import { readFileSync, writeFileSync, existsSync } from "fs";
import { randomBytes } from "crypto";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { isPriorityCompany } from "../config/priority-companies.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const JOBS_PATH = join(__dirname, "../data/jobs.json");

export interface Job {
  id: string;
  url: string;
  title: string | null;
  company: string | null;
  ats: string;
  location: string | null;
  salary: string | null;
  seniority: string | null;
  source: string;
  score: number | null;
  score_reasoning: string | null;
  priority: boolean;
  date_found: string;
  date_applied: string | null;
  status: "new" | "applied" | "responded" | "interviewing" | "offer" | "rejected" | "skipped";
  scrape_detail_failed: boolean;
  description: string | null;
}

export interface JobsData {
  jobs: Job[];
  last_scraped: string | null;
  scrape_stats: {
    total_queries: number;
    new_jobs_found: number;
    duplicates_skipped: number;
    detail_fetch_failed: number;
  } | null;
  scrape_errors: { source: string; query: string; error: string; timestamp: string }[];
}

export function loadJobs(): JobsData {
  if (!existsSync(JOBS_PATH)) {
    return { jobs: [], last_scraped: null, scrape_stats: null, scrape_errors: [] };
  }
  const raw = readFileSync(JOBS_PATH, "utf-8");
  return JSON.parse(raw) as JobsData;
}

export function saveJobs(data: JobsData): void {
  writeFileSync(JOBS_PATH, JSON.stringify(data, null, 2));
}

export function generateId(): string {
  return randomBytes(6).toString("hex");
}

// Normalize URL for dedup: strip trailing slashes, query params, fragments
function normalizeUrl(url: string): string {
  try {
    const u = new URL(url);
    // Remove common tracking params
    u.searchParams.delete("utm_source");
    u.searchParams.delete("utm_medium");
    u.searchParams.delete("utm_campaign");
    u.searchParams.delete("ref");
    u.searchParams.delete("source");
    u.searchParams.delete("gh_jid");
    u.hash = "";
    return u.toString().replace(/\/+$/, "");
  } catch {
    return url.replace(/\/+$/, "");
  }
}

// Check if a URL already exists in the jobs list
export function isDuplicate(jobs: Job[], url: string): boolean {
  const normalized = normalizeUrl(url);
  return jobs.some((j) => normalizeUrl(j.url) === normalized);
}

// Normalize title+company for cross-site dedup
function normalizeForDedup(title: string | null, company: string | null): string | null {
  if (!title || !company) return null;
  return `${title.toLowerCase().replace(/[^a-z0-9]/g, "")}::${company.toLowerCase().replace(/[^a-z0-9]/g, "")}`;
}

// Check if same job (by title+company) already exists from a different site
export function isCrossSiteDuplicate(jobs: Job[], title: string | null, company: string | null): boolean {
  const key = normalizeForDedup(title, company);
  if (!key) return false;
  return jobs.some((j) => normalizeForDedup(j.title, j.company) === key);
}

// Aggregator/job-board site names that get mistakenly captured as the
// employer. We null these out so the title-extraction path can find the
// real employer (e.g., "Engineer at OpenAI" → company: OpenAI).
const AGGREGATOR_NAMES = new Set([
  "startup jobs", "startup.jobs",
  "wellfound", "angellist",
  "built in", "builtin",
  "indeed", "glassdoor", "ziprecruiter",
  "linkedin",
  "ai jobs", "ai-jobs.net",
  "jobgether",
  "available jobs",
  "yc jobs", "y combinator jobs", "workatastartup",
  "remote rocketship",
  "career center",
]);

function isAggregatorName(c: string | null): boolean {
  if (!c) return false;
  return AGGREGATOR_NAMES.has(c.trim().toLowerCase());
}

