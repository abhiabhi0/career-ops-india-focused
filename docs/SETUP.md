# ⚙️ Complete Setup & Configuration Guide

This guide covers everything required to set up the **Career-Ops** pipeline from scratch. Follow these steps to install the system dependencies, configure your job-seeking profile, set up API integrations, and verify your installation.

---

## 📋 Prerequisites

Before starting, ensure you have the following installed on your system:
* **Node.js**: Version 18.x or later (Node 20+ recommended)
* **Python**: Version 3.10 or later (with `venv` and `pip`)
* **Git**: To clone the repository and manage version control
* **Google Chrome / Chromium**: Installed on your system (optional but recommended; Playwright will download its own local copy)

---

## 🛠️ Step-by-Step Installation

### 1. Clone the Repository
Clone the repository and navigate to the project root directory:
```bash
git clone https://github.com/abhiabhi0/career-ops-india-focused.git
cd career-ops-india-focused
```

### 2. Install Node.js Dependencies & Playwright
Install the core Node packages and set up Playwright's headless Chromium browser. Chromium is required for HTML-to-PDF CV generation (Phase 5/6) and for rendering JS-heavy sites during scans (Phase 3).
```bash
npm install
npx playwright install --with-deps chromium
```

### 3. Set Up Python Virtual Environment
Some phases of the pipeline rely on Python libraries for scraping and dataset processing:
* **Phase 2 (Scrapling)**: Uses a Python-based stealthy browser scraper to bypass Cloudflare and other scraping protections on careers pages.
* **Phase 4 (Open Job Data)**: Processes large compressed Parquet datasets from Hugging Face.

Create a virtual environment named `.venv-scrapling` and install the required dependencies:
```bash
# Create the virtual environment
python3 -m venv .venv-scrapling

# Upgrade pip
.venv-scrapling/bin/pip install --upgrade pip

# Install Scrapling with stealth fetchers
.venv-scrapling/bin/pip install "scrapling[fetchers]"

# Install data processing packages for Open Job Data (Phase 4)
.venv-scrapling/bin/pip install pandas pyarrow huggingface_hub fsspec
```

---

## 🔑 Environment Variables & API Keys (`.env`)

The project uses a `.env` file in the root directory to store credentials, paths, and scraper settings.

Copy the provided example file to create your `.env` configuration:
```bash
cp .env.example .env
```

### The Serper API Key (`SERPER_API_KEY`)

The most important environment variable to configure is the **Serper API Key**.

