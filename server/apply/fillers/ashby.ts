import { Page } from "playwright";
import type {
  FormFiller,
  ProfileData,
  FillResult,
  CustomQuestion,
} from "../form-filler.js";
import { safeFill, safeUpload } from "../form-filler.js";

// Ashby system field names
const SYSTEM_FIELDS = [
  "_systemfield_name",
  "_systemfield_email",
  "_systemfield_phone",
  "_systemfield_resume",
  "_systemfield_linkedInUrl",
  "_systemfield_location",
  "_systemfield_currentCompany",
  "_systemfield_org",
];

// Label → profile key mapping (case-insensitive)
const LABEL_MAP: Record<string, keyof ProfileData | "resume" | "skip" | "full_name"> = {
  name: "full_name",
  "full name": "full_name",
  "your name": "full_name",
  email: "email",
  "email address": "email",
  phone: "phone",
  "phone number": "phone",
  resume: "resume",
  "resume/cv": "resume",
  cv: "resume",
  linkedin: "linkedin",
  "linkedin url": "linkedin",
  "linkedin profile": "linkedin",
  "linkedin profile url": "linkedin",
  github: "github",
  "github url": "github",
  "github profile": "github",
  website: "website",
  "website url": "website",
  "personal website": "website",
  portfolio: "website",
  "portfolio url": "website",
  location: "location",
  "current company": "current_company",
  "current employer": "current_company",
  "cover letter": "skip",
};

function matchLabel(label: string): keyof ProfileData | "resume" | "skip" | "full_name" | null {
  const lower = label.toLowerCase().trim();
  for (const [key, value] of Object.entries(LABEL_MAP)) {
    if (lower === key || lower.startsWith(key)) return value;
  }
  return null;
}

class AshbyFiller implements FormFiller {
  readonly platform = "ashby";

  async navigateToForm(page: Page, url: string): Promise<void> {
    // Ashby application forms are at {job_url}/application
    let formUrl = url;
    if (!url.endsWith("/application")) {
      formUrl = url.replace(/\/$/, "") + "/application";
    }

    await page.goto(formUrl, { waitUntil: "domcontentloaded" });
    // Ashby is a React SPA with no <form> tag — wait for inputs to render
    await page.waitForSelector('input, textarea, [role="textbox"]', { timeout: 15000 });
    await page.waitForTimeout(2000);
  }

  async fillStandardFields(page: Page, profile: ProfileData): Promise<FillResult> {
    const result: FillResult = { filled: [], skipped: [], failed: [], customQuestions: [] };

    // Ashby is a React SPA — always start with name-attribute filling
    await this.fillByNameAttributes(page, profile, result);

    // Then try label-based group detection for anything missed
    const formGroups = page.locator(
      '[data-testid*="field"], .ashby-application-form-field-entry',
    );
    let groupCount = await formGroups.count();

    if (groupCount === 0) {
      return result;
    }

    for (let i = 0; i < groupCount; i++) {
      const group = formGroups.nth(i);
      const labelEl = group.locator("label").first();
      const labelText = await labelEl.textContent().catch(() => null);
      if (!labelText) continue;

      const mapped = matchLabel(labelText);
      if (!mapped) continue;

      if (mapped === "skip") {
        result.skipped.push(labelText.trim());
        continue;
      }

      if (mapped === "resume") {
        const fileInput = group.locator('input[type="file"]').first();
        if ((await fileInput.count()) > 0) {
          try {
            await fileInput.setInputFiles(profile.resume_path);
            result.filled.push("resume");
          } catch {
            result.failed.push("resume");
          }
        }
        continue;
      }

      const value = mapped === "full_name" ? profile.full_name : (profile[mapped as keyof ProfileData] || "");
      if (!value) continue;

      // Try input/textarea
      const input = group.locator("input:not([type='file']):not([type='hidden']), textarea").first();
      if ((await input.count()) > 0 && (await input.isVisible())) {
        try {
          await input.fill(value);
          result.filled.push(labelText.trim());

          // Handle location autocomplete — Ashby uses Google Places
          if (mapped === "location") {
            await page.waitForTimeout(800);
            await page.keyboard.press("ArrowDown");
            await page.keyboard.press("Enter");
          }
        } catch {
          result.failed.push(labelText.trim());
        }
        continue;
      }

      // Try select/dropdown
      const select = group.locator("select").first();
      if ((await select.count()) > 0) {
        try {
          await select.selectOption({ label: value });
          result.filled.push(labelText.trim());
        } catch {
          result.failed.push(labelText.trim());
        }
      }
    }

    return result;
  }

