// Scrape Agent: Uses Serper.dev for Google search ($0), then
// platform-specific extractors + Claude API fallback for page parsing.
//
// Usage:
//   npx tsx server/agents/scrape-agent.ts           # full scrape
//   npx tsx server/agents/scrape-agent.ts --quick    # ATS sites only

import { config } from "dotenv";
config();

import { generateQueryMatrix, detectATS } from "../config/scrape-config.js";
import { loadSearchProfile } from "../config/search-profile.js";
import { extractJobMatchContext } from "../matching/context.js";
import { parseSinglePage } from "../scraper/batch-parser.js";
import { loadJobs, saveJobs, mergeNewJobs, isDuplicate } from "../scraper/dedup.js";

const QUICK_MODE = process.argv.includes("--quick");
const SERPER_API_KEY = process.env.SERPER_API_KEY;

if (!SERPER_API_KEY) {
  console.error("Missing SERPER_API_KEY in .env — get a free key at https://serper.dev");
  process.exit(1);
}

interface SearchResult { url: string; title: string; snippet: string; }
interface SearchResponse { results: SearchResult[]; error: string | null; }

// URLs that are search/index pages, not actual job postings
const JUNK_URL_PATTERNS = [
  /wellfound\.com\/jobs\?/,           // wellfound search results
  /startup\.jobs\/roles\//,           // category pages
  /startup\.jobs\/interview-questions\//,
  /startup\.jobs\/artificial-intelligence-jobs$/,
  /startup\.jobs\/jobs\?/,            // search results
  /startup\.jobs\/company\//,         // company profiles
  /indeed\.com/,                      // removed entirely
  /news\.ycombinator\.com/,           // HN comments
  /greenhouse\.io\/job-board$/,       // greenhouse index
  /greenhouse\.io\/embed\//,          // embed widgets
  /jobs\.ashbyhq\.com\/?$/,           // ashby index
  /ziprecruiter\.com/,                // ZipRecruiter aggregate pages
  /glassdoor\.com/,                   // Glassdoor aggregate pages
  /upwork\.com/,                      // Upwork guides
  /jobleads\.com/,                    // JobLeads aggregate
  /salary\.com/,                      // salary pages
  /\?q=/,                             // any search results page
];

const JUNK_TITLE_PATTERNS = [
  /^ask hn/i,
  /comment/i,
  /^i analyzed/i,
  /^what (is|are)/i,
  /^why /i,
  /search directly/i,
  /job-board/i,
  /NOW HIRING/i,                      // ZipRecruiter style titles
  /\d+ .* jobs? in /i,               // "485 Solutions Engineer jobs in Portland"
  /Jobs \(NOW HIRING\)/i,
  /How To Become/i,                   // career guide articles
  /^\d+k?-\$\d+k? .* Jobs/i,         // "$84k-$225k AI Engineer Jobs"
  /jobs in .*, March 2026/i,          // Glassdoor date-filtered results
  /jobs in .*, February 2026/i,
  /Startup Jobs in /i,                // startup.jobs city pages
  /^\d+ .* Jobs /i,                   // "119 ai prompt engineer Jobs"
];

// Non-US location indicators (for filtering during parse)
const NON_US_PATTERNS = [
  /\b(India|Bangalore|Bengaluru|Chennai|Mumbai|Pune|Gurugram|Noida|Delhi)\b/i,
  /\b(London|England|UK|United Kingdom|Dublin|Ireland)\b/i,
  /\b(Paris|France|Germany|Munich|Berlin|Hamburg)\b/i,
  /\b(Barcelona|Spain|Madrid|Italy|Milan)\b/i,
  /\b(Tokyo|Japan|Singapore|Hong Kong|China|Taiwan|Taipei)\b/i,
  /\b(Sydney|Australia|Melbourne)\b/i,
  /\b(Toronto|Canada|Ontario|Vancouver|Edmonton|Montreal)\b/i,
  /\b(Dubai|UAE|Abu Dhabi|Casablanca|Morocco)\b/i,
  /\b(Israel|Tel Aviv|Warsaw|Copenhagen|Budapest|Zagreb)\b/i,
  /\b(Kuala Lumpur|Malaysia|Seoul|Korea)\b/i,
  /\b(Mexico City|Brazil|Argentina|LatAm)\b/i,
  /\b(Turkey|Istanbul)\b/i,
];

