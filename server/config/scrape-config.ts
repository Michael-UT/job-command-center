// The full taxonomy of job title variations and search targets.
// Titles are grouped into batches of 3-4 for Google OR chains
// to stay within query length limits.

export const TITLE_BATCHES: string[][] = [
  // Batch 1: Core FDE titles
  [
    "forward deployed engineer",
    "forward deployed AI engineer",
    "forward deployed software engineer",
  ],
  // Batch 2: AI deployment / applied AI
  [
    "AI deployment engineer",
    "AI deployment strategist",
    "applied AI engineer",
  ],
  // Batch 3: Solutions engineering (AI-qualified)
  [
    "solutions engineer AI",
    "solutions engineer LLM",
    "solutions engineer machine learning",
    "solutions architect AI",
  ],
  // Batch 4: Consulting / implementation
  [
    "AI consultant",
    "AI implementation engineer",
    "AI integration engineer",
  ],
  // Batch 5: Customer-facing AI
  [
    "customer engineer AI",
    "technical account manager AI",
    "AI strategist",
  ],
  // Batch 6: Professional services
  [
    "professional services engineer AI",
    "field engineer AI",
    "pre-sales engineer AI",
  ],
  // Batch 7: Enterprise / success
  [
    "technical solutions engineer AI",
    "enterprise AI engineer",
    "AI success engineer",
    "AI engagement manager",
  ],
  // Batch 8: Broader AI engineer titles (high volume, catches more companies)
  [
    "AI engineer",
    "machine learning engineer",
    "ML engineer",
  ],
  // Batch 9: Broader solutions / implementation
  [
    "solutions engineer",
    "implementation engineer",
    "technical solutions consultant",
  ],
  // Batch 10: LLM-specific roles
  [
    "LLM engineer",
    "prompt engineer",
    "generative AI engineer",
  ],
  // Batch 11: AI platform / infrastructure
  [
    "AI platform engineer",
    "ML platform engineer",
    "AI infrastructure engineer",
  ],
];

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
  // Indeed removed — user request (poor result quality, lots of junk)
  { name: "Wellfound", siteOperator: "site:wellfound.com/jobs", scrapable: false },
  { name: "Built In", siteOperator: "site:builtin.com/job", scrapable: true },
  { name: "YC", siteOperator: "site:workatastartup.com", scrapable: true },
  { name: "startup.jobs", siteOperator: "site:startup.jobs", scrapable: true },
  { name: "ai-jobs.net", siteOperator: "site:ai-jobs.net", scrapable: true },
  // HN Who is Hiring removed — returns comments/articles, not job postings
];

export const ALL_SITES: SiteTarget[] = [...ATS_SITES, ...JOB_BOARD_SITES];

// Build a single Google search query from a title batch + site target
function buildQuery(titles: string[], site: SiteTarget): string {
  const orChain = titles.map((t) => `"${t}"`).join(" OR ");
  return `${site.siteOperator} ${orChain}`;
}

// Build a general web query (no site: restriction) to catch company career pages
function buildGeneralQuery(titles: string[]): string {
  const orChain = titles.map((t) => `"${t}"`).join(" OR ");
  return `${orChain} careers apply 2026`;
}

export interface SearchQuery {
  query: string;
  titleBatchIndex: number;
  siteName: string;
  siteOperator: string;
}

// Generate the full query matrix
export function generateQueryMatrix(): SearchQuery[] {
  const queries: SearchQuery[] = [];

  for (let i = 0; i < TITLE_BATCHES.length; i++) {
    const batch = TITLE_BATCHES[i];

    // Site-targeted queries (ATS + job boards)
    for (const site of ALL_SITES) {
      queries.push({
        query: buildQuery(batch, site),
        titleBatchIndex: i,
        siteName: site.name,
        siteOperator: site.siteOperator,
      });
    }

    // General web queries (no site restriction)
    queries.push({
      query: buildGeneralQuery(batch),
      titleBatchIndex: i,
      siteName: "general_web",
      siteOperator: "",
    });
  }

  return queries;
}

// Detect ATS platform from a URL
export function detectATS(url: string): string {
  const u = url.toLowerCase();
  if (u.includes("greenhouse.io") || u.includes("boards.greenhouse")) return "greenhouse";
  if (u.includes("ashbyhq.com")) return "ashby";
  if (u.includes("lever.co")) return "lever";
  if (u.includes("myworkdayjobs")) return "workday";
  if (u.includes("rippling.com")) return "rippling";
  if (u.includes("linkedin.com")) return "linkedin";
  if (u.includes("indeed.com")) return "indeed";
  if (u.includes("wellfound.com")) return "wellfound";
  if (u.includes("builtin.com")) return "builtin";
  if (u.includes("workatastartup.com")) return "yc";
  if (u.includes("startup.jobs")) return "startup_jobs";
  if (u.includes("ai-jobs.net")) return "ai_jobs";

  // Company-direct career pages — label as {company}_careers so the UI
  // shows something meaningful instead of "unknown"
  if (u.includes("openai.com/careers")) return "openai_careers";
  if (u.includes("careers.adobe.com")) return "adobe_careers";
  if (u.includes("jobs.lenovo.com")) return "lenovo_careers";
  if (u.includes("jobs.comcast.com")) return "comcast_careers";
  if (u.includes("accenture.com")) return "accenture_careers";
  if (u.includes("echostar.com")) return "echostar_careers";

  // Aggregators / repost sites
  if (u.includes("remoterocketship.com")) return "remoterocketship";
  if (u.includes("tallo.com")) return "tallo";
  if (u.includes("jobrapido.com")) return "jobrapido";
  if (u.includes("career.io")) return "career_io";
  if (u.includes("jobgether.com")) return "jobgether";

  // Fallback: use the hostname (minus www. and TLD) so the column is
  // never blank — callers can still test for "unknown"-prefixed values.
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    const label = host.split(".")[0];
    return label ? `host_${label}` : "unknown";
  } catch {
    return "unknown";
  }
}

// Summary stats
export function getQueryStats() {
  const matrix = generateQueryMatrix();
  return {
    totalQueries: matrix.length,
    titleBatches: TITLE_BATCHES.length,
    totalTitles: TITLE_BATCHES.flat().length,
    atsSites: ATS_SITES.length,
    jobBoardSites: JOB_BOARD_SITES.length,
    generalWebQueries: TITLE_BATCHES.length,
  };
}
