# Job Command Center

Job search scraper + auto-apply system for **Forward Deployed Engineer / AI Deployment / Applied AI** roles.

Scrapes 950+ job postings across 12 platforms, scores them by fit using AI, and auto-fills application forms on Ashby, Greenhouse, and Lever.

## How It Works

**Scrape** -- Searches Google (via Serper.dev) with 33 title variations across 12 ATS platforms and job boards. Parses pages using a 5-tier extraction strategy (JSON-LD, Greenhouse API, Rippling, Lever meta tags, Claude API fallback). Filters junk, deduplicates, and removes non-US jobs.

**Score** -- Each new job is scored 1-5 by Claude based on fit to your profile. Scores appear in the dashboard and jobs are sorted by fit. Jobs from priority companies get a +1 boost.

**Priority Companies** -- Each scrape also pulls the complete job board from 76 curated target companies directly via their ATS APIs (Greenhouse, Ashby, Lever, Rippling), catching roles that wouldn't match the standard title searches.

**Apply** -- Direct Playwright browser automation fills application forms on Ashby, Greenhouse, and Lever. Custom questions are drafted by Claude and presented for your approval. You confirm before any submission.

**Track** -- Jobs move through a 7-status pipeline: new -> applied -> responded -> interviewing -> offer (or rejected/skipped). Change status from the dashboard.

## Setup

### Prerequisites

