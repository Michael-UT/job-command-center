import { Page } from "playwright";
import type {
  FormFiller,
  ProfileData,
  FillResult,
  CustomQuestion,
} from "../form-filler.js";
import { safeFill, safeUpload, safeSelect, safeCheck } from "../form-filler.js";

// Known standard field labels that we can auto-fill (case-insensitive match)
const KNOWN_FIELDS: Record<string, keyof ProfileData | "resume" | "skip"> = {
  "first name": "first_name",
  "last name": "last_name",
  email: "email",
  phone: "phone",
  "phone number": "phone",
  linkedin: "linkedin",
  "linkedin profile": "linkedin",
  "linkedin url": "linkedin",
  "linkedin profile url": "linkedin",
  github: "github",
  "github url": "github",
  "github profile": "github",
  website: "website",
  "website url": "website",
  "personal website": "website",
  portfolio: "website",
  "portfolio url": "website",
  resume: "resume",
  "resume/cv": "resume",
  "cover letter": "skip",
};

function matchesKnownField(label: string): keyof ProfileData | "resume" | "skip" | null {
  const lower = label.toLowerCase().trim();
  for (const [key, value] of Object.entries(KNOWN_FIELDS)) {
    if (lower === key || lower.startsWith(key)) return value;
  }
  return null;
}

class GreenhouseFiller implements FormFiller {
  readonly platform = "greenhouse";

  async navigateToForm(page: Page, url: string): Promise<void> {
    await page.goto(url, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2000);

    // Greenhouse may show job description first with an "Apply" link/button
    const applyBtn = page.locator(
      'a:has-text("Apply for this job"), a:has-text("Apply"), button:has-text("Apply")',
    );
    if ((await applyBtn.count()) > 0) {
      await applyBtn.first().click();
      await page.waitForTimeout(2000);
    }
  }

  async fillStandardFields(page: Page, profile: ProfileData): Promise<FillResult> {
    const result: FillResult = { filled: [], skipped: [], failed: [], customQuestions: [] };

    // Core fields — Greenhouse uses stable IDs
    await safeFill(page, ['#first_name', 'input[name="first_name"]'], profile.first_name, "first_name", result);
    await safeFill(page, ['#last_name', 'input[name="last_name"]'], profile.last_name, "last_name", result);
    await safeFill(page, ['#email', 'input[name="email"]'], profile.email, "email", result);
    await safeFill(page, ['#phone', 'input[name="phone"]'], profile.phone, "phone", result);

    // Resume upload
    await safeUpload(
      page,
      ['input[type="file"][accept*="pdf"]', '#resume', 'input[type="file"]'],
      profile.resume_path,
      "resume",
      result,
    );

    // Now handle question-based fields (LinkedIn, custom selects, etc.)
    // Greenhouse uses question_{ID} naming for custom fields
    const questionGroups = page.locator('[class*="field"], .field, [data-field]');
    const count = await questionGroups.count();

    for (let i = 0; i < count; i++) {
      const group = questionGroups.nth(i);
      const label = await group.locator("label").first().textContent().catch(() => null);
      if (!label) continue;

      const known = matchesKnownField(label);
      if (!known) continue;
      if (known === "skip") {
        result.skipped.push(label);
        continue;
      }
      if (known === "resume") continue; // already handled above

      const value = profile[known as keyof ProfileData] || "";
      if (!value) continue;

      // Try to fill input/textarea inside this group
      const input = group.locator("input, textarea").first();
      if ((await input.count()) > 0 && (await input.isVisible())) {
        try {
          await input.fill(value);
          result.filled.push(label);
        } catch {
          result.failed.push(label);
        }
        continue;
      }

      // Try select
      const select = group.locator("select").first();
      if ((await select.count()) > 0) {
        try {
          await select.selectOption({ label: value });
          result.filled.push(label);
        } catch {
          result.failed.push(label);
        }
      }
    }

    return result;
  }

  async extractCustomQuestions(page: Page): Promise<CustomQuestion[]> {
    const questions: CustomQuestion[] = [];

    // Find all question fields that we didn't fill in fillStandardFields
    const fields = page.locator('[class*="field"], .field, [data-field]');
    const count = await fields.count();

    for (let i = 0; i < count; i++) {
      const field = fields.nth(i);
      const label = await field.locator("label").first().textContent().catch(() => null);
      if (!label) continue;

      const known = matchesKnownField(label);
      if (known) continue; // skip fields we already handle

      // Skip EEOC fields
      const lowerLabel = label.toLowerCase();
      if (
        lowerLabel.includes("gender") ||
        lowerLabel.includes("race") ||
        lowerLabel.includes("veteran") ||
        lowerLabel.includes("disability") ||
        lowerLabel.includes("demographic")
      )
        continue;

      const required =
        (await field.locator(".required, [aria-required='true'], .asterisk").count()) > 0;

      // Determine field type
      const textarea = field.locator("textarea").first();
      if ((await textarea.count()) > 0 && (await textarea.isVisible())) {
        // Check if already filled
        const currentVal = await textarea.inputValue().catch(() => "");
        if (currentVal) continue;
        questions.push({
          label: label.trim(),
          selector: `textarea`,
          required,
          type: "textarea",
        });
        continue;
      }

      const input = field.locator('input[type="text"], input:not([type])').first();
      if ((await input.count()) > 0 && (await input.isVisible())) {
        const currentVal = await input.inputValue().catch(() => "");
        if (currentVal) continue;
        questions.push({
          label: label.trim(),
          selector: `input`,
          required,
          type: "text",
        });
        continue;
      }

      const select = field.locator("select").first();
      if ((await select.count()) > 0 && (await select.isVisible())) {
        const options = await select.locator("option").allTextContents();
        questions.push({
          label: label.trim(),
          selector: `select`,
          required,
          type: "select",
          options: options.filter((o) => o.trim()),
        });
      }
    }

    return questions;
  }

  async fillCustomAnswers(page: Page, answers: Map<string, string>): Promise<void> {
    const fields = page.locator('[class*="field"], .field, [data-field]');
    const count = await fields.count();

    for (let i = 0; i < count; i++) {
      const field = fields.nth(i);
      const label = await field.locator("label").first().textContent().catch(() => null);
      if (!label) continue;

      const answer = answers.get(label.trim());
      if (!answer) continue;

      const textarea = field.locator("textarea").first();
      if ((await textarea.count()) > 0 && (await textarea.isVisible())) {
        await textarea.fill(answer);
        continue;
      }

      const input = field.locator('input[type="text"], input:not([type])').first();
      if ((await input.count()) > 0 && (await input.isVisible())) {
        await input.fill(answer);
        continue;
      }

      const select = field.locator("select").first();
      if ((await select.count()) > 0 && (await select.isVisible())) {
        try {
          await select.selectOption({ label: answer });
        } catch {
          // try by value
          await select.selectOption(answer).catch(() => {});
        }
      }
    }
  }

  async submit(page: Page): Promise<void> {
    const submitBtn = page.locator(
      'button[type="submit"], input[type="submit"], button:has-text("Submit")',
    );
    await submitBtn.first().click();
    await page.waitForTimeout(3000);
  }
}

export default new GreenhouseFiller();
