// Backfill: recover missing company names for jobs where company is null.
// Sources, in priority order:
//   1. URL slug on known ATS hosts (lever.co/{company}, greenhouse/{company}, etc.)
//   2. "Company - Role" title prefix (common on Lever listings)
//   3. "Role at Company" title pattern (Wellfound, startup.jobs)
// Also marks obvious listing/index pages as "skipped" so they stop
// clogging the dashboard.
//
// Usage:
//   npx tsx server/scraper/cleanup-missing-company.ts --dry-run
//   npx tsx server/scraper/cleanup-missing-company.ts

import { config } from "dotenv";
config();

import { loadJobs, saveJobs } from "./dedup.js";
import { isPriorityCompany } from "../config/priority-companies.js";

const DRY_RUN = process.argv.includes("--dry-run");

// Slug → proper display name for companies we scrape often.
// For anything not in this map, we title-case the slug and strip " Inc/LLC".
const SLUG_NAMES: Record<string, string> = {
  palantir: "Palantir",
  coupa: "Coupa Software",
  quantcast: "Quantcast",
  gleanwork: "Glean",
  anthropic: "Anthropic",
  openai: "OpenAI",
  scaleai: "Scale AI",
  xai: "xAI",
  defenseunicorns: "Defense Unicorns",
  labelbox: "Labelbox",
  snorkelai: "Snorkel AI",
  cresta: "Cresta",
  icapitalnetwork: "iCapital",
  axiomaticai: "Axiomatic AI",
  runpodai: "RunPod",
  levelai: "Level AI",
  "field-ai": "Field AI",
  createmusicgroup: "Create Music Group",
  "ashling-partners": "Ashling Partners",
  ashlingpartners: "Ashling Partners",
  hyperfi: "Hyperfi",
  orderlywellness: "Orderly Wellness",
  "orderly-wellness": "Orderly Wellness",
};

