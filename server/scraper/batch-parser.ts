// Batch parser: sends job page HTML to the Anthropic Batch API
// for structured extraction at 50% token cost.
// Falls back to single-request parsing if batch is unavailable.

import { config } from "dotenv";
import { z } from "zod";
import { PARSE_SYSTEM_PROMPT, PARSE_FEW_SHOT_EXAMPLES } from "../agents/prompts/scrape-parse.js";
import { extractJobMatchContext } from "../matching/context.js";

// Load .env for ANTHROPIC_API_KEY
config();

// Dynamic import to handle both CJS/ESM
let client: any;
async function getClient() {
  if (!client) {
    const mod = await import("@anthropic-ai/sdk");
    const Anthropic = (mod as any).default || mod;
    client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return client;
}

export interface RawPage {
  url: string;
  html: string;
  ats: string;
  source: string;
}

export interface ParsedJob {
  url: string;
  ats: string;
  source: string;
  is_job_posting: boolean;
  title: string | null;
  company: string | null;
  location: string | null;
  salary: string | null;
  seniority: string | null;
  employment_type: string | null;
  status: string | null;
  parse_failed: boolean;
  parse_fail_reason: string | null;
}

const PARSE_INPUT_CHAR_LIMIT = 6500;
const META_CHAR_LIMIT = 1200;
const STRUCTURED_DATA_CHAR_LIMIT = 2200;
const PAGE_TEXT_CHAR_LIMIT = 2800;
const MATCH_CONTEXT_CHAR_LIMIT = 1800;
const PARSE_MODEL = process.env.PARSE_MODEL || "claude-sonnet-4-6";

const ParsedJobSchema = z.object({
  is_job_posting: z.boolean(),
  title: z.string().trim().max(200).nullable(),
  company: z.string().trim().max(160).nullable(),
  location: z.string().trim().max(200).nullable(),
  salary: z.string().trim().max(80).nullable(),
  seniority: z.enum(["intern", "entry", "mid", "senior", "lead", "staff"]).nullable(),
  employment_type: z.enum(["full-time", "part-time", "contract"]).nullable(),
  status: z.enum(["open", "closed"]).nullable(),
  parse_failed: z.boolean(),
  parse_fail_reason: z.string().trim().max(240).nullable(),
});

type JsonLdNode = Record<string, unknown>;

function flattenJsonLdNodes(value: unknown): JsonLdNode[] {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value.flatMap(flattenJsonLdNodes);
  }
  if (typeof value !== "object") return [];

  const node = value as JsonLdNode;
  const nested = Array.isArray(node["@graph"])
    ? node["@graph"].flatMap(flattenJsonLdNodes)
    : [];

  return [node, ...nested];
}

function hasJobPostingType(node: JsonLdNode): boolean {
  const type = node["@type"];
  if (Array.isArray(type)) return type.includes("JobPosting");
  return type === "JobPosting";
}

function formatCompensation(value: number, isAnnual: boolean): string {
  if (isAnnual && value >= 1000) {
    return `$${Math.round(value / 1000)}k`;
  }
  return `$${Number.isInteger(value) ? value : value.toFixed(2)}`;
}

function extractSalary(data: JsonLdNode): string | null {
  const salaryInfo =
    typeof data.baseSalary === "object" && data.baseSalary
      ? (data.baseSalary as JsonLdNode)
      : null;
  const salaryValue =
    typeof salaryInfo?.value === "object" && salaryInfo.value
      ? (salaryInfo.value as JsonLdNode)
      : salaryInfo;

  if (!salaryValue) return null;

  const min = Number(salaryValue.minValue ?? salaryValue.value ?? salaryValue["value"]);
  const max = Number(salaryValue.maxValue ?? salaryValue.value ?? salaryValue["value"]);
  const unitText = String(
    salaryValue.unitText ?? salaryInfo?.unitText ?? "",
  ).toLowerCase();
  const isAnnual =
    unitText === "" || unitText.includes("year") || unitText.includes("annual");
  const suffix = unitText.includes("hour") ? "/hr" : "";

  if (!Number.isFinite(min) || min <= 0 || min >= 10000000) return null;

  if (Number.isFinite(max) && max > 0 && max < 10000000 && max !== min) {
    return `${formatCompensation(min, isAnnual)}-${formatCompensation(max, isAnnual)}${suffix}`;
  }

  return `${formatCompensation(min, isAnnual)}${suffix}`;
}

