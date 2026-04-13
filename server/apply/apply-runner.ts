// Direct Playwright auto-apply runner.
// Replaces the Agent SDK + MCP approach with deterministic form filling.
//
// Usage:
//   npx tsx server/apply/apply-runner.ts <job-id>           # apply to one job
//   npx tsx server/apply/apply-runner.ts <url>              # apply to a URL directly
//   npx tsx server/apply/apply-runner.ts --batch            # apply to all supported new jobs
//   npx tsx server/apply/apply-runner.ts --batch --limit 5  # apply to 5 new jobs

import { config } from "dotenv";
config();

import { chromium } from "playwright";
import { join } from "path";
import * as readline from "readline/promises";
import { loadProfileFromDisk } from "../tools/profile-tools.js";
import { loadJobs, saveJobs, markApplied, type Job } from "../scraper/dedup.js";
import { detectATS } from "../config/scrape-config.js";
import { buildProfileData, type ProfileData } from "./form-filler.js";
import { draftCustomAnswers, presentToUser } from "./custom-questions.js";

// Dynamic imports for platform fillers (ESM-compatible)
async function getFillerForUrl(url: string) {
  const ats = detectATS(url);
  switch (ats) {
    case "ashby":
      return (await import("./fillers/ashby.js")).default;
    case "greenhouse":
      return (await import("./fillers/greenhouse.js")).default;
    case "lever":
      return (await import("./fillers/lever.js")).default;
    default:
      throw new Error(
        `Unsupported platform: ${ats}. Auto-apply supports ashby, greenhouse, and lever only.`,
      );
  }
}

const SUPPORTED_PLATFORMS = new Set(["ashby", "greenhouse", "lever"]);

const args = process.argv.slice(2);
const BATCH_MODE = args.includes("--batch");
const limitIdx = args.indexOf("--limit");
const BATCH_LIMIT = limitIdx >= 0 ? parseInt(args[limitIdx + 1], 10) : Infinity;

async function prompt(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(question);
  rl.close();
  return answer.trim();
}

async function applyToJob(
  job: { id: string; url: string; title: string | null; company: string | null },
  profile: ProfileData,
) {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`  Applying to: ${job.title || "Unknown"} at ${job.company || "Unknown"}`);
  console.log(`  URL: ${job.url}`);
  console.log(`  Platform: ${detectATS(job.url)}`);
  console.log(`${"=".repeat(60)}\n`);

  const filler = await getFillerForUrl(job.url);

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
  });
  const page = await context.newPage();

  try {
    // Step 1: Navigate to form
    console.log("  Navigating to application form...");
    await filler.navigateToForm(page, job.url);
    console.log("  Form loaded.");

    // Step 2: Fill standard fields
    console.log("  Filling standard fields...");
    const result = await filler.fillStandardFields(page, profile);
    if (result.filled.length > 0) {
      console.log(`  Filled: ${result.filled.join(", ")}`);
    }
    if (result.skipped.length > 0) {
      console.log(`  Skipped: ${result.skipped.join(", ")}`);
    }
    if (result.failed.length > 0) {
      console.log(`  Failed: ${result.failed.join(", ")}`);
    }

    // Step 3: Handle custom questions
    console.log("  Checking for custom questions...");
    const customQs = await filler.extractCustomQuestions(page);

    if (customQs.length > 0) {
      console.log(`  Found ${customQs.length} custom question(s). Drafting answers...`);
      const drafts = await draftCustomAnswers(customQs, profile, job.title, job.company);
      const approved = await presentToUser(drafts);

      const answerMap = new Map<string, string>();
      for (const a of approved) {
        if (a.approved && a.finalAnswer) {
          answerMap.set(a.question, a.finalAnswer);
        }
      }

      if (answerMap.size > 0) {
        await filler.fillCustomAnswers(page, answerMap);
        console.log(`  Filled ${answerMap.size} custom answer(s).`);
      }
    } else {
      console.log("  No custom questions found.");
    }

    // Step 4: Pre-submit confirmation
    const failStr = result.failed.length > 0 ? ` | ${result.failed.length} FAILED` : "";
    const confirmMsg =
      result.failed.length > 0
        ? `\n  WARNING: ${result.failed.join(", ")} failed to fill.\n  ${job.company} — ${result.filled.length} filled${failStr}. Submit?\n`
        : `\n  ${job.company} — ${result.filled.length} fields filled. Submit?\n`;

    console.log(confirmMsg);
    const choice = await prompt("  [Enter] Submit  [2] Review in browser  [3] Skip > ");

    if (choice === "3") {
      console.log("  Skipped.");
      return false;
    }

    if (choice === "2") {
      await prompt("  Review the form in the browser. Press Enter when ready to submit... ");
    }

    // Step 5: Submit
    console.log("  Submitting...");
    await filler.submit(page);
    console.log("  Submitted!");

    // Step 6: Mark as applied
    if (job.id !== "manual") {
      const data = loadJobs();
      markApplied(data, job.id);
      saveJobs(data);
      console.log(`  Marked as applied in jobs.json.`);
    }

    return true;
  } catch (e) {
    console.error(`  Error: ${e instanceof Error ? e.message : String(e)}`);

    // Give user a chance to review the browser state
    const recover = await prompt("  Error occurred. [Enter] Close browser  [2] Keep browser open > ");
    if (recover === "2") {
      await prompt("  Browser kept open. Press Enter when done to close... ");
    }

    return false;
  } finally {
    await browser.close();
  }
}

