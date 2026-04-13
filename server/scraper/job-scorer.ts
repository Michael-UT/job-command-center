// Batch AI scoring: rates each job 1-5 based on fit to user's profile.
// Uses Claude API in batches of 10 jobs to minimize cost (~$0.02 per 100 jobs).

import { config } from "dotenv";
config();

import type { Job } from "./dedup.js";
import { loadProfileFromDisk } from "../tools/profile-tools.js";

let client: any;
async function getClient() {
  if (!client) {
    const mod = await import("@anthropic-ai/sdk");
    const Anthropic = (mod as any).default || mod;
    client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return client;
}

function buildScoringPrompt(jobs: Job[], profileContext: string): string {
  const jobLines = jobs
    .map(
      (j, i) =>
        `${i + 1}. "${j.title || "Unknown"}" at ${j.company || "Unknown"} | ${j.location || "?"} | ${j.salary || "no salary"} | ${j.seniority || "?"}`,
    )
    .join("\n");

  return `Rate each job on a 0.00-10.00 scale based on fit for this candidate. Use 2 decimal places for nuance (e.g. 8.45). Reply ONLY with a JSON array of decimals, e.g. [9.20,6.75,8.10,3.50,1.25].

## Candidate Profile
${profileContext}

## Scoring Rubric (use the full range, be nuanced)

9.00-10.00 = PERFECT — Forward Deployed Engineer / Applied AI / AI Deployment role at a top-tier AI-native company (Anthropic, OpenAI, Cognition, Sierra, Decagon, etc.). Exactly the candidate's target.

8.00-8.99 = EXCELLENT — FDE/Applied AI/AI Deployment at a strong AI company, OR Solutions Engineer AI / AI Consultant / Customer Engineer AI at a premier AI company.

7.00-7.99 = VERY STRONG — Solutions Engineer AI, AI Consultant, AI Implementation Engineer, Technical Solutions Engineer AI at a good company. Clear AI focus, client-facing.

6.00-6.99 = STRONG — Applied AI Engineer, AI Platform Engineer, LLM Engineer at a legit AI company. Good fit but less client-facing than target roles.

5.00-5.99 = DECENT — General AI/ML Engineer, ML Platform Engineer, Generative AI Engineer. Adjacent but not the sweet spot.

4.00-4.99 = MODERATE — Solutions Engineer (generic), Pre-Sales Engineer, Customer Engineer at non-AI company, OR ML Engineer at traditional company.

3.00-3.99 = WEAK — General software engineering role, even at a good company. Not AI-focused.

2.00-2.99 = POOR — Engineering role in wrong domain (embedded, hardware, DevOps), or right role but very junior/senior mismatch.

1.00-1.99 = VERY POOR — Non-engineering technical role, wrong industry.

0.00-0.99 = REJECT — Completely irrelevant (legal, HR, sales ops, etc.).

## Instructions

- Use the FULL range with 2-decimal nuance — don't just pick round numbers. A 7.80 is meaningfully different from a 7.20.
- Consider company quality: a Staff Solutions Engineer at Anthropic > a Staff Solutions Engineer at a random SaaS.
- Consider seniority match: candidate has 5 years of experience. Principal/Director roles should score lower.
- Consider location: prefer US/Remote; international roles score lower.

## Jobs to Score
${jobLines}`;
}

export async function scoreJobs(jobs: Job[]): Promise<void> {
  if (jobs.length === 0) return;

  const profile = loadProfileFromDisk();
  const profileContext = [
    `Current role: ${profile.current_title || "?"} at ${profile.current_company || "?"}`,
    `Years of experience: ${profile.years_experience || "?"}`,
    `Target: FDE, AI Deployment, Applied AI, Solutions Engineer roles`,
    `Background: ${(profile.background_context || "").slice(0, 500)}`,
  ].join("\n");

  const BATCH_SIZE = 10;
  const anthropic = await getClient();

  for (let i = 0; i < jobs.length; i += BATCH_SIZE) {
    const batch = jobs.slice(i, i + BATCH_SIZE);
    process.stdout.write(`  Scoring jobs ${i + 1}-${i + batch.length}... `);

    try {
      const response = await anthropic.messages.create({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 300,
        messages: [
          { role: "user", content: buildScoringPrompt(batch, profileContext) },
        ],
      });

      const text =
        response.content[0].type === "text" ? response.content[0].text : "[]";
      // Extract JSON array of decimals from response (may have surrounding text)
      const match = text.match(/\[[\d.,\s]+\]/);
      if (match) {
        const scores: number[] = JSON.parse(match[0]);
        for (let j = 0; j < batch.length && j < scores.length; j++) {
          let score = Math.max(0, Math.min(10, scores[j]));
          // Priority company boost: +2.00 capped at 10.00
          if (batch[j].priority) score = Math.min(10, score + 2);
          // Round to 2 decimals
          batch[j].score = Math.round(score * 100) / 100;
        }
        console.log(`done (${scores.map((s) => s.toFixed(2)).join(", ")})`);
      } else {
        console.log("parse failed, skipping");
      }
    } catch (e) {
      console.log(`error: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
}
