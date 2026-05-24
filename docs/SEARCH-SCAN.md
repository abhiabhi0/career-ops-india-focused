# search-scan.js — Unified Job Scanner

A three-phase job scanner that combines **direct API scanning** (Greenhouse, Ashby, Lever), **direct browser scraping with Scrapling**, and **Resilient Web Search** to maximize discovery.

## How It Works

```
config/profile.yml  PORTALS_PATH
    │                   │
    ▼                   ▼
Phase 1: API Scan ─── fetches structured job data from ───┐
(Greenhouse / Ashby / Lever board APIs)                    │
10 concurrent requests, no config needed                   │
                                                           │
Phase 2: Scrapling ─ direct career-page / portal scraping ─┤
(tracked companies + generated portal search URLs)         │
                                                           ▼
Phase 3: Web Search ─ Cascading Fallback Logic ───────► dedup + title filter
(Google -> DuckDuckGo -> Brave API)                        │
                                                           │
                                                           ▼
                                                  data/pipeline.md
                                                  data/scan-history.tsv
```

## Resilient Cascading Search

To avoid being blocked by search engines (CAPTCHAs), the scanner now features an automatic fallback mechanism:

1.  **Google (Playwright)**: Primary attempt.
2.  **DuckDuckGo (Playwright)**: Automatic fallback if Google blocks or shows a CAPTCHA.
3.  **Brave API**: Final fallback (requires `BRAVE_API_KEY` in `.env`).

## 📍 Strict Location Filtering

The scanner now enforces strict filtering to ensure you only collect roles eligible for Indian residents.

- **Auto-Detect**: It reads your country from `config/profile.yml`. If none is found, it defaults to 'india'.
- **Scoring Engine**: It checks the Title, Location, URL, and Description.
- **Exclusion**: Explicitly skips roles marked "US Only", "USA", "UK Only", "Europe Only", "EMEA", "Americas", etc.
- **Inclusion**: Priority is given to roles mentioning "India", major Indian cities, "APAC", "Global", or "Worldwide".

## 🛡️ Stop-on-Failure Mechanism

To prevent your IP from being flagged across all search engines, the scanner is now "intelligent" about stopping:
- If **Google, DuckDuckGo, and Brave** (or whichever are configured) all fail for a single query, the scanner assumes a global block.
- It will immediately **abort Phase 2** and provide a summary of what was found up to that point.

## Profile-Driven Search

The scanner automatically generates search queries based on your `config/profile.yml`. This allows you to customize the search for any role or location without touching the code.

1.  Fill out `config/profile.yml` with your `target_roles` and `location`.
2.  Run the scanner. It will generate queries like:
    `site:jobs.ashbyhq.com "Senior Backend Engineer (Go)" (India OR "remote")`

## Setup

### 1. Install Node Dependencies
Ensure Playwright and its system libraries are installed:
```bash
npm install
npx playwright install --with-deps chromium
```

### 2. Install Scrapling Fetchers
The scanner uses a Python helper for direct career-page scraping. The default path is `.venv-scrapling/bin/python`.

```bash
python3 -m venv .venv-scrapling
.venv-scrapling/bin/pip install "scrapling[fetchers]"
```

Notes:
- `search-scan.js` reuses the Chromium executable from the repo's Node Playwright install, so you do not need a second browser install just for Scrapling.
- If your Scrapling virtualenv lives elsewhere, set `SCRAPLING_PYTHON=/absolute/path/to/python`.
- Set `SCRAPLING_FETCHER=stealthy` if you want the helper to use Scrapling's stealth browser session.

### 3. (Optional) Brave API Key
If you want the most robust results, add a Brave API key to your `.env`:
```bash
echo 'BRAVE_API_KEY=your_key_here' >> .env
```

## Usage

### Full scan (API + Scrapling + Cascading Search)
```bash
node search-scan.js
```

### Full scan + apply-assist prep
```bash
node search-scan.js --apply-assist
```