// Split "Team Name at EmployerName" → "EmployerName" (drop team context).
// Used when a page serves the team descriptor as the employer.
function splitCompanyAt(company: string | null): string | null {
  if (!company) return company;
  const m = company.match(/^(.+?)\s+at\s+([A-Z][A-Za-z0-9\s&'.]+?)$/);
  return m ? m[2].trim() : company;
}

// Extract a US location hint from a URL slug when parse-time location is missing.
// Runs on serper-sourced pages whose HTML didn't expose structured data.
export function locationFromUrlSlug(url: string | null): string | null {
  if (!url) return null;
  const slug = url.toLowerCase();
  if (/\b(us-remote|usa-remote|united-states-remote|remote-usa|remote-us\b)/.test(slug)) return "US Remote";
  if (/\b(nyc|new-york-city|new-york-ny)\b/.test(slug)) return "New York City";
  if (/\b(san-francisco|sf-bay-area|palo-alto|mountain-view|menlo-park)\b/.test(slug)) return "San Francisco";
  if (/\b(seattle)\b/.test(slug)) return "Seattle";
  if (/\b(austin)\b/.test(slug)) return "Austin";
  if (/\b(boston)\b/.test(slug)) return "Boston";
  if (/\b(chicago)\b/.test(slug)) return "Chicago";
  if (/\b(los-angeles)\b/.test(slug)) return "Los Angeles";
  if (/\b(washington-dc|washington-d-c)\b/.test(slug)) return "Washington, DC";
  if (/\b(denver)\b/.test(slug)) return "Denver";
  if (/\b(atlanta)\b/.test(slug)) return "Atlanta";
  if (/\b(miami)\b/.test(slug)) return "Miami";
  return null;
}

// Extract company from title and clean both fields.
// Handles patterns like "Engineer at Company", "Engineer - Company", "Engineer | Company"
export function cleanTitleAndCompany(
  title: string | null,
  company: string | null,
): { title: string | null; company: string | null } {
  if (!title) return { title, company };

  let cleanedTitle = title;
  // Discard aggregator-site names so we re-extract the real employer below
  let extractedCompany = isAggregatorName(company) ? null : company;
  // Split "Team at Employer" → "Employer"
  extractedCompany = splitCompanyAt(extractedCompany);

  // Step 1: Strip common prefixes
  cleanedTitle = cleanedTitle
    .replace(/^Job Application for /i, "")
    .replace(/^Apply for /i, "")
    .replace(/^Apply: /i, "");

  // Step 2: Strip trailing site names (Google appends these to snippets)
  cleanedTitle = cleanedTitle
    .replace(/\s+(Wellfound|startup\.jobs|Built ?In|Indeed|Glassdoor|ZipRecruiter|LinkedIn)\s*$/i, "")
    .replace(/\s*-\s*(Greenhouse|Lever|Ashby|Remote Rocketship|Career Center)\s*$/i, "");

  // Step 3: Strip "• Location" suffixes (Wellfound format: "Title at Company • City")
  cleanedTitle = cleanedTitle.replace(/\s*[•·]\s*[A-Za-z\s,]+$/, "");

  // Step 4: Strip trailing whitespace tabs and ellipsis
  cleanedTitle = cleanedTitle.replace(/\s+$/, "").replace(/\s*\.{3}$/, "");

  // Step 5: Extract location from title if embedded (e.g., "Role in 95051, Santa Clara, CA, US")
  let extractedLocation: string | null = null;
  const locationInTitle = cleanedTitle.match(/\s+in\s+(\d{5},\s*[A-Za-z\s,]+(?:US|USA))$/i);
  if (locationInTitle) {
    extractedLocation = locationInTitle[1].trim();
    cleanedTitle = cleanedTitle.slice(0, -locationInTitle[0].length).trim();
  }

  // Step 6: Extract company if not already set
  if (!extractedCompany) {
    // Pattern: "Title at Company" (Wellfound, startup.jobs)
    // Stop at bullet, pipe, dash-space, or end of string for company name
    const atMatch = cleanedTitle.match(/^(.+?)\s+at\s+([A-Z][A-Za-z0-9\s&'.\/]+?)$/i);
    if (atMatch) {
      cleanedTitle = atMatch[1].trim();
      extractedCompany = atMatch[2].trim();
    }

    // Pattern: "Title - Company" (LinkedIn, general web)
    if (!extractedCompany) {
      const dashMatch = cleanedTitle.match(/^(.+?)\s+[-–—]\s+([A-Z][A-Za-z0-9\s&'.]+)$/);
      if (dashMatch && dashMatch[2].length < 40 && !dashMatch[2].match(/\b(Engineer|Manager|Lead|Senior|AI|ML|Remote|Hybrid|Full.Time)\b/i)) {
        cleanedTitle = dashMatch[1].trim();
        extractedCompany = dashMatch[2].trim();
      }
    }

    // Pattern: "Title | Company" (some job boards)
    if (!extractedCompany) {
      const pipeMatch = cleanedTitle.match(/^(.+?)\s*\|\s*([A-Z][A-Za-z0-9\s&'.]+)$/);
      if (pipeMatch && pipeMatch[2].length < 40 && !pipeMatch[2].match(/\b(Engineer|Manager|Lead|Remote|Hybrid)\b/i)) {
        cleanedTitle = pipeMatch[1].trim();
        extractedCompany = pipeMatch[2].trim();
      }
    }
  }

  // Step 7: Clean up extracted company name
  if (extractedCompany) {
    extractedCompany = extractedCompany
      .replace(/\s*\.{3}$/, "")
      .replace(/\s*\(.*$/, "") // remove parenthetical suffixes
      .replace(/\s+$/, "")
      .trim();
    // Reject if it looks like a site name, not a company
    if (extractedCompany.length < 2 || /^(Wellfound|startup\.jobs|Indeed|Glassdoor|LinkedIn)$/i.test(extractedCompany)) {
      extractedCompany = null;
    }
  }

  return { title: cleanedTitle.trim(), company: extractedCompany };
}

// Add new jobs, skipping URL duplicates and cross-site duplicates.
export function mergeNewJobs(
  existing: JobsData,
  newJobs: Omit<Job, "id" | "date_found" | "date_applied" | "status" | "score" | "score_reasoning">[],
): number {
  const today = new Date().toISOString().split("T")[0];
  let added = 0;

  for (const job of newJobs) {
    if (isDuplicate(existing.jobs, job.url)) continue;

    // Clean title and extract company if missing
    const cleaned = cleanTitleAndCompany(job.title, job.company);

    if (isCrossSiteDuplicate(existing.jobs, cleaned.title, cleaned.company)) continue;

    existing.jobs.push({
      ...job,
      title: cleaned.title,
      company: cleaned.company,
      id: generateId(),
      score: null,
      score_reasoning: null,
      priority: isPriorityCompany(cleaned.company),
      date_found: today,
      date_applied: null,
      status: "new",
    });
    added++;
  }

  return added;
}

// Update a job's status
export function updateStatus(data: JobsData, jobId: string, newStatus: Job["status"]): boolean {
  const job = data.jobs.find((j) => j.id === jobId);
  if (!job) return false;
  job.status = newStatus;
  if (newStatus === "applied" && !job.date_applied) {
    job.date_applied = new Date().toISOString();
  }
  return true;
}

// Backwards-compatible alias
export function markApplied(data: JobsData, jobId: string): boolean {
  return updateStatus(data, jobId, "applied");
}

// Sort jobs by score descending (nulls last)
function sortByScore(jobs: Job[]): Job[] {
  return [...jobs].sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
}

// Get jobs grouped by status, all groups sorted by score descending
export function getJobsByStatus(data: JobsData) {
  const today = new Date().toISOString().split("T")[0];
  return {
    newToday: sortByScore(data.jobs.filter((j) => j.status === "new" && j.date_found === today)),
    previouslySeen: sortByScore(data.jobs.filter((j) => j.status === "new" && j.date_found !== today)),
    applied: sortByScore(data.jobs.filter((j) => j.status === "applied")),
    responded: sortByScore(data.jobs.filter((j) => j.status === "responded")),
    interviewing: sortByScore(data.jobs.filter((j) => j.status === "interviewing")),
    offer: sortByScore(data.jobs.filter((j) => j.status === "offer")),
    rejected: sortByScore(data.jobs.filter((j) => j.status === "rejected")),
    skipped: sortByScore(data.jobs.filter((j) => j.status === "skipped")),
  };
}
