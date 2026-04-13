import { Page } from "playwright";
import type {
  FormFiller,
  ProfileData,
  FillResult,
  CustomQuestion,
} from "../form-filler.js";
import { safeFill, safeUpload } from "../form-filler.js";

// Label → profile key mapping
const LABEL_MAP: Record<string, keyof ProfileData | "resume" | "skip" | "full_name"> = {
  "full name": "full_name",
  name: "full_name",
  email: "email",
  phone: "phone",
  "phone number": "phone",
  "current company": "current_company",
  "current title": "current_title",
  org: "current_company",
  linkedin: "linkedin",
  "linkedin url": "linkedin",
  github: "github",
  "github url": "github",
  website: "website",
  portfolio: "website",
  "personal website": "website",
  resume: "resume",
  "resume/cv": "resume",
  "cover letter": "skip",
};

function matchLabel(label: string): keyof ProfileData | "resume" | "skip" | "full_name" | null {
  const lower = label.toLowerCase().trim();
  for (const [key, value] of Object.entries(LABEL_MAP)) {
    if (lower === key || lower.includes(key)) return value;
  }
  return null;
}

class LeverFiller implements FormFiller {
  readonly platform = "lever";

  async navigateToForm(page: Page, url: string): Promise<void> {
    // Lever apply pages are at {job_url}/apply
    let formUrl = url;
    if (!url.endsWith("/apply")) {
      formUrl = url.replace(/\/$/, "") + "/apply";
    }

    await page.goto(formUrl, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2000);
  }

  async fillStandardFields(page: Page, profile: ProfileData): Promise<FillResult> {
    const result: FillResult = { filled: [], skipped: [], failed: [], customQuestions: [] };

    // Lever uses straightforward name attributes
    await safeFill(page, ['input[name="name"]'], profile.full_name, "name", result);
    await safeFill(page, ['input[name="email"]'], profile.email, "email", result);
    await safeFill(page, ['input[name="phone"]'], profile.phone, "phone", result);
    await safeFill(page, ['input[name="org"]'], profile.current_company, "current_company", result);

    // URL fields — Lever uses name="urls[LinkedIn]" pattern
    await safeFill(
      page,
      ['input[name="urls[LinkedIn]"]', 'input[name="urls[LinkedIn URL]"]'],
      profile.linkedin,
      "linkedin",
      result,
    );
    await safeFill(
      page,
      ['input[name="urls[GitHub]"]', 'input[name="urls[GitHub URL]"]'],
      profile.github,
      "github",
      result,
    );
    await safeFill(
      page,
      ['input[name="urls[Portfolio]"]', 'input[name="urls[Website]"]', 'input[name="urls[Other]"]'],
      profile.website,
      "website",
      result,
    );

    // Resume upload
    await safeUpload(
      page,
      ['input[name="resume"]', 'input[type="file"]'],
      profile.resume_path,
      "resume",
      result,
    );

    return result;
  }

  async extractCustomQuestions(page: Page): Promise<CustomQuestion[]> {
    const questions: CustomQuestion[] = [];

    // Lever custom questions are in .application-question containers
    // or in card-based sections
    const questionContainers = page.locator(
      ".application-question, .application-additional, .custom-questions > div",
    );
    const count = await questionContainers.count();

    for (let i = 0; i < count; i++) {
      const container = questionContainers.nth(i);
      const label = await container.locator("label, .question-label, .field-label").first().textContent().catch(() => null);
      if (!label) continue;

      const mapped = matchLabel(label);
      if (mapped) continue; // standard field

      // Skip EEOC
      const lower = label.toLowerCase();
      if (
        lower.includes("gender") ||
        lower.includes("race") ||
        lower.includes("veteran") ||
        lower.includes("disability") ||
        lower.includes("equal employment")
      )
        continue;

      const required = label.includes("*") ||
        (await container.locator("[required], [aria-required='true']").count()) > 0;

      const textarea = container.locator("textarea").first();
      if ((await textarea.count()) > 0 && (await textarea.isVisible())) {
        const val = await textarea.inputValue().catch(() => "");
        if (!val) {
          questions.push({ label: label.trim(), selector: "textarea", required, type: "textarea" });
        }
        continue;
      }

      const input = container.locator('input[type="text"], input:not([type])').first();
      if ((await input.count()) > 0 && (await input.isVisible())) {
        const val = await input.inputValue().catch(() => "");
        if (!val) {
          questions.push({ label: label.trim(), selector: "input", required, type: "text" });
        }
        continue;
      }

      const select = container.locator("select").first();
      if ((await select.count()) > 0 && (await select.isVisible())) {
        const options = await select.locator("option").allTextContents();
        questions.push({
          label: label.trim(),
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
    const containers = page.locator(
      ".application-question, .application-additional, .custom-questions > div",
    );
    const count = await containers.count();

    for (let i = 0; i < count; i++) {
      const container = containers.nth(i);
      const label = await container.locator("label, .question-label, .field-label").first().textContent().catch(() => null);
      if (!label) continue;

      const answer = answers.get(label.trim());
      if (!answer) continue;

      const textarea = container.locator("textarea").first();
      if ((await textarea.count()) > 0 && (await textarea.isVisible())) {
        await textarea.fill(answer);
        continue;
      }

      const input = container.locator('input[type="text"], input:not([type])').first();
      if ((await input.count()) > 0 && (await input.isVisible())) {
        await input.fill(answer);
        continue;
      }

      const select = container.locator("select").first();
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
      'button[type="submit"], button:has-text("Submit application"), button:has-text("Submit"), .postings-btn[type="submit"]',
    );
    await submitBtn.first().click();
    await page.waitForTimeout(3000);
  }
}

export default new LeverFiller();