  // Primary strategy: fill by multiple selector strategies
  // Ashby renders inputs dynamically — try name attrs, aria-labels, placeholders, and label associations
  private async fillByNameAttributes(
    page: Page,
    profile: ProfileData,
    result: FillResult,
  ): Promise<void> {
    // Each entry: [selectors, value, fieldName]
    // Includes name attrs, aria-label, placeholder, and Playwright label() locator fallbacks
    const fields: [string[], string, string][] = [
      [
        ['input[name="_systemfield_name"]', 'input[name="name"]',
         'input[aria-label*="name" i]', 'input[placeholder*="name" i]'],
        profile.full_name, "name",
      ],
      [
        ['input[name="_systemfield_email"]', 'input[name="email"]', 'input[type="email"]',
         'input[aria-label*="email" i]', 'input[placeholder*="email" i]'],
        profile.email, "email",
      ],
      [
        ['input[name="_systemfield_phone"]', 'input[name="phone"]', 'input[type="tel"]',
         'input[aria-label*="phone" i]', 'input[placeholder*="phone" i]'],
        profile.phone, "phone",
      ],
      [
        ['input[name="_systemfield_linkedInUrl"]', 'input[name="linkedInUrl"]',
         'input[aria-label*="linkedin" i]', 'input[placeholder*="linkedin" i]'],
        profile.linkedin, "linkedin",
      ],
      [
        ['input[name="_systemfield_location"]', 'input[name="location"]',
         'input[aria-label*="location" i]', 'input[placeholder*="location" i]'],
        profile.location, "location",
      ],
      [
        ['input[name="_systemfield_currentCompany"]', 'input[name="currentCompany"]',
         'input[aria-label*="company" i]', 'input[placeholder*="company" i]'],
        profile.current_company, "current_company",
      ],
    ];

    for (const [selectors, value, name] of fields) {
      if (!value) continue;
      // Try CSS selectors first
      const filled = await safeFill(page, selectors, value, name, result);
      if (!filled) {
        // Remove the failed entry — try Playwright's label-based locator
        result.failed.pop();
        try {
          const byLabel = page.getByLabel(name, { exact: false }).first();
          if (await byLabel.isVisible({ timeout: 1000 })) {
            await byLabel.fill(value);
            result.filled.push(name);
            continue;
          }
        } catch {
          // not found
        }
        result.failed.push(name);
      }
    }

    // Resume
    await safeUpload(
      page,
      ['input[type="file"]'],
      profile.resume_path,
      "resume",
      result,
    );
  }

  async extractCustomQuestions(page: Page): Promise<CustomQuestion[]> {
    const questions: CustomQuestion[] = [];
    const formGroups = page.locator(
      '[data-testid*="field"], .ashby-application-form-field-entry, form > div > div',
    );
    const count = await formGroups.count();

    for (let i = 0; i < count; i++) {
      const group = formGroups.nth(i);
      const labelText = await group.locator("label").first().textContent().catch(() => null);
      if (!labelText) continue;

      const mapped = matchLabel(labelText);
      if (mapped) continue; // already handled

      // Skip EEOC-type fields
      const lower = labelText.toLowerCase();
      if (
        lower.includes("gender") ||
        lower.includes("race") ||
        lower.includes("veteran") ||
        lower.includes("disability") ||
        lower.includes("demographic") ||
        lower.includes("pronouns")
      )
        continue;

      const required = (await group.locator('[aria-required="true"], .required').count()) > 0 ||
        labelText.includes("*");

      const textarea = group.locator("textarea").first();
      if ((await textarea.count()) > 0 && (await textarea.isVisible())) {
        const val = await textarea.inputValue().catch(() => "");
        if (!val) {
          questions.push({ label: labelText.trim(), selector: "textarea", required, type: "textarea" });
        }
        continue;
      }

      const input = group.locator('input[type="text"], input:not([type])').first();
      if ((await input.count()) > 0 && (await input.isVisible())) {
        const val = await input.inputValue().catch(() => "");
        if (!val) {
          questions.push({ label: labelText.trim(), selector: "input", required, type: "text" });
        }
        continue;
      }

      const select = group.locator("select").first();
      if ((await select.count()) > 0 && (await select.isVisible())) {
        const options = await select.locator("option").allTextContents();
        questions.push({
          label: labelText.trim(),
          selector: "select",
          required,
          type: "select",
          options: options.filter((o) => o.trim()),
        });
      }
    }

    return questions;
  }

  async fillCustomAnswers(page: Page, answers: Map<string, string>): Promise<void> {
    const formGroups = page.locator(
      '[data-testid*="field"], .ashby-application-form-field-entry, form > div > div',
    );
    const count = await formGroups.count();

    for (let i = 0; i < count; i++) {
      const group = formGroups.nth(i);
      const labelText = await group.locator("label").first().textContent().catch(() => null);
      if (!labelText) continue;

      const answer = answers.get(labelText.trim());
      if (!answer) continue;

      const textarea = group.locator("textarea").first();
      if ((await textarea.count()) > 0 && (await textarea.isVisible())) {
        await textarea.fill(answer);
        continue;
      }

      const input = group.locator('input[type="text"], input:not([type])').first();
      if ((await input.count()) > 0 && (await input.isVisible())) {
        await input.fill(answer);
        continue;
      }

      const select = group.locator("select").first();
      if ((await select.count()) > 0 && (await select.isVisible())) {
        try {
          await select.selectOption({ label: answer });
        } catch {
          await select.selectOption(answer).catch(() => {});
        }
      }
    }
  }

  async submit(page: Page): Promise<void> {
    const submitBtn = page.locator(
      'button[type="submit"], button:has-text("Submit"), button:has-text("Submit application")',
    );
    await submitBtn.first().click();
    await page.waitForTimeout(3000);
  }
}

export default new AshbyFiller();
