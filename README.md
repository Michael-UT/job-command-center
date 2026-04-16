# Job Command Center

Job Command Center is a React + Express workspace for finding jobs across a configurable set of target roles, storing them locally, and launching a supervised apply agent when you are ready to work through forms.

The repo has four core pieces:

- `src/` renders the dashboard for scraped jobs and apply controls.
- `server/index.ts` serves the API used by the frontend.
- `server/agents/scrape-agent.ts` searches the web via Serper, parses job pages, and writes results to `server/data/jobs.json`.
- `server/agents/apply-agent.ts` runs the interactive application flow with Playwright MCP and custom profile/apply tools.

## Setup

```bash
npm install
cp .env.example .env
cp profile.example.yaml profile.yaml
```

Then:

- Add `SERPER_API_KEY` and `ANTHROPIC_API_KEY` to `.env`
- Fill out `profile.yaml`
- Place your resume at `./resume.pdf`, or set `resume_path` in `profile.yaml`

## Commands

```bash
npm run dev          # Vite frontend + Express API
npm run dev:frontend # frontend only
npm run dev:server   # backend only
npm run scrape       # CLI scrape run
npm run apply        # CLI apply agent
npm run apply:batch  # CLI batch apply mode
npm run tokenizer    # local prompt/token playground, no API call
npm run build        # production frontend build
```

## Search Profile And Matching

- The dashboard lets you edit target role titles and qualification keywords directly.
- Negative title keywords can be added in the dashboard and are passed directly into Google-style query exclusions such as `-intern`.
- Scraping queries are generated from the saved target titles.
- Match scores are computed locally on a 0-10 scale from job title, cleaned summary text, and qualification text.
- Raw HTML is not used for matching.

## Data Flow

1. The scraper generates a query matrix from `server/config/scrape-config.ts`.
2. Serper returns candidate URLs.
3. `server/scraper/batch-parser.ts` tries fast extractors first, then Anthropic parsing when needed.
4. `server/scraper/dedup.ts` normalizes and persists jobs in `server/data/jobs.json`.
5. The dashboard calls `/api/jobs`, `/api/scrape`, and apply endpoints from `src/App.jsx`.
6. The apply agent loads `profile.yaml`, reads the resume, drives the browser, pauses for confirmation, and only then marks a job applied.

## Important Files

- `server/config/search-profile.ts`: default titles, negative-title filters, keyword defaults, and saved profile persistence
- `server/config/scrape-config.ts`: search titles, sites, and ATS detection
- `server/scraper/dedup.ts`: persistence, IDs, deduplication, grouped status views
- `server/scraper/batch-parser.ts`: HTML cleanup plus parser/extractor logic
- `server/tools/profile-tools.ts`: profile and resume MCP tools
- `server/tools/apply-tools.ts`: mark-applied and application logging MCP tools
- `src/App.jsx`: dashboard UI

## Safety Notes

- Do not commit `.env`, `profile.yaml`, `resume.pdf`, or `server/data/jobs.json`
- The apply flow is designed to pause before submission for human confirmation
- Only one apply session should run at a time because it uses the shared terminal/browser