function prettifySlug(slug: string): string {
  const lower = slug.toLowerCase();
  if (SLUG_NAMES[lower]) return SLUG_NAMES[lower];
  const titleCased = slug
    .replace(/-/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .replace(/\b(Inc|Llc|Corp|Ltd)\b/gi, "")
    .trim();
  // "Ai" → "AI", "Ml" → "ML" as common suffix/whole-word
  return titleCased
    .replace(/\bAi\b/g, "AI")
    .replace(/\bMl\b/g, "ML")
    .replace(/\bAi(\s)/g, "AI$1")
    .trim();
}

// Locale-segment test: "en-US", "es-MX", etc. — skip these when they appear
// as the first path segment on hosts like Rippling.
const LOCALE_RE = /^[a-z]{2}-[A-Z]{2}$/;

function companyFromUrl(url: string): string | null {
  if (!url) return null;
  // Rippling sometimes prefixes with a locale: /en-US/{company}/jobs/...
  const rippling = url.match(/ats\.rippling\.com\/([^/?#]+)(?:\/([^/?#]+))?/i);
  if (rippling) {
    const first = rippling[1];
    const second = rippling[2];
    const slug = LOCALE_RE.test(first) && second ? second : first;
    if (slug && slug.toLowerCase() !== "jobs") return prettifySlug(slug);
  }
  const patterns: { re: RegExp; group: number }[] = [
    { re: /jobs\.lever\.co\/([^/?#]+)/i, group: 1 },
    { re: /(?:job-boards|boards)\.greenhouse\.io\/([^/?#]+)/i, group: 1 },
    { re: /jobs\.ashbyhq\.com\/([^/?#]+)/i, group: 1 },
    { re: /boards-api\.greenhouse\.io\/v1\/boards\/([^/?#]+)/i, group: 1 },
  ];
  for (const { re, group } of patterns) {
    const m = url.match(re);
    if (m) return prettifySlug(m[group]);
  }
  return null;
}

function companyFromTitlePrefix(title: string): { company: string; title: string } | null {
  // "Company Name - Role Title" — company ends at " - ", role starts after.
  // Only trigger if LHS looks like a company name (2-4 tokens, reasonable length, Title Case).
  const m = title.match(/^([A-Z][A-Za-z0-9&.,' ]{1,40}?)\s+-\s+(.+)$/);
  if (!m) return null;
  const lhs = m[1].trim();
  const rhs = m[2].trim();
  // Reject if LHS looks like a role itself (contains role words)
  if (/\b(Engineer|Manager|Lead|Senior|Staff|Principal|Director|VP|Head|Intern|Consultant|Analyst|Architect)\b/i.test(lhs)) return null;
  if (lhs.length < 3) return null;
  return { company: lhs, title: rhs };
}

function companyFromTitleAt(title: string): { company: string; title: string } | null {
  // "Role at Company - ..." / "Role at Company • Location ..." / "Role at Company |"
  // Wellfound format often ends with " - " or " | " or " • City".
  const m = title.match(/^(.+?)\s+at\s+([A-Z][A-Za-z0-9.&' ]{1,40}?)(?:\s*(?:[•|\-]|$)|$)/);
  if (!m) return null;
  let role = m[1].trim();
  let company = m[2].trim();
  // Strip trailing junk from company
  company = company.replace(/\s*(co\.|inc\.?|llc|ltd)$/i, "").trim();
  if (company.length < 2) return null;
  return { company, title: role };
}

// Listing/index pages masquerading as jobs — mark as skipped
const INDEX_TITLE_PATTERNS = [
  /\d+ .* jobs? in /i,
  /jobs in [\w ,]+,?\s*(January|February|March|April|May|June|July|August|September|October|November|December)/i,
  /^[\w ]+ jobs in United States$/i,
  /NOW HIRING/i,
  /^\d+k?-\$?\d+k? .* Jobs/i,
  /^How To Become/i,
  /^Your Guide to/i,
  /Jobs \(NOW HIRING\)/i,
];

function isIndexPage(title: string): boolean {
  return INDEX_TITLE_PATTERNS.some((re) => re.test(title));
}

function main() {
  const data = loadJobs();
  const missing = data.jobs.filter((j) => !j.company || j.company === "?" || j.company === "-");
  console.log(`Jobs with missing company: ${missing.length}\n`);

  let urlFixed = 0, prefixFixed = 0, atFixed = 0, indexSkipped = 0, stillMissing = 0;
  const samples: string[] = [];

  function addSample(kind: string, before: string, after: string) {
    if (samples.length < 15) samples.push(`[${kind}] ${before}\n          → ${after}`);
  }

  for (const j of missing) {
    const origTitle = j.title || "";
    const origUrl = j.url || "";

    // Listing pages: skip entirely
    if (j.status === "new" && isIndexPage(origTitle)) {
      addSample("INDEX", `${origTitle} [${j.status}]`, "→ status=skipped");
      if (!DRY_RUN) j.status = "skipped";
      indexSkipped++;
      continue;
    }

    // 1. URL slug (most reliable)
    const urlCompany = companyFromUrl(origUrl);
    if (urlCompany) {
      addSample("URL   ", `${origTitle} | url=${origUrl.slice(0, 60)}`, `company=${urlCompany}`);
      if (!DRY_RUN) {
        j.company = urlCompany;
        j.priority = isPriorityCompany(urlCompany);
      }
      urlFixed++;
      continue;
    }

    // 2. Title prefix "Company - Role"
    const prefixMatch = companyFromTitlePrefix(origTitle);
    if (prefixMatch) {
      addSample("PREFIX", `${origTitle}`, `title=${prefixMatch.title} | company=${prefixMatch.company}`);
      if (!DRY_RUN) {
        j.title = prefixMatch.title;
        j.company = prefixMatch.company;
        j.priority = isPriorityCompany(prefixMatch.company);
      }
      prefixFixed++;
      continue;
    }

    // 3. Title " at Company"
    const atMatch = companyFromTitleAt(origTitle);
    if (atMatch) {
      addSample("AT    ", `${origTitle}`, `title=${atMatch.title} | company=${atMatch.company}`);
      if (!DRY_RUN) {
        j.title = atMatch.title;
        j.company = atMatch.company;
        j.priority = isPriorityCompany(atMatch.company);
      }
      atFixed++;
      continue;
    }

    stillMissing++;
  }

  console.log(`=== Summary ===`);
  console.log(`From URL slug:      ${urlFixed}`);
  console.log(`From title prefix:  ${prefixFixed}`);
  console.log(`From "at Company":  ${atFixed}`);
  console.log(`Index pages → skip: ${indexSkipped}`);
  console.log(`Still unfixable:    ${stillMissing}`);
  console.log();
  console.log(`=== Samples ===`);
  for (const s of samples) console.log(`  ${s}`);

  if (DRY_RUN) {
    console.log(`\n[dry-run] No changes written.`);
    return;
  }
  saveJobs(data);
  console.log(`\nSaved.`);
}

main();
