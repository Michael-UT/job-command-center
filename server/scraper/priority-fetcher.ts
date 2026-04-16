// Fetches all current job postings from priority companies via their ATS public APIs.
// Greenhouse, Ashby, Lever APIs are free and return JSON lists of all open jobs.
// Custom career pages fall back to Serper site queries.

import { PRIORITY_COMPANIES, type PriorityCompany } from "../config/priority-companies.js";

// Reject titles that are clearly not engineering/tech/AI roles.
// We're lenient here — the scoring model will further filter via 1-5 fit scores.
const IRRELEVANT_KEYWORDS = [
  "accountant", "accounting", "payroll", "bookkeeper", "tax analyst", "tax manager", "auditor",
  "legal counsel", "paralegal", "attorney", "lawyer",
  "recruiter", "talent acquisition", "people ops", "people operations", "hrbp", "compensation analyst",
  "facilities", "janitor", "security guard", "receptionist", "administrative assistant",
  "warehouse", "forklift", "welder", "machinist", "mechanic", "assembler", "technician ii", "technician iii",
  "barista", "chef", "cook", "bartender",
  "truck driver", "pilot", "flight attendant",
  "construction", "plumber", "electrician",
  "teacher", "instructor", "tutor",
  "intern", "internship", "summer intern",
  "nurse", "physician", "medical assistant", "clinical",
  "marketing manager", "brand manager", "content writer", "social media",
  "sales development representative", "sdr", "bdr", "account executive",
  "graphic designer", "ux designer", "ui designer",
];

function isRelevantTitle(title: string): boolean {
  if (!title) return false;
  const lower = title.toLowerCase();
  return !IRRELEVANT_KEYWORDS.some((k) => lower.includes(k));
}

export interface FetchedJob {
  url: string;
  title: string;
  company: string;
  location: string | null;
  salary: string | null;
  ats: string;
  source: string;
  description: string | null;
}

function stripHtml(html: string | null | undefined, limit = 2500): string | null {
  if (!html) return null;
  const text = String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<\/?(br|p|div|li|h[1-6])[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">").replace(/&quot;/gi, '"').replace(/&#39;/gi, "'")
    .replace(/&#\d+;/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n\s*\n+/g, "\n\n")
    .trim();
  if (!text) return null;
  return text.length > limit ? text.slice(0, limit).trim() + "..." : text;
}

// Format a number like 295000 as "$295k"
function formatSalary(minValue?: number, maxValue?: number, currency = "USD"): string | null {
  if (!minValue && !maxValue) return null;
  const fmt = (v: number) => (v >= 1000 ? `$${Math.round(v / 1000)}k` : `$${v}`);
  const symbol = currency === "USD" ? "" : `${currency} `;
  if (minValue && maxValue && minValue !== maxValue) return `${symbol}${fmt(minValue)}-${fmt(maxValue)}`;
  const single = minValue || maxValue!;
  return `${symbol}${fmt(single)}`;
}

// Extract salary from HTML content via regex (for Greenhouse)
function extractSalaryFromHtml(html: string): string | null {
  if (!html) return null;
  // Decode entities then match salary patterns
  const decoded = html
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&nbsp;/g, " ");
  // Pattern: $180,000 - $250,000 or $180k-$250k or $180K to $250K
  const m = decoded.match(/\$[\d,]+(?:\.\d+)?[kKmM]?\s*[-–—to]+\s*\$[\d,]+(?:\.\d+)?[kKmM]?/);
  if (m) {
    // Normalize the match
    return m[0].replace(/,/g, "").replace(/\s+/g, " ").trim();
  }
  // Single value: "$295K" or "$295,000"
  const single = decoded.match(/(?:salary|compensation|base pay|annual pay)[^$]{0,50}(\$[\d,]+[kKmM]?)/i);
  if (single) return single[1].replace(/,/g, "");
  return null;
}

// Greenhouse: GET https://boards-api.greenhouse.io/v1/boards/{slug}/jobs?content=true
async function fetchGreenhouse(company: PriorityCompany): Promise<FetchedJob[]> {
  const url = `https://boards-api.greenhouse.io/v1/boards/${company.slug}/jobs?content=true`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) return [];
    const data = (await res.json()) as any;
    const jobs = data.jobs || [];
    return jobs
      .filter((j: any) => isRelevantTitle(j.title))
      .map((j: any) => ({
        url: j.absolute_url,
        title: j.title,
        company: company.name,
        location: j.location?.name || null,
        salary: extractSalaryFromHtml(j.content || ""),
        ats: "greenhouse",
        source: "priority_greenhouse_api",
        description: stripHtml(j.content),
      }));
  } catch {
    return [];
  }
}

