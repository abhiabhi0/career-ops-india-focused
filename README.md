# Career-Ops India (Free-Tier Agents)

This repository is copied from [santifer/career-ops](https://github.com/santifer/career-ops) and modified to work with free-tier AI coding agents for candidates residing in India.

Primary goal: help India-based candidates target remote jobs worldwide that explicitly allow India-resident applicants.

### 🚀 Resilient Discovery System
This fork features an advanced **Resilient Job Discovery** pipeline (`search-scan.js`) that is profile-driven and highly resistant to search engine blocks. It combines ATS APIs, direct browser scraping with `Scrapling`, and search fallback so you can find the right roles without manual browsing or CAPTCHA frustration.

## Prerequisites

- Node.js 18+
- npm
- Playwright Chromium

## One-Time Setup

```bash
# 1) Install dependencies
npm install
npx playwright install chromium

# 1b) Install Scrapling fetchers for direct portal scraping
python3 -m venv .venv-scrapling
.venv-scrapling/bin/pip install "scrapling[fetchers]"

# 2) Validate local setup
npm run doctor

# 3) Create required files (if missing)
cp config/profile.example.yml config/profile.yml
cp templates/portals.example.yml portals.yml

# 4) Add your CV
# Create cv.md in repo root
```

## Mandatory Personalization (Required For Every User)

Every user must update both:

- `config/profile.yml`
- `modes/_profile.md`

Without these two files customized, the evaluations and recommendations will be low quality.

Recommended updates:

- In `config/profile.yml`
  - set personal identity/contact details
  - set `location.country: India`
  - set timezone to IST
  - define compensation and remote policy
- In `modes/_profile.md`
  - set your target roles/archetypes
  - set your strengths and proof points
  - set your location and filtering policy

## 📍 Strict India-Remote Filtering

The system is now **fully autonomous** regarding location. 

1. **Auto-Profile Reading**: The scanner automatically reads your `location.country` from `config/profile.yml`.
2. **Strict Filtering**: It uses a scoring engine to exclude "US Only" or "Europe Only" roles, even if labeled "Remote".
3. **Targeted Search**: It only keeps roles that are explicitly open to India-resident candidates (Remote-India, APAC, or Global Remote).

Avoid roles that are remote but geographically restricted to non-India regions.

## How To Run With Different AI Agents

### Claude Code

```bash
claude
```

Then ask:

- `/career-ops scan`
- `/career-ops pipeline`
- `/career-ops {job-url}`

### Cursor Agent

Open this repo in Cursor and use chat in Agent mode. Ask:

- "Run /career-ops scan and shortlist India-eligible remote roles"
- "Evaluate this JD URL and generate report + PDF"
- "Update tracker for this role"

### Codex / Codex CLI

Open this repo in Codex and run equivalent prompts:

- "Scan portals for remote roles open to India candidates"
- "Evaluate this job URL against my profile"
- "Generate tailored resume PDF and tracker update"

### Antigravity (free-tier workflow)

Open the repository in your Antigravity setup and use the same high-level prompts:

- scan India-eligible global remote roles
- evaluate job URLs against `cv.md` + `config/profile.yml`
- write reports and tracker updates

## Universal Agent Contract (Must Follow)

To ensure **every** agent behaves the same, treat this section as required repo policy.

### Required startup reads (in order)

1. `CLAUDE.md`
2. `ANTIGRAVITY.md`
3. `modes/_shared.md`
4. `modes/_profile.md`
5. `.agents/workflows/career-ops.md`
6. `.agents/workflows/career-ops-scan.md`
7. `modes/scan.md`

### 🤖 Agent-Led Workflow

The AI Agent (Antigravity, Claude, or Cursor) is the "brain" that executes the heavy lifting. **Do not write CVs manually.** Use the agent to evaluate discovered jobs and generate artifacts.

#### 1. Discovery (Automatic)
Run `node search-scan.js` to find new leads. The scanner reads `config/profile.yml`, hits ATS APIs directly, uses `Scrapling` for career pages and portal result pages, and then falls back to search engines when needed. New leads are automatically added to `data/pipeline.md` with strict location checks.

For ready-to-copy commands for Naukri, Instahyre, Cutshort, Brave-only runs, API-only mode, and anti-block usage, see [docs/SEARCH-SCAN.md](docs/SEARCH-SCAN.md).

#### 2. Evaluation & CV Drafting (Agent)
Ask your AI coding agent:
> "Process my new leads in data/pipeline.md. Evaluate each against my profile. For the best matches, generate a tailored resume.md and answers.md in the applications/ folder."

#### 3. Definition of Done
A run is complete only when:
1. New roles are added to `data/pipeline.md`.
2. `data/scan-history.tsv` is updated.
3. **AI Agent** generates a custom `resume.md` and `answers.md` for each role in `applications/golang-jobs-{date}/{role-slug}/`.
4. Tracker README is updated.

## Recommended Workflow

1. Run unified scan: `npm run scan:all` (or `node search-scan.js`)
2. API-only scan (no key needed): `npm run scan:api`
3. Search-only scan: `npm run scan:search`
4. Scan + prepare apply-assist artifacts: `node search-scan.js --search-only --apply-assist`
5. Evaluate best matches: `/career-ops {job-url}`
6. Generate tailored resume: `/career-ops pdf` or full auto-pipeline
7. Keep tracker clean:
   - `npm run verify`
   - `npm run merge` (after batch evaluations)

> **Scanner docs**: See [docs/SEARCH-SCAN.md](docs/SEARCH-SCAN.md) for full setup guide, Brave API key configuration, CLI reference, and examples.

Tip: `search-scan.js` auto-detects `.venv-scrapling/bin/python`. If you keep Scrapling in another virtualenv, set `SCRAPLING_PYTHON=/absolute/path/to/python`.

## Notes

- This repo is intentionally tuned for India-based remote job search.
- Keep personal customization in `config/profile.yml` and `modes/_profile.md`.
- If a role is not remote or does not support India-resident candidates, skip it.
- In this fork, `career-ops scan` should continue after discovery and prepare per-role artifacts in `applications/golang-jobs-{date}/` (`resume.md` + `answers.md` + batch README row), even when auto-apply cannot be completed.
- Apply-assist may upload your local `resume.pdf` and inspect forms, but it always stops before the final submit action.
