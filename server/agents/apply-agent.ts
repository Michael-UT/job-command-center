// Apply Agent: Uses Claude Agent SDK with Playwright MCP to fill out
// job application forms. Asks the user for input on ambiguous fields
// via AskUserQuestion in the terminal.
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
import { loadJobs, saveJobs, type Job } from "../scraper/dedup.js";
import { profileServer, loadProfileFromDisk } from "../tools/profile-tools.js";
import { applyToolsServer } from "../tools/apply-tools.js";
import { buildApplySystemPrompt } from "./prompts/apply-fill.js";
import * as readline from "readline/promises";

const args = process.argv.slice(2);
const BATCH_MODE = args.includes("--batch");
const limitIdx = args.indexOf("--limit");
const BATCH_LIMIT = limitIdx >= 0 ? parseInt(args[limitIdx + 1], 10) : Infinity;

// Helper to prompt user in terminal
async function prompt(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(question);
  rl.close();
  return answer;
}

async function applyToJob(job: { id: string; url: string; title: string | null; company: string | null }) {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`  Applying to: ${job.title || "Unknown"} at ${job.company || "Unknown"}`);
  console.log(`  URL: ${job.url}`);
  console.log(`  Job ID: ${job.id}`);
  console.log(`${"=".repeat(60)}\n`);

  const profile = loadProfileFromDisk();
  const systemPrompt = buildApplySystemPrompt(profile);

  const applyPrompt = `Apply to this job posting: ${job.url}

Job ID for marking as applied after submission: ${job.id}
Job title: ${job.title || "Unknown"}
Company: ${job.company || "Unknown"}

IMPORTANT: You MUST use the Playwright MCP tools (mcp__playwright__*) for ALL browser interactions.
Use browser_navigate to open pages, browser_snapshot to see the page, browser_click to click elements,
browser_fill_form to fill inputs, browser_select_option for dropdowns, and browser_file_upload for resume.
Do NOT use Bash or any other method to interact with the browser.

Steps:
1. First call load_profile to get the applicant's profile data
2. Call get_resume_text to read the resume content for answering custom questions
3. Use browser_navigate to open the job URL
4. Use browser_snapshot to see the page, then click "Apply" if present
5. Use browser_snapshot to see form fields, then use browser_fill_form and browser_click to fill each field following the behavioral rules in your system prompt
6. For any field you're not >90% confident about, ask the user via AskUserQuestion
7. Before submitting, show a complete summary and ask for confirmation
8. After confirmed submission, call mark_applied with job ID "${job.id}"
9. Call log_application with details of what was filled`;

  try {
    for await (const message of query({
      prompt: applyPrompt,
      options: {
        systemPrompt,
        // Playwright MCP for browser automation
        mcpServers: {
          playwright: { type: "stdio" as const, command: "npx", args: ["@playwright/mcp", "--headless=false"] },
          profile: profileServer,
          apply_tools: applyToolsServer,
        },
        allowedTools: [
          "AskUserQuestion",
          "mcp__playwright__*",
          "mcp__profile__*",
          "mcp__apply_tools__*",
        ],
        maxTurns: 50,
        permissionMode: "default",
        canUseTool: async (toolName: string, input: any) => {
          // AskUserQuestion — present to user in terminal
          if (toolName === "AskUserQuestion") {
            const answers: Record<string, string> = {};

            for (const q of input.questions || []) {
              const options = q.options || [];
              // Compact display: question + options on fewer lines
              const optStr = options.map((o: any, i: number) => `${i + 1}) ${o.label}`).join("  ");
              console.log(`\n  ${q.question}`);
              console.log(`  ${optStr}`);
              console.log(`  [Enter = ${options[0]?.label || "1"}]`);

              const response = (await prompt("  > ")).trim();

              if (response === "" && options.length > 0) {
                // Enter = first option (Submit / Accept)
                answers[q.question] = options[0].label;
              } else {
                const num = parseInt(response, 10);
                if (!isNaN(num) && num >= 1 && num <= options.length) {
                  answers[q.question] = options[num - 1].label;
                } else {
                  answers[q.question] = response;
                }
              }
            }

            return {
              behavior: "allow" as const,
              updatedInput: { questions: input.questions, answers },
            };
          }

          // Auto-approve all other allowed tools
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
      await applyToJob({ id: "manual", url: target, title: null, company: null });
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
