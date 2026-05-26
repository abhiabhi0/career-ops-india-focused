# Career-Ops India (Free-Tier Agents)

This repository is copied from [santifer/career-ops](https://github.com/santifer/career-ops) and modified to work with free-tier AI coding agents for candidates residing in India.

Primary goal: Automate discovering, filtering, and applying to remote jobs worldwide that explicitly allow India-resident applicants.

## 🤖 Any AI Agent Supported
This framework is built around standard markdown files (`pipeline.md`), which means it works perfectly with **any** AI coding agent, including:
- **Claude Code** (`claude` CLI)
- **Cursor**
- **Antigravity**
- **Codex / Windsurf / Aider**

---

## 🛠️ One-Time Setup

1. **Install Node dependencies & Playwright:**
   ```bash
   npm install
   npx playwright install chromium
   ```

2. **Install Scrapling fetchers for direct portal scraping:**
   ```bash
   python3 -m venv .venv-scrapling
   .venv-scrapling/bin/pip install "scrapling[fetchers]"
   ```

3. **Configure your profile:**
   ```bash
   cp config/profile.example.yml config/profile.yml
   cp templates/portals.example.yml portals.yml
   ```
   *CRITICAL: Edit `config/profile.yml` to set your target job titles, keywords, location, and salary expectations. Both the AI and the local keyword scanner rely entirely on this file!*

---

## 🏗️ Architecture

The workflow is cleanly split into two distinct tools:

### 1. The Discoverer (`search-scan.js`)
This script scours the internet for jobs. It hits ATS APIs, scrapes specific career portals, and falls back to deep Google/DuckDuckGo searches.
- **Why we have it:** To automatically find hundreds of job postings daily while bypassing anti-bot measures.
- **What it does:** It takes every new job it finds and appends it to `data/pipeline.md` as a pending checkbox (`- [ ]`).

### 2. The Filter & Launcher (`apply-assist.mjs`)
This script evaluates the raw jobs in `pipeline.md` and generates a 1-click HTML launcher so you can rapidly open the good jobs in your browser.
- **Why we have it:** You don't have time to manually open and read 500 job postings.
- **What it does:** It can either use a fast local keyword matcher, or it can read the approvals made by your AI agent. It then creates a batched HTML launcher and marks the processed jobs as Done (`[D]`).

---

## 🚀 The Workflows (How to use it)

You can run this system entirely locally (for free, using keywords), entirely with AI (for deep, nuanced filtering), or combine them for ultimate efficiency!

### Step 1: Scan for Jobs (Always the first step)
```bash
node search-scan.js --phase1
node search-scan.js --phase2
node search-scan.js --phase3
```
*Result: Your `data/pipeline.md` is populated with raw pending jobs `[ ]`.*

### Option A: The "Speed" Flow (No AI)
*Best for rapidly filtering hundreds of jobs using the strict rules in your `profile.yml`.*

1. **Pre-filter locally:**
   ```bash
   node apply-assist.mjs --filter-local
   ```
   *Checks your `profile.yml` keywords. Passed jobs become `[L]`, rejected become `[-]`.*

2. **Generate the Launcher:**
   ```bash
   node apply-assist.mjs --launch
   ```
   *Creates an HTML file where you can open the `[L]` jobs in batches of 10.*

### Option B: The "Nuance" Flow (AI Only)
*Best for deep reading of job descriptions when you have a small amount of high-quality leads.*

1. **Ask your AI Agent:**
   In your chat UI (Cursor, Antigravity, etc.), use the slash command or prompt:
   > `/career-ops evaluate the pending jobs in pipeline.md`
   
   *The AI reads the URLs, compares them against your profile, and marks the good ones as `[x]`.*

2. **Generate the Launcher:**
   ```bash
   node apply-assist.mjs --launch
   ```
   *Creates the HTML launcher with the `[x]` jobs.*

### Option C: The "Hybrid" Flow (Ultimate Efficiency)
*Use the local keyword filter to narrow down the junk, then use the AI to find the perfect matches.*

1. **Scan:** `node search-scan.js --phase3` (Finds 500 URLs -> `[ ]`)
2. **Pre-filter:** `node apply-assist.mjs --filter-local` (Narrows down to 50 URLs -> `[L]`)
3. **AI Evaluate:** Ask your agent to review the 50 `[L]` jobs. It approves 10 -> `[x]`.
4. **Launch:** `node apply-assist.mjs --launch` (Adds the 10 perfect matches to the launcher -> `[D]`).

---

## 📜 Complete Command Reference

### Discovery Commands
- `node search-scan.js --phase1` : Scans standard ATS APIs (Lever, Greenhouse, etc).
- `node search-scan.js --phase2` : Scrapes direct job portals using Scrapling.
- `node search-scan.js --phase3` : Performs fallback web searches (Serper/DuckDuckGo).
- `npm run scan:all` : Runs all configured scanners.

### Evaluation Commands
- `node apply-assist.mjs --filter-local` : Evaluates `[ ]` pending jobs locally using keyword matching. Updates state to `[L]` (pass) or `[-]` (fail).
- `/career-ops` : Wakes up the AI agent to evaluate `[ ]` or `[L]` jobs and mark them `[x]`.

### Launcher Commands
- `node apply-assist.mjs --launch` : Collects all `[L]` and `[x]` jobs, adds them to `launcher-<date>.html` in batches of 10, and updates their state to `[D]` (Done).

## 📍 Strict India-Remote Filtering

The system is fully autonomous regarding location.
1. **Auto-Profile Reading**: The scanner automatically reads your `location.country` from `config/profile.yml`.
2. **Strict Filtering**: It excludes "US Only" or "Europe Only" roles, even if labeled "Remote".
3. **Targeted Search**: It only keeps roles that are explicitly open to India-resident candidates (Remote-India, APAC, or Global Remote).