- Node.js 18+
- A [Serper.dev](https://serper.dev) API key (free tier: 2,500 queries/month)
- An [Anthropic](https://console.anthropic.com/) API key

### Install

```bash
git clone https://github.com/aaronpurewal/job-command-center.git
cd job-command-center
npm install
npx playwright install chromium
```

### Configure

1. Copy the environment file and add your API keys:

```bash
cp .env.example .env
```

```
ANTHROPIC_API_KEY=sk-ant-...
SERPER_API_KEY=...
```

2. Copy the profile template and fill in your details:

```bash
cp profile.example.yaml profile.yaml
```

Edit `profile.yaml` with your name, email, phone, LinkedIn, work history, and background context. This is used for form filling and custom question drafting.

3. Add your resume as `resume.pdf` in the project root.

### Run

```bash
npm run dev
```

Opens the dashboard at [http://localhost:5173](http://localhost:5173) with the Express API on port 3001.

## Commands

| Command | What it does |
|---------|-------------|
| `npm run dev` | Start frontend + backend |
| `npm run scrape` | Full scrape (~143 Google queries) |
| `npm run scrape -- --quick` | ATS sites only (faster) |
| `npm run apply -- <job-id>` | Auto-apply to one job |
| `npm run apply -- <url>` | Auto-apply to a URL |
| `npm run apply:batch` | Auto-apply to all new supported jobs |
| `npm run stories -- <job-id>` | Generate STAR interview stories for a job |

## Architecture

```
src/App.jsx                  React dashboard (scores, status pipeline, stories tab)
server/index.ts              Express API (port 3001)
server/config/scrape-config.ts    33 title variations x 13 targets = 143 queries
server/agents/scrape-agent.ts     Serper.dev search + page parsing
server/scraper/batch-parser.ts    5-tier page parser (JSON-LD -> API -> meta -> Claude)
server/scraper/dedup.ts           Job data model, dedup, status management
server/scraper/job-scorer.ts      AI job scoring (batched, uses Haiku)
server/apply/apply-runner.ts      Direct Playwright auto-apply
server/apply/fillers/             Platform-specific form fillers (ashby, greenhouse, lever)
server/apply/custom-questions.ts  Claude API drafting for free-text questions
server/agents/story-agent.ts      STAR interview story generator
server/tools/profile-tools.ts     Profile + resume loading
server/data/jobs.json             Job database (gitignored)
server/data/story-bank.md         Accumulated interview stories (gitignored)
profile.yaml                      Your profile data (gitignored)
resume.pdf                        Your resume (gitignored)
```

## Scraping

Searches are built from 33 job title variations across 11 batches:

- Forward Deployed Engineer (core + AI + software)
- AI Deployment Engineer, Applied AI Engineer
- Solutions Engineer / Architect (AI, LLM, ML)
- AI Consultant, Implementation Engineer, Integration Engineer
- Customer Engineer AI, Technical Account Manager AI
- Professional Services Engineer, Field Engineer, Pre-Sales Engineer
- Enterprise AI Engineer, AI Engagement Manager
- AI Engineer, ML Engineer (broad)
- Solutions Engineer, Implementation Engineer (broad)
- LLM Engineer, Prompt Engineer, Generative AI Engineer
- AI Platform Engineer, ML Platform Engineer

Each batch is searched across 6 ATS platforms (Ashby, Greenhouse, Lever, Workday, Rippling) + 6 job boards (LinkedIn, Wellfound, Built In, YC, startup.jobs, ai-jobs.net) + general web.

Pages are parsed using a cost-optimized 5-tier strategy:
1. **JSON-LD** structured data (free, instant)
2. **Greenhouse JSON API** (free, instant)
3. **Rippling `__NEXT_DATA__`** (free, instant)
4. **Lever meta tags** (free, instant)
5. **Claude API fallback** (paid, only when above fail)

## Scoring

After scraping, each new job is scored 1-5 using Claude Haiku based on fit to your profile:

- **5** = Perfect match (FDE, Applied AI at an AI company)
- **4** = Strong match (Solutions Engineer AI, AI Consultant)
- **3** = Decent match (general AI/ML, adjacent role)
- **2** = Weak match (tangentially related)
- **1** = Poor match (wrong domain/level)

Jobs are batched 10 per API call. Scoring 1,000 jobs costs ~$0.014.

## Auto-Apply (Beta)

> **Warning:** The auto-apply system is in active development and may not work reliably on all job postings. Form selectors can vary between companies on the same ATS platform. Always review the browser before confirming submission. Use at your own risk.

The apply system uses direct Playwright scripts (not an AI agent) with platform-specific form fillers:

- **Ashby** -- React SPA, fills by input name attributes and aria-labels
- **Greenhouse** -- Server-rendered HTML, fills by stable element IDs
- **Lever** -- Simple HTML forms with predictable name attributes

Only these 3 platforms are supported for auto-apply. Other platforms (Workday, LinkedIn, Wellfound, etc.) require manual application.

**How it works:**
1. Opens a visible browser window (you can watch it work)
2. Navigates to the application form
3. Fills standard fields from `profile.yaml` (name, email, phone, LinkedIn, resume)
4. For custom questions: drafts answers with Claude, presents them in the terminal for your approval
5. Shows a summary and waits for your confirmation before submitting
6. Marks the job as "applied" in the database

**Known limitations:**
- Ashby forms are React SPAs with dynamic rendering -- selectors may not match all companies
- Some Greenhouse forms use non-standard custom field layouts
- File upload (resume) may fail on some forms with custom dropzone implementations
- Location autocomplete fields (Google Places) require special handling
- Multi-page forms may not advance correctly on all sites

## Priority Companies

These 76 companies are targeted with direct ATS API calls every scrape, pulling ALL their current postings (not just ones matching standard title searches). Jobs from these companies receive a **+1 score boost** and a **★ star badge** in the dashboard. A "Priority only" filter toggle lets you view just these companies.

Irrelevant roles (legal, HR, facilities, sales, etc.) are filtered out at fetch time.

| Company | ATS |
|---|---|
| Abnormal | Greenhouse |
| Adaptive Security | Ashby |
| Agency | Custom |
| Anduril | Custom |
| Anthropic | Greenhouse |
| Applied Compute | Ashby |
| Applied Intuition | Greenhouse |
| Arcade | Ashby |
| Assort Health | Ashby |
| Avoca | Ashby |
| Baseten | Ashby |
| Basis | Ashby |
| Braintrust | Ashby |
| Browserbase | Ashby |
| Canva | Custom |
| Chroma | Ashby |
| Clay | Ashby |
| ClickHouse | Greenhouse |
| Cognition | Ashby |
| Conductor | Rippling |
| CrewAI | Custom |
| Crosby | Ashby |
| Cursor | Custom |
| Databricks | Greenhouse |
| David AI | Ashby |
| Decagon | Ashby |
| Doppel | Ashby |
| Dust | Ashby |
| E2B | Ashby |
| ElevenLabs | Ashby |
| Exa | Ashby |
| Factory | Custom |
| Fal | Greenhouse |
| Fireworks AI | Greenhouse |
| Flock Safety | Ashby |
| Gamma | Ashby |
| General Counsel (GC AI) | Custom |
| Glean | Greenhouse |
| Gong | Greenhouse |
| Granola | Ashby |
| Harvey | Ashby |
| Icon | Greenhouse |
| Juicebox | Ashby |
| LangChain | Ashby |
| Legora | Ashby |
| Linear | Ashby |
| Listen | Ashby |
| LlamaIndex | Ashby |
| Lovable | Ashby |
| Matic Robotics | Ashby |
| Mintlify | Ashby |
| Modal | Ashby |
| Momentic | Ashby |
| n8n | Ashby |
| OpenAI | Ashby |
| OpenEvidence | Ashby |
| OpenRouter | Ashby |
| PACE | Rippling |
| Parallel | Ashby |
| Physical Intelligence | Ashby |
| Profound | Ashby |
| Ramp | Ashby |
| Reality Defender | Ashby |
| Resend | Ashby |
| Retell | Ashby |
| Rillet | Ashby |
| Serval | Ashby |
| Sierra | Ashby |
| Stripe | Greenhouse |
| Supabase | Ashby |
| Together.ai | Greenhouse |
| Turbopuffer | Ashby |
| Vercel | Greenhouse |
| Wispr Flow | Ashby |
| XBow | Ashby |

To modify this list, edit `server/config/priority-companies.ts`. Then run `npx tsx server/scraper/flag-priority.ts` to backfill.

## Interview Story Bank

Generate STAR+R (Situation, Task, Action, Result, Reflection) interview stories tailored to specific job postings:

```bash
npm run stories -- <job-id>
```

Stories accumulate in `server/data/story-bank.md` and are viewable in the dashboard's Stories tab. Each generation adds 4-6 stories relevant to that role, avoiding duplicates of existing stories.

## Cost

| Operation | Cost |
|-----------|------|
| Scrape (143 queries via Serper free tier) | $0.00 |
| Page parsing (JSON-LD/API fast paths) | $0.00 |
| Page parsing (Claude fallback, ~10% of pages) | ~$0.01-0.05 |
| Score 1,000 jobs (Haiku) | ~$0.014 |
| Auto-apply per job (no custom questions) | $0.00 |
| Auto-apply per job (with custom question drafting) | ~$0.01 |
| Story generation per job | ~$0.03 |

## License

MIT
