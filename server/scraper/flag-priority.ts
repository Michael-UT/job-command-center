// One-time backfill script:
// 1. Adds `priority: false` field to all existing jobs
// 2. Fetches all priority company jobs via their ATS APIs, merges into database
// 3. Flags all jobs matching priority companies
// 4. Re-scores priority jobs to apply the +1 boost
//
// Usage: npx tsx server/scraper/flag-priority.ts

import { config } from "dotenv";
config();

import { loadJobs, saveJobs, mergeNewJobs } from "./dedup.js";
import { fetchAllPriorityJobs } from "./priority-fetcher.js";
import { isPriorityCompany } from "../config/priority-companies.js";
import { scoreJobs } from "./job-scorer.js";

async function main() {
  const data = loadJobs();
  console.log(`Starting with ${data.jobs.length} jobs\n`);

  // Step 1: Add priority:false to existing jobs
  let addedField = 0;
  for (const job of data.jobs) {
    if (!("priority" in job)) {
      (job as any).priority = false;
      addedField++;
    }
  }
  console.log(`Added priority field to ${addedField} existing jobs`);

  // Step 2: Fetch all priority company jobs
  const priorityJobs = await fetchAllPriorityJobs();

  // Step 3: Merge into database
  const toMerge = priorityJobs.map((j) => ({
    url: j.url,
    title: j.title,
    company: j.company,
    ats: j.ats,
    location: j.location,
    salary: j.salary,
    seniority: null,
    source: j.source,
    scrape_detail_failed: false,
    description: j.description,
    priority: true,
  }));

  const before = data.jobs.length;
  mergeNewJobs(data, toMerge);
  const newJobs = data.jobs.length - before;
  console.log(`\nAdded ${newJobs} new priority jobs (${priorityJobs.length} fetched, rest deduped)`);

  // Step 4: Flag all existing jobs whose company matches priority list
  let flagged = 0;
  for (const job of data.jobs) {
    if (!job.priority && isPriorityCompany(job.company)) {
      job.priority = true;
      flagged++;
    }
  }
  console.log(`Flagged ${flagged} existing jobs as priority`);

  // Save before scoring (in case scoring fails, we don't lose the flagging)
  saveJobs(data);

  // Step 5: Score any unscored jobs (new priority jobs will need scoring)
  const unscored = data.jobs.filter((j) => j.score === null);
  if (unscored.length > 0) {
    console.log(`\nScoring ${unscored.length} unscored jobs...`);
    await scoreJobs(unscored);
  }

  // Step 6: Re-apply score boost on all priority jobs that have scores but weren't boosted yet
  // (Only needed for jobs that were scored before this feature existed)
  let boosted = 0;
  for (const job of data.jobs) {
    if (job.priority && job.score !== null && job.score < 5) {
      // We can't distinguish boosted vs unboosted retroactively, so we apply +1 to all
      // priority jobs that aren't already at 5. This is a one-time backfill.
      job.score = Math.min(5, job.score + 1);
      boosted++;
    }
  }
  console.log(`Applied +1 boost to ${boosted} priority jobs`);

  saveJobs(data);

  // Final stats
  const priorityCount = data.jobs.filter((j) => j.priority).length;
  console.log(`\n=== Final Stats ===`);
  console.log(`Total jobs: ${data.jobs.length}`);
  console.log(`Priority jobs: ${priorityCount}`);
  console.log(`Score distribution:`);
  [5, 4, 3, 2, 1].forEach((s) => {
    const count = data.jobs.filter((j) => j.score === s).length;
    console.log(`  ${s}: ${count}`);
  });
}

main().catch(console.error);