#### What is Serper?
[Serper.dev](https://serper.dev) is a fast, cost-effective, and reliable API wrapper for Google Search.

#### Why do we need it?
In **Phase 3 (Search Queries)** of the job scanner, the script queries search engines (like Google) with tailored search strings (e.g., `site:jobs.ashbyhq.com "Golang" "remote"`).
* **Without Serper**: The script falls back to automated browser scraping of Google via Playwright. However, Google detects automated headless traffic almost immediately, triggering **CAPTCHAs** that block the execution.
* **With Serper**: The scanner queries the Serper REST endpoint. This bypasses all anti-bot mechanisms, returns search results in a clean JSON format, and ensures the scanner completes successfully without manual intervention.

If `SERPER_API_KEY` is not present, the scanner will attempt to use browser-based Google queries, automatically falling back to DuckDuckGo if blocked.

#### How to get a free key:
1. Go to [serper.dev](https://serper.dev) and sign up for a free account.
2. Upon registration, you will receive **2,500 free queries**, which is extremely generous and will easily last for several months of job hunting.
3. Copy your API key from the dashboard.
4. Add it to your `.env` file:
   ```env
   SERPER_API_KEY=your_copied_api_key_here
   ```

### Other Environment Variables

| Variable | Type | Description | Default |
| :--- | :--- | :--- | :--- |
| `SERPER_API_KEY` | String | API key from serper.dev (recommended for Phase 3). | *None* |
| `SCRAPLING_PYTHON` | Path | Custom path to your python executable if you want to override the default `.venv-scrapling/bin/python`. | *Calculated* |
| `SCRAPLING_CHROMIUM_PATH` | Path | Override the browser binary path used by Python's Scrapling library. | *Calculated* |
| `PYDOLL_CHROMIUM_PATH` | Path | Same as `SCRAPLING_CHROMIUM_PATH`, specific to the PyDoll fetcher package. | *Calculated* |
| `SCRAPLING_FETCHER` | String | Scrapling fetcher type. Set to `stealthy` to use py-stealth elements, or `playwright` for simple requests. | `playwright` |
| `SCRAPLING_MAX_PAGES` | Integer | Limit the number of pages scraped per company careers portal in Phase 2. | `50` |
| `CAREER_OPS_ALLOW_DEP_INSTALL`| `0` / `1` | Allows the self-updater script (`update-system.mjs`) to run `npm install` automatically if set to `1`. | `0` |

---

## ⚙️ Configuration Files

To make the system yours, customize the two main configuration templates.

### 1. Profile Configuration (`config/profile.yml`)
The profile configuration is the **single source of truth** for your career goals, experience, and search filters. Copy the template and edit it:
```bash
cp config/profile.example.yml config/profile.yml
```

Open `config/profile.yml` and personalize the fields. Pay close attention to:
* **`target_roles`**: List the exact job titles you are targeting. These are interpolated into Phase 3 search queries.
* **`job_criteria.allowed_titles`**: Keywords that **must** be present in a job title for it to be accepted (e.g., `golang`, `backend`).
* **`job_criteria.allowed_locations`**: Locations you want to filter for (e.g., `remote`, `india`, `apac`). The scanner automatically excludes roles not matching these locations.
* **`job_criteria.blocked_phrases`**: Negative keywords that will automatically skip a job (e.g., `frontend`, `java`, `dotnet`).

### 2. Portals Configuration (`portals.yml`)
Configure which company portals to scrape and what queries to search. Copy the template:
```bash
cp templates/portals.example.yml portals.yml
```

Open `portals.yml` and configure:
* **`tracked_companies`**: Add the careers page URLs of companies you want to track directly in Phase 1 & 2.
* **`search_queries`**: Define the search engine query templates for Phase 3. Use placeholders like `{roles}`, `{skills}`, or `{locations}` to dynamically build queries using your `profile.yml` setup.

---

## 🔍 Verifying the Setup

After finishing the steps above, run the verification scripts to check that the configurations match and the pipelines are intact:

### 1. Check Profile Sync
Runs a sanity check to verify that your `cv.md` (which should contain your CV) matches the configuration in `config/profile.yml`:
```bash
node cv-sync-check.mjs
```

### 2. Verify Pipeline Files
Ensures that files like `data/pipeline.md` and `data/applications.md` are formatted properly and don't contain any syntax errors:
```bash
node verify-pipeline.mjs
```

### 3. Test the Scanners (Dry Run)
Perform a **dry run** of the job scanner. A dry run executes the phases, checks your configuration, and fetches jobs, but **does not write** any modifications to `data/pipeline.md` or `data/scan-history.tsv`. This is perfect for verifying your setup without messing up your tracking lists.
```bash
node search-scan.js --dry-run
```

If the dry run finishes without throwing errors, your setup is **100% complete and working!**

---

## 🚀 How to Run the Scanner

Once verified, you can run the scanner to find new jobs:

```bash
# Run all configured phases (API, Portals, Search Engine, Open Job Data)
npm run scan:all

# Run only Phase 1 (ATS APIs - Greenhouse/Lever/Ashby)
npm run scan:api

# Run only Phase 2 (Direct company portals scraping via Scrapling)
npm run scan:portals

# Run only Phase 3 (Google/DuckDuckGo URL collection)
npm run scan:search

# Run only Phase 4 (Open Job Data Hugging Face feed scanning)
npm run scan:openjobdata
```
