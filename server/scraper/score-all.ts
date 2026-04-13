// One-time script to score all unscored jobs.
// Usage: npx tsx server/scraper/score-all.ts

import { config } from "dotenv";
config();

import { loadJobs, saveJobs } from "./dedup.js";
import { scoreJobs } from "./job-scorer.js";

async function main() {
  const data = loadJobs();
  const unscored = data.jobs.filter((j) => j.score === null);
  console.log(`Unscored jobs: ${unscored.length}`);
  console.log("Scoring with Haiku...\n");

  await scoreJobs(unscored);
  saveJobs(data);

  const scored = data.jobs.filter((j) => j.score !== null);
  const dist = [1, 2, 3, 4, 5].map((s) => ({
    score: s,
    count: scored.filter((j) => j.score === s).length,
  }));
  console.log("\nDone! Score distribution:");
  dist.forEach((d) => console.log(`  Score ${d.score}: ${d.count} jobs`));
  console.log(`  Unscored: ${data.jobs.filter((j) => j.score === null).length}`);
}

main().catch(console.error);
