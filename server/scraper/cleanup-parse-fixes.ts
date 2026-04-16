// Backfill three parsing fixes on existing jobs:
//   1. Split company "Team at Employer" → "Employer"
//   2. Re-run detectATS on ats=="unknown" jobs (now has more domain rules)
//   3. Fill in location from URL slug when location is null
//
// Usage:
//   npx tsx server/scraper/cleanup-parse-fixes.ts --dry-run
//   npx tsx server/scraper/cleanup-parse-fixes.ts

import { config } from "dotenv";
config();

import { loadJobs, saveJobs, cleanTitleAndCompany, locationFromUrlSlug } from "./dedup.js";
import { detectATS } from "../config/scrape-config.js";
import { isPriorityCompany } from "../config/priority-companies.js";

const DRY_RUN = process.argv.includes("--dry-run");

function main() {
  const data = loadJobs();
  let companyFixed = 0, atsFixed = 0, locationFixed = 0;
  const samples: string[] = [];

  for (const j of data.jobs) {
    // Fix 1: company contains " at " — re-run cleanTitleAndCompany
    if (j.company && / at /i.test(j.company)) {
      const cleaned = cleanTitleAndCompany(j.title, j.company);
      if (cleaned.company && cleaned.company !== j.company) {
        if (samples.length < 5) {
          samples.push(`COMPANY:  "${j.company}" → "${cleaned.company}"`);
        }
        if (!DRY_RUN) {
          j.company = cleaned.company;
          j.priority = isPriorityCompany(cleaned.company);
        }
        companyFixed++;
      }
    }

    // Fix 2: re-run detectATS when ats is unknown/empty
    if (!j.ats || j.ats === "unknown") {
      const newAts = detectATS(j.url || "");
      if (newAts !== j.ats && newAts !== "unknown") {
        if (samples.length < 10 && samples.filter((s) => s.startsWith("ATS")).length < 3) {
          samples.push(`ATS:      ${j.ats || "(blank)"} → ${newAts}  [${(j.url || "").slice(0, 60)}]`);
        }
        if (!DRY_RUN) j.ats = newAts;
        atsFixed++;
      }
    }

    // Fix 3: location missing, try to infer from URL slug
    if (!j.location) {
      const loc = locationFromUrlSlug(j.url || null);
      if (loc) {
        if (samples.length < 15 && samples.filter((s) => s.startsWith("LOCATION")).length < 3) {
          samples.push(`LOCATION: (blank) → "${loc}"  [${(j.url || "").slice(0, 60)}]`);
        }
        if (!DRY_RUN) j.location = loc;
        locationFixed++;
      }
    }
  }

  console.log(`\n=== Parse Fixes Summary ===`);
  console.log(`Company "Team at X" split:   ${companyFixed}`);
  console.log(`ATS newly classified:        ${atsFixed}`);
  console.log(`Location from URL slug:      ${locationFixed}`);
  console.log(`\nSamples:`);
  for (const s of samples) console.log(`  ${s}`);

  if (DRY_RUN) {
    console.log(`\n[dry-run] No changes written. Re-run without --dry-run to apply.`);
    return;
  }

  saveJobs(data);
  console.log(`\nSaved.`);
}

main();
