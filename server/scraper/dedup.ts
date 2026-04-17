import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { randomBytes } from "crypto";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { inferCompanyFromTitle, stripCompanyFromTitle } from "./job-normalization.js";

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
  search_snippet?: string | null;
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

function getLocalDateStamp(date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);

  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;

  if (!year || !month || !day) {
    return date.toISOString().split("T")[0];
  }

  return `${year}-${month}-${day}`;
}

export function loadJobs(): JobsData {
  if (!existsSync(JOBS_PATH)) {
    return defaultJobsData();
  }
  const raw = readFileSync(JOBS_PATH, "utf-8");
  const parsed = { ...defaultJobsData(), ...JSON.parse(raw) } as JobsData;

  return {
    ...parsed,
    jobs: reconcileJobs(parsed.jobs || []),
  };
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
    return { jobs: parsed.map(hydrateArchivedJob) };
  }

  return {
    ...defaultArchivedJobsData(),
    ...parsed,
    jobs: (parsed.jobs || []).map(hydrateArchivedJob),
  };
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

function normalizeCompany(company: string | null | undefined): string | null {
  const normalized = (company || "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

  return normalized || null;
}

function normalizeTitleForDedup(title: string | null, company: string | null | undefined): string | null {
  if (!title) return null;

  const cleaned = stripCompanyFromTitle(title, company)
    .replace(/\bjob application for\b/gi, " ")
    .replace(/\bcareers?\b/gi, " ")
    .replace(/\b(wellfound|built in|linkedin|y combinator)\b/gi, " ")
    .replace(/[|•]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

  return cleaned || null;
}

function hydrateIncomingJob(
  job: Omit<Job, "id" | "date_found" | "date_applied" | "status">,
): Omit<Job, "id" | "date_found" | "date_applied" | "status"> {
  return {
    ...job,
    ats: job.ats === "unknown" && job.url.toLowerCase().includes("/careers/") ? "company_site" : job.ats,
    company: job.company || inferCompanyFromTitle(job.title),
    description_text: job.description_text || job.search_snippet || null,
  };
}

function hydrateJob(job: Job): Job {
  return {
    ...job,
    ...hydrateIncomingJob(job),
  };
}

function hydrateArchivedJob(job: ArchivedJob): ArchivedJob {
  return {
    ...job,
    ...hydrateIncomingJob(job),
  };
}

// Check if a URL already exists in the jobs list
export function isDuplicate(jobs: JobIdentity[], url: string): boolean {
  const normalized = normalizeUrl(url);
  return jobs.some((j) => normalizeUrl(j.url) === normalized);
}

// Normalize title+company for cross-site dedup
function normalizeForDedup(title: string | null, company: string | null): string | null {
  const normalizedTitle = normalizeTitleForDedup(title, company);
  const normalizedCompany = normalizeCompany(company || inferCompanyFromTitle(title));
  if (!normalizedTitle || !normalizedCompany) return null;
  return `${normalizedTitle}::${normalizedCompany}`;
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

function findDuplicateByUrl<T extends JobIdentity>(jobs: T[], url: string): T | null {
  const normalizedUrl = normalizeUrl(url);
  return jobs.find((job) => normalizeUrl(job.url) === normalizedUrl) || null;
}

function findCrossSiteDuplicateJob<T extends JobIdentity>(
  jobs: T[],
  title: string | null,
  company: string | null,
): T | null {
  const key = normalizeForDedup(title, company);
  if (!key) return null;
  return jobs.find((job) => normalizeForDedup(job.title, job.company) === key) || null;
}

function titleHasCompanySuffix(title: string | null, company: string | null): boolean {
  if (!title || !company) return false;
  return stripCompanyFromTitle(title, company) !== title.trim();
}

function shouldPreferIncomingTitle(
  currentTitle: string | null,
  incomingTitle: string | null,
  company: string | null,
): boolean {
  if (!incomingTitle) return false;
  if (!currentTitle) return true;

  if (titleHasCompanySuffix(currentTitle, company) && !titleHasCompanySuffix(incomingTitle, company)) {
    return true;
  }

  const currentStripped = stripCompanyFromTitle(currentTitle, company);
  const incomingStripped = stripCompanyFromTitle(incomingTitle, company);
  return currentStripped === incomingStripped && incomingTitle.length < currentTitle.length;
}

function shouldPreferIncomingText(currentValue: string | null | undefined, incomingValue: string | null | undefined): boolean {
  if (!incomingValue) return false;
  if (!currentValue) return true;
  return incomingValue.length > currentValue.length + 40;
}

function getAtsSpecificityRank(ats: string): number {
  if (!ats || ats === "unknown") return 0;
  if (ats === "company_site") return 1;
  return 2;
}

function shouldPreferIncomingAts(currentAts: string, incomingAts: string): boolean {
  return getAtsSpecificityRank(incomingAts) > getAtsSpecificityRank(currentAts);
}

function shouldPreferIncomingSource(
  currentSource: string,
  incomingSource: string,
  currentDetailFailed: boolean,
  incomingDetailFailed: boolean,
): boolean {
  if (!incomingSource) return false;
  if (!currentSource) return true;

  if (currentDetailFailed && !incomingDetailFailed) {
    return true;
  }

  const currentIsFallback = currentSource === "serper";
  const incomingIsFallback = incomingSource === "serper";
  return currentIsFallback && !incomingIsFallback;
}

function getStatusRank(status: Job["status"]): number {
  switch (status) {
    case "applied":
      return 3;
    case "skipped":
      return 2;
    case "new":
    default:
      return 1;
  }
}

function mergeJobData(
  target: Job,
  incomingRaw: Omit<Job, "id" | "date_found" | "date_applied" | "status"> | Job,
): boolean {
  const incoming = hydrateIncomingJob(incomingRaw);
  const resolvedCompany = target.company || incoming.company || inferCompanyFromTitle(target.title);
  let changed = false;

  if (!target.company && incoming.company) {
    target.company = incoming.company;
    changed = true;
  }

  if (shouldPreferIncomingTitle(target.title, incoming.title, resolvedCompany)) {
    target.title = incoming.title;
    changed = true;
  }

  if (shouldPreferIncomingAts(target.ats, incoming.ats)) {
    target.ats = incoming.ats;
    changed = true;
  }

  if (
    shouldPreferIncomingSource(
      target.source,
      incoming.source,
      target.scrape_detail_failed,
      incoming.scrape_detail_failed,
    )
  ) {
    target.source = incoming.source;
    changed = true;
  }

  if (!target.location && incoming.location) {
    target.location = incoming.location;
    changed = true;
  }

  if (!target.salary && incoming.salary) {
    target.salary = incoming.salary;
    changed = true;
  }

  if (!target.seniority && incoming.seniority) {
    target.seniority = incoming.seniority;
    changed = true;
  }

  if (!target.search_snippet && incoming.search_snippet) {
    target.search_snippet = incoming.search_snippet;
    changed = true;
  }

  if (shouldPreferIncomingText(target.description_text, incoming.description_text)) {
    target.description_text = incoming.description_text;
    changed = true;
  }

  if (shouldPreferIncomingText(target.qualification_text, incoming.qualification_text)) {
    target.qualification_text = incoming.qualification_text;
    changed = true;
  }

  if (target.scrape_detail_failed && !incoming.scrape_detail_failed) {
    target.scrape_detail_failed = false;
    changed = true;
  }

  if ("status" in incomingRaw && getStatusRank(incomingRaw.status) > getStatusRank(target.status)) {
    target.status = incomingRaw.status;
    changed = true;
  }

  if ("date_applied" in incomingRaw && !target.date_applied && incomingRaw.date_applied) {
    target.date_applied = incomingRaw.date_applied;
    changed = true;
  }

  if (!target.description_text && target.search_snippet) {
    target.description_text = target.search_snippet;
    changed = true;
  }

  return changed;
}

function reconcileJobs(jobs: Job[]): Job[] {
  const merged: Job[] = [];

  for (const rawJob of jobs) {
    const job = hydrateJob(rawJob);
    const duplicateByUrl = findDuplicateByUrl(merged, job.url);
    if (duplicateByUrl) {
      mergeJobData(duplicateByUrl, job);
      continue;
    }

    const duplicateByKey = findCrossSiteDuplicateJob(merged, job.title, job.company);
    if (duplicateByKey) {
      mergeJobData(duplicateByKey, job);
      continue;
    }

    merged.push(job);
  }

  return merged;
}

// Add new jobs, skipping URL duplicates and cross-site duplicates.
export function mergeNewJobs(
  existing: JobsData,
  newJobs: Omit<Job, "id" | "date_found" | "date_applied" | "status">[],
  archivedJobs: ArchivedJob[] = [],
): number {
  const today = getLocalDateStamp();
  let added = 0;

  for (const rawJob of newJobs) {
    const job = hydrateIncomingJob(rawJob);
    const duplicateByUrl = findDuplicateByUrl(existing.jobs, job.url);
    if (duplicateByUrl) {
      mergeJobData(duplicateByUrl, job);
      continue;
    }

    if (findDuplicateByUrl(archivedJobs, job.url)) continue;

    const duplicateByKey = findCrossSiteDuplicateJob(existing.jobs, job.title, job.company);
    if (duplicateByKey) {
      mergeJobData(duplicateByKey, job);
      continue;
    }

    if (findCrossSiteDuplicateJob(archivedJobs, job.title, job.company)) continue;

    const newJob: Job = {
      ...job,
      id: generateId(),
      date_found: today,
      date_applied: null,
      status: "new",
    };

    existing.jobs.push(newJob);
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
  const today = getLocalDateStamp();
  return {
    newToday: data.jobs.filter((j) => j.status === "new" && j.date_found === today),
    previouslySeen: data.jobs.filter((j) => j.status === "new" && j.date_found !== today),
    applied: data.jobs.filter((j) => j.status === "applied"),
    skipped: data.jobs.filter((j) => j.status === "skipped"),
  };
}