const US_PATTERNS = /\b(US|USA|United States|Remote|New York|San Francisco|Boston|Austin|Seattle|Chicago|Washington|California|NYC|SF|Denver|Atlanta|Dallas|Reno|Pittsburgh|Charlotte|Los Angeles|Portland|Phoenix|Durham|Brooklyn)\b/i;

export function isNonUS(location: string | null, title: string | null): boolean {
  if (location) {
    const hasUS = US_PATTERNS.test(location);
    const hasNonUS = NON_US_PATTERNS.some((p) => p.test(location));
    if (hasNonUS && !hasUS) return true;
  }
  if (title) {
    if (/\bEMEA\b|\bAPAC\b|\bLATAM\b/i.test(title)) return true;
    if (/- (Paris|London|UK|India|Germany|Morocco|MENA)\b/i.test(title)) return true;
  }
  return false;
}

function isJunk(url: string, title: string): boolean {
  if (JUNK_URL_PATTERNS.some((p) => p.test(url))) return true;
  if (title && JUNK_TITLE_PATTERNS.some((p) => p.test(title))) return true;
  return false;
}

// Call Serper.dev Google Search API
async function serperSearch(query: string): Promise<SearchResponse> {
  try {
    const res = await fetch("https://google.serper.dev/search", {
      method: "POST",
      headers: {
        "X-API-KEY": SERPER_API_KEY!,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ q: query, num: 20 }),
    });

    if (!res.ok) {
      const error = `serper_http_${res.status}: ${res.statusText}`;
      console.error(`    Serper error: ${res.status} ${res.statusText}`);
      return { results: [], error };
    }

    const data = await res.json() as any;
    const results: SearchResult[] = [];

    for (const item of data.organic || []) {
      if (!item.link || isJunk(item.link, item.title || "")) continue;
      results.push({
        url: item.link.replace(/\/+$/, ""),
        title: item.title || "",
        snippet: item.snippet || "",
      });
    }

    return { results, error: null };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    console.error(`    Serper request failed: ${error}`);
    return { results: [], error };
  }
}

