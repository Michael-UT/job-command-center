// Custom MCP tools for loading the user's profile and resume.
// These are registered as an in-process MCP server via the Agent SDK.

import { tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { readFileSync, existsSync } from "fs";
import { isAbsolute, join } from "path";
import { parse as parseYaml } from "yaml";

const PROJECT_ROOT = process.cwd();
const MAX_BACKGROUND_CONTEXT_CHARS = 4000;
const MAX_RESUME_TEXT_CHARS = 8000;

export function loadProfileFromDisk(): Record<string, string> {
  const profilePath = join(PROJECT_ROOT, "profile.yaml");
  if (!existsSync(profilePath)) {
    throw new Error(
      "profile.yaml not found. Copy profile.example.yaml → profile.yaml and fill in your details.",
    );
  }
  const raw = readFileSync(profilePath, "utf-8");
  return parseYaml(raw) as Record<string, string>;
}

function resolveResumePath(profile: Record<string, string>): string {
  const configuredPath = profile.resume_path?.trim() || "resume.pdf";
  return isAbsolute(configuredPath)
    ? configuredPath
    : join(PROJECT_ROOT, configuredPath);
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function truncateText(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, maxChars).trim()}\n\n[truncated to ${maxChars} chars]`;
}

function buildCompactProfile(profile: Record<string, string>): Record<string, string> {
  const compact: Record<string, string> = {};

  for (const [key, value] of Object.entries(profile)) {
    if (!value || key === "background_context") continue;
    compact[key] = typeof value === "string" ? value.trim() : String(value);
  }

  if (profile.background_context?.trim()) {
    compact.background_context_available = "true";
  }

  return compact;
}

const loadProfile = tool(
  "load_profile",
  "Load the applicant's core structured profile data from profile.yaml. For longer narrative context, call get_background_context separately only if needed.",
  {},
  async () => {
    try {
      const profile = loadProfileFromDisk();
      return {
        content: [{ type: "text" as const, text: JSON.stringify(buildCompactProfile(profile), null, 2) }],
      };
    } catch (e) {
      return {
        content: [{ type: "text" as const, text: `Error: ${e instanceof Error ? e.message : String(e)}` }],
        isError: true,
      };
    }
  },
  { annotations: { readOnlyHint: true } },
);

const getBackgroundContext = tool(
  "get_background_context",
  "Load the applicant's longer background_context from profile.yaml for custom written answers. Only call this when a tailored free-text answer is actually needed.",
  {},
  async () => {
    try {
      const profile = loadProfileFromDisk();
      const backgroundContext = profile.background_context?.trim();
      if (!backgroundContext) {
        return {
          content: [{ type: "text" as const, text: "No background_context found in profile.yaml." }],
          isError: true,
        };
      }

      return {
        content: [{
          type: "text" as const,
          text: truncateText(backgroundContext, MAX_BACKGROUND_CONTEXT_CHARS),
        }],
      };
    } catch (e) {
      return {
        content: [{ type: "text" as const, text: `Error: ${e instanceof Error ? e.message : String(e)}` }],
        isError: true,
      };
    }
  },
  { annotations: { readOnlyHint: true } },
);

const getResumeText = tool(
  "get_resume_text",
  "Extract normalized text content from the applicant's resume file. Only call this when resume details are needed for a written answer or an ambiguous field.",
  {},
  async () => {
    try {
      const profile = loadProfileFromDisk();
      const resumePath = resolveResumePath(profile);
      if (!existsSync(resumePath)) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Resume file not found at ${resumePath}. Update resume_path in profile.yaml or add the file.`,
            },
          ],
          isError: true,
        };
      }

      // Dynamic import for pdf-parse (CommonJS module)
      const pdfParse = (await import("pdf-parse")).default;
      const buffer = readFileSync(resumePath);
      const data = await pdfParse(buffer);
      return {
        content: [{
          type: "text" as const,
          text: truncateText(normalizeWhitespace(data.text), MAX_RESUME_TEXT_CHARS),
        }],
      };
    } catch (e) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Failed to parse configured resume file: ${e instanceof Error ? e.message : String(e)}`,
          },
        ],
        isError: true,
      };
    }
  },
  { annotations: { readOnlyHint: true } },
);

const getResumePath = tool(
  "get_resume_path",
  "Get the absolute file path to the configured resume file for uploading to application forms.",
  {},
  async () => {
    try {
      const profile = loadProfileFromDisk();
      const resumePath = resolveResumePath(profile);
      if (!existsSync(resumePath)) {
        return {
          content: [{ type: "text" as const, text: `Resume file not found at ${resumePath}.` }],
          isError: true,
        };
      }
      return {
        content: [{ type: "text" as const, text: resumePath }],
      };
    } catch (e) {
      return {
        content: [{ type: "text" as const, text: `Error: ${e instanceof Error ? e.message : String(e)}` }],
        isError: true,
      };
    }
  },
  { annotations: { readOnlyHint: true } },
);

export const profileServer = createSdkMcpServer({
  name: "profile",
  version: "1.0.0",
  tools: [loadProfile, getBackgroundContext, getResumeText, getResumePath],
});
