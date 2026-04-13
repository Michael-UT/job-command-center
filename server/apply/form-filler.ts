import { Page } from "playwright";
import { detectATS } from "../config/scrape-config.js";

export interface ProfileData {
  first_name: string;
  last_name: string;
  full_name: string;
  email: string;
  phone: string;
  phone_digits_only: string;
  location: string;
  linkedin: string;
  website: string;
  github: string;
  resume_path: string;
  current_company: string;
  current_title: string;
  years_experience: string;
  work_authorization: string;
  sponsorship_needed: string;
  start_date: string;
  how_heard: string;
  background_context: string;
}

export interface CustomQuestion {
  label: string;
  selector: string;
  required: boolean;
  type: "text" | "textarea" | "select";
  options?: string[];
}

export interface FillResult {
  filled: string[];
  skipped: string[];
  failed: string[];
  customQuestions: CustomQuestion[];
}

export interface FormFiller {
  readonly platform: string;
  navigateToForm(page: Page, url: string): Promise<void>;
  fillStandardFields(page: Page, profile: ProfileData): Promise<FillResult>;
  extractCustomQuestions(page: Page): Promise<CustomQuestion[]>;
  fillCustomAnswers(page: Page, answers: Map<string, string>): Promise<void>;
  submit(page: Page): Promise<void>;
}

// Try multiple selectors for a field, return true if one worked
export async function safeFill(
  page: Page,
  selectors: string[],
  value: string,
  fieldName: string,
  result: FillResult,
): Promise<boolean> {
  for (const selector of selectors) {
    try {
      const el = page.locator(selector).first();
      if (await el.isVisible({ timeout: 2000 })) {
        await el.fill(value);
        result.filled.push(fieldName);
        return true;
      }
    } catch {
      // try next selector
    }
  }
  result.failed.push(fieldName);
  return false;
}

// Try to upload a file to a file input
export async function safeUpload(
  page: Page,
  selectors: string[],
  filePath: string,
  fieldName: string,
  result: FillResult,
): Promise<boolean> {
  for (const selector of selectors) {
    try {
      const el = page.locator(selector).first();
      if ((await el.count()) > 0) {
        await el.setInputFiles(filePath);
        result.filled.push(fieldName);
        return true;
      }
    } catch {
      // try next selector
    }
  }
  result.failed.push(fieldName);
  return false;
}

// Try to select a dropdown option
export async function safeSelect(
  page: Page,
  selectors: string[],
  value: string,
  fieldName: string,
  result: FillResult,
): Promise<boolean> {
  for (const selector of selectors) {
    try {
      const el = page.locator(selector).first();
      if (await el.isVisible({ timeout: 2000 })) {
        await el.selectOption({ label: value });
        result.filled.push(fieldName);
        return true;
      }
    } catch {
      // try next selector
    }
  }
  result.failed.push(fieldName);
  return false;
}

// Try to check a checkbox
export async function safeCheck(
  page: Page,
  selectors: string[],
  fieldName: string,
  result: FillResult,
): Promise<boolean> {
  for (const selector of selectors) {
    try {
      const el = page.locator(selector).first();
      if (await el.isVisible({ timeout: 2000 })) {
        if (!(await el.isChecked())) {
          await el.check();
        }
        result.filled.push(fieldName);
        return true;
      }
    } catch {
      // try next selector
    }
  }
  return false; // checkboxes are usually optional, don't mark as failed
}

export function getFillerForUrl(url: string): FormFiller {
  // Lazy imports to avoid circular deps
  const ats = detectATS(url);
  switch (ats) {
    case "ashby":
      return require("./fillers/ashby.js").default;
    case "greenhouse":
      return require("./fillers/greenhouse.js").default;
    case "lever":
      return require("./fillers/lever.js").default;
    default:
      throw new Error(
        `Unsupported ATS platform: ${ats}. Auto-apply supports ashby, greenhouse, and lever only.`,
      );
  }
}

// Build ProfileData from the raw YAML profile
export function buildProfileData(raw: Record<string, string>): ProfileData {
  const first = raw.first_name || "";
  const last = raw.last_name || "";
  return {
    first_name: first,
    last_name: last,
    full_name: `${first} ${last}`.trim(),
    email: raw.email || "",
    phone: raw.phone || "",
    phone_digits_only: (raw.phone || "").replace(/\D/g, ""),
    location: raw.location || "",
    linkedin: raw.linkedin || "",
    website: raw.website || "",
    github: raw.github || "",
    resume_path: raw.resume_path || "./resume.pdf",
    current_company: raw.current_company || "",
    current_title: raw.current_title || "",
    years_experience: raw.years_experience || "",
    work_authorization: raw.work_authorization || "Yes",
    sponsorship_needed: raw.sponsorship_needed || "No",
    start_date: raw.start_date || "",
    how_heard: raw.how_heard || "",
    background_context: raw.background_context || "",
  };
}
