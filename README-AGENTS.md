# Career-Ops (Multi-Agent Edition)

This repository is copied from **[santifer/career-ops](https://github.com/santifer/career-ops)** and modified so it can be used with free-tier and mixed-agent workflows (for example: **Antigravity**, **Cursor**, **Codex**, and **Claude**), while keeping the core career-ops pipeline behavior.

## What this repo does

Career-ops is an AI-assisted job search pipeline to:
- discover roles
- evaluate job descriptions
- generate tailored resumes
- track applications
- manage reports and outputs

## What was adapted for multi-agent usage

- Added interoperability notes for non-Claude toolchains.
- Added `ANTIGRAVITY.md` to map career-ops workflow/tool expectations to Antigravity-style tools.
- Kept core scripts and data contract intact so you can still use the original flow.

## Prerequisites

- Node.js 18+
- npm
- Playwright browser dependency (for PDF generation and browser-driven tasks)

Install dependencies:

```bash
npm install
```

Run setup check:

```bash
npm run doctor
```

## Required user files

Make sure these exist before running workflows:
- `cv.md`
- `config/profile.yml`
- `modes/_profile.md`
- `portals.yml`

## Common commands

- `npm run doctor` — validate setup
- `npm run verify` — pipeline integrity check
- `npm run dedup` — deduplicate tracker
- `npm run merge` — merge tracker additions
- `npm run pdf` — generate PDF from tailored CV
- `npm run sync-check` — CV/profile consistency check

## How to use with Antigravity

1. Open and read `ANTIGRAVITY.md` first.
2. Use the same career-ops flow, but with mapped tools (as documented in that file).
3. Typical sequence:
   - run scan/discovery
   - auto-prepare selected jobs into application-ready artifacts
   - generate tailored CV/resume outputs
   - prepare application responses
   - update pipeline/tracker

Recommended prompt style in Antigravity:
- “Use `ANTIGRAVITY.md` mappings and run career-ops scan for Go backend roles in India remote + target cities.”
- “Evaluate this JD URL and generate tailored resume + answers.md.”

Expected scan output in this fork:
- `applications/golang-jobs-{YYYY-MM-DD}/{role-slug}/resume.md`
- `applications/golang-jobs-{YYYY-MM-DD}/{role-slug}/answers.md`
- updated `applications/golang-jobs-{YYYY-MM-DD}/README.md` row for each discovered role

## How to use with Cursor

1. Open repo in Cursor.
2. Ask the agent to follow `CLAUDE.md`, `DATA_CONTRACT.md`, and your profile files.
3. Use natural prompts such as:
   - “Scan for Golang backend jobs in Remote India + MP/Nagpur/Jaipur/Gujarat.”
   - “Generate tailored resume and application answers for this URL.”
   - “Update tracker and save report artifacts.”
4. Validate with:
   - `npm run verify`
   - `npm run merge` (after batch evaluations)

## How to use with Codex

Use Codex as an implementation/refactor/automation helper around the same workflow:

1. Keep `cv.md`, `profile.yml`, and `portals.yml` updated.
2. Ask Codex to:
   - run scans
   - create per-job tailored artifacts
   - update pipeline/tracker files
   - refactor scripts safely without changing behavior
3. Re-run:
   - `npm run doctor`
   - `npm run verify`

## How to use with Claude

This is the native/original style for this project:

1. Use slash-style career-ops workflows or equivalent prompts:
   - scan
   - pipeline
   - apply
   - pdf
2. Follow repository guardrails in `CLAUDE.md` and `DATA_CONTRACT.md`.
3. Keep personalization in:
   - `config/profile.yml`
   - `modes/_profile.md`

## Recommended operating model (any agent)

1. **Scan** for relevant roles.
2. **Evaluate** only high-fit jobs.
3. **Generate** tailored resume + answers per job.
4. **Apply carefully** (review before final submit).
5. **Track** status changes in the tracker.
6. **Iterate** profile and filters based on outcomes.

## Important notes

- Keep user-specific data in user-layer files (`cv.md`, `config/profile.yml`, `modes/_profile.md`, `data/*`, `reports/*`, `output/*`).
- Avoid putting personalization in shared mode/system files unless you intend global behavior changes.
- For batch runs, always merge tracker additions after evaluations.
