import { existsSync, readFileSync } from "fs";
import { loadSearchProfile } from "../server/config/search-profile.js";
import { buildMatchPromptPreview, scoreJobAgainstProfile } from "../server/matching/score.js";
import { loadJobs } from "../server/scraper/dedup.js";

function printUsage() {
  console.log(`Tokenizer Playground

Usage:
  npm run tokenizer -- --text "Some prompt text"
  npm run tokenizer -- --file path/to/file.txt
  npm run tokenizer -- --job-id <job-id>

Notes:
  - Estimates tokens locally with a rough chars/4 vs words*1.35 heuristic
  - For --job-id, the script loads the saved job, builds the cleaned match payload,
    and prints the current local 0-10 match score using the saved search profile
`);
}

function estimateTokens(text: string): number {
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;
  return Math.max(Math.ceil(text.length / 4), Math.ceil(words * 1.35));
}

function readArgValue(flag: string, args: string[]): string | null {
  const index = args.indexOf(flag);
  if (index === -1) return null;
  return args[index + 1] || null;
}

function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    let buffer = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      buffer += chunk;
    });
    process.stdin.on("end", () => resolve(buffer));
  });
}

async function main() {
  const args = process.argv.slice(2);

  if (args.includes("--help")) {
    printUsage();
    return;
  }

  const textArg = readArgValue("--text", args);
  const fileArg = readArgValue("--file", args);
  const jobIdArg = readArgValue("--job-id", args);

  if (jobIdArg) {
    const profile = loadSearchProfile();
    const data = loadJobs();
    const job = data.jobs.find((entry) => entry.id === jobIdArg);

    if (!job) {
      console.error(`Job "${jobIdArg}" not found in server/data/jobs.json`);
      process.exit(1);
    }

    const candidate = {
      title: job.title,
      descriptionText: job.description_text || null,
      qualificationText: job.qualification_text || null,
    };
    const prompt = buildMatchPromptPreview(candidate, profile);
    const result = scoreJobAgainstProfile(candidate, profile);

    console.log("=== Match Preview ===");
    console.log(`Title: ${job.title || "Unknown"}`);
    console.log(`Company: ${job.company || "Unknown"}`);
    console.log(`Local match score: ${result.score}/10`);
    console.log(`Summary: ${result.summary}`);
    console.log("");
    console.log("=== Prompt Payload ===");
    console.log(prompt);
    console.log("");
    console.log("=== Token Estimate ===");
    console.log(`Characters: ${prompt.length}`);
    console.log(`Approx tokens: ${estimateTokens(prompt)}`);
    return;
  }

  let text = textArg;

  if (!text && fileArg) {
    if (!existsSync(fileArg)) {
      console.error(`File not found: ${fileArg}`);
      process.exit(1);
    }
    text = readFileSync(fileArg, "utf8");
  }

  if (!text && !process.stdin.isTTY) {
    text = await readStdin();
  }

  if (!text) {
    printUsage();
    process.exit(1);
  }

  console.log("=== Token Estimate ===");
  console.log(`Characters: ${text.length}`);
  console.log(`Words: ${text.trim() ? text.trim().split(/\s+/).length : 0}`);
  console.log(`Approx tokens: ${estimateTokens(text)}`);
  console.log("");
  console.log("=== Preview ===");
  console.log(text.length > 1600 ? `${text.slice(0, 1600)}\n\n[...truncated]` : text);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