function extractLocationPart(value: unknown): string | null {
  if (!value) return null;
  if (typeof value === "string") return value;
  if (typeof value !== "object") return null;

  const node = value as JsonLdNode;
  const country =
    typeof node.addressCountry === "string"
      ? node.addressCountry
      : typeof node.addressCountry === "object" && node.addressCountry
        ? String((node.addressCountry as JsonLdNode).name ?? "")
        : null;

  return [
    node.addressLocality,
    node.addressRegion,
    country && !["US", "USA", "United States"].includes(country) ? country : null,
  ]
    .filter((part): part is string => typeof part === "string" && part.trim().length > 0)
    .join(", ") || null;
}

function extractLocation(data: JsonLdNode): string | null {
  const rawLocations = Array.isArray(data.jobLocation)
    ? data.jobLocation
    : data.jobLocation
      ? [data.jobLocation]
      : [];

  const locations = rawLocations
    .map((entry) => {
      if (typeof entry === "object" && entry) {
        return extractLocationPart((entry as JsonLdNode).address ?? entry);
      }
      return extractLocationPart(entry);
    })
    .filter((value): value is string => Boolean(value));

  const uniqueLocations = [...new Set(locations)];
  const baseLocation = uniqueLocations.length > 0 ? uniqueLocations.join(" / ") : null;

  if (data.jobLocationType === "TELECOMMUTE") {
    return baseLocation ? `${baseLocation} / Remote` : "Remote";
  }

  return baseLocation;
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength).trim()}\n[...truncated]`;
}

function extractJsonObject(text: string): string {
  const trimmed = text.trim();
  const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fencedMatch) return fencedMatch[1].trim();

  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return trimmed.slice(firstBrace, lastBrace + 1);
  }

  return trimmed;
}

function parseModelOutput(rawText: string): z.infer<typeof ParsedJobSchema> {
  const extracted = extractJsonObject(rawText);
  const parsed = JSON.parse(extracted);
  return ParsedJobSchema.parse(parsed);
}

function buildParseFailure(page: RawPage, reason: string): ParsedJob {
  return {
    url: page.url,
    ats: page.ats,
    source: page.source,
    is_job_posting: false,
    title: null,
    company: null,
    location: null,
    salary: null,
    seniority: null,
    employment_type: null,
    status: null,
    parse_failed: true,
    parse_fail_reason: reason,
  };
}

// Extract useful content from HTML for parsing.
// Handles both server-rendered pages and JS-heavy SPAs (Ashby, etc.)
function cleanHtml(html: string): string {
  // First, try to extract JSON-LD structured data (most ATS platforms include this)
  const jsonLdMatches = html.matchAll(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi);
  let jsonLd = "";
  for (const match of jsonLdMatches) {
    jsonLd += match[1] + "\n";
  }

  // Extract meta tags (often contain title, description, company)
  const metaTags: string[] = [];
  for (const match of html.matchAll(/<meta[^>]+(property|name)="([^"]*)"[^>]*content="([^"]*)"[^>]*>/gi)) {
    if (match[2].includes("title") || match[2].includes("description") || match[2].includes("og:")) {
      metaTags.push(`${match[2]}: ${match[3]}`);
    }
  }

  // Extract <title>
  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  const pageTitle = titleMatch ? `Page title: ${titleMatch[1]}` : "";

  // Strip scripts, styles, nav, footer for visible text
  const visibleText = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<nav[\s\S]*?<\/nav>/gi, "")
    .replace(/<footer[\s\S]*?<\/footer>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<[^>]+>/g, " ")  // strip remaining HTML tags
    .replace(/\s+/g, " ")
    .trim();

  const matchContext = extractJobMatchContext(html);
  const sections = [
    pageTitle ? pageTitle : null,
    metaTags.length > 0 ? `Meta: ${truncate(metaTags.join(" | "), META_CHAR_LIMIT)}` : null,
    jsonLd ? `Structured data: ${truncate(jsonLd, STRUCTURED_DATA_CHAR_LIMIT)}` : null,
    matchContext.relevantText
      ? `Relevant text: ${truncate(matchContext.relevantText, MATCH_CONTEXT_CHAR_LIMIT)}`
      : null,
    visibleText ? `Page text: ${truncate(visibleText, PAGE_TEXT_CHAR_LIMIT)}` : null,
  ].filter(Boolean);

  return truncate(sections.join("\n\n"), PARSE_INPUT_CHAR_LIMIT);
}

// Try to extract job data directly from JSON-LD (skip Claude API call if possible)
function tryJsonLd(html: string): ParsedJob | null {
  const matches = html.matchAll(
    /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
  );

  for (const match of matches) {
    try {
      const data = JSON.parse(match[1]);
      const jobPosting = flattenJsonLdNodes(data).find(hasJobPostingType);
      if (!jobPosting) continue;

      return {
        url: "",
        ats: "",
        source: "",
        is_job_posting: true,
        title: typeof jobPosting.title === "string" ? jobPosting.title : null,
        company:
          typeof jobPosting.hiringOrganization === "object" && jobPosting.hiringOrganization
            ? String((jobPosting.hiringOrganization as JsonLdNode).name ?? "")
            : null,
        location: extractLocation(jobPosting),
        salary: extractSalary(jobPosting),
        seniority: null,
        employment_type:
          jobPosting.employmentType === "FULL_TIME"
            ? "full-time"
            : jobPosting.employmentType === "PART_TIME"
              ? "part-time"
              : jobPosting.employmentType === "CONTRACTOR"
                ? "contract"
                : null,
        status: "open",
        parse_failed: false,
        parse_fail_reason: null,
      };
    } catch {
      continue;
    }
  }

  return null;
}

// Try Greenhouse JSON API: boards-api.greenhouse.io/v1/boards/{company}/jobs/{id}
async function tryGreenhouseApi(url: string): Promise<ParsedJob | null> {
  // Extract company and job ID from URL
  // Patterns: job-boards.greenhouse.io/{company}/jobs/{id} or boards.greenhouse.io/{company}/jobs/{id}
  const match = url.match(/(?:job-boards|boards)\.greenhouse\.io\/([^/]+)\/jobs\/(\d+)/);
  if (!match) return null;

  const [, company, jobId] = match;
  const apiUrl = `https://boards-api.greenhouse.io/v1/boards/${company}/jobs/${jobId}`;

  try {
    const res = await fetch(apiUrl, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;

    const data = await res.json() as any;
    if (!data.title) return null;

    // Extract salary from content HTML if present
    let salary: string | null = null;
    if (data.content) {
      const salaryMatch = data.content.match(/\$[\d,]+(?:k|K)?\s*[-–—to]+\s*\$[\d,]+(?:k|K)?/);
      if (salaryMatch) salary = salaryMatch[0];
    }

    // Common slug → proper name mappings
    const GREENHOUSE_NAMES: Record<string, string> = {
      anthropic: "Anthropic", scaleai: "Scale AI", xai: "xAI", gleanwork: "Glean",
      icapitalnetwork: "iCapital", cresta: "Cresta", labelbox: "Labelbox",
      snorkelai: "Snorkel AI", axiomaticai: "Axiomatic AI", defenseunicorns: "Defense Unicorns",
      runpodai: "RunPod",
    };
    const companyName = GREENHOUSE_NAMES[company]
      || company.replace(/-/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase());

    return {
      url, ats: "greenhouse", source: "greenhouse_api",
      is_job_posting: true,
      title: data.title,
      company: companyName,
      location: data.location?.name || null,
      salary,
      seniority: null,
      employment_type: "full-time",
      status: "open",
      parse_failed: false,
      parse_fail_reason: null,
    };
  } catch {
    return null;
  }
}

