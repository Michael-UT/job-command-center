// One-time cleanup: mark all non-US jobs currently in status=="new"
// as status=="skipped". Reuses the same isNonUS() that gates new scrapes
// so the criteria match going forward.
//
// Usage: npx tsx server/scraper/cleanup-non-us.ts [--dry-run]

import { loadJobs, saveJobs } from "./dedup.js";
import { isNonUS } from "../agents/scrape-agent.js";

const DRY_RUN = process.argv.includes("--dry-run");

function main() {
  const data = loadJobs();
  const candidates = data.jobs.filter(
    (j) => j.status === "new" && isNonUS(j.location, j.title),
  );

  console.log(`Non-US jobs in status=="new": ${candidates.length}`);
  if (candidates.length === 0) {
    console.log("Nothing to clean up.");
    return;
  }

  // Show a preview — companies and locations grouped
  const byCompany = new Map<string, number>();
  for (const j of candidates) {
    const c = j.company || "(unknown)";
    byCompany.set(c, (byCompany.get(c) || 0) + 1);
  }
  const topCompanies = [...byCompany.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15);
  console.log("\nTop 15 companies affected:");
  for (const [c, n] of topCompanies) console.log(`  ${n.toString().padStart(4)}  ${c}`);

  if (DRY_RUN) {
    console.log("\n[dry-run] No changes written. Re-run without --dry-run to apply.");
    return;
  }

  let skipped = 0;
  for (const j of candidates) {
    j.status = "skipped";
    skipped++;
  }
  saveJobs(data);
  console.log(`\nMarked ${skipped} non-US jobs as skipped. DB saved.`);
}

main();
