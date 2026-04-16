import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SEARCH_PROFILE_PATH = join(__dirname, "../data/search-profile.json");

export interface SearchProfile {
  titles: string[];
  negativeTitleKeywords: string[];
  qualificationKeywords: string[];
}

const DEFAULT_TITLES = [
  "forward deployed engineer",
  "forward deployed AI engineer",
  "forward deployed software engineer",
  "AI deployment engineer",
  "AI deployment strategist",
  "applied AI engineer",
  "solutions engineer AI",
  "solutions engineer LLM",
  "solutions engineer machine learning",
  "solutions architect AI",
  "AI consultant",
  "AI implementation engineer",
  "AI integration engineer",
  "customer engineer AI",
  "technical account manager AI",
  "AI strategist",
  "professional services engineer AI",
  "field engineer AI",
  "pre-sales engineer AI",
  "technical solutions engineer AI",
  "enterprise AI engineer",
  "AI success engineer",
  "AI engagement manager",
  "AI engineer",
  "machine learning engineer",
  "ML engineer",
  "solutions engineer",
  "implementation engineer",
  "technical solutions consultant",
  "LLM engineer",
  "prompt engineer",
  "generative AI engineer",
  "AI platform engineer",
  "ML platform engineer",
  "AI infrastructure engineer",
];

const DEFAULT_QUALIFICATION_KEYWORDS = [
  "customer-facing",
  "enterprise",
  "solutions engineering",
  "implementation",
  "deployment",
  "professional services",
  "stakeholder management",
  "pre-sales",
  "consulting",
  "python",
  "typescript",
  "llm",
  "agentic systems",
  "prompt engineering",
  "rag",
  "machine learning",
  "production ai",
];

function normalizeList(values: string[] | undefined): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];

  for (const value of values || []) {
    const trimmed = value.trim().replace(/\s+/g, " ");
    if (!trimmed) continue;

    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push(trimmed);
  }

  return normalized;
}

function normalizeNegativeKeyword(value: string): string {
  return value
    .trim()
    .replace(/^-+/, "")
    .replace(/^"+|"+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeNegativeList(values: string[] | undefined): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];

  for (const value of values || []) {
    const trimmed = normalizeNegativeKeyword(value);
    if (!trimmed) continue;

    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push(trimmed);
  }

  return normalized;
}

function splitInlineNegativeTitleKeywords(values: string[] | undefined): {
  titles: string[];
  negativeTitleKeywords: string[];
} {
  const titles: string[] = [];
  const negativeTitleKeywords: string[] = [];

  for (const value of normalizeList(values)) {
    if (value.startsWith("-")) {
      const negativeKeyword = normalizeNegativeKeyword(value);
      if (negativeKeyword) negativeTitleKeywords.push(negativeKeyword);
      continue;
    }

    titles.push(value);
  }

  return {
    titles: normalizeList(titles),
    negativeTitleKeywords: normalizeNegativeList(negativeTitleKeywords),
  };
}

function mergeUnique(left: string[], right: string[]): string[] {
  const seen = new Set<string>();
  const merged: string[] = [];

  for (const value of [...left, ...right]) {
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(value);
  }

  return merged;
}

export function getDefaultSearchProfile(): SearchProfile {
  return {
    titles: [...DEFAULT_TITLES],
    negativeTitleKeywords: [],
    qualificationKeywords: [...DEFAULT_QUALIFICATION_KEYWORDS],
  };
}

export function normalizeSearchProfile(
  profile: Partial<SearchProfile> | null | undefined,
): SearchProfile {
  const defaults = getDefaultSearchProfile();

  const inlineFilters = splitInlineNegativeTitleKeywords(profile?.titles);
  const titles = inlineFilters.titles;
  const negativeTitleKeywords = mergeUnique(
    inlineFilters.negativeTitleKeywords,
    normalizeNegativeList(profile?.negativeTitleKeywords),
  );
  const qualificationKeywords = normalizeList(profile?.qualificationKeywords);

  return {
    titles: titles.length > 0 ? titles : defaults.titles,
    negativeTitleKeywords,
    qualificationKeywords:
      qualificationKeywords.length > 0
        ? qualificationKeywords
        : defaults.qualificationKeywords,
  };
}

export function loadSearchProfile(): SearchProfile {
  if (!existsSync(SEARCH_PROFILE_PATH)) {
    return getDefaultSearchProfile();
  }

  try {
    const raw = readFileSync(SEARCH_PROFILE_PATH, "utf-8");
    return normalizeSearchProfile(JSON.parse(raw) as Partial<SearchProfile>);
  } catch {
    return getDefaultSearchProfile();
  }
}

export function saveSearchProfile(profile: Partial<SearchProfile>): SearchProfile {
  const normalized = normalizeSearchProfile(profile);
  mkdirSync(dirname(SEARCH_PROFILE_PATH), { recursive: true });
  writeFileSync(SEARCH_PROFILE_PATH, JSON.stringify(normalized, null, 2));
  return normalized;
}
