// One-time script: re-fetches all priority company jobs and updates
// salary, location, and title on existing jobs (matching by URL).
//
// Usage: npx tsx server/scraper/backfill-salaries.ts

import { config } from "dotenv";
config();

import { loadJobs, saveJobs } from "./dedup.js";
import { fetchAllPriorityJobs } from "./priority-fetcher.js";

function normalizeUrl(url: string): string {
  try {
    const u = new URL(url);
    ["utm_source", "utm_medium", "utm_campaign", "ref", "source", "gh_jid"].forEach((p) =>
      u.searchParams.delete(p),
    );
    u.hash = "";
    return u.toString().replace(/\/+$/, "");
  } catch {
    return url.replace(/\/+$/, "");
  }
}

async function main() {
  const data = loadJobs();
  console.log(`Loaded ${data.jobs.length} jobs`);

  const priorityJobs = await fetchAllPriorityJobs();

  // Build a map of normalized URL → fetched job
  const byUrl = new Map<string, (typeof priorityJobs)[0]>();
  for (const j of priorityJobs) {
    byUrl.set(normalizeUrl(j.url), j);
  }

  let salariesAdded = 0;
  let salariesUpdated = 0;
  let titlesUpdated = 0;
  let locationsUpdated = 0;

  for (const existing of data.jobs) {
    const fetched = byUrl.get(normalizeUrl(existing.url));
    if (!fetched) continue;

    if (fetched.salary && !existing.salary) {
      existing.salary = fetched.salary;
      salariesAdded++;
    } else if (fetched.salary && existing.salary !== fetched.salary) {
      existing.salary = fetched.salary;
      salariesUpdated++;
    }

    if (fetched.title && existing.title !== fetched.title) {
      existing.title = fetched.title;
      titlesUpdated++;
    }

    if (fetched.location && existing.location !== fetched.location) {
      existing.location = fetched.location;
      locationsUpdated++;
    }
  }

  saveJobs(data);

  console.log(`\n=== Backfill Results ===`);
  console.log(`Salaries added:   ${salariesAdded}`);
  console.log(`Salaries updated: ${salariesUpdated}`);
  console.log(`Titles updated:   ${titlesUpdated}`);
  console.log(`Locations updated: ${locationsUpdated}`);

  const withSalary = data.jobs.filter((j) => j.salary).length;
  console.log(`\nTotal jobs with salary: ${withSalary}/${data.jobs.length}`);
}

main().catch(console.error);
