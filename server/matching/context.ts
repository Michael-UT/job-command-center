function decodeEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function stripHtml(html: string): string {
  return decodeEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, "")
      .replace(/<!--[\s\S]*?-->/g, "")
      .replace(/<(br|\/p|\/div|\/section|\/article|\/li|\/ul|\/ol|\/h[1-6])[^>]*>/gi, "\n")
      .replace(/<li[^>]*>/gi, "\n- ")
      .replace(/<[^>]+>/g, " ")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .replace(/[ \t]{2,}/g, " ")
      .trim(),
  );
}

function extractPageTitle(html: string): string | null {
  const title = html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]?.trim();
  return title || null;
}

function extractMetaDescription(html: string): string | null {
  const description =
    html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i)?.[1]
    || html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i)?.[1];

  return description?.trim() || null;
}

function extractSectionText(rawText: string, headings: string[]): string | null {
  const headingPattern = headings
    .map((heading) => heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("|");

  const regex = new RegExp(
    `(?:^|\\n)\\s*(?:${headingPattern})\\s*[:\\-]?\\s*\\n([\\s\\S]{0,1800}?)(?=\\n\\s*[A-Z][^\\n]{1,80}:?\\s*\\n|$)`,
    "im",
  );

  const match = rawText.match(regex)?.[1];
  return match?.trim() || null;
}

function truncate(value: string | null, maxLength: number): string | null {
  if (!value) return null;
  return value.length > maxLength ? `${value.slice(0, maxLength).trim()}…` : value;
}

function buildSummaryText(text: string, metaDescription: string | null): string | null {
  if (metaDescription) {
    return truncate(metaDescription, 900);
  }

  const normalized = text
    .split(/\n+/)
    .map((line) => line.trim())
    .filter((line) => line.length > 40 && !line.startsWith("- "));

  if (normalized.length === 0) return null;
  return truncate(normalized.slice(0, 4).join(" "), 900);
}

function buildQualificationText(text: string): string | null {
  const section = extractSectionText(text, [
    "qualifications",
    "requirements",
    "what you bring",
    "what we're looking for",
    "must have",
    "preferred qualifications",
    "experience",
  ]);

  if (section) return truncate(section, 1200);

  const lines = text
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(
      (line) =>
        line.startsWith("- ")
        || /\b(required|qualification|experience|skills?|must have|nice to have)\b/i.test(line),
    );

  if (lines.length === 0) return null;
  return truncate(lines.slice(0, 10).join("\n"), 1200);
}

export interface JobMatchContext {
  pageTitle: string | null;
  descriptionText: string | null;
  qualificationText: string | null;
  relevantText: string;
}

export function extractJobMatchContext(html: string): JobMatchContext {
  const text = stripHtml(html);
  const pageTitle = extractPageTitle(html);
  const metaDescription = extractMetaDescription(html);
  const descriptionText = buildSummaryText(text, metaDescription);
  const qualificationText = buildQualificationText(text);

  const relevantText = [
    pageTitle ? `Page title: ${pageTitle}` : null,
    descriptionText ? `Description: ${descriptionText}` : null,
    qualificationText ? `Qualifications: ${qualificationText}` : null,
  ]
    .filter(Boolean)
    .join("\n\n");

  return {
    pageTitle,
    descriptionText,
    qualificationText,
    relevantText: relevantText || truncate(text, 1600) || "",
  };
}
