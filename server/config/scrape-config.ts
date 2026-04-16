// Search query generation and ATS detection.
// The target role titles are loaded from the persisted search profile.

import { loadSearchProfile, type SearchProfile } from "./search-profile.js";

const SEARCH_YEAR = new Date().getUTCFullYear();
const TITLE_BATCH_SIZE = 3;

export interface SiteTarget {
  name: string;
  siteOperator: string;
  scrapable: boolean; // whether direct WebFetch works, or only Google index
}

export const ATS_SITES: SiteTarget[] = [
  { name: "Ashby", siteOperator: "site:jobs.ashbyhq.com", scrapable: true },
  { name: "Greenhouse", siteOperator: "site:job-boards.greenhouse.io", scrapable: true },
  { name: "Greenhouse (alt)", siteOperator: "site:boards.greenhouse.io", scrapable: true },
  { name: "Lever", siteOperator: "site:jobs.lever.co", scrapable: true },
  { name: "Workday", siteOperator: "site:myworkdayjobs.com", scrapable: false },
  { name: "Rippling", siteOperator: "site:ats.rippling.com", scrapable: true },
];

export const JOB_BOARD_SITES: SiteTarget[] = [
  { name: "LinkedIn", siteOperator: "site:linkedin.com/jobs", scrapable: false },
  { name: "Wellfound", siteOperator: "site:wellfound.com/jobs", scrapable: false },
  { name: "Built In", siteOperator: "site:builtin.com/job", scrapable: true },
  { name: "YC", siteOperator: "site:workatastartup.com", scrapable: true },
  { name: "startup.jobs", siteOperator: "site:startup.jobs", scrapable: true },
  { name: "ai-jobs.net", siteOperator: "site:ai-jobs.net", scrapable: true },
];

export const ALL_SITES: SiteTarget[] = [...ATS_SITES, ...JOB_BOARD_SITES];

function buildTitleBatches(titles: string[]): string[][] {
  const batches: string[][] = [];

  for (let i = 0; i < titles.length; i += TITLE_BATCH_SIZE) {
    batches.push(titles.slice(i, i + TITLE_BATCH_SIZE));
  }

  return batches;
}

// Build a single Google search query from a title batch + site target
function buildQuery(titles: string[], site: SiteTarget): string {
  const orChain = titles.map((title) => `"${title}"`).join(" OR ");
  return `${site.siteOperator} ${orChain}`;
}

// Build a general web query (no site: restriction) to catch company career pages
function buildGeneralQuery(titles: string[]): string {
  const orChain = titles.map((title) => `"${title}"`).join(" OR ");
  return `${orChain} careers apply ${SEARCH_YEAR}`;
}

export interface SearchQuery {
  query: string;
  titleBatchIndex: number;
  siteName: string;
  siteOperator: string;
  titles: string[];
}

// Generate the full query matrix for the current search profile.
export function generateQueryMatrix(
  profile: SearchProfile = loadSearchProfile(),
): SearchQuery[] {
  const queries: SearchQuery[] = [];
  const titleBatches = buildTitleBatches(profile.titles);

  for (let i = 0; i < titleBatches.length; i++) {
    const batch = titleBatches[i];

    for (const site of ALL_SITES) {
      queries.push({
        query: buildQuery(batch, site),
        titleBatchIndex: i,
        siteName: site.name,
        siteOperator: site.siteOperator,
        titles: batch,
      });
    }

    queries.push({
      query: buildGeneralQuery(batch),
      titleBatchIndex: i,
      siteName: "general_web",
      siteOperator: "",
      titles: batch,
    });
  }

  return queries;
}

// Detect ATS platform from a URL
export function detectATS(url: string): string {
  const normalizedUrl = url.toLowerCase();
  if (normalizedUrl.includes("greenhouse.io") || normalizedUrl.includes("boards.greenhouse")) return "greenhouse";
  if (normalizedUrl.includes("ashbyhq.com")) return "ashby";
  if (normalizedUrl.includes("lever.co")) return "lever";
  if (normalizedUrl.includes("myworkdayjobs")) return "workday";
  if (normalizedUrl.includes("rippling.com")) return "rippling";
  if (normalizedUrl.includes("linkedin.com")) return "linkedin";
  if (normalizedUrl.includes("indeed.com")) return "indeed";
  if (normalizedUrl.includes("wellfound.com")) return "wellfound";
  if (normalizedUrl.includes("builtin.com")) return "builtin";
  if (normalizedUrl.includes("workatastartup.com")) return "yc";
  if (normalizedUrl.includes("startup.jobs")) return "startup_jobs";
  if (normalizedUrl.includes("ai-jobs.net")) return "ai_jobs";
  return "unknown";
}

// Summary stats
export function getQueryStats(profile: SearchProfile = loadSearchProfile()) {
  const titleBatches = buildTitleBatches(profile.titles);
  const matrix = generateQueryMatrix(profile);

  return {
    totalQueries: matrix.length,
    titleBatches: titleBatches.length,
    totalTitles: profile.titles.length,
    qualificationKeywords: profile.qualificationKeywords.length,
    atsSites: ATS_SITES.length,
    jobBoardSites: JOB_BOARD_SITES.length,
    generalWebQueries: titleBatches.length,
  };
}
