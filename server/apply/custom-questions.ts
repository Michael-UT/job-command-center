import Anthropic from "@anthropic-ai/sdk";
import * as readline from "readline/promises";
import type { CustomQuestion, ProfileData } from "./form-filler.js";

export interface DraftedAnswer {
  question: string;
  selector: string;
  type: "text" | "textarea" | "select";
  draft: string;
  approved: boolean;
  finalAnswer: string;
}

export async function draftCustomAnswers(
  questions: CustomQuestion[],
  profile: ProfileData,
  jobTitle: string | null,
  company: string | null,
): Promise<DraftedAnswer[]> {
  if (questions.length === 0) return [];

  const client = new Anthropic();

  const questionList = questions
    .map((q, i) => `${i + 1}. ${q.label}${q.required ? " (REQUIRED)" : ""}`)
    .join("\n");

  const response = await client.messages.create({
    model: "claude-sonnet-4-6-20250514",
    max_tokens: 1500,
    messages: [
      {
        role: "user",
        content: `Draft concise answers for these job application questions.

Job: ${jobTitle || "Unknown"} at ${company || "Unknown"}

Applicant background:
${profile.background_context}

Current role: ${profile.current_title} at ${profile.current_company}
Years of experience: ${profile.years_experience}

Questions:
${questionList}

Reply as a JSON array only, no markdown fences:
[{"index": 1, "answer": "..."}, ...]

Rules:
- Keep answers 2-3 sentences max
- Be specific to the applicant's real experience, not generic
- For "why this company" questions, tie their background to the company's mission
- For salary questions, reply "ASK_USER"
- For yes/no questions, just reply "Yes" or "No"`,
      },
    ],
  });

  const text = response.content[0].type === "text" ? response.content[0].text : "";
  let parsed: { index: number; answer: string }[];
  try {
    parsed = JSON.parse(text);
  } catch {
    console.log("  Warning: Could not parse Claude's draft answers. You'll type them manually.");
    return questions.map((q) => ({
      question: q.label,
      selector: q.selector,
      type: q.type,
      draft: "",
      approved: false,
      finalAnswer: "",
    }));
  }

  return questions.map((q, i) => {
    const match = parsed.find((p) => p.index === i + 1);
    return {
      question: q.label,
      selector: q.selector,
      type: q.type,
      draft: match?.answer || "",
      approved: false,
      finalAnswer: "",
    };
  });
}

export async function presentToUser(drafts: DraftedAnswer[]): Promise<DraftedAnswer[]> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  for (const draft of drafts) {
    if (draft.draft === "ASK_USER") {
      console.log(`\n  Q: ${draft.question}`);
      const answer = await rl.question("  Your answer: ");
      draft.finalAnswer = answer.trim();
      draft.approved = draft.finalAnswer.length > 0;
      continue;
    }

    console.log(`\n  Q: ${draft.question}`);
    if (draft.draft) {
      console.log(`  Draft: ${draft.draft}`);
      const choice = (await rl.question("  [Enter] Use draft  [2] Type own  [3] Skip > ")).trim();

      if (choice === "2") {
        draft.finalAnswer = await rl.question("  Your answer: ");
        draft.approved = true;
      } else if (choice === "3") {
        draft.approved = false;
      } else {
        draft.finalAnswer = draft.draft;
        draft.approved = true;
      }
    } else {
      const answer = await rl.question("  Your answer (or Enter to skip): ");
      draft.finalAnswer = answer.trim();
      draft.approved = draft.finalAnswer.length > 0;
    }
  }

  rl.close();
  return drafts;
}
