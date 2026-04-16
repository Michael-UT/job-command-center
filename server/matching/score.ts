import type { SearchProfile } from "../config/search-profile.js";

const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "ai",
  "for",
  "in",
  "of",
  "on",
  "or",
  "the",
  "to",
  "with",
]);

const NON_TARGET_TITLE_KEYWORDS = [
  "account executive",
  "recruiter",
  "designer",
  "marketing",
  "sales development",
  "sdr",
  "finance manager",
  "hr manager",
];

function normalize(value: string | null | undefined): string {
  return (value || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s/+.-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function tokenize(value: string): string[] {
  return normalize(value)
    .split(" ")
    .map((token) => token.trim())
    .filter((token) => token.length > 1 && !STOP_WORDS.has(token));
}

function countSharedTokens(left: string[], right: string[]): number {
  const rightSet = new Set(right);
  return left.filter((token) => rightSet.has(token)).length;
}

function scoreTitleSimilarity(jobTitle: string, roleTitle: string): number {
  const normalizedJobTitle = normalize(jobTitle);
  const normalizedRoleTitle = normalize(roleTitle);

  if (!normalizedJobTitle || !normalizedRoleTitle) return 0;
  if (normalizedJobTitle === normalizedRoleTitle) return 6;
  if (normalizedJobTitle.includes(normalizedRoleTitle) || normalizedRoleTitle.includes(normalizedJobTitle)) {
    return 5;
  }

  const jobTokens = tokenize(normalizedJobTitle);
  const roleTokens = tokenize(normalizedRoleTitle);
  if (jobTokens.length === 0 || roleTokens.length === 0) return 0;

  const overlapRatio = countSharedTokens(jobTokens, roleTokens) / roleTokens.length;
  if (overlapRatio >= 0.8) return 4;
  if (overlapRatio >= 0.6) return 3;
  if (overlapRatio >= 0.4) return 2;
  if (overlapRatio >= 0.25) return 1;
  return 0;
}

function containsNormalizedPhrase(text: string, phrase: string): boolean {
  if (!text || !phrase) return false;
  const pattern = new RegExp(`(^| )${escapeRegex(phrase)}($| )`, "i");
  return pattern.test(text);
}

function collectMatchedKeywords(text: string, keywords: string[]): string[] {
  const normalizedText = normalize(text);

  return keywords.filter((keyword) => {
    const normalizedKeyword = normalize(keyword);
    if (!normalizedKeyword) return false;
    if (containsNormalizedPhrase(normalizedText, normalizedKeyword)) return true;

    const keywordTokens = tokenize(normalizedKeyword);
    if (keywordTokens.length < 2) return false;

    return keywordTokens.every((token) => normalizedText.includes(token));
  });
}

export interface MatchCandidate {
  title: string | null;
  descriptionText: string | null;
  qualificationText: string | null;
}

export interface MatchResult {
  score: number;
  matchedRoleTitle: string | null;
  matchedQualifications: string[];
  summary: string;
}

export function scoreJobAgainstProfile(
  candidate: MatchCandidate,
  profile: SearchProfile,
): MatchResult {
  const jobTitle = candidate.title || "";
  const combinedText = [
    candidate.descriptionText,
    candidate.qualificationText,
  ]
    .filter(Boolean)
    .join("\n");

  let bestRoleTitle: string | null = null;
  let bestTitleScore = 0;

  for (const roleTitle of profile.titles) {
    const titleScore = scoreTitleSimilarity(jobTitle, roleTitle);
    if (titleScore > bestTitleScore) {
      bestTitleScore = titleScore;
      bestRoleTitle = roleTitle;
    }
  }

  const matchedQualifications = collectMatchedKeywords(
    `${jobTitle}\n${combinedText}`,
    profile.qualificationKeywords,
  );
  const matchedNegativeTitleKeywords = collectMatchedKeywords(
    `${jobTitle}\n${combinedText}`,
    profile.negativeTitleKeywords,
  );

  const qualificationScoreBase = Math.min(profile.qualificationKeywords.length, 8) || 1;
  const qualificationScore = Math.min(
    4,
    (matchedQualifications.length / qualificationScoreBase) * 4,
  );

  const roleMentionBonus =
    bestRoleTitle && normalize(combinedText).includes(normalize(bestRoleTitle)) ? 1 : 0;

  const hasNonTargetSignal = NON_TARGET_TITLE_KEYWORDS.some((keyword) =>
    normalize(jobTitle).includes(keyword),
  );
  const penalty = hasNonTargetSignal && bestTitleScore < 4 ? 2 : 0;
  const exclusionPenalty = Math.min(4, matchedNegativeTitleKeywords.length * 4);

  const rawScore =
    bestTitleScore
    + qualificationScore
    + roleMentionBonus
    - penalty
    - exclusionPenalty;
  const score = Math.max(0, Math.min(10, Math.round(rawScore)));

  const summaryParts = [
    bestRoleTitle ? `best title match: ${bestRoleTitle}` : null,
    matchedNegativeTitleKeywords.length > 0
      ? `excluded terms: ${matchedNegativeTitleKeywords.join(", ")}`
      : null,
    matchedQualifications.length > 0
      ? `matched qualifications: ${matchedQualifications.slice(0, 4).join(", ")}`
      : "matched qualifications: none",
  ].filter(Boolean);

  return {
    score,
    matchedRoleTitle: bestRoleTitle,
    matchedQualifications,
    summary: summaryParts.join(" | "),
  };
}

export function buildMatchPromptPreview(
  candidate: MatchCandidate,
  profile: SearchProfile,
): string {
  return JSON.stringify(
    {
      job_title: candidate.title,
      job_description: candidate.descriptionText,
      role_qualifications: candidate.qualificationText,
      target_roles: profile.titles,
      negative_title_keywords: profile.negativeTitleKeywords,
      target_qualification_keywords: profile.qualificationKeywords,
      instructions:
        "Score this job from 0 to 10 based only on job title, cleaned description, and relevant qualifications. Ignore raw HTML and irrelevant boilerplate.",
    },
    null,
    2,
  );
}
