// Batch AI scoring: rates each job 0.00-10.00 on fit to the user's resume.
// Uses Sonnet 4.6 with the full job description (not just metadata).
// Batch of 5 per call to keep attention-per-job high.

import { config } from "dotenv";
config();

import type { Job } from "./dedup.js";
import { loadProfileFromDisk } from "../tools/profile-tools.js";

let client: any;
async function getClient() {
  if (!client) {
    const mod = await import("@anthropic-ai/sdk");
    const Anthropic = (mod as any).default || mod;
    client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return client;
}

const DESCRIPTION_ANALYSIS_RUBRIC = `
STRONG POSITIVE SIGNALS — push score toward 9-10:
- Description explicitly names working DIRECTLY with enterprise customers on LLM / AI deployments (not just "some customer interaction")
- Stack overlap with candidate: Python + (TypeScript OR React) + LLMs / RAG / prompt engineering / evals
- Explicit Forward-Deployed / Applied-AI / Customer-Engineer / AI-Deployment framing, or language like "embed with customers to ship AI"
- Years-of-experience listed as 2-5 (candidate is ~4); blend of IC coding + direct customer interaction
- Startup-stage-appropriate language: "fast-paced", "ambiguous", "zero-to-one", "first 10 FDEs", "build from scratch"
- Company is a foundation-model lab or top AI-native product startup (builds PRODUCTS with LLMs — Anthropic, OpenAI, Harvey, Glean, Perplexity, Scale, xAI, LangChain, Cohere, Cursor, etc.)

POSITIVE SIGNALS — mild lift toward 7-8:
- Strategy, GTM, Business Development, or Partnerships at an AI-native company (non-quota)
- Technical Program / Product Manager at an AI-native company
- Pre-Sales or Sales Engineering (technical, not quota-carrying)
- Customer Success Manager at AI-native company when role is implementation-heavy, not renewal-focused
- Solutions Engineer / Implementation Engineer at developer-tools or infra company with clear customer-deploy work

NEGATIVE SIGNALS — pull score down 1-3 points:
- Asks for 7+ years experience, or "Senior Staff" / "Principal" with deep specialization
- Pure research role: publications required, novel-algorithm work, PhD in the must-haves
- Pure internal platform / infra / ML-ops / SRE with zero customer-facing work described
- Heavy domain expertise required that candidate lacks: autonomous vehicles, genomics, medical imaging, quant trading, robotics, game-engine dev
- Description implies 80%+ IC coding with no external interaction
- Legacy non-AI stack dominates (Java EE, .NET, mainframe, C++ embedded) with no AI layer described
- Role is at a non-AI company doing generic "digital transformation" / "AI adoption" consulting

HARD REJECTS — force score below 2.0:
- Pure quota-carrying individual-contributor sales: AE, SDR, BDR, Account Executive, Sales Rep (distinct from Sales Engineer or BD/Partnerships, which are OK)
- Pure designer roles: Graphic Designer, UX Designer, UI Designer, Brand Designer, Illustrator
- Non-tech professions: accountant, bookkeeper, legal / attorney / paralegal, nurse / clinical, teacher / instructor, recruiter, marketing manager, content writer, social media manager, customer support L1
- Role requires fluency in a non-English language (Japanese, Korean, Mandarin, Arabic, German, French, etc.) as a core competency
- Single-country non-US requirement: "must be based in India / Singapore / UK / Tel Aviv / Tokyo / Berlin / Dublin"; also titles/locations marked with country codes like "- IN", "- JP", "IND-Remote", country-prefix location strings, or "remote within [non-US country]"
- Internship, new-grad, or entry-level (<2 years); also 10+-years senior executive (VP, SVP, CxO, Head of)

ENFORCEMENT — read carefully:
- HARD REJECT signals are FLOORS, not mere negatives. If any ONE hard-reject signal is clearly present, the final score MUST be below 2.0, regardless of how strong the positive signals are. Do not "average" strong stack/title matches against a hard-reject floor.
- Country hints to treat as hard rejects: ISO alpha-2 codes at end of title ("- IN", "- JP", "- SG", "- KR"), ISO alpha-3 prefixes in location ("IND-", "SGP-", "JPN-", "GBR-", "DEU-", etc.), and phrases like "remote within India" or "India-based".
`;

function buildScoringPrompt(jobs: Job[], profileContext: string): string {
  const jobBlocks = jobs
    .map((j, i) => {
      const meta = `${j.title || "Unknown"} at ${j.company || "Unknown"} | ${j.location || "?"} | ${j.salary || "no salary"} | ${j.seniority || "?"}`;
      const desc = j.description
        ? `Description:\n${j.description}`
        : `Description: (no description captured — score from metadata alone, lean conservative)`;
      return `### Job ${i + 1}\n${meta}\n\n${desc}`;
    })
    .join("\n\n---\n\n");

  return `You are scoring jobs on a 0.00-10.00 scale for fit to this candidate's ACTUAL resume.
Use 2 decimal places (e.g., 8.45). Read each description carefully and weight signals against the rubric below.

Reply ONLY with a JSON array of {score, reasoning} objects, one per job, in order:
[{"score":9.20,"reasoning":"..."}, {"score":6.75,"reasoning":"..."}, ...]

Keep each reasoning to ONE short sentence (≤25 words) naming the single strongest signal that drove the score.

## Candidate Resume
${profileContext}

## What This Candidate Brings
- AI Deployment Strategist at a global investment bank (current): prompt engineering, vendor evaluation, RAG systems, C-suite advisory
- AI Research Fellow (ICML 2024 publication): LLM evaluation, trust & safety, full-stack React + ML models
- Software Engineer (fintech): React/Next.js, customer onboarding flows, millions of MAUs
- Program Manager (logistics startup): cross-functional product requirements, data dashboards, AR prototyping
- Strategy Consultant (Deloitte): technology roadmaps, workforce modeling, government advisory
- Technical skills: Python, TypeScript, React/Next.js, RAG, LlamaIndex, prompt engineering, SQL, Tableau
- BBA in Management Information Systems, UT Austin

## Scoring Rubric — tier anchors

9.00-10.00 = PERFECT — Role directly matches AI deployment + strategy + client-facing + technical blend at a strong AI or tech company.
8.00-8.99 = EXCELLENT — Strong overlap with multiple resume themes (AI + strategy + customer-facing + technical).
7.00-7.99 = VERY STRONG — Good match on 2+ resume themes.
6.00-6.99 = STRONG — Matches one major resume theme well.
5.00-5.99 = DECENT — Adjacent to candidate's experience.
4.00-4.99 = MODERATE — Tangential overlap.
3.00-3.99 = WEAK — Minimal relevance. Wrong domain or function but at a relevant company.
2.00-2.99 = POOR — Wrong domain and wrong function. Major seniority mismatch.
1.00-1.99 = VERY POOR — Almost no relevance.
0.00-0.99 = REJECT — Completely irrelevant (janitorial, food service, medical, etc.).

## How To Read Descriptions

${DESCRIPTION_ANALYSIS_RUBRIC}

## General Instructions
- The description is the primary signal — title alone can mislead. Two "Solutions Engineer" roles at the same company can be different jobs.
- Candidate has ~4 years experience. Director/VP roles and entry-level both score lower.
- Prefer NYC and Remote locations. International-only roles score lower.
- Customer-facing and GTM roles at AI companies are STRONG fits (7+), not weak fits.
- Use the FULL 0-10 range with decimal nuance — don't cluster everything at 7.00.

## Jobs to Score
${jobBlocks}`;
}

export async function scoreJobs(jobs: Job[]): Promise<void> {
  if (jobs.length === 0) return;

  const profile = loadProfileFromDisk();
  const profileContext = [
    `Current role: ${profile.current_title || "?"} at ${profile.current_company || "?"}`,
    `Years of experience: ${profile.years_experience || "?"}`,
    `Location preference: NYC, Remote`,
    `Background:\n${(profile.background_context || "").slice(0, 800)}`,
  ].join("\n");

  const BATCH_SIZE = 5;
  const anthropic = await getClient();

  for (let i = 0; i < jobs.length; i += BATCH_SIZE) {
    const batch = jobs.slice(i, i + BATCH_SIZE);
    process.stdout.write(`  Scoring jobs ${i + 1}-${i + batch.length}... `);

    try {
      const response = await anthropic.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 1000,
        messages: [
          { role: "user", content: buildScoringPrompt(batch, profileContext) },
        ],
      });

      const text =
        response.content[0].type === "text" ? response.content[0].text : "[]";
      // Extract JSON array from response (may have leading/trailing text)
      const match = text.match(/\[\s*\{[\s\S]*\}\s*\]/);
      if (match) {
        const results: { score: number; reasoning: string }[] = JSON.parse(match[0]);
        for (let j = 0; j < batch.length && j < results.length; j++) {
          let score = Math.max(0, Math.min(10, Number(results[j].score) || 0));
          if (batch[j].priority) score = Math.min(10, score + 2);
          batch[j].score = Math.round(score * 100) / 100;
          batch[j].score_reasoning = String(results[j].reasoning || "").slice(0, 300);
        }
        console.log(`done (${results.map((r) => (Number(r.score) || 0).toFixed(2)).join(", ")})`);
      } else {
        console.log("parse failed, skipping");
      }
    } catch (e) {
      console.log(`error: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
}