// Try Rippling __NEXT_DATA__ extraction
function tryRipplingNextData(html: string, url: string): ParsedJob | null {
  try {
    const match = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
    if (!match) return null;

    const nextData = JSON.parse(match[1]);
    const queries = nextData?.props?.pageProps?.dehydratedState?.queries;
    if (!queries || !Array.isArray(queries)) return null;

    // Find the job posts query
    for (const q of queries) {
      const items = q.state?.data?.items;
      if (!Array.isArray(items) || items.length === 0) continue;

      // Check if these are job items (have name + url fields)
      const first = items[0];
      if (!first.name || !first.url) continue;

      // If the URL points to a specific job, find it
      const jobSlug = url.split("/jobs/")[1];
      if (jobSlug) {
        const job = items.find((j: any) => j.url?.includes(jobSlug) || j.id === jobSlug);
        if (job) {
          const loc = Array.isArray(job.locations)
            ? job.locations.map((l: any) => l.name || l.city).filter(Boolean).join(" / ")
            : null;
          return {
            url, ats: "rippling", source: "rippling_nextdata",
            is_job_posting: true,
            title: job.name,
            company: nextData?.props?.pageProps?.apiData?.jobBoardSlug?.replace(/-/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase()) || null,
            location: loc,
            salary: null,
            seniority: null,
            employment_type: "full-time",
            status: "open",
            parse_failed: false,
            parse_fail_reason: null,
          };
        }
      }

      // Otherwise return the first job as a fallback
      return {
        url, ats: "rippling", source: "rippling_nextdata",
        is_job_posting: true,
        title: first.name,
        company: nextData?.props?.pageProps?.apiData?.jobBoardSlug?.replace(/-/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase()) || null,
        location: Array.isArray(first.locations)
          ? first.locations.map((l: any) => l.name || l.city).filter(Boolean).join(" / ")
          : null,
        salary: null,
        seniority: null,
        employment_type: "full-time",
        status: "open",
        parse_failed: false,
        parse_fail_reason: null,
      };
    }
    return null;
  } catch {
    return null;
  }
}

