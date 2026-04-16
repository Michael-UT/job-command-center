// Batch parser: sends job page HTML to the Anthropic Batch API
// for structured extraction at 50% token cost.
// Falls back to single-request parsing if batch is unavailable.

import { config } from "dotenv";
import { PARSE_SYSTEM_PROMPT, PARSE_FEW_SHOT_EXAMPLES } from "../agents/prompts/scrape-parse.js";

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
  description: string | null;
  parse_failed: boolean;
  parse_fail_reason: string | null;
}

// Strip HTML → plaintext for description capture. Decodes common entities,
// collapses whitespace, truncates to `limit` chars.
function stripHtmlToText(html: string | null | undefined, limit = 2500): string | null {
  if (!html) return null;
  const text = String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<nav[\s\S]*?<\/nav>/gi, "")
    .replace(/<footer[\s\S]*?<\/footer>/gi, "")
    .replace(/<header[\s\S]*?<\/header>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<\/?(br|p|div|li|h[1-6])[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#\d+;/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n\s*\n+/g, "\n\n")
    .trim();
  if (!text) return null;
  return text.length > limit ? text.slice(0, limit).trim() + "..." : text;
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
  let visibleText = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<nav[\s\S]*?<\/nav>/gi, "")
    .replace(/<footer[\s\S]*?<\/footer>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<[^>]+>/g, " ")  // strip remaining HTML tags
    .replace(/\s+/g, " ")
    .trim();

  // Build the content to send to Claude, prioritizing structured data
  let cleaned = "";
  if (pageTitle) cleaned += pageTitle + "\n";
  if (metaTags.length > 0) cleaned += "Meta: " + metaTags.join(" | ") + "\n";
  if (jsonLd) cleaned += "Structured data: " + jsonLd + "\n";
  cleaned += "Page text: " + visibleText;

  if (cleaned.length > 8000) {
    cleaned = cleaned.slice(0, 8000) + "\n[...truncated]";
  }
  return cleaned;
}

// Try to extract job data directly from JSON-LD (skip Claude API call if possible)
function tryJsonLd(html: string): ParsedJob | null {
  try {
    const match = html.match(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/i);
    if (!match) return null;

    const data = JSON.parse(match[1]);
    if (data["@type"] !== "JobPosting") return null;

    // Parse salary, handling missing/invalid values
    let salary: string | null = null;
    const salaryVal = data.baseSalary?.value;
    if (salaryVal) {
      const min = Number(salaryVal.minValue);
      const max = Number(salaryVal.maxValue);
      if (!isNaN(min) && !isNaN(max) && min > 0 && max > 0 && max < 10000000) {
        // Convert to $XXXk format if > 1000, otherwise keep as-is
        const fmtMin = min >= 1000 ? `$${Math.round(min / 1000)}k` : `$${min}`;
        const fmtMax = max >= 1000 ? `$${Math.round(max / 1000)}k` : `$${max}`;
        salary = `${fmtMin}-${fmtMax}`;
      }
    }

    const location = data.jobLocation?.address
      ? [data.jobLocation.address.addressLocality, data.jobLocation.address.addressRegion]
          .filter(Boolean).join(", ")
      : null;

    return {
      url: "", ats: "", source: "",
      is_job_posting: true,
      title: data.title || null,
      company: data.hiringOrganization?.name || null,
      location: (data.jobLocationType === "TELECOMMUTE" && location)
        ? `${location} / Remote` : (location || (data.jobLocationType === "TELECOMMUTE" ? "Remote" : null)),
      salary,
      seniority: null,
      employment_type: data.employmentType === "FULL_TIME" ? "full-time"
        : data.employmentType === "PART_TIME" ? "part-time"
        : data.employmentType === "CONTRACTOR" ? "contract" : null,
      status: "open",
      description: stripHtmlToText(data.description),
      parse_failed: false,
      parse_fail_reason: null,
    };
  } catch {
    return null;
  }
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
      description: stripHtmlToText(data.content),
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
            description: stripHtmlToText(job.description) || stripHtmlToText(html),
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
        description: stripHtmlToText(first.description) || stripHtmlToText(html),
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
      description: stripHtmlToText(html),
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
  const description = stripHtmlToText(page.html);

  try {
    const anthropic = await getClient();
    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-6-20250514",
      max_tokens: 400,
      system: PARSE_SYSTEM_PROMPT,
      messages: [
        ...PARSE_FEW_SHOT_EXAMPLES,
        { role: "user", content: cleaned },
      ],
    });

    const text =
      response.content[0].type === "text" ? response.content[0].text : "";
    const parsed = JSON.parse(text);

    return {
      url: page.url,
      ats: page.ats,
      source: page.source,
      ...parsed,
      description,
    };
  } catch (e) {
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
      description,
      parse_failed: true,
      parse_fail_reason: `parse_error: ${e instanceof Error ? e.message : String(e)}`,
    };
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
      model: "claude-sonnet-4-6-20250514" as const,
      max_tokens: 400,
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

      const description = stripHtmlToText(page.html);
      if (entry.result.type === "succeeded") {
        try {
          const msg = entry.result.message;
          const text =
            msg.content[0].type === "text" ? msg.content[0].text : "";
          const data = JSON.parse(text);
          parsed.push({ url: page.url, ats: page.ats, source: page.source, ...data, description });
        } catch {
          parsed.push({
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
            description,
            parse_failed: true,
            parse_fail_reason: "batch_result_parse_error",
          });
        }
      } else {
        parsed.push({
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
          description,
          parse_failed: true,
          parse_fail_reason: `batch_error: ${entry.result.type}`,
        });
      }
    }

    return parsed;
  } catch (e) {
    console.error(`  Batch API failed, falling back to single parsing: ${e}`);
    return Promise.all(pages.map(parseSinglePage));
  }
}