async function main() {
  console.log(`\n  JOB COMMAND CENTER — DIRECT APPLY\n`);

  // Load profile once
  const raw = loadProfileFromDisk();
  const profile = buildProfileData(raw);
  profile.resume_path = join(process.cwd(), raw.resume_path || "resume.pdf");

  if (BATCH_MODE) {
    const data = loadJobs();
    const newJobs = data.jobs.filter(
      (j) => j.status === "new" && SUPPORTED_PLATFORMS.has(j.ats),
    );

    if (newJobs.length === 0) {
      console.log("  No new jobs on supported platforms (ashby, greenhouse, lever).");
      console.log("  Run a scrape first, or use a direct URL.");
      return;
    }

    const toApply = newJobs.slice(0, BATCH_LIMIT);
    const unsupported = data.jobs.filter((j) => j.status === "new" && !SUPPORTED_PLATFORMS.has(j.ats)).length;

    console.log(`  Batch mode: ${toApply.length} supported jobs`);
    console.log(`  (${newJobs.length} total on supported platforms, ${unsupported} on unsupported platforms)`);
    console.log(`  Ctrl+C to stop anytime.\n`);

    let applied = 0;
    let skipped = 0;

    for (let i = 0; i < toApply.length; i++) {
      const job = toApply[i];
      console.log(`\n  [${i + 1}/${toApply.length}] ${job.title || "?"} @ ${job.company || "?"} (${job.ats})`);

      const success = await applyToJob(job, profile);
      if (success) applied++;
      else skipped++;

      if (i < toApply.length - 1) {
        console.log(`\n  Next in 2s... (Ctrl+C to stop)`);
        await new Promise((r) => setTimeout(r, 2000));
      }
    }

    console.log(`\n${"=".repeat(60)}`);
    console.log(`  Session Summary`);
    console.log(`  Applied: ${applied} | Skipped: ${skipped}`);
    console.log(`${"=".repeat(60)}`);
  } else if (args.length > 0 && !args[0].startsWith("--")) {
    const target = args[0];

    if (target.startsWith("http")) {
      // Direct URL mode
      const ats = detectATS(target);
      if (!SUPPORTED_PLATFORMS.has(ats)) {
        console.error(`  Platform "${ats}" is not supported. Only ashby, greenhouse, lever.`);
        return;
      }
      await applyToJob({ id: "manual", url: target, title: null, company: null }, profile);
    } else {
      // Job ID mode
      const data = loadJobs();
      const job = data.jobs.find((j) => j.id === target);
      if (!job) {
        console.error(`  Job ID "${target}" not found.`);
        return;
      }
      if (job.status === "applied") {
        console.log(`  Already applied to "${job.title}" at ${job.company}.`);
        return;
      }
      if (!SUPPORTED_PLATFORMS.has(job.ats)) {
        console.error(`  Platform "${job.ats}" is not supported. Only ashby, greenhouse, lever.`);
        return;
      }
      await applyToJob(job, profile);
    }
  } else {
    console.log("Usage:");
    console.log("  npx tsx server/apply/apply-runner.ts <job-id>           # apply to one job");
    console.log("  npx tsx server/apply/apply-runner.ts <url>              # apply to a URL");
    console.log("  npx tsx server/apply/apply-runner.ts --batch            # all supported new jobs");
    console.log("  npx tsx server/apply/apply-runner.ts --batch --limit 5  # apply to 5 new jobs");
    console.log("");

    const data = loadJobs();
    const supported = data.jobs.filter((j) => j.status === "new" && SUPPORTED_PLATFORMS.has(j.ats));
    const unsupported = data.jobs.filter((j) => j.status === "new" && !SUPPORTED_PLATFORMS.has(j.ats));
    console.log(`  Supported new jobs: ${supported.length} (ashby: ${supported.filter(j => j.ats === "ashby").length}, greenhouse: ${supported.filter(j => j.ats === "greenhouse").length}, lever: ${supported.filter(j => j.ats === "lever").length})`);
    console.log(`  Unsupported (manual): ${unsupported.length}`);
  }
}

main().catch(console.error);