// Try Lever meta tags — Lever pages are server-rendered with good meta tags
function tryLeverMeta(html: string, url: string): ParsedJob | null {
  if (!url.includes("lever.co")) return null;

  try {
    const title = html.match(/<meta\s+property="og:title"\s+content="([^"]+)"/i)?.[1]
      || html.match(/<title>([^<]+)<\/title>/i)?.[1];
    if (!title) return null;

    const description = html.match(/<meta\s+property="og:description"\s+content="([^"]+)"/i)?.[1] || "";

    // Extract company from URL: jobs.lever.co/{company}/...
    const companySlug = url.match(/jobs\.lever\.co\/([^/]+)/)?.[1];
    const company = companySlug
      ? companySlug.replace(/-/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase())
      : null;

    // Try to find location in the description or page
    const locationMatch = html.match(/<div[^>]*class="[^"]*location[^"]*"[^>]*>([^<]+)</i)
      || description.match(/((?:New York|San Francisco|Remote|London|Seattle|Austin|Chicago|Boston|Washington|Palo Alto|Los Angeles)[^,]*(?:,\s*\w+)?)/i);
    const location = locationMatch?.[1]?.trim() || null;

    return {
      url, ats: "lever", source: "lever_meta",
      is_job_posting: true,
      title: title.replace(/ - .*$/, "").trim(), // strip " - Company Name" suffix
      company,
      location,
      salary: null,
      seniority: null,
      employment_type: "full-time",
      status: "open",
      parse_failed: false,
      parse_fail_reason: null,
    };
  } catch {
    return null;
  }
}

