// Interview Story Bank Generator
// Generates STAR+R stories tailored to a specific job posting.
// Stories accumulate in server/data/story-bank.md over time.
//
// Usage:
//   npx tsx server/agents/story-agent.ts <job-id>

import { config } from "dotenv";
config();

import Anthropic from "@anthropic-ai/sdk";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { loadJobs } from "../scraper/dedup.js";
import { loadProfileFromDisk } from "../tools/profile-tools.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const STORY_BANK_PATH = join(__dirname, "../data/story-bank.md");

async function main() {
  const jobId = process.argv[2];
  if (!jobId) {
    console.log("Usage: npx tsx server/agents/story-agent.ts <job-id>");
    console.log("       npm run stories -- <job-id>");
    process.exit(1);
  }

  const data = loadJobs();
  const job = data.jobs.find((j) => j.id === jobId);
  if (!job) {
    console.error(`Job "${jobId}" not found in jobs.json`);
    process.exit(1);
  }

  const profile = loadProfileFromDisk();
  const existing = existsSync(STORY_BANK_PATH)
    ? readFileSync(STORY_BANK_PATH, "utf-8")
    : "";

  // Extract one-line summaries of existing stories for dedup
  const existingSummaries = existing
    .split("\n")
    .filter((l) => l.startsWith("### "))
    .map((l) => l.replace("### ", "").trim())
    .join("\n");

  console.log(`\n  Generating STAR stories for: ${job.title} at ${job.company}`);
  console.log(`  Existing stories: ${existingSummaries ? existingSummaries.split("\n").length : 0}\n`);

  const client = new Anthropic();
  const response = await client.messages.create({
    model: "claude-sonnet-4-6-20250514",
    max_tokens: 3000,
    messages: [
      {
        role: "user",
        content: `Generate 4-6 STAR+R interview stories that would be relevant for this specific role.

## Target Role
Title: ${job.title || "Unknown"}
Company: ${job.company || "Unknown"}
Location: ${job.location || "Unknown"}
Seniority: ${job.seniority || "Unknown"}

## Candidate Background
${profile.background_context || "No background context available"}

Current role: ${profile.current_title || "?"} at ${profile.current_company || "?"}
Years of experience: ${profile.years_experience || "?"}

## Existing Stories (avoid duplicating these themes)
${existingSummaries || "None yet"}

## Output Format
For each story, use this exact format:

### [Short descriptive title]
**Relevant for:** [what interview questions this answers]

**Situation:** [1-2 sentences — the context and challenge]
**Task:** [1 sentence — your specific responsibility]
**Action:** [2-3 sentences — what you did, be specific about tools/approaches]
**Result:** [1-2 sentences — quantified outcome if possible]
**Reflection:** [1 sentence — what you learned or would do differently]

## Rules
- Stories must be based on the candidate's REAL experience from their background
- Focus on stories most relevant to THIS specific role
- Include at least 1 story about leadership/influence
- Include at least 1 story about technical problem-solving
- Quantify results where the background provides metrics
- Do NOT invent experience — only use what's in the background context
- Each story should be distinct (different project, different skill demonstrated)`,
      },
    ],
  });

  const stories =
    response.content[0].type === "text" ? response.content[0].text : "";

  if (!stories) {
    console.error("  No stories generated.");
    process.exit(1);
  }

  const today = new Date().toISOString().split("T")[0];
  const header = `\n---\n\n## ${job.title} at ${job.company} (${today})\n\n`;
  const newContent = existing + header + stories + "\n";

  writeFileSync(STORY_BANK_PATH, newContent);

  const storyCount = (stories.match(/^### /gm) || []).length;
  console.log(`  Generated ${storyCount} stories.`);
  console.log(`  Saved to: ${STORY_BANK_PATH}`);

  if (response.usage) {
    const cost =
      (response.usage.input_tokens * 3 + response.usage.output_tokens * 15) /
      1_000_000;
    console.log(`  Cost: $${cost.toFixed(4)}`);
  }
}

main().catch(console.error);
