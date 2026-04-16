// Apply Agent: Uses Claude Agent SDK with Playwright MCP to fill out
// high-confidence job application fields in a visible browser, then
// hands off the live form to the user for manual review/submission.
//
// Usage:
//   npx tsx server/agents/apply-agent.ts <job-id>           # apply to one job
//   npx tsx server/agents/apply-agent.ts <url>              # apply to a URL directly
//   npx tsx server/agents/apply-agent.ts --batch            # apply to all "new" jobs
//   npx tsx server/agents/apply-agent.ts --batch --limit 5  # apply to 5 new jobs

import { config } from "dotenv";
config();

// Extend timeout for browser interactions (default is too short)
process.env.CLAUDE_CODE_MAX_TURN_TIMEOUT_MS = process.env.CLAUDE_CODE_MAX_TURN_TIMEOUT_MS || "300000";

import { query } from "@anthropic-ai/claude-agent-sdk";
import { loadJobs } from "../scraper/dedup.js";
import { profileServer } from "../tools/profile-tools.js";
import { applyToolsServer } from "../tools/apply-tools.js";
import { buildApplySystemPrompt } from "./prompts/apply-fill.js";

const args = process.argv.slice(2);
const BATCH_MODE = args.includes("--batch");
const limitIdx = args.indexOf("--limit");
const parsedBatchLimit = limitIdx >= 0 ? Number.parseInt(args[limitIdx + 1] || "", 10) : null;
const BATCH_LIMIT =
  parsedBatchLimit !== null && Number.isInteger(parsedBatchLimit) && parsedBatchLimit > 0
    ? parsedBatchLimit
    : Infinity;
const APPLY_AGENT_MODEL = process.env.APPLY_AGENT_MODEL || "claude-sonnet-4-6";
const APPLY_AGENT_MAX_BUDGET_USD = (() => {
  const parsed = Number.parseFloat(process.env.APPLY_AGENT_MAX_BUDGET_USD || "2");
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 2;
})();

interface ApplyTarget {
  id: string | null;
  url: string;
  title: string | null;
  company: string | null;
}

const AUTOFILL_TOOL_NAMES = new Set([
  "mcp__playwright__browser_fill_form",
  "mcp__playwright__browser_file_upload",
  "mcp__playwright__browser_type",
  "mcp__playwright__browser_select_option",
]);
const HANDOFF_TOOL_NAME = "mcp__apply_tools__wait_for_user_handoff";

function isAllowedAgentTool(toolName: string): boolean {
  return (
    toolName.startsWith("mcp__playwright__")
    || toolName.startsWith("mcp__profile__")
    || toolName.startsWith("mcp__apply_tools__")
  );
}

async function applyToJob(job: ApplyTarget) {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`  Applying to: ${job.title || "Unknown"} at ${job.company || "Unknown"}`);
  console.log(`  URL: ${job.url}`);
  console.log(`  Job ID: ${job.id || "manual (not tracked in jobs.json)"}`);
  console.log(`${"=".repeat(60)}\n`);

  const systemPrompt = buildApplySystemPrompt();
  const trackingInstructions = job.id
    ? `This application is tracked in jobs.json.
Job ID for marking as applied after submission: ${job.id}`
    : `This application came from a direct URL and is not tracked in jobs.json.
Do not call mark_applied for this run.`;

  const applyPrompt = `Apply to this job posting: ${job.url}

${trackingInstructions}
Job title: ${job.title || "Unknown"}
Company: ${job.company || "Unknown"}

Steps:
1. First call load_profile to get the applicant's profile data
2. Call get_resume_path to get the file path for uploading the configured resume file
3. Launch the visible Playwright browser immediately and navigate to the job URL there
4. If there's an "Apply" button, click it to reach the application form
5. Fill only the fields you are highly confident about, and upload the resume when possible
6. Do not use WebFetch or ToolSearch for this run; the user wants a live browser workflow
7. Do not ask the user to answer custom questions mid-run; leave low-confidence, free-text, salary, and personal-attestation fields for manual review
8. Do not submit automatically
9. When the browser is ready for the user, call wait_for_user_handoff exactly once so the terminal waits while the browser stays open and the agent stops touching the page
10. Tell the user to review, finish any remaining fields, submit manually in the browser, then return to the terminal and answer there
11. ${job.id ? `If wait_for_user_handoff says the user submitted it, call mark_applied with job ID "${job.id}"` : "If wait_for_user_handoff says the user submitted it, skip mark_applied because there is no tracked job ID"}
12. Call log_application with details of what was filled and whether wait_for_user_handoff says it was submitted. Use job_id "${job.id || "manual"}" in the log.`;

  try {
    let usedPlaywright = false;
    let autofillWorkDone = false;
    let handoffStarted = false;

    for await (const message of query({
      prompt: applyPrompt,
      options: {
        systemPrompt,
        // Playwright MCP for browser automation
        mcpServers: {
          playwright: { command: "npx", args: ["@playwright/mcp@latest"] },
          profile: profileServer,
          apply_tools: applyToolsServer,
        },
        allowedTools: [
          "mcp__playwright__*",
          "mcp__profile__*",
          "mcp__apply_tools__*",
        ],
        tools: [],
        model: APPLY_AGENT_MODEL,
        effort: "medium",
        maxTurns: 50,
        maxBudgetUsd: APPLY_AGENT_MAX_BUDGET_USD,
        permissionMode: "dontAsk",
        canUseTool: async (toolName: string, input: any) => {
          if (!isAllowedAgentTool(toolName)) {
            return {
              behavior: "deny" as const,
              message: `Do not use ${toolName} in this workflow. Use Playwright plus the profile/apply MCP tools only.`,
            };
          }

          if (
            handoffStarted
            && (
              toolName.startsWith("mcp__playwright__")
              || toolName.startsWith("mcp__profile__")
              || toolName === HANDOFF_TOOL_NAME
            )
          ) {
            return {
              behavior: "deny" as const,
              message:
                "The first-pass autofill handoff has already started. Do not touch the browser again. Only finish logging and marking the job if needed.",
            };
          }

          if (toolName.startsWith("mcp__playwright__")) {
            usedPlaywright = true;
            if (AUTOFILL_TOOL_NAMES.has(toolName)) {
              autofillWorkDone = true;
            }
          }

          if (toolName === HANDOFF_TOOL_NAME) {
            if (!usedPlaywright || !autofillWorkDone) {
              return {
                behavior: "deny" as const,
                message:
                  "Do the first-pass autofill before handing off. Open the browser, fill high-confidence fields, then call wait_for_user_handoff once.",
              };
            }

            handoffStarted = true;
            return {
              behavior: "allow" as const,
              updatedInput: input,
            };
          }

          // Auto-approve the remaining explicitly allowed tools
          return { behavior: "allow" as const, updatedInput: input };
        },
      },
    })) {
      const msg = message as any;
      // Print agent's thinking and actions
      if (msg.type === "assistant" && msg.message?.content) {
        for (const block of msg.message.content) {
          if (block.type === "text") {
            console.log(`  ${block.text}`);
          } else if (block.type === "tool_use") {
            console.log(`  [tool] ${block.name}`);
          }
        }
      } else if (msg.type === "result") {
        if (msg.subtype === "success") {
          console.log(`\n  Application complete.`);
          if (msg.total_cost_usd) {
            console.log(`  Cost: $${msg.total_cost_usd.toFixed(4)}`);
          }
        } else {
          console.log(`\n  Application ended: ${msg.subtype}`);
        }
      }
    }
  } catch (e) {
    console.error(`  Application failed: ${e instanceof Error ? e.message : String(e)}`);
  }
}

