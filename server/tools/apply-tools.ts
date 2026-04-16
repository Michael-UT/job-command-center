// Custom MCP tools for the apply agent:
// - mark_applied: update job status in jobs.json
// - log_application: write detailed application log

import { tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { loadJobs, saveJobs, markApplied } from "../scraper/dedup.js";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import * as readline from "readline/promises";

const PROJECT_ROOT = process.cwd();
const APP_LOG_PATH = join(PROJECT_ROOT, "applications_log.json");

const markJobApplied = tool(
  "mark_applied",
  "Mark a job as 'applied' in jobs.json so it shows as greyed out in the dashboard and prevents double-applying.",
  { job_id: z.string().describe("The job ID from jobs.json") },
  async (args) => {
    try {
      const data = loadJobs();
      const success = markApplied(data, args.job_id);
      if (success) {
        saveJobs(data);
        return { content: [{ type: "text" as const, text: `Job ${args.job_id} marked as applied.` }] };
      }
      return { content: [{ type: "text" as const, text: `Job ${args.job_id} not found.` }], isError: true };
    } catch (e) {
      return { content: [{ type: "text" as const, text: `Error: ${e instanceof Error ? e.message : String(e)}` }], isError: true };
    }
  },
);

interface ApplicationLogEntry {
  job_id: string;
  url: string;
  company: string;
  title: string;
  fields_filled: string[];
  fields_skipped: string[];
  custom_answers: Record<string, string>;
  submitted: boolean;
  timestamp: string;
}

async function prompt(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(question);
  rl.close();
  return answer;
}

const logApplication = tool(
  "log_application",
  "Log detailed info about a completed application to applications_log.json.",
  {
    job_id: z.string().describe("Job ID"),
    url: z.string().describe("Job URL"),
    company: z.string().default("Unknown").describe("Company name"),
    title: z.string().default("Unknown").describe("Job title"),
    fields_filled: z.array(z.string()).default([]).describe("Fields that were filled"),
    fields_skipped: z.array(z.string()).default([]).describe("Fields that were skipped"),
    custom_answers: z.record(z.string(), z.string()).default({}).describe("Question -> answer pairs entered during the application"),
    submitted: z.boolean().describe("Whether form was submitted"),
  },
  async (args) => {
    try {
      let log: ApplicationLogEntry[] = [];
      if (existsSync(APP_LOG_PATH)) {
        log = JSON.parse(readFileSync(APP_LOG_PATH, "utf-8"));
      }

      log.push({
        job_id: args.job_id,
        url: args.url,
        company: args.company,
        title: args.title,
        fields_filled: args.fields_filled,
        fields_skipped: args.fields_skipped,
        custom_answers: args.custom_answers,
        submitted: args.submitted,
        timestamp: new Date().toISOString(),
      });

      writeFileSync(APP_LOG_PATH, JSON.stringify(log, null, 2));
      return { content: [{ type: "text" as const, text: `Application logged for ${args.company} - ${args.title}` }] };
    } catch (e) {
      return { content: [{ type: "text" as const, text: `Error: ${e instanceof Error ? e.message : String(e)}` }], isError: true };
    }
  },
);

const waitForUserHandoff = tool(
  "wait_for_user_handoff",
  "Pause after the first-pass autofill so the user can finish reviewing/submitting in the browser without the agent touching the page again. Returns whether the user says they submitted.",
  {
    company: z.string().default("Unknown").describe("Company name"),
    title: z.string().default("Unknown").describe("Job title"),
    autofilled_fields: z.array(z.string()).default([]).describe("High-confidence fields the agent filled"),
    manual_review_items: z.array(z.string()).default([]).describe("Fields or sections the user should review/fill manually"),
    notes: z.string().default("").describe("Short additional note for the handoff"),
  },
  async (args) => {
    try {
      console.log(`\n  Browser handoff: ${args.title} @ ${args.company}`);
      console.log("  Autofill first pass is complete. The agent will stop touching the browser now.");

      if (args.autofilled_fields.length > 0) {
        console.log("\n  Autofilled:");
        for (const item of args.autofilled_fields) {
          console.log(`  - ${item}`);
        }
      }

      if (args.manual_review_items.length > 0) {
        console.log("\n  Review manually:");
        for (const item of args.manual_review_items) {
          console.log(`  - ${item}`);
        }
      }

      if (args.notes.trim()) {
        console.log(`\n  Note: ${args.notes.trim()}`);
      }

      console.log("\n  Finish the remaining fields and submit in the browser if you want.");
      console.log('  Then return here and type "submitted" or "not submitted".');
      console.log("  [Browser stays open while waiting here]");

      const response = (await prompt("  > ")).trim().toLowerCase();
      const submitted = response === "submitted" || response === "submit" || response === "yes" || response === "y";

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                submitted,
                raw_response: response || "not submitted",
              },
              null,
              2,
            ),
          },
        ],
      };
    } catch (e) {
      return {
        content: [{ type: "text" as const, text: `Error: ${e instanceof Error ? e.message : String(e)}` }],
        isError: true,
      };
    }
  },
);

export const applyToolsServer = createSdkMcpServer({
  name: "apply_tools",
  version: "1.0.0",
  tools: [markJobApplied, logApplication, waitForUserHandoff],
});