This runs discovery first, then processes every pending entry in `data/pipeline.md` with the local browser:
- prepares `applications/golang-jobs-{date}/{role-slug}/resume.md`
- prepares `applications/golang-jobs-{date}/{role-slug}/answers.md`
- inspects the application page and records findings in `apply-assist.json`
- attempts safe resume upload when a file input is present
- stops before the final `Submit` / `Apply` action

### Apply After Scanning

`apply-assist` does **not** read directly from `data/scan-history.tsv`.

Use the files this way:
- `data/scan-history.tsv`: audit log of everything the scanner has seen
- `data/pipeline.md`: the actual queue of pending jobs to prepare for application

Workflow:

1. Run a scan so new jobs are added to `data/pipeline.md`
2. Review `data/pipeline.md` and keep only the jobs you want to prepare
3. Put your resume PDF at repo root as `resume.pdf`
4. Run `apply-assist` on the pending pipeline entries

Commands:

```bash
# 1) Scan and queue jobs
node search-scan.js

# 2) Or scan only specific sources first
node search-scan.js --site-only
node search-scan.js --search-only --query "naukri" --limit 5

# 3) Prepare application artifacts for every pending pipeline job
node search-scan.js --apply-assist

# 4) Limit apply-assist to the first N pending jobs
node apply-assist.mjs --limit 5

# 5) Show the browser while inspecting forms
node search-scan.js --apply-assist --headed
```

What `apply-assist` produces for each pending pipeline entry:
- `applications/golang-jobs-{date}/{role-slug}/resume.md`
- `applications/golang-jobs-{date}/{role-slug}/answers.md`
- `applications/golang-jobs-{date}/{role-slug}/apply-assist.json`
- batch tracker row in `applications/golang-jobs-{date}/README.md`

Important:
- If a job exists only in `scan-history.tsv` but not in `pipeline.md`, `apply-assist` will ignore it.
- If you want to apply-assist a job, make sure it remains as a pending `- [ ] ...` item in `data/pipeline.md`.
- The current flow may inspect the form and upload `resume.pdf`, but it stops before final submission.

### Recommended Run Modes

Use these depending on how aggressive or stable you want the scan to be:

```bash
# Full scan: API + browser/web search
node search-scan.js

# API only: no browser, no Google/DDG, most stable
node search-scan.js --api-only

# Direct site scraping only: Scrapling on company pages + portal pages
node search-scan.js --site-only

# Search only: skip API boards, run only web discovery
node search-scan.js --search-only

# Brave only: no browser automation for search phase
node search-scan.js --engine brave

# DuckDuckGo only: browser automation, but avoids Google
node search-scan.js --engine ddg

# Headed mode: show the browser window for debugging
node search-scan.js --headed
```

### India-Focused Copy-Paste Commands

These are safe, practical commands you can copy-paste directly depending on what you want to search.

#### Stable scans

```bash
# ATS/API boards only
node search-scan.js --api-only

# Direct site scraping only
node search-scan.js --site-only

# ATS/API boards only for one company
node search-scan.js --api-only --company "Canonical"

# Brave-only search with a smaller batch
node search-scan.js --engine brave --limit 20
```

#### Targeted India board searches

These commands are not all equally reliable. The current scanner has explicit
URL extraction support for some portals and only best-effort fallback support
for others.

```bash
# Confirmed / first-class supported

# Naukri only
node search-scan.js --search-only --query "naukri" --limit 5

# Instahyre only
node search-scan.js --search-only --query "instahyre" --limit 5

# Cutshort only
node search-scan.js --search-only --query "cutshort" --limit 5

# Freshteam only
node search-scan.js --search-only --query "freshteam" --limit 5

# LinkedIn India searches only (works, but search engines may return lower yield)
node search-scan.js --search-only --query "linkedin" --limit 5

# Wellfound only
node search-scan.js --search-only --query "wellfound" --limit 5

# Workable only
node search-scan.js --search-only --query "workable" --limit 5

# Best-effort / experimental

# Foundit only
node search-scan.js --search-only --query "foundit" --limit 5

# Shine only
node search-scan.js --search-only --query "shine" --limit 5
```