// Ashby: GET https://api.ashbyhq.com/posting-api/job-board/{slug}
async function fetchAshby(company: PriorityCompany): Promise<FetchedJob[]> {
  if (!company.slug) return [];
  const url = `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(company.slug)}?includeCompensation=true`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) return [];
    const data = (await res.json()) as any;
    const jobs = data.jobs || [];
    return jobs
      .filter((j: any) => isRelevantTitle(j.title))
      .map((j: any) => {
        // Ashby compensation: prefer compensationTierSummary, fall back to summaryComponents
        let salary: string | null = null;
        const comp = j.compensation;
        if (comp?.compensationTierSummary) {
          salary = comp.compensationTierSummary;
        } else if (comp?.summaryComponents?.[0]) {
          const s = comp.summaryComponents[0];
          salary = formatSalary(s.minValue, s.maxValue, s.currencyCode);
        }
        return {
          url: j.jobUrl || j.applyUrl,
          title: j.title,
          company: company.name,
          location: j.location || null,
          salary,
          ats: "ashby",
          source: "priority_ashby_api",
          description: stripHtml(j.descriptionHtml || j.descriptionPlain || j.description),
        };
      });
  } catch {
    return [];
  }
}

// Lever: GET https://api.lever.co/v0/postings/{slug}?mode=json
async function fetchLever(company: PriorityCompany): Promise<FetchedJob[]> {
  const url = `https://api.lever.co/v0/postings/${company.slug}?mode=json`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) return [];
    const data = (await res.json()) as any;
    if (!Array.isArray(data)) return [];
    return data
      .filter((j: any) => isRelevantTitle(j.text))
      .map((j: any) => ({
        url: j.hostedUrl || j.applyUrl,
        title: j.text,
        company: company.name,
        location: j.categories?.location || null,
        salary: extractSalaryFromHtml(j.descriptionPlain || j.description || ""),
        ats: "lever",
        source: "priority_lever_api",
        description: stripHtml(j.descriptionPlain || j.description),
      }));
  } catch {
    return [];
  }
}

// Rippling: no public JSON API, but the careers page contains a __NEXT_DATA__ blob
// we can parse. Falls back to empty if that fails.
async function fetchRippling(company: PriorityCompany): Promise<FetchedJob[]> {
  const url = `https://ats.rippling.com/${company.slug}`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) return [];
    const html = await res.text();
    const match = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
    if (!match) return [];
    const data = JSON.parse(match[1]);
    const queries = data?.props?.pageProps?.dehydratedState?.queries || [];
    const jobs: any[] = [];
    for (const q of queries) {
      const items = q.state?.data?.items;
      if (Array.isArray(items)) {
        for (const item of items) {
          if (item.name && item.url) jobs.push(item);
        }
      }
    }
    return jobs
      .filter((j: any) => isRelevantTitle(j.name))
      .map((j: any) => ({
        url: j.url.startsWith("http") ? j.url : `https://ats.rippling.com${j.url}`,
        title: j.name,
        company: company.name,
        location: Array.isArray(j.locations)
          ? j.locations.map((l: any) => l.name || l.city).filter(Boolean).join(" / ")
          : null,
        salary: null,
        ats: "rippling",
        source: "priority_rippling",
        description: stripHtml(j.description),
      }));
  } catch {
    return [];
  }
}

// Custom career pages: fall back to Serper site query for the company's domain
async function fetchCustom(company: PriorityCompany): Promise<FetchedJob[]> {
  const apiKey = process.env.SERPER_API_KEY;
  if (!apiKey) return [];
  const domain = company.careersUrl.replace(/^https?:\/\//, "").split("/")[0];
  const query = `site:${domain} AI engineer OR solutions engineer OR forward deployed`;
  try {
    const res = await fetch("https://google.serper.dev/search", {
      method: "POST",
      headers: { "X-API-KEY": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({ q: query, num: 20 }),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as any;
    return (data.organic || [])
      .filter((o: any) => o.link && o.link.includes(domain))
      .map((o: any) => ({
        url: o.link,
        title: o.title || "Unknown",
        company: company.name,
        location: null,
        salary: null,
        ats: "custom",
        source: "priority_custom_serper",
        description: o.snippet || null,
      }));
  } catch {
    return [];
  }
}

export async function fetchCompanyJobs(company: PriorityCompany): Promise<FetchedJob[]> {
  switch (company.ats) {
    case "greenhouse":
      return fetchGreenhouse(company);
    case "ashby":
      return fetchAshby(company);
    case "lever":
      return fetchLever(company);
    case "rippling":
      return fetchRippling(company);
    case "custom":
    default:
      return fetchCustom(company);
  }
}

export async function fetchAllPriorityJobs(): Promise<FetchedJob[]> {
  const allJobs: FetchedJob[] = [];
  console.log(`\n  Fetching jobs from ${PRIORITY_COMPANIES.length} priority companies...`);

  for (let i = 0; i < PRIORITY_COMPANIES.length; i++) {
    const company = PRIORITY_COMPANIES[i];
    process.stdout.write(`  [${i + 1}/${PRIORITY_COMPANIES.length}] ${company.name}... `);
    const jobs = await fetchCompanyJobs(company);
    console.log(`${jobs.length} jobs (${company.ats || "none"})`);
    allJobs.push(...jobs);
    await new Promise((r) => setTimeout(r, 100));
  }

  console.log(`\n  Total priority jobs fetched: ${allJobs.length}`);
  return allJobs;
}
