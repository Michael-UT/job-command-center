# CLAUDE.md — Project Context

## What This Is

Job Command Center: a job search scraper + auto-apply system for Venture Capital / Growth Equity / Investment roles.

## Who This Is For

Priya Purewal — Venture Investor at Smash Capital (LA), formerly March Capital. MBA from Columbia Business School, BBA from UT Austin (MIS). 4+ years direct VC investing experience across consumer, software, and technology. Prior: Deloitte Consulting (4 years, Financial Services tech consulting), Goldman Sachs. Looking for Principal/VP-level VC roles or equivalent seniority at growth equity, corporate VC, or VC-adjacent firms.

## Architecture

- **Frontend:** React (Vite) — dashboard showing scraped jobs, Apply buttons, scrape status
- **Backend:** Express API (TypeScript) — serves job data, triggers agents
- **Scrape engine:** Serper.dev (Google Search API) + platform-specific extractors + Claude API fallback for page parsing
- **Apply system:** Direct Playwright scripts per ATS platform (Ashby, Greenhouse, Lever) — no Agent SDK
- **Data store:** `server/data/jobs.json` (simple JSON, gitignored)

## Job Title Taxonomy

These are the title variations to search for, grouped into batches of 3-4 for Google OR chains. Adjust based on Priya's target seniority and preferences.

### Batch 1: Core VC Titles (Principal/VP level — primary targets)
- "venture capital principal"
- "venture capital vice president"
- "VC principal"

### Batch 2: Core VC Titles (Senior Associate / Associate level — fallback)
- "venture capital associate"
- "venture capital senior associate"
- "VC associate"

### Batch 3: Investment Titles (Generic)
- "investment principal"
- "investment vice president"
- "investment director"

### Batch 4: Growth Equity
- "growth equity associate"
- "growth equity principal"
- "growth equity vice president"
- "growth investor"

### Batch 5: Venture Investor / Partner Track
- "venture investor"
- "venture partner"
- "investment partner"

### Batch 6: Corporate VC / Strategic
- "corporate venture capital"
- "strategic investments associate"
- "corporate development venture"
- "CVC associate"

### Batch 7: Portfolio / Platform (VC ops roles)
- "portfolio manager venture"
- "platform manager VC"
- "head of platform venture"
- "portfolio operations"

### Batch 8: Broader Investment Roles
- "private equity associate"
- "private equity principal"
- "private equity vice president"

### Batch 9: Fund / LP Roles
- "fund manager"
- "limited partner relations"
- "investor relations venture"

### Batch 10: Sector-Specific (Consumer/Software — Priya's sweet spots)
- "consumer investor"
- "software investor"
- "technology investor"

### Batch 11: Analyst / Research (VC-adjacent)
- "venture analyst"
- "investment analyst technology"
- "research associate venture capital"

## Search Targets

### ATS Platforms (direct job postings)
- Ashby: `site:jobs.ashbyhq.com`
- Greenhouse: `site:job-boards.greenhouse.io` and `site:boards.greenhouse.io`
- Lever: `site:jobs.lever.co`
- Workday: `site:myworkdayjobs.com`
- Rippling: `site:ats.rippling.com`

### Job Boards
- LinkedIn: `site:linkedin.com/jobs`
- Wellfound: `site:wellfound.com/jobs`
- Built In: `site:builtin.com/job`
- YC Work at a Startup: `site:workatastartup.com`

### General Web (no site restriction)
- Each title batch + `careers apply 2026`

## Location Filter

