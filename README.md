# Career-Ops India (Free-Tier Agents)

This repository is copied from [santifer/career-ops](https://github.com/santifer/career-ops) and modified to work with free-tier AI coding agents for candidates residing in India.

Primary goal: help India-based candidates target remote jobs worldwide that explicitly allow India-resident applicants.

## Prerequisites

- Node.js 18+
- npm
- Playwright Chromium

## One-Time Setup

```bash
# 1) Install dependencies
npm install
npx playwright install chromium

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

## India-Remote Filtering Guidance

In `portals.yml`, prioritize roles that clearly allow India-resident candidates:

- `Remote - India`
- `remote from India`
- `APAC`
- `global remote`
- `work from anywhere` (if eligibility is clear)

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

### Definition of done for `career-ops scan`

A scan run is considered **complete** only if all are true:

1. New roles are discovered and added to `data/pipeline.md` (if any).
2. `data/scan-history.tsv` is updated.
3. For each newly added role, create/update:
   - `applications/golang-jobs-{YYYY-MM-DD}/{role-slug}/resume.md`
   - `applications/golang-jobs-{YYYY-MM-DD}/{role-slug}/answers.md`
4. Update `applications/golang-jobs-{YYYY-MM-DD}/README.md` with one row per role.
5. If apply automation fails, keep artifacts and mark status as blocked (do not discard work).

If any item above is missing, the run is **not complete**.

### Copy-paste enforcement prompt (use with any agent)

Use this exact prompt when starting a run:

```text
Follow repository policy in README.md "Universal Agent Contract".
Run career-ops scan end-to-end.
Do not stop at URL discovery.
For each newly discovered role, generate applications/golang-jobs-{today}/{role-slug}/resume.md and answers.md, and update applications/golang-jobs-{today}/README.md.
If apply flow fails, keep artifacts and mark blocked status.
Return only after all definition-of-done checks pass.
```

## Recommended Workflow

1. Run scan: `/career-ops scan`
2. Evaluate best matches: `/career-ops {job-url}`
3. Generate tailored resume: `/career-ops pdf` or full auto-pipeline
4. Keep tracker clean:
   - `npm run verify`
   - `npm run merge` (after batch evaluations)

## Notes

- This repo is intentionally tuned for India-based remote job search.
- Keep personal customization in `config/profile.yml` and `modes/_profile.md`.
- If a role is not remote or does not support India-resident candidates, skip it.
- In this fork, `career-ops scan` should continue after discovery and prepare per-role artifacts in `applications/golang-jobs-{date}/` (`resume.md` + `answers.md` + batch README row), even when auto-apply cannot be completed.
