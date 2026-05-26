# search-scan.js — Unified Job Scanner

A three-phase job scanner that combines **API scanning**, **career page scraping**, and **search engine URL collection** to discover jobs.

## Architecture

```
portals.yml
    │
    ├── tracked_companies ──► Phase 1: API Scan
    │   (Greenhouse / Ashby / Lever board APIs)
    │   10 concurrent requests, zero browser
    │
    ├── tracked_companies ──► Phase 2: Portal Scrape
    │   (Scrapling on career page URLs)
    │   Scrolls pages, clicks "Load More", extracts job links
    │
    └── search_queries ─────► Phase 3: Search Queries
        (Google → DuckDuckGo via Playwright)
        Collects all result URLs per query
                │
                ▼
        dedup + title filter
                │
                ▼
        data/pipeline.md
        data/scan-history.tsv
        data/search-urls.tsv (Phase 3 raw URLs)
```

## Quick Start

```bash
# Full scan (all 3 phases)
node search-scan.js

# Run individual phases
node search-scan.js --phase1          # API only
node search-scan.js --phase2          # Scrapling portals only
node search-scan.js --phase3          # Search queries only

# Combine specific phases
node search-scan.js --phase1 --phase3

# Preview without writing files
node search-scan.js --dry-run
```

## Setup

### 1. Node Dependencies
```bash
npm install
npx playwright install --with-deps chromium
```

### 2. Scrapling (Phase 2)
```bash
python3 -m venv .venv-scrapling
.venv-scrapling/bin/pip install "scrapling[fetchers]"
```

Scrapling reuses the Chromium from Playwright — no extra browser install needed.  
Override with `SCRAPLING_PYTHON=/path/to/python` if your venv lives elsewhere.

## CLI Reference

| Flag | Description |
| :--- | :--- |
| `--phase1` | Run Phase 1 only (API scan) |
| `--phase2` | Run Phase 2 only (Scrapling portal scrape) |
| `--phase3` | Run Phase 3 only (search query URL collection) |
| `--company NAME` | Filter companies by name (Phase 1 + 2) |
| `--query KEYWORD` | Filter search queries by keyword (Phase 3) |
| `--limit N` | Limit Phase 3 to N queries |
| `--num N` | Results per Phase 3 query (default: 10) |
| `--engine ENGINE` | Force `google` or `ddg` for Phase 3 |
| `--headed` | Show browser window (debug) |
| `--dry-run` | Preview results without saving |
| `--location LOC` | Override location filter (default: from profile or "india") |
| `--apply-assist` | Prepare application artifacts after scanning |

Legacy flags `--api-only`, `--site-only`, `--search-only` still work as aliases for `--phase1`, `--phase2`, `--phase3`.

## Phase Details

### Phase 1 — API Scan

Fetches structured job data from ATS board APIs:
- **Greenhouse**: `boards-api.greenhouse.io/v1/boards/{slug}/jobs`
- **Ashby**: `api.ashbyhq.com/posting-api/job-board/{slug}`
- **Lever**: `api.lever.co/v0/postings/{slug}`

Auto-detected from `careers_url` in `tracked_companies`. No browser needed.

### Phase 2 — Portal Scrape (Scrapling)

Opens each company's `careers_url` in a headless browser via the Scrapling Python helper:
- Scrolls the page and clicks "Load More" / "Show All" buttons
- Extracts all `<a>` links and filters for job-like URLs
- Applies title filter and location filter

### Phase 3 — Search Queries

For each `search_queries` entry in `portals.yml`:
- Searches on Google via Playwright (falls back to DuckDuckGo if CAPTCHA'd)
- Collects all organic result URLs — raw, unfiltered
- Deduplicates across queries
- Saves raw URLs to `data/search-urls.tsv`
- Filters job-like URLs into `data/pipeline.md`

## Examples

```bash
# API scan for one company
node search-scan.js --phase1 --company "Grafana"

# Portal scrape for one company
node search-scan.js --phase2 --company "Razorpay"

# Search queries filtered by keyword, limited to 5
node search-scan.js --phase3 --query "naukri" --limit 5

# Search with 20 results per query, DuckDuckGo only
node search-scan.js --phase3 --num 20 --engine ddg

# Full scan, show browser
node search-scan.js --headed

# Full scan + prepare applications
node search-scan.js --apply-assist
```

## npm Scripts

```bash
npm run scan:all       # Full scan (all phases)
npm run scan:api       # Phase 1 only
npm run scan:portals   # Phase 2 only
npm run scan:search    # Phase 3 only
npm run collect-urls   # Standalone URL collector (Phase 3 only, no pipeline write)
```

## Troubleshooting

**Google CAPTCHA**: Phase 3 auto-falls back to DuckDuckGo. If both fail, try:
- Lower `--limit` (fewer queries = less chance of blocking)
- Use `--engine ddg` to skip Google entirely
- Wait and try again later

**Scrapling fails**: Ensure `.venv-scrapling` is set up correctly and Chromium is installed via Playwright.

**Anti-block tips**:
1. Run `--phase1` first (zero browser, never blocked)
2. Run `--phase2` next (direct page visits, rarely blocked)
3. Run `--phase3` last with `--limit 10` to test before going full
