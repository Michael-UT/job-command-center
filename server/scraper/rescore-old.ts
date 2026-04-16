// Rescore jobs that were scored under the old Haiku title-only rubric
// (identified by score set but score_reasoning null) using the new
// Sonnet 4.6 description-aware scorer. Old jobs lack descriptions, so
// the scorer uses its metadata-only fallback — but the full rubric
// including HARD REJECT enforcement runs against every job.
//
// Saves after each batch so an interruption loses at most 5 jobs.
//
// Usage:
//   npx tsx server/scraper/rescore-old.ts --dry-run        # show count only
//   npx tsx server/scraper/rescore-old.ts --limit 50       # rescore 50 (sanity check)
//   npx tsx server/scraper/rescore-old.ts                  # full run

import { config } from "dotenv";
config();

import type { Job } from "./dedup.js";
import { loadJobs, saveJobs } from "./dedup.js";
import { loadProfileFromDisk } from "../tools/profile-tools.js";

const DRY_RUN = process.argv.includes("--dry-run");
const LIMIT_ARG = process.argv.indexOf("--limit");
const LIMIT = LIMIT_ARG >= 0 ? parseInt(process.argv[LIMIT_ARG + 1], 10) : Infinity;

let client: any;
async function getClient() {
  if (!client) {
    const mod = await import("@anthropic-ai/sdk");
    const Anthropic = (mod as any).default || mod;
    client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return client;
}

// Inline a trimmed version of the scoring batch loop so we can save
// per-batch rather than only at the end. The prompt is identical to
// job-scorer.ts — we import its prompt builder if possible, but since
// that function is not exported, we duplicate the logic minimally here.
// To keep calibration identical, we call scoreJobs() from job-scorer.ts
// and save after each batch completes.
import { scoreJobs } from "./job-scorer.js";

async function main() {
  const data = loadJobs();

  // Target: jobs that have a score but no reasoning (= old pipeline)
  const target = data.jobs.filter(
    (j) => j.score !== null && !j.score_reasoning,
  );

  console.log(`Jobs scored under old rubric (score set, no reasoning): ${target.length}`);
  if (target.length === 0) {
    console.log("Nothing to rescore.");
    return;
  }

  const limited = target.slice(0, LIMIT);
  if (LIMIT < target.length) {
    console.log(`Limiting to first ${limited.length} jobs (--limit ${LIMIT})`);
  }

  // Rough cost estimate at Sonnet 4.6 pricing (~$3/M input, $15/M output)
  // with ~1800 input + 250 output tokens per 5-job batch
  const batches = Math.ceil(limited.length / 5);
  const estCost = batches * ((1800 / 1_000_000) * 3 + (250 / 1_000_000) * 15);
  const estMin = Math.ceil((batches * 4) / 60);
  console.log(`Plan: ${batches} batches × 5 jobs ≈ $${estCost.toFixed(2)}, ~${estMin} min`);

  if (DRY_RUN) {
    console.log("[dry-run] No API calls. Re-run without --dry-run to apply.");
    return;
  }

  // Process 5 at a time, save after each batch. scoreJobs mutates in place.
  const BATCH = 5;
  let completed = 0;
  const startedAt = Date.now();

  for (let i = 0; i < limited.length; i += BATCH) {
    const slice = limited.slice(i, i + BATCH);
    await scoreJobs(slice); // mutates slice[j].score and slice[j].score_reasoning
    saveJobs(data);          // persist after every batch
    completed += slice.length;

    const elapsedMin = (Date.now() - startedAt) / 60000;
    const rate = completed / elapsedMin;
    const eta = rate > 0 ? (limited.length - completed) / rate : 0;
    console.log(
      `  Progress: ${completed}/${limited.length} (${((completed / limited.length) * 100).toFixed(1)}%) | ` +
      `elapsed ${elapsedMin.toFixed(1)}m | ETA ${eta.toFixed(1)}m`,
    );
  }

  // Final score distribution report
  const rescored = data.jobs.filter((j) => j.score_reasoning);
  console.log(`\n=== Rescore Complete ===`);
  console.log(`Total jobs with reasoning now: ${rescored.length}`);
  const buckets = [[9, 10], [8, 9], [7, 8], [6, 7], [5, 6], [4, 5], [3, 4], [2, 3], [0, 2]];
  for (const [lo, hi] of buckets) {
    const n = rescored.filter((j) => (j.score ?? 0) >= lo && (j.score ?? 0) < hi).length;
    console.log(`  ${lo.toFixed(2)}-${hi.toFixed(2)}: ${n}`);
  }
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
