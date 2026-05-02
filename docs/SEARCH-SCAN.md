# search-scan.js — Unified Job Scanner

A two-phase job scanner that combines **direct API scanning** (Greenhouse, Ashby, Lever) with **Resilient Web Search** to maximize discovery.

## How It Works

```
config/profile.yml  PORTALS_PATH
    │                   │
    ▼                   ▼
Phase 1: API Scan ─── fetches structured job data from ───┐
(Greenhouse / Ashby / Lever board APIs)                    │
10 concurrent requests, no config needed                   │
                                                           ▼
Phase 2: Web Search ── Cascading Fallback Logic ──────► dedup + title filter
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

### 1. Install Dependencies
Ensure Playwright and its system libraries are installed:
```bash
npm install
npx playwright install --with-deps chromium
```

### 2. (Optional) Brave API Key
If you want the most robust results, add a Brave API key to your `.env`:
```bash
echo 'BRAVE_API_KEY=your_key_here' >> .env
```

## Usage

### Full scan (API + Cascading Search)
```bash
node search-scan.js
```

### Recommended Run Modes

Use these depending on how aggressive or stable you want the scan to be:

```bash
# Full scan: API + browser/web search
node search-scan.js

# API only: no browser, no Google/DDG, most stable
node search-scan.js --api-only

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
| `--limit N` | Stop after N queries to avoid rate limits. |
| `--headed` | Open browser window to see the search in action (debugging). |
| `--dry-run` | Preview results in console without saving to files. |

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
