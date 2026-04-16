// Backfill: for jobs whose company field holds an aggregator site name
// (Startup Jobs, Wellfound, Built In, etc.), re-run cleanTitleAndCompany
// to extract the real employer from the title (e.g., "Engineer at OpenAI"
// → company: OpenAI, title: Engineer). Also re-applies priority flag.
//
// Usage:
//   npx tsx server/scraper/cleanup-aggregator-companies.ts --dry-run
//   npx tsx server/scraper/cleanup-aggregator-companies.ts

import { config } from "dotenv";
config();

import { loadJobs, saveJobs, cleanTitleAndCompany } from "./dedup.js";
import { isPriorityCompany } from "../config/priority-companies.js";

const DRY_RUN = process.argv.includes("--dry-run");

const AGGREGATOR_NAMES = new Set([
  "startup jobs", "startup.jobs",
  "wellfound", "angellist",
  "built in", "builtin",
  "indeed", "glassdoor", "ziprecruiter",
  "linkedin",
  "ai jobs", "ai-jobs.net",
  "jobgether",
  "available jobs",
  "yc jobs", "y combinator jobs", "workatastartup",
  "remote rocketship",
  "career center",
]);

function main() {
  const data = loadJobs();
  const targets = data.jobs.filter((j) =>
    j.company && AGGREGATOR_NAMES.has(j.company.trim().toLowerCase()),
  );

  console.log(`Jobs with aggregator-name company: ${targets.length}`);
  if (targets.length === 0) {
    console.log("Nothing to fix.");
    return;
  }

  let fixed = 0;
  let unchanged = 0;
  const samples: { before: string; after: string }[] = [];

  for (const j of targets) {
    const before = `${j.title} | ${j.company}`;
    const cleaned = cleanTitleAndCompany(j.title, j.company);
    if (cleaned.company && cleaned.company !== j.company) {
      if (samples.length < 10) {
        samples.push({
          before,
          after: `${cleaned.title} | ${cleaned.company}`,
        });
      }
      if (!DRY_RUN) {
        j.title = cleaned.title;
        j.company = cleaned.company;
        // Re-evaluate priority based on the now-correct company
        const wasPriority = j.priority;
        j.priority = isPriorityCompany(cleaned.company);
        if (j.priority && !wasPriority) {
          // Note: priority boost is applied at scoring time, not here.
          // Score will be re-boosted on the next scrape; for now leave score as-is.
        }
      }
      fixed++;
    } else {
      unchanged++;
    }
  }

  console.log(`\nWould fix:    ${fixed}`);
  console.log(`Unchanged:    ${unchanged}  (no "X at Y" pattern in title)`);
  console.log("\nSample of changes:");
  for (const s of samples) {
    console.log(`  BEFORE: ${s.before}`);
    console.log(`  AFTER:  ${s.after}`);
    console.log();
  }

  if (DRY_RUN) {
    console.log("[dry-run] No changes written. Re-run without --dry-run to apply.");
    return;
  }

  saveJobs(data);
  console.log(`Saved. ${fixed} jobs updated.`);
}

main();
