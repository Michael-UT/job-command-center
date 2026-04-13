// Express API server for Job Command Center.
// Serves job data to the React frontend and triggers agent actions.

import express from "express";
import cors from "cors";
import { spawn } from "child_process";
import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { loadJobs, saveJobs, getJobsByStatus, updateStatus, type JobsData, type Job } from "./scraper/dedup.js";
import { getQueryStats } from "./config/scrape-config.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = 3001;

app.use(cors());
app.use(express.json());

// GET /api/jobs — return all jobs grouped by status
app.get("/api/jobs", (_req, res) => {
  try {
    const data = loadJobs();
    const grouped = getJobsByStatus(data);
    res.json({
      ...grouped,
      total: data.jobs.length,
      last_scraped: data.last_scraped,
      scrape_stats: data.scrape_stats,
      scrape_errors: data.scrape_errors,
    });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// GET /api/status — dashboard stats
app.get("/api/status", (_req, res) => {
  try {
    const data = loadJobs();
    const grouped = getJobsByStatus(data);
    const queryStats = getQueryStats();
    res.json({
      total_jobs: data.jobs.length,
      new_today: grouped.newToday.length,
      previously_seen: grouped.previouslySeen.length,
      applied: grouped.applied.length,
      responded: grouped.responded.length,
      interviewing: grouped.interviewing.length,
      offer: grouped.offer.length,
      rejected: grouped.rejected.length,
      skipped: grouped.skipped.length,
      last_scraped: data.last_scraped,
      scrape_stats: data.scrape_stats,
      scrape_errors: data.scrape_errors,
      query_matrix: queryStats,
    });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// Track running processes so we don't spawn duplicates
let scrapeProcess: ReturnType<typeof spawn> | null = null;

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
  const child = spawn("npx", ["tsx", "server/apply/apply-runner.ts", jobId], {
    cwd: process.cwd(),
    stdio: "inherit",
    env: { ...process.env },
  });

  child.on("close", (code) => {
    console.log(`[API] Apply agent finished with code ${code}`);
  });

  res.json({
    message: `Apply agent started for ${job.company} - ${job.title}. Check terminal for interaction.`,
    job_id: jobId,
  });
});

// POST /api/apply-all-new — trigger batch apply for all new jobs
app.post("/api/apply-all-new", (req, res) => {
  const limit = req.body?.limit || 10;
  const data = loadJobs();
  const newJobs = data.jobs.filter((j) => j.status === "new");

  if (newJobs.length === 0) {
    res.status(400).json({ error: "No new jobs to apply to" });
    return;
  }

  console.log(`[API] Starting batch apply for ${Math.min(limit, newJobs.length)} jobs...`);

  const child = spawn(
    "npx",
    ["tsx", "server/apply/apply-runner.ts", "--batch", "--limit", String(limit)],
    {
      cwd: process.cwd(),
      stdio: "inherit",
      env: { ...process.env },
    },
  );

  child.on("close", (code) => {
    console.log(`[API] Batch apply finished with code ${code}`);
  });

  res.json({
    message: `Batch apply started for ${Math.min(limit, newJobs.length)} jobs. Check terminal.`,
    total_new: newJobs.length,
    applying: Math.min(limit, newJobs.length),
  });
});

// POST /api/jobs/:id/status — update a job's status
const VALID_STATUSES: Job["status"][] = ["new", "applied", "responded", "interviewing", "offer", "rejected", "skipped"];

app.post("/api/jobs/:id/status", (req, res) => {
  const jobId = req.params.id;
  const newStatus = req.body?.status as Job["status"];

  if (!VALID_STATUSES.includes(newStatus)) {
    res.status(400).json({ error: `Invalid status: ${newStatus}. Valid: ${VALID_STATUSES.join(", ")}` });
    return;
  }

  const data = loadJobs();
  const success = updateStatus(data, jobId, newStatus);
  if (!success) {
    res.status(404).json({ error: `Job ${jobId} not found` });
    return;
  }

  saveJobs(data);
  const job = data.jobs.find((j) => j.id === jobId);
  res.json({ success: true, job });
});

// GET /api/stories — return the interview story bank
app.get("/api/stories", (_req, res) => {
  const storyPath = join(__dirname, "data/story-bank.md");
  if (!existsSync(storyPath)) {
    res.json({ content: "", count: 0 });
    return;
  }
  const content = readFileSync(storyPath, "utf-8");
  const count = (content.match(/^## /gm) || []).length;
  res.json({ content, count });
});

app.listen(PORT, () => {
  console.log(`[Server] Job Command Center API running on http://localhost:${PORT}`);
  console.log(`[Server] Frontend: http://localhost:5173`);
});