async function main() {
  console.log(`\n╔${"═".repeat(56)}╗`);
  console.log(`║          JOB COMMAND CENTER — APPLY AGENT             ║`);
  console.log(`╚${"═".repeat(56)}╝\n`);

  if (BATCH_MODE) {
    if (limitIdx >= 0 && BATCH_LIMIT === Infinity) {
      console.error('  Invalid --limit value. Use a positive integer, for example "--limit 5".');
      return;
    }

    // Batch: apply to all "new" jobs
    const data = loadJobs();
    const newJobs = data.jobs.filter((j) => j.status === "new");

    if (newJobs.length === 0) {
      console.log("  No new jobs to apply to. Run a scrape first.");
      return;
    }

    const toApply = newJobs.slice(0, BATCH_LIMIT);
    console.log(`  Batch mode: ${toApply.length} jobs to apply to`);
    console.log(`  (${newJobs.length} total new, limit: ${BATCH_LIMIT === Infinity ? "none" : BATCH_LIMIT})\n`);

    console.log("  Auto-advancing between jobs. Press Ctrl+C to stop.\n");

    for (let i = 0; i < toApply.length; i++) {
      const job = toApply[i];
      console.log(`\n[${i + 1}/${toApply.length}] ${job.title || "?"} @ ${job.company || "?"}`);
      await applyToJob(job);

      // Auto-advance with small delay
      if (i < toApply.length - 1) {
        console.log(`\n  → Next in 2s... (Ctrl+C to stop)`);
        await new Promise((r) => setTimeout(r, 2000));
      }
    }

    // Print summary
    const updated = loadJobs();
    const applied = updated.jobs.filter((j) => j.status === "applied");
    console.log(`\n${"=".repeat(60)}`);
    console.log(`  Session Summary`);
    console.log(`  Total applied: ${applied.length}`);
    console.log(`  Remaining new: ${updated.jobs.filter((j) => j.status === "new").length}`);
    console.log(`${"=".repeat(60)}`);
  } else if (args.length > 0 && !args[0].startsWith("--")) {
    const target = args[0];

    // Check if it's a job ID or a URL
    if (target.startsWith("http")) {
      // Direct URL mode
      await applyToJob({ id: null, url: target, title: null, company: null });
    } else {
      // Job ID mode
      const data = loadJobs();
      const job = data.jobs.find((j) => j.id === target);
      if (!job) {
        console.error(`  Job ID "${target}" not found in jobs.json`);
        return;
      }
      if (job.status === "applied") {
        console.log(`  Job "${job.title}" at ${job.company} is already applied. Skipping.`);
        return;
      }
      await applyToJob(job);
    }
  } else {
    console.log("Usage:");
    console.log("  npx tsx server/agents/apply-agent.ts <job-id>           # apply to one job");
    console.log("  npx tsx server/agents/apply-agent.ts <url>              # apply to a URL");
    console.log("  npx tsx server/agents/apply-agent.ts --batch            # apply to all new jobs");
    console.log("  npx tsx server/agents/apply-agent.ts --batch --limit 5  # apply to 5 new jobs");
  }
}

main().catch(console.error);