Target: **US-based roles only**, with emphasis on:
- Los Angeles / Southern California (Priya's current base)
- New York / NYC (Columbia network, prior experience)
- San Francisco / Bay Area (VC hub)
- Remote

Filter out non-US locations (India, UK, Europe, APAC, etc.)

## Key Files

- `server/config/scrape-config.ts` — title batches × sites = query matrix
- `server/agents/scrape-agent.ts` — Serper.dev scrape orchestrator
- `server/scraper/batch-parser.ts` — page parser (JSON-LD → Greenhouse API → Claude fallback)
- `server/scraper/dedup.ts` — URL + cross-site dedup, job data model
- `server/apply/apply-runner.ts` — Direct Playwright auto-apply (Ashby, Greenhouse, Lever)
- `server/apply/fillers/` — Platform-specific form fillers
- `server/apply/custom-questions.ts` — Claude API for drafting custom question answers
- `server/tools/profile-tools.ts` — Loads profile.yaml + resume.pdf
- `src/App.jsx` — React frontend dashboard

## Commands

```bash
npm run dev          # Start frontend + backend concurrently
npm run scrape       # Run full scrape (all queries)
npm run scrape -- --quick  # ATS sites only (faster)
npm run apply -- <job-id>  # Apply to one job by ID
npm run apply -- <url>     # Apply to a URL directly
npm run apply:batch        # Apply to all new supported jobs
```

## Profile Setup

1. Copy `profile.example.yaml` → `profile.yaml`
2. Fill in Priya's details:
   - first_name: Priya
   - last_name: Purewal
   - email, phone, linkedin, etc.
   - current_company: Smash Capital
   - current_title: Venture Investor
   - years_experience: 10+ (including Deloitte)
   - work_authorization: Yes
   - sponsorship_needed: No
   - background_context: (see below)

### Background Context for Custom Questions

```yaml
background_context: |
  I'm a Venture Investor at Smash Capital in Los Angeles, where I invest in high growth
  consumer, software, and technology companies. Previously at March Capital, a growth-stage
  VC fund investing globally since 2014.

  I hold an MBA from Columbia Business School, where I worked across multiple VC funds
  including Amplifyher Ventures (female-founded startups), Bowery Capital (B2B software),
  and InviNext Growth Partners (emerging consumer brands).

  Before business school, I spent 4 years at Deloitte Consulting specializing in business
  process transformation at Fortune 500 organizations, developing global technology
  solutions for Financial Services clients. I was promoted to Senior Consultant.

  Additional experience: Goldman Sachs (TMT/Realty Management Division).

  Education: MBA from Columbia Business School, BBA in Management Information Systems
  from UT Austin McCombs School of Business.

  I bring deep expertise spanning early-stage to growth-stage investing, with a particular
  focus on consumer and enterprise software. My consulting background gives me strong
  operational diligence capabilities and a structured approach to market analysis.

  Languages: English (native), Spanish (limited working).
```

3. Add `resume.pdf` to project root

## Don't

- Don't modify profile.yaml (contains PII, gitignored)
- Don't commit .env, resume.pdf, or server/data/jobs.json
- Don't auto-submit applications without human confirmation
- Don't use LangChain — raw Anthropic SDK only
- Don't add non-US jobs to the database

## Junk Filters

VC job searches return a lot of noise. Filter out:
- Articles ("How to Break Into VC", "What VCs Look For")
- Aggregator pages (ZipRecruiter, Glassdoor, Salary.com)
- Recruiting firm postings (Glocap, Oxbridge, SG Partners) — unless they link to the actual firm
- Portfolio company jobs (these are jobs AT startups, not AT the VC firm)
- "Venture Fellow" / unpaid / part-time roles (unless Priya wants them)
- Internship postings

## Cost Targets

- Scrape: $0.00 (Serper free tier + JSON-LD parsing; Claude API fallback ~$0.01/page)
- Apply (supported platforms): $0.00-0.01 per application (Claude only for custom questions)
- Apply (unsupported platforms): manual

## Implementation Notes

When building this from scratch, follow this order:
1. Set up Vite + React + Express skeleton (`npm run dev`)
2. Build scrape-config.ts with the title batches above
3. Build scrape-agent.ts with Serper.dev integration
4. Build batch-parser.ts with JSON-LD + Greenhouse API + Claude fallback
5. Build dedup.ts for URL normalization and cross-site dedup
6. Build the React dashboard (App.jsx)
7. Build the direct Playwright apply system (apply-runner.ts + fillers/)
8. Wire up Express API endpoints

The scrape config is the main thing that differs from a generic job search tool — everything else is platform-agnostic.
