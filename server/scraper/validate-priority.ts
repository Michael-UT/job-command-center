// One-time validation script: fetches jobs from all priority companies
// and reports which ones return 0 jobs (likely wrong slug).
//
// Usage: npx tsx server/scraper/validate-priority.ts

import { config } from "dotenv";
config();

import { fetchAllPriorityJobs } from "./priority-fetcher.js";
import { PRIORITY_COMPANIES } from "../config/priority-companies.js";

async function main() {
  const jobs = await fetchAllPriorityJobs();

  // Group by company
  const byCompany = new Map<string, number>();
  for (const company of PRIORITY_COMPANIES) {
    byCompany.set(company.name, 0);
  }
  for (const job of jobs) {
    byCompany.set(job.company, (byCompany.get(job.company) || 0) + 1);
  }

  console.log("\n=== RESULTS ===\n");
  const zero: string[] = [];
  const nonzero: string[] = [];
  for (const [name, count] of byCompany) {
    if (count === 0) zero.push(name);
    else nonzero.push(`${name}: ${count}`);
  }

  console.log(`Companies with jobs (${nonzero.length}):`);
  nonzero.forEach((l) => console.log("  ✓ " + l));
  console.log(`\nCompanies with 0 jobs (${zero.length}):`);
  zero.forEach((l) => console.log("  ✗ " + l));
  console.log(`\nTotal jobs fetched: ${jobs.length}`);
}

main().catch(console.error);
