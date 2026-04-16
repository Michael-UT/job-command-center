import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { randomBytes } from "crypto";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const JOBS_PATH = join(__dirname, "../data/jobs.json");
const ARCHIVED_JOBS_PATH = join(__dirname, "../data/archived-jobs.json");

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
  date_found: string;
  date_applied: string | null;
  status: "new" | "applied" | "skipped";
  scrape_detail_failed: boolean;
  description_text?: string | null;
  qualification_text?: string | null;
}

export interface ArchivedJob extends Job {
  archived_at: string;
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

export interface ArchivedJobsData {
  jobs: ArchivedJob[];
}

type JobIdentity = Pick<Job, "url" | "title" | "company">;

function defaultJobsData(): JobsData {
  return { jobs: [], last_scraped: null, scrape_stats: null, scrape_errors: [] };
}

function defaultArchivedJobsData(): ArchivedJobsData {
  return { jobs: [] };
}

export function loadJobs(): JobsData {
  if (!existsSync(JOBS_PATH)) {
    return defaultJobsData();
  }
  const raw = readFileSync(JOBS_PATH, "utf-8");
  return { ...defaultJobsData(), ...JSON.parse(raw) } as JobsData;
}

export function saveJobs(data: JobsData): void {
  mkdirSync(dirname(JOBS_PATH), { recursive: true });
  writeFileSync(JOBS_PATH, JSON.stringify(data, null, 2));
}

export function loadArchivedJobs(): ArchivedJobsData {
  if (!existsSync(ARCHIVED_JOBS_PATH)) {
    return defaultArchivedJobsData();
  }

  const raw = readFileSync(ARCHIVED_JOBS_PATH, "utf-8");
  const parsed = JSON.parse(raw) as ArchivedJobsData | ArchivedJob[];

  if (Array.isArray(parsed)) {
    return { jobs: parsed };
  }

  return { ...defaultArchivedJobsData(), ...parsed };
}

export function saveArchivedJobs(data: ArchivedJobsData): void {
  mkdirSync(dirname(ARCHIVED_JOBS_PATH), { recursive: true });
  writeFileSync(ARCHIVED_JOBS_PATH, JSON.stringify(data, null, 2));
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
export function isDuplicate(jobs: JobIdentity[], url: string): boolean {
  const normalized = normalizeUrl(url);
  return jobs.some((j) => normalizeUrl(j.url) === normalized);
}

// Normalize title+company for cross-site dedup
function normalizeForDedup(title: string | null, company: string | null): string | null {
  if (!title || !company) return null;
  return `${title.toLowerCase().replace(/[^a-z0-9]/g, "")}::${company.toLowerCase().replace(/[^a-z0-9]/g, "")}`;
}

// Check if same job (by title+company) already exists from a different site
export function isCrossSiteDuplicate(
  jobs: JobIdentity[],
  title: string | null,
  company: string | null,
): boolean {
  const key = normalizeForDedup(title, company);
  if (!key) return false;
  return jobs.some((j) => normalizeForDedup(j.title, j.company) === key);
}

// Add new jobs, skipping URL duplicates and cross-site duplicates.
export function mergeNewJobs(
  existing: JobsData,
  newJobs: Omit<Job, "id" | "date_found" | "date_applied" | "status">[],
  archivedJobs: ArchivedJob[] = [],
): number {
  const today = new Date().toISOString().split("T")[0];
  let added = 0;
  const knownJobs: JobIdentity[] = [...existing.jobs, ...archivedJobs];

  for (const job of newJobs) {
    if (isDuplicate(knownJobs, job.url)) continue;
    if (isCrossSiteDuplicate(knownJobs, job.title, job.company)) continue;

    const newJob: Job = {
      ...job,
      id: generateId(),
      date_found: today,
      date_applied: null,
      status: "new",
    };

    existing.jobs.push(newJob);
    knownJobs.push(newJob);
    added++;
  }

  return added;
}

// Mark a job as applied
export function markApplied(data: JobsData, jobId: string): boolean {
  const job = data.jobs.find((j) => j.id === jobId);
  if (!job) return false;
  job.status = "applied";
  job.date_applied = new Date().toISOString();
  return true;
}

export function archiveJob(
  data: JobsData,
  archivedData: ArchivedJobsData,
  jobId: string,
): ArchivedJob | null {
  const jobIndex = data.jobs.findIndex((job) => job.id === jobId);
  if (jobIndex === -1) return null;

  const [job] = data.jobs.splice(jobIndex, 1);
  const archivedJob: ArchivedJob = {
    ...job,
    archived_at: new Date().toISOString(),
  };

  archivedData.jobs = archivedData.jobs.filter(
    (existingJob) => existingJob.id !== archivedJob.id && normalizeUrl(existingJob.url) !== normalizeUrl(archivedJob.url),
  );
  archivedData.jobs.unshift(archivedJob);
  return archivedJob;
}

export type RestoreArchivedJobResult =
  | { success: true; job: Job }
  | { success: false; reason: "not_found" | "duplicate" };

export function restoreArchivedJob(
  data: JobsData,
  archivedData: ArchivedJobsData,
  jobId: string,
): RestoreArchivedJobResult {
  const jobIndex = archivedData.jobs.findIndex((job) => job.id === jobId);
  if (jobIndex === -1) {
    return { success: false, reason: "not_found" };
  }

  const archivedJob = archivedData.jobs[jobIndex];

  if (isDuplicate(data.jobs, archivedJob.url) || isCrossSiteDuplicate(data.jobs, archivedJob.title, archivedJob.company)) {
    return { success: false, reason: "duplicate" };
  }

  archivedData.jobs.splice(jobIndex, 1);
  const { archived_at: _archivedAt, ...restoredJob } = archivedJob;
  data.jobs.push(restoredJob);
  return { success: true, job: restoredJob };
}

// Get jobs grouped by status
export function getJobsByStatus(data: JobsData) {
  const today = new Date().toISOString().split("T")[0];
  return {
    newToday: data.jobs.filter((j) => j.status === "new" && j.date_found === today),
    previouslySeen: data.jobs.filter((j) => j.status === "new" && j.date_found !== today),
    applied: data.jobs.filter((j) => j.status === "applied"),
    skipped: data.jobs.filter((j) => j.status === "skipped"),
  };
}
