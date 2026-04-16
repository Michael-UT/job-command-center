// Express API server for Job Command Center.
// Serves job data to the React frontend and triggers agent actions.

import express from "express";
import cors from "cors";
import { spawn } from "child_process";
import { loadJobs, getJobsByStatus } from "./scraper/dedup.js";
import { getQueryStats } from "./config/scrape-config.js";
import {
  getDefaultSearchProfile,
  loadSearchProfile,
  saveSearchProfile,
  type SearchProfile,
} from "./config/search-profile.js";
import { scoreJobAgainstProfile } from "./matching/score.js";

const app = express();
const PORT = 3001;

app.use(cors());
app.use(express.json());

function enrichJobMatches<
  T extends {
    title: string | null;
    date_found: string;
    description_text?: string | null;
    qualification_text?: string | null;
  },
>(job: T, profile: SearchProfile) {
  const match = scoreJobAgainstProfile(
    {
      title: job.title,
      descriptionText: job.description_text || null,
      qualificationText: job.qualification_text || null,
    },
    profile,
  );

  return {
    ...job,
    match_score: match.score,
    match_summary: match.summary,
    matched_role_title: match.matchedRoleTitle,
    matched_qualifications: match.matchedQualifications,
  };
}

function sortJobsByMatch<
  T extends {
    match_score?: number | null;
    date_found: string;
  },
>(jobs: T[]): T[] {
  return [...jobs].sort((left, right) => {
    const scoreDelta = (right.match_score ?? -1) - (left.match_score ?? -1);
    if (scoreDelta !== 0) return scoreDelta;
    return right.date_found.localeCompare(left.date_found);
  });
}

// GET /api/jobs — return all jobs grouped by status
app.get("/api/jobs", (_req, res) => {
  try {
    const data = loadJobs();
    const searchProfile = loadSearchProfile();
    const enrichedData = {
      ...data,
      jobs: data.jobs.map((job) => enrichJobMatches(job, searchProfile)),
    };
    const grouped = getJobsByStatus(enrichedData);
    res.json({
      newToday: sortJobsByMatch(grouped.newToday),
      previouslySeen: sortJobsByMatch(grouped.previouslySeen),
      applied: sortJobsByMatch(grouped.applied),
      skipped: sortJobsByMatch(grouped.skipped),
      total: data.jobs.length,
      last_scraped: data.last_scraped,
      scrape_stats: data.scrape_stats,
      scrape_errors: data.scrape_errors,
      search_profile: searchProfile,
    });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// GET /api/status — dashboard stats
app.get("/api/status", (_req, res) => {
  try {
    const data = loadJobs();
    const searchProfile = loadSearchProfile();
    const grouped = getJobsByStatus({
      ...data,
      jobs: data.jobs.map((job) => enrichJobMatches(job, searchProfile)),
    });
    const queryStats = getQueryStats(searchProfile);
    res.json({
      total_jobs: data.jobs.length,
      new_today: grouped.newToday.length,
      previously_seen: grouped.previouslySeen.length,
      applied: grouped.applied.length,
      skipped: grouped.skipped.length,
      last_scraped: data.last_scraped,
      scrape_stats: data.scrape_stats,
      scrape_errors: data.scrape_errors,
      query_matrix: queryStats,
      search_profile: searchProfile,
    });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

app.get("/api/search-profile", (_req, res) => {
  try {
    const profile = loadSearchProfile();
    res.json({
      profile,
      defaults: getDefaultSearchProfile(),
      query_matrix: getQueryStats(profile),
    });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

app.put("/api/search-profile", (req, res) => {
  try {
    const profile = saveSearchProfile(req.body || {});
    res.json({
      profile,
      defaults: getDefaultSearchProfile(),
      query_matrix: getQueryStats(profile),
    });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// Track running processes so we don't spawn duplicates
let scrapeProcess: ReturnType<typeof spawn> | null = null;
let applyProcess: ReturnType<typeof spawn> | null = null;

// POST /api/scrape — trigger a scrape (runs in background)
app.post("/api/scrape", (req, res) => {
  if (scrapeProcess) {
    res.status(409).json({ error: "Scrape already in progress" });
    return;
  }

  const quick = req.body?.quick === true;
  const args = ["server/agents/scrape-agent.ts"];
  if (quick) args.push("--quick");

  console.log(`[API] Starting scrape (${quick ? "quick" : "full"})...`);
  scrapeProcess = spawn("npx", ["tsx", ...args], {
    cwd: process.cwd(),
    stdio: "inherit",
    env: { ...process.env },
  });

  scrapeProcess.on("close", (code) => {
    console.log(`[API] Scrape finished with code ${code}`);
    scrapeProcess = null;
  });

  res.json({ message: "Scrape started", mode: quick ? "quick" : "full" });
});

// POST /api/apply/:id — trigger apply agent for a specific job
app.post("/api/apply/:id", (req, res) => {
  if (applyProcess) {
    res.status(409).json({ error: "An apply session is already running in the terminal" });
    return;
  }

  const jobId = req.params.id;
  const data = loadJobs();
  const job = data.jobs.find((j) => j.id === jobId);

  if (!job) {
    res.status(404).json({ error: `Job ${jobId} not found` });
    return;
  }

  if (job.status === "applied") {
    res.status(400).json({ error: `Job ${jobId} already applied` });
    return;
  }

  console.log(`[API] Starting apply agent for ${job.title} at ${job.company}...`);
  console.log(`[API] Interact with the agent in the terminal running the server.`);

  // Spawn apply agent — user interacts in terminal
  applyProcess = spawn("npx", ["tsx", "server/agents/apply-agent.ts", jobId], {
    cwd: process.cwd(),
    stdio: "inherit",
    env: { ...process.env },
  });

  applyProcess.on("close", (code) => {
    console.log(`[API] Apply agent finished with code ${code}`);
    applyProcess = null;
  });

  res.json({
    message: `Apply agent started for ${job.company} - ${job.title}. Check terminal for interaction.`,
    job_id: jobId,
  });
});

// POST /api/apply-all-new — trigger batch apply for all new jobs
app.post("/api/apply-all-new", (req, res) => {
  if (applyProcess) {
    res.status(409).json({ error: "An apply session is already running in the terminal" });
    return;
  }

  const parsedLimit = Number.parseInt(String(req.body?.limit ?? "10"), 10);
  const limit = Number.isInteger(parsedLimit) && parsedLimit > 0 ? parsedLimit : 10;
  const data = loadJobs();
  const newJobs = data.jobs.filter((j) => j.status === "new");

  if (newJobs.length === 0) {
    res.status(400).json({ error: "No new jobs to apply to" });
    return;
  }

  console.log(`[API] Starting batch apply for ${Math.min(limit, newJobs.length)} jobs...`);

  applyProcess = spawn(
    "npx",
    ["tsx", "server/agents/apply-agent.ts", "--batch", "--limit", String(limit)],
    {
      cwd: process.cwd(),
      stdio: "inherit",
      env: { ...process.env },
    },
  );

  applyProcess.on("close", (code) => {
    console.log(`[API] Batch apply finished with code ${code}`);
    applyProcess = null;
  });

  res.json({
    message: `Batch apply started for ${Math.min(limit, newJobs.length)} jobs. Check terminal.`,
    total_new: newJobs.length,
    applying: Math.min(limit, newJobs.length),
  });
});

app.listen(PORT, () => {
  console.log(`[Server] Job Command Center API running on http://localhost:${PORT}`);
  console.log(`[Server] Frontend: http://localhost:5173`);
});