// Parse a single page — tries platform-specific extractors first (free), falls back to Claude API
export async function parseSinglePage(page: RawPage): Promise<ParsedJob> {
  // Fast path 1: JSON-LD structured data (Ashby, some Lever, Workday)
  const jsonLdResult = tryJsonLd(page.html);
  if (jsonLdResult) {
    return { ...jsonLdResult, url: page.url, ats: page.ats, source: page.source };
  }

  // Fast path 2: Greenhouse JSON API
  if (page.ats === "greenhouse" || page.url.includes("greenhouse.io")) {
    const ghResult = await tryGreenhouseApi(page.url);
    if (ghResult) return ghResult;
  }

  // Fast path 3: Rippling __NEXT_DATA__
  if (page.ats === "rippling" || page.url.includes("rippling.com")) {
    const ripResult = tryRipplingNextData(page.html, page.url);
    if (ripResult) return ripResult;
  }

  // Fast path 4: Lever meta tags
  if (page.ats === "lever" || page.url.includes("lever.co")) {
    const leverResult = tryLeverMeta(page.html, page.url);
    if (leverResult) return leverResult;
  }

  // Slow path: send to Claude API for extraction
  const cleaned = cleanHtml(page.html);

  try {
    const anthropic = await getClient();
    const response = await anthropic.messages.create({
      model: PARSE_MODEL,
      max_tokens: 400,
      temperature: 0,
      system: PARSE_SYSTEM_PROMPT,
      messages: [
        ...PARSE_FEW_SHOT_EXAMPLES,
        { role: "user", content: cleaned },
      ],
    });

    const text =
      response.content[0].type === "text" ? response.content[0].text : "";
    const parsed = parseModelOutput(text);

    return {
      url: page.url,
      ats: page.ats,
      source: page.source,
      ...parsed,
    };
  } catch (e) {
    return buildParseFailure(
      page,
      `parse_error: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
}

// Parse multiple pages using the Anthropic Batch API (50% off tokens).
// Polls for completion — small batches typically finish in minutes.
export async function batchParsePages(pages: RawPage[]): Promise<ParsedJob[]> {
  if (pages.length === 0) return [];

  // For very small batches, use direct calls instead
  if (pages.length <= 3) {
    const results: ParsedJob[] = [];
    for (const page of pages) {
      results.push(await parseSinglePage(page));
    }
    return results;
  }

  const requests = pages.map((page, i) => ({
    custom_id: `job-${i}`,
    params: {
      model: PARSE_MODEL,
      max_tokens: 400,
      temperature: 0,
      system: PARSE_SYSTEM_PROMPT,
      messages: [
        ...PARSE_FEW_SHOT_EXAMPLES,
        { role: "user" as const, content: cleanHtml(page.html) },
      ],
    },
  }));

  try {
    const anthropic = await getClient();
    // Create the batch
    const batch = await anthropic.batches.create({ requests });
    console.log(`  Batch ${batch.id} created with ${pages.length} requests`);

    // Poll for completion
    let result = batch;
    while (result.processing_status === "in_progress") {
      await new Promise((r) => setTimeout(r, 5000)); // check every 5s
      result = await anthropic.batches.retrieve(batch.id);
      const counts = result.request_counts;
      console.log(
        `  Batch progress: ${counts.succeeded}/${counts.processing + counts.succeeded} ` +
          `(${counts.errored} errors)`,
      );
    }

    if (result.processing_status !== "ended") {
      console.error(`  Batch failed with status: ${result.processing_status}`);
      // Fallback to single parsing
      return Promise.all(pages.map(parseSinglePage));
    }

    // Retrieve results
    const parsed: ParsedJob[] = [];
    const resultStream = await anthropic.batches.results(batch.id);

    for await (const entry of resultStream) {
      const idx = parseInt(entry.custom_id.replace("job-", ""), 10);
      const page = pages[idx];

      if (entry.result.type === "succeeded") {
        try {
          const msg = entry.result.message;
          const text =
            msg.content[0].type === "text" ? msg.content[0].text : "";
          const data = parseModelOutput(text);
          parsed.push({ url: page.url, ats: page.ats, source: page.source, ...data });
        } catch (e) {
          parsed.push(
            buildParseFailure(
              page,
              `batch_result_parse_error: ${e instanceof Error ? e.message : String(e)}`,
            ),
          );
        }
      } else {
        parsed.push(buildParseFailure(page, `batch_error: ${entry.result.type}`));
      }
    }

    return parsed;
  } catch (e) {
    console.error(`  Batch API failed, falling back to single parsing: ${e}`);
    return Promise.all(pages.map(parseSinglePage));
  }
}