`Indeed` is not recommended currently. The search query exists conceptually,
but the current extractor does not reliably recognize Indeed result URLs.

#### Browser-search alternatives when Google blocks

Brave commands below require `BRAVE_API_KEY` in `.env`.

```bash
# DuckDuckGo only, small batch
node search-scan.js --search-only --engine ddg --limit 10

# Brave only, small batch
node search-scan.js --search-only --engine brave --limit 10

# Brave only for Naukri-like India-focused queries
node search-scan.js --search-only --engine brave --query "naukri" --limit 5

# Brave only for Instahyre-like India-focused queries
node search-scan.js --search-only --engine brave --query "instahyre" --limit 5

# Brave only for Cutshort-like India-focused queries
node search-scan.js --search-only --engine brave --query "cutshort" --limit 5
```

#### City or location-focused runs

```bash
# Force India location filter explicitly
node search-scan.js --search-only --location "india" --limit 10

# Bengaluru-focused run
node search-scan.js --search-only --location "bengaluru" --limit 10

# Remote India queries from portals.yml
node search-scan.js --search-only --query "remote" --limit 10
```

#### Single-company web search runs

```bash
# One specific company
node search-scan.js --search-only --company "Razorpay" --limit 5

# Another specific company
node search-scan.js --search-only --company "PhonePe" --limit 5

# YC / remote company examples
node search-scan.js --search-only --company "Render" --limit 5
node search-scan.js --search-only --company "Clerk" --limit 5
```

#### Dry-run variants

```bash
# Preview only, do not write to pipeline/history
node search-scan.js --dry-run

# Preview only for direct Scrapling phases
node search-scan.js --site-only --dry-run

# Preview only for Naukri
node search-scan.js --search-only --query "naukri" --limit 5 --dry-run

# Preview only with Brave
node search-scan.js --search-only --engine brave --limit 10 --dry-run
```

### Advanced Flags

| Flag | Description |
| :--- | :--- |
| `--engine auto` | Default. Uses Cascading logic (Google -> DDG -> Brave). |
| `--engine google` | Force Google only. |
| `--engine ddg` | Force DuckDuckGo only. |
| `--engine brave` | Force Brave only. |
| `--site-only` | Run only the direct Scrapling phases: company career pages and generated portal pages. |
| `--limit N` | Stop after N queries to avoid rate limits. |
| `--headed` | Open browser window to see the search in action (debugging). |
| `--dry-run` | Preview results in console without saving to files. |
| `--apply-assist` | After scanning, prepare application artifacts for all pending `pipeline.md` jobs and stop before final submission. |
| `--no-stealth-search` | Disable the Playwright stealth search and fall back completely to the original Scrapling fetching logic. |

## Troubleshooting

If you hit a CAPTCHA:
1. The scanner will **automatically** try DuckDuckGo or Brave.
2. If all engines fail, try again later or use a lower `--limit`.
3. Check `config/profile.yml` to ensure your search strings are not too broad.

### Practical Anti-Block Advice

If Google blocks after a few searches, use this order:

1. Run API-only first:
```bash
node search-scan.js --api-only
```

2. Then run a small targeted search batch:
```bash
node search-scan.js --search-only --query "naukri" --limit 5
node search-scan.js --search-only --query "instahyre" --limit 5
node search-scan.js --search-only --query "cutshort" --limit 5
```

3. If Google keeps blocking, switch to Brave-only:
```bash
node search-scan.js --search-only --engine brave --query "naukri" --limit 5
node search-scan.js --search-only --engine brave --query "instahyre" --limit 5
node search-scan.js --search-only --engine brave --query "cutshort" --limit 5
```

4. Avoid running the full default web-search sweep repeatedly in a short time. Your current config expands to many queries, so smaller targeted runs are more reliable.
