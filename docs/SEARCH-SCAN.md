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