// Fetch page content using plain HTTP
async function fetchPage(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36" },
      redirect: "follow",
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

async function main() {
  console.log("\n=== Job Command Center — Scrape Agent ===\n");

  const searchProfile = loadSearchProfile();
  const allQueries = generateQueryMatrix(searchProfile);
  const queries = QUICK_MODE
    ? allQueries.filter((q) => q.siteOperator.includes("site:"))
    : allQueries;

  console.log(`Mode: ${QUICK_MODE ? "QUICK (ATS sites only)" : "FULL"}`);
  console.log(`Queries to execute: ${queries.length}`);
  console.log(
    `Target roles: ${searchProfile.titles.length} | Exclusions: ${searchProfile.negativeTitleKeywords.length} | Qualification keywords: ${searchProfile.qualificationKeywords.length}`,
  );
  console.log(`Search API: Serper.dev (free tier)\n`);

  const jobsData = loadJobs();
  console.log(`Existing jobs in database: ${jobsData.jobs.length}`);

  // Step 1: Run all searches via Serper.dev
  const allSearchResults: SearchResult[] = [];
  const errors: { source: string; query: string; error: string; timestamp: string }[] = [];
  let searchTime = Date.now();

  for (let i = 0; i < queries.length; i++) {
    const q = queries[i];
    process.stdout.write(`  [${i + 1}/${queries.length}] ${q.siteName}... `);

    const { results, error } = await serperSearch(q.query);
    console.log(`${results.length} results`);
    allSearchResults.push(...results);
    if (error) {
      errors.push({
        source: q.siteName,
        query: q.query,
        error,
        timestamp: new Date().toISOString(),
      });
    }

    // Don't log zero-result queries as errors — they're normal for niche titles

    // Small delay to be respectful
    await new Promise((r) => setTimeout(r, 200));
  }

  searchTime = Date.now() - searchTime;
  console.log(`\n  Search complete in ${(searchTime / 1000).toFixed(1)}s`);

  // Step 2: Dedup
  const uniqueUrls = new Map<string, SearchResult>();
  for (const result of allSearchResults) {
    if (!isDuplicate(jobsData.jobs, result.url) && !uniqueUrls.has(result.url)) {
      uniqueUrls.set(result.url, result);
    }
  }

  console.log(`  Total search results: ${allSearchResults.length}`);
  console.log(`  Unique new URLs: ${uniqueUrls.size}`);

  if (uniqueUrls.size === 0) {
    console.log("  No new jobs found.");
    jobsData.last_scraped = new Date().toISOString();
    jobsData.scrape_stats = { total_queries: queries.length, new_jobs_found: 0, duplicates_skipped: allSearchResults.length, detail_fetch_failed: 0 };
    jobsData.scrape_errors = errors;
    saveJobs(jobsData);
    return;
  }

  // Step 3: Fetch pages + parse
  console.log(`\n  Fetching & parsing ${uniqueUrls.size} pages...`);
  let fetchCount = 0;
  let detailFailures = 0;
  let parseSuccess = 0;
  let addedThisRun = 0;

  for (const [url, result] of uniqueUrls) {
    fetchCount++;
    process.stdout.write(`  [${fetchCount}/${uniqueUrls.size}] `);

    const html = await fetchPage(url);
    if (!html) {
      detailFailures++;
      // Add with search snippet info
      addedThisRun += mergeNewJobs(jobsData, [{
        url,
        title: result.title || null,
        company: null,
        ats: detectATS(url),
        location: null,
        salary: null,
        seniority: null,
        source: "serper",
        scrape_detail_failed: true,
      }]);
      errors.push({
        source: detectATS(url),
        query: url,
        error: "fetch_failed",
        timestamp: new Date().toISOString(),
      });
      console.log(`⚠ Fetch failed — ${result.title?.slice(0, 50)}`);
      continue;
    }

    try {
      const parsed = await parseSinglePage({ url, html, ats: detectATS(url), source: "serper" });

      if (parsed.is_job_posting && parsed.status !== "closed") {
        // Filter non-US jobs
        if (isNonUS(parsed.location, parsed.title)) {
          console.log(`✗ Non-US: ${parsed.location || parsed.title}`);
        } else {
          const matchContext = extractJobMatchContext(html);
          const added = mergeNewJobs(jobsData, [{
            url,
            title: parsed.title || result.title || null,
            company: parsed.company,
            ats: parsed.ats,
            location: parsed.location,
            salary: parsed.salary,
            seniority: parsed.seniority,
            source: parsed.source,
            scrape_detail_failed: false,
            description_text: matchContext.descriptionText,
            qualification_text: matchContext.qualificationText,
          }]);
          addedThisRun += added;
          parseSuccess++;
          if (added > 0) {
            console.log(`✓ ${(parsed.title || "?").slice(0, 40)} @ ${parsed.company || "?"} | ${parsed.salary || "-"}`);
          } else {
            console.log(`↺ Duplicate listing — ${(parsed.title || result.title || "?").slice(0, 40)}`);
          }
        }
      } else if (parsed.status === "closed") {
        console.log(`✗ Closed`);
      } else if (parsed.parse_failed) {
        detailFailures++;
        addedThisRun += mergeNewJobs(jobsData, [{
          url,
          title: result.title || null,
          company: null,
          ats: detectATS(url),
          location: null,
          salary: null,
          seniority: null,
          source: "serper",
          scrape_detail_failed: true,
        }]);
        errors.push({
          source: detectATS(url),
          query: url,
          error: parsed.parse_fail_reason || "parse_failed",
          timestamp: new Date().toISOString(),
        });
        console.log(`⚠ Parse failed — ${parsed.parse_fail_reason?.slice(0, 40)}`);
      } else if (!parsed.is_job_posting) {
        console.log(`✗ Not a job`);
      }
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      detailFailures++;
      addedThisRun += mergeNewJobs(jobsData, [{
        url,
        title: result.title || null,
        company: null,
        ats: detectATS(url),
        location: null,
        salary: null,
        seniority: null,
        source: "serper",
        scrape_detail_failed: true,
      }]);
      errors.push({
        source: detectATS(url),
        query: url,
        error,
        timestamp: new Date().toISOString(),
      });
      console.log(`✗ Error: ${error}`);
    }

    await new Promise((r) => setTimeout(r, 100));
  }

  // Step 4: Save
  jobsData.last_scraped = new Date().toISOString();
  jobsData.scrape_stats = {
    total_queries: queries.length,
    new_jobs_found: addedThisRun,
    duplicates_skipped: allSearchResults.length - uniqueUrls.size,
    detail_fetch_failed: detailFailures,
  };
  jobsData.scrape_errors = errors;
  saveJobs(jobsData);

  console.log("\n=== Scrape Complete ===");
  console.log(`  Queries: ${queries.length} | New jobs: ${addedThisRun} | Parsed: ${parseSuccess} | Detail failures: ${detailFailures}`);
  console.log(`  Total in database: ${jobsData.jobs.length}`);
  console.log("  Parser path: fast extractors with Anthropic fallback when needed");
}

main().catch(console.error);
