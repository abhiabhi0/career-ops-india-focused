#!/usr/bin/env node

/**
 * search-scan.js — Unified job scanner for career-ops
 *
 * Three-phase scanner:
 *   Phase 1 (API):      Fetches Greenhouse, Ashby, and Lever APIs directly.
 *   Phase 2 (Portals):  Scrapes tracked company career pages with Scrapling.
 *   Phase 3 (Search):   Collects URLs from search engines for search_queries.
 *
 * Zero AI tokens — pure HTTP + JSON + browser automation.
 *
 * Usage:
 *   node search-scan.js                   # full scan (all 3 phases)
 *   node search-scan.js --phase1          # Phase 1 only (API scan)
 *   node search-scan.js --phase2          # Phase 2 only (Scrapling portals)
 *   node search-scan.js --phase3          # Phase 3 only (search query URLs)
 *   node search-scan.js --phase1 --phase3 # combine specific phases
 *   node search-scan.js --dry-run         # preview, no file writes
 *   node search-scan.js --company Grafana # filter to one company (Phase 1+2)
 *   node search-scan.js --query "Golang"  # filter search queries by keyword
 *   node search-scan.js --limit 5         # limit Phase 3 queries to N
 *   node search-scan.js --num 20          # results per Phase 3 query (default 10)
 *   node search-scan.js --headed          # show the browser window (debug)
 *   node search-scan.js --engine ddg      # force DuckDuckGo for Phase 3
 *   node search-scan.js --apply-assist    # prepare application artifacts
 */

import { readFileSync, writeFileSync, appendFileSync, existsSync } from 'fs';
import { spawn } from 'child_process';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const ROOT_DIR = dirname(fileURLToPath(import.meta.url));

try { require('dotenv').config(); } catch { }
const yaml = require('js-yaml');

// ── Config ─────────────────────────────────────────────────────────────

const PORTALS_PATH    = 'portals.yml';
const SCAN_HISTORY    = 'data/scan-history.tsv';
const PIPELINE_PATH   = 'data/pipeline.md';
const APPLICATIONS    = 'data/applications.md';
const APPLY_ASSIST_SCRIPT = resolve(ROOT_DIR, 'apply-assist.mjs');

const API_CONCURRENCY  = 10;
const API_TIMEOUT_MS   = 10_000;
const SCRAPLING_DELAY_MS = 1200;
const SEARCH_DELAY_MS  = 3500;  // respectful delay between search queries
const DEFAULT_NUM      = 10;
const SCRAPLING_SCRIPT  = resolve(ROOT_DIR, 'scripts/scrapling-site-scrape.py');
const STEALTH_SEARCH_SCRIPT = resolve(ROOT_DIR, 'scripts/stealth-search.py');
const SCRAPLING_PYTHON  = resolve(ROOT_DIR, '.venv-scrapling/bin/python');

const PROFILE_PATH = 'config/profile.yml';

// ── Profile loading ────────────────────────────────────────────────────

function loadProfile() {
  if (!existsSync(PROFILE_PATH)) return null;
  try {
    return yaml.load(readFileSync(PROFILE_PATH, 'utf-8'));
  } catch (err) {
    console.error(`Warning: Failed to load profile: ${err.message}`);
    return null;
  }
}

// ── Process helpers ────────────────────────────────────────────────────

function detectScraplingPython() {
  if (process.env.SCRAPLING_PYTHON) return process.env.SCRAPLING_PYTHON;
  if (existsSync(SCRAPLING_PYTHON)) return SCRAPLING_PYTHON;
  return 'python3';
}

function runProcess(command, args, { input, env = {} } = {}) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, {
      cwd: ROOT_DIR,
      env: { ...process.env, ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', chunk => { stdout += chunk.toString(); });
    child.stderr.on('data', chunk => { stderr += chunk.toString(); });
    child.on('error', rejectPromise);
    child.on('close', code => resolvePromise({ code, stdout, stderr }));

    if (input) child.stdin.write(input);
    child.stdin.end();
  });
}

async function getPlaywrightChromiumPath() {
  const { chromium } = await import('playwright');
  return chromium.executablePath();
}

async function scrapeCareerSitesWithScrapling(targets, headed = false) {
  if (!targets.length) return { results: [] };
  if (!existsSync(SCRAPLING_SCRIPT)) {
    throw new Error(`Missing helper script: ${SCRAPLING_SCRIPT}`);
  }

  const python = detectScraplingPython();
  const chromiumPath =
    process.env.SCRAPLING_CHROMIUM_PATH ||
    process.env.PYDOLL_CHROMIUM_PATH ||
    await getPlaywrightChromiumPath();
  const payload = JSON.stringify({ targets });
  const args = [SCRAPLING_SCRIPT];
  if (headed) args.push('--headed');
  if ((process.env.SCRAPLING_FETCHER || '').toLowerCase() === 'stealthy') args.push('--stealthy');
  if (process.env.SCRAPLING_MAX_PAGES) args.push('--max-pages', process.env.SCRAPLING_MAX_PAGES);

  const { code, stdout, stderr } = await runProcess(python, args, {
    input: payload,
    env: { SCRAPLING_CHROMIUM_PATH: chromiumPath },
  });

  if (code !== 0) {
    const message = stderr.trim() || stdout.trim() || `Scrapling helper exited with code ${code}`;
    throw new Error(message);
  }

  try {
    return JSON.parse(stdout || '{"results":[]}');
  } catch (err) {
    throw new Error(`Could not parse Scrapling JSON output: ${err.message}`);
  }
}

async function runApplyAssist({ headed = false } = {}) {
  if (!existsSync(APPLY_ASSIST_SCRIPT)) {
    throw new Error(`Missing apply-assist script: ${APPLY_ASSIST_SCRIPT}`);
  }

  const args = [APPLY_ASSIST_SCRIPT];
  if (headed) args.push('--headed');
  const { code, stdout, stderr } = await runProcess('node', args);

  if (stdout.trim()) process.stdout.write(`${stdout.trim()}\n`);
  if (code !== 0) {
    throw new Error(stderr.trim() || `apply-assist exited with code ${code}`);
  }
}

async function searchGoogleStealthy(queries, num = 10, headed = false) {
  if (!existsSync(STEALTH_SEARCH_SCRIPT)) {
    throw new Error(`Missing helper script: ${STEALTH_SEARCH_SCRIPT}`);
  }

  const python = detectScraplingPython();
  const chromiumPath =
    process.env.SCRAPLING_CHROMIUM_PATH ||
    process.env.PYDOLL_CHROMIUM_PATH ||
    await getPlaywrightChromiumPath();

  const payload = JSON.stringify({ queries, num, headed });
  const args = [STEALTH_SEARCH_SCRIPT];
  if (headed) args.push('--headed');

  const { code, stdout, stderr } = await runProcess(python, args, {
    input: payload,
    env: { SCRAPLING_CHROMIUM_PATH: chromiumPath },
  });

  if (code !== 0) {
    const message = stderr.trim() || stdout.trim() || `stealth-search helper exited with code ${code}`;
    throw new Error(message);
  }

  try {
    return JSON.parse(stdout || '{"results":[]}');
  } catch (err) {
    throw new Error(`Could not parse stealth-search JSON output: ${err.message}`);
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Phase 1 — Direct API scanning (Greenhouse / Ashby / Lever)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// ── API detection ──────────────────────────────────────────────────────

function detectApi(company) {
  if (company.api && company.api.includes('greenhouse')) {
    return { type: 'greenhouse', url: company.api };
  }

  const url = company.careers_url || '';

  const ashbyMatch = url.match(/jobs\.ashbyhq\.com\/([^/?#]+)/);
  if (ashbyMatch) {
    return {
      type: 'ashby',
      url: `https://api.ashbyhq.com/posting-api/job-board/${ashbyMatch[1]}?includeCompensation=true`,
    };
  }

  const leverMatch = url.match(/jobs\.lever\.co\/([^/?#]+)/);
  if (leverMatch) {
    return {
      type: 'lever',
      url: `https://api.lever.co/v0/postings/${leverMatch[1]}`,
    };
  }

  const ghEuMatch = url.match(/job-boards(?:\.eu)?\.greenhouse\.io\/([^/?#]+)/);
  if (ghEuMatch && !company.api) {
    return {
      type: 'greenhouse',
      url: `https://boards-api.greenhouse.io/v1/boards/${ghEuMatch[1]}/jobs`,
    };
  }

  return null;
}

// ── API parsers ────────────────────────────────────────────────────────

function parseGreenhouse(json, companyName) {
  return (json.jobs || []).map(j => ({
    title: j.title || '',
    url: j.absolute_url || '',
    company: companyName,
    location: j.location?.name || '',
  }));
}

function parseAshby(json, companyName) {
  return (json.jobs || []).map(j => ({
    title: j.title || '',
    url: j.jobUrl || '',
    company: companyName,
    location: j.location || '',
  }));
}

function parseLever(json, companyName) {
  if (!Array.isArray(json)) return [];
  return json.map(j => ({
    title: j.text || '',
    url: j.hostedUrl || '',
    company: companyName,
    location: j.categories?.location || '',
  }));
}

const API_PARSERS = { greenhouse: parseGreenhouse, ashby: parseAshby, lever: parseLever };

// ── Fetch helpers ──────────────────────────────────────────────────────

async function fetchJson(url, timeoutMs = API_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

async function parallelFetch(tasks, limit) {
  const results = [];
  let i = 0;
  async function next() {
    while (i < tasks.length) {
      const task = tasks[i++];
      results.push(await task());
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, () => next()));
  return results;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Phase 2 — Scrapling: company career pages
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const JOB_URL_PATTERNS = [
  /jobs\.ashbyhq\.com\/[^/?#]+\/[a-f0-9-]{30,}/i,
  /job-boards\.greenhouse\.io\/[^/]+\/jobs\/\d+/i,
  /boards\.greenhouse\.io\/[^/]+\/jobs\/\d+/i,
  /jobs\.lever\.co\/[^/]+\/[a-f0-9-]{30,}/i,
  /wellfound\.com\/jobs\/\d+/i,
  /linkedin\.com\/jobs\/view\/\d+/i,
  /naukri\.com\/job-listings-[^?#]+/i,
  /instahyre\.com\/jobs\/[^?#]+/i,
  /cutshort\.io\/[^/]+\/[^?#]+/i,
  /workatastartup\.com\/jobs\/\d+/i,
  /ycombinator\.com\/companies\/[^/]+\/jobs\/[^?#]+/i,
  /remoteok\.com\/remote-jobs\/\d+/i,
  /weworkremotely\.com\/remote-jobs\/[^?#]+/i,
  /apply\.workable\.com\/[^/]+\/j\/[^/?#]+/i,
  /freshteam\.com\/jobs\/[^?#]+/i,
];

const GENERIC_JOB_PATH_HINTS = [
  '/job/', '/jobs/', '/career/', '/careers/', '/position/', '/positions/',
  '/opening/', '/openings/', '/opportunity/', '/opportunities/',
  '/vacancy/', '/vacancies/', '/role/', '/roles/',
  '/requisition/', '/requisitions/',
];

const GENERIC_TITLE_HINTS = [
  'engineer', 'developer', 'backend', 'platform', 'software',
  'golang', 'devops', 'sre', 'staff', 'principal', 'lead',
];

const LOCATION_HINTS = [
  'remote', 'india', 'apac', 'global', 'worldwide',
  'bangalore', 'bengaluru', 'mumbai', 'delhi', 'new delhi',
  'hyderabad', 'pune', 'chennai', 'gurgaon', 'noida',
  'ahmedabad', 'surat', 'vadodara', 'gujarat',
  'indore', 'bhopal', 'madhya pradesh',
  'nagpur', 'jaipur', 'rajasthan',
  'spain', 'europe', 'emea',
];

const IRRELEVANT_TITLE_PHRASES = [
  'repair engineer', 'structural design engineer', 'labware lims',
  'salesforce', 'sap btp', 'fullstack', 'full stack', 'frontend',
  'android', 'ios', 'qa engineer', 'manual test',
];

const NON_JOB_URL_PATTERNS = [
  /\/career\/.*\/salaries/i,
  /[?&]campaignid=serp-more/i,
  /\/hire\/remote-software-developers/i,
  /\/career\/[^/]+\/salaries/i,
];

const APPLY_HINTS = [
  'apply', 'apply now', 'easy apply', 'submit application',
  'job description', 'responsibilities', 'requirements', 'qualifications',
];

function isLikelyJobUrl(url, title = '', allowTitleOnly = false) {
  const lower = (url || '').toLowerCase();
  const titleLower = (title || '').toLowerCase();

  if (NON_JOB_URL_PATTERNS.some(pattern => pattern.test(url))) return false;
  if (JOB_URL_PATTERNS.some(p => p.test(url))) return true;
  if (GENERIC_JOB_PATH_HINTS.some(hint => lower.includes(hint)) && lower.split('/').length >= 5) {
    return true;
  }
  if (lower.includes('jobid=') || lower.includes('gh_jid=') || lower.includes('lever-via=')) {
    return true;
  }

  if (!allowTitleOnly) return false;

  try {
    const parsed = new URL(url);
    const path = parsed.pathname.toLowerCase();
    const pathSegments = path.split('/').filter(Boolean);
    const hasTitleHint = GENERIC_TITLE_HINTS.some(hint => titleLower.includes(hint));
    const looksLikeListingPage = lower.endsWith('/jobs') || lower.endsWith('/careers') || lower.endsWith('/positions');

    return hasTitleHint && pathSegments.length >= 2 && !looksLikeListingPage;
  } catch {
    return false;
  }
}

function classifyJobRelevance(job = {}) {
  const title = (job.title || job.rawTitle || '').toLowerCase();
  const url = (job.url || '').toLowerCase();
  const description = (job.description || '').toLowerCase();
  const company = (job.company || '').toLowerCase();
  const text = `${title} ${description} ${url} ${company}`.trim();

  if (!text) return { keep: false, reason: 'empty_job' };
  if (NON_JOB_URL_PATTERNS.some(pattern => pattern.test(url))) {
    return { keep: false, reason: 'non_job_url' };
  }
  if (IRRELEVANT_TITLE_PHRASES.some(phrase => title.includes(phrase))) {
    return { keep: false, reason: 'irrelevant_title' };
  }

  const positiveSignals = [
    'golang', 'go engineer', 'go developer', 'backend',
    'site reliability', 'sre', 'platform engineer', 'devops',
    'distributed systems', 'microservices',
  ];

  const applySignals = APPLY_HINTS.some(hint => text.includes(hint));
  const roleSignals = positiveSignals.some(signal => title.includes(signal) || description.includes(signal));

  if (!roleSignals) {
    return { keep: false, reason: 'missing_role_signal' };
  }

  if (!applySignals && !JOB_URL_PATTERNS.some(pattern => pattern.test(url))) {
    return { keep: false, reason: 'weak_job_signal' };
  }

  return { keep: true, reason: 'relevant' };
}

// ── Location Filtering ────────────────────────────────────────────────

function isLocationEligible(job, targetLoc = 'india') {
  const text = `${job.title} ${job.location} ${job.url} ${job.description || ''}`.toLowerCase();

  const negatives = [
    'us only', 'usa only', 'united states', 'uk only', 'united kingdom',
    'europe only', 'emea', 'americas', 'canada', 'germany', 'france',
    'london', 'new york', 'san francisco', 'north america', 'latam'
  ];

  const positives = [
    'india', 'bangalore', 'bengaluru', 'mumbai', 'delhi', 'hyderabad',
    'pune', 'chennai', 'gurgaon', 'noida', 'apac', 'global', 'worldwide', 'anywhere'
  ];

  const hasPositive = positives.some(p => text.includes(p));
  if (hasPositive) return true;

  const hasNegative = negatives.some(n => text.includes(n));
  if (hasNegative) return false;

  if (text.includes('remote') || text.includes('wfh')) return true;

  if (targetLoc && !text.includes(targetLoc.toLowerCase())) return false;

  return true;
}

// ── Location extraction from titles ───────────────────────────────────

function extractLocationFromTitle(title = '') {
  // Try to extract location from patterns like:
  //   "Senior Backend Engineer - Remote, India"
  //   "Software Engineer | Bangalore"
  //   "Go Developer @ Remote"
  //   "SDE II (Remote - India)"
  const locationKeywords = [
    'remote', 'india', 'apac', 'global', 'worldwide', 'anywhere',
    'bangalore', 'bengaluru', 'mumbai', 'delhi', 'new delhi',
    'hyderabad', 'pune', 'chennai', 'gurgaon', 'noida',
    'ahmedabad', 'surat', 'vadodara', 'gujarat',
    'indore', 'bhopal', 'madhya pradesh',
    'nagpur', 'jaipur', 'rajasthan',
    'kolkata', 'kochi', 'thiruvananthapuram',
    'europe', 'emea', 'spain', 'germany', 'france', 'uk',
    'us', 'usa', 'united states', 'canada',
    'singapore', 'japan', 'australia',
  ];

  // Try splitting on common delimiters: ' - ', ' | ', ' @ ', ' — ', ' – '
  const delimiters = [/ [\-\|@\u2013\u2014] /g];
  let parts = [title];
  for (const d of delimiters) {
    const newParts = [];
    for (const p of parts) newParts.push(...p.split(d));
    parts = newParts;
  }

  // Also check parenthesized content: "SDE II (Remote - India)"
  const parenMatch = title.match(/\(([^)]+)\)/);
  if (parenMatch) parts.push(parenMatch[1]);

  // Find parts that look like locations
  for (const part of parts.reverse()) {
    const lower = part.trim().toLowerCase();
    if (locationKeywords.some(kw => lower.includes(kw))) {
      // Don't return parts that look like job titles
      if (/engineer|developer|manager|lead|senior|junior|intern|architect/i.test(part)) continue;
      return part.trim();
    }
  }

  return '';
}

// ── Extract jobs from scraped results ──────────────────────────────────

function extractJobsFromScrape(searchResult, companyHint) {
  const results = searchResult?.web?.results || [];
  const jobs = [];

  for (const r of results) {
    const url = r.url || '';
    const title = r.title || '';
    const desc = r.description || '';

    const isJob = isLikelyJobUrl(url, title, true);
    if (!isJob) continue;

    const lower = url.toLowerCase();
    if (lower.endsWith('/jobs') || lower.endsWith('/careers') ||
      lower.endsWith('/positions') || lower.includes('?page=') || lower.includes('/search?')) continue;

    let company = companyHint;
    if (!company) {
      const ashby = url.match(/jobs\.ashbyhq\.com\/([^/?#]+)/);
      const lever = url.match(/jobs\.lever\.co\/([^/?#]+)/);
      const gh = url.match(/greenhouse\.io\/([^/?#]+)/);
      let host = '';
      try { host = new URL(url).hostname.replace('www.', ''); } catch { }
      company = ashby?.[1] || lever?.[1] || gh?.[1] || host.split('.')[0] || 'Unknown';
    }

    const cleanTitle = title.replace(/\s*[|\u2013\u2014].*$/, '').trim() || title;

    jobs.push({
      title: cleanTitle,
      rawTitle: title,
      url,
      company,
      location: r.location || '',
      description: desc
    });
  }
  return jobs;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Phase 3 — Search engine URL collection (Google / DuckDuckGo)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

let _browser = null;
let _page = null;

async function initBrowser(headed = false) {
  const { chromium } = await import('playwright');
  _browser = await chromium.launch({
    headless: !headed,
    args: [
      '--disable-blink-features=AutomationControlled',
      '--no-sandbox',
    ],
  });

  const userAgents = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
  ];
  const ua = userAgents[Math.floor(Math.random() * userAgents.length)];

  const context = await _browser.newContext({
    locale: 'en-IN',
    timezoneId: 'Asia/Kolkata',
    userAgent: ua,
    viewport: { width: 1280, height: 800 },
  });
  _page = await context.newPage();

  // Dismiss Google consent dialog if it appears
  try {
    await _page.goto('https://www.google.com', { waitUntil: 'domcontentloaded', timeout: 15000 });
    const consentBtn = await _page.$('button:has-text("Accept all"), button:has-text("I agree"), button:has-text("Agree"), #L2AGLb');
    if (consentBtn) {
      await consentBtn.click();
      await sleep(1000);
    }
  } catch {
    // Not fatal
  }
}

async function closeBrowser() {
  if (_browser) {
    await _browser.close();
    _browser = null;
    _page = null;
  }
}

async function googleSearch(query, count) {
  const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}&num=${count}&hl=en&gl=in`;
  await _page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });

  // Check for CAPTCHA
  const captcha = await _page.$('#captcha-form, #recaptcha, form[action*="sorry"]');
  if (captcha) throw new Error('Google CAPTCHA detected');

  try {
    await _page.waitForSelector('#search', { timeout: 8000 });
  } catch {
    const title = await _page.title();
    if (title.includes('Robot') || title.includes('CAPTCHA')) {
      throw new Error('Google CAPTCHA detected');
    }
    throw new Error(`Google results did not load. Page: "${title}"`);
  }

  const results = await _page.evaluate(() => {
    const items = [];
    const searchDiv = document.querySelector('#search');
    if (!searchDiv) return [];

    for (const a of searchDiv.querySelectorAll('a')) {
      const href = a.href;
      if (!href || href.includes('google.com') || href.startsWith('javascript:')) continue;

      const titleEl = a.querySelector('h3, h1, span[role="heading"], div[role="heading"]');
      const titleText = titleEl?.innerText.trim();
      if (!titleText) continue;

      items.push({ url: href, title: titleText });
    }
    return items;
  });

  if (results.length === 0) {
    const fallback = await _page.evaluate(() => {
      const items = [];
      for (const a of document.querySelectorAll('a')) {
        const h3 = a.querySelector('h3, h1, span[role="heading"]');
        if (!h3) continue;
        const href = a.href;
        if (!href || href.includes('google.com')) continue;
        items.push({ url: href, title: h3.innerText.trim() });
      }
      return items;
    });
    return fallback.slice(0, count);
  }

  return results.slice(0, count);
}

async function ddgSearch(query, count) {
  const searchUrl = `https://duckduckgo.com/?q=${encodeURIComponent(query)}&t=h_&ia=web`;
  await _page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });

  const blocked = await _page.evaluate(() => {
    const text = document.body.innerText.toLowerCase();
    return text.includes('too many requests') || text.includes('automated access') || text.includes('robot');
  });
  if (blocked) throw new Error('DuckDuckGo blocked');

  try {
    await _page.waitForSelector('.react-results--main, article, #links, .links_main', { timeout: 10000 });
  } catch {
    throw new Error('DuckDuckGo results did not load');
  }

  const results = await _page.evaluate(() => {
    const items = [];
    const links = document.querySelectorAll('a[data-testid="result-title-a"], h2 a, .result__a');
    for (const a of links) {
      const href = a.href;
      if (!href || href.includes('duckduckgo.com')) continue;
      const titleText = (a.querySelector('span') || a).innerText.trim();
      if (!titleText) continue;
      items.push({ url: href, title: titleText });
    }
    return items;
  });

  return results.slice(0, count);
}

async function serperSearch(query, count) {
  if (!process.env.SERPER_API_KEY) {
    throw new Error('SERPER_API_KEY is not set in .env');
  }

  const response = await fetch('https://google.serper.dev/search', {
    method: 'POST',
    headers: {
      'X-API-KEY': process.env.SERPER_API_KEY,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      q: query,
      num: count,
      gl: 'in' // India localization
    })
  });

  if (!response.ok) {
    throw new Error(`Serper API failed with status ${response.status}`);
  }

  const data = await response.json();
  const results = [];

  for (const r of data.organic || []) {
    if (!r.link || r.link.includes('google.com')) continue;
    results.push({ url: r.link, title: r.title || '' });
  }

  return results.slice(0, count);
}

async function searchEngine(query, count, engines) {
  let lastError = null;

  for (const engine of engines) {
    try {
      if (engine === 'serper') return await serperSearch(query, count);
      if (engine === 'google') return await googleSearch(query, count);
      if (engine === 'ddg') return await ddgSearch(query, count);
    } catch (err) {
      lastError = err;
      process.stdout.write(`\n    ⚠ ${engine.toUpperCase()} failed (${err.message}), trying next... `);
      await sleep(2000);
    }
  }

  throw new Error(`All engines failed: ${lastError?.message}`);
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Shared: Title filter, Dedup, Writers
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function buildTitleFilter(titleFilter) {
  const positive = (titleFilter?.positive || []).map(k => k.toLowerCase());
  const negative = (titleFilter?.negative || []).map(k => k.toLowerCase());
  return (title) => {
    const lower = (title || '').toLowerCase();
    const hasPositive = positive.length === 0 || positive.some(k => lower.includes(k));
    const hasNegative = negative.some(k => lower.includes(k));
    return hasPositive && !hasNegative;
  };
}

// ── Dedup ──────────────────────────────────────────────────────────────

function loadSeenUrls() {
  const seen = new Set();
  if (existsSync(SCAN_HISTORY)) {
    for (const line of readFileSync(SCAN_HISTORY, 'utf-8').split('\n').slice(1)) {
      const u = line.split('\t')[0]; if (u) seen.add(u);
    }
  }
  if (existsSync(PIPELINE_PATH)) {
    for (const m of readFileSync(PIPELINE_PATH, 'utf-8').matchAll(/- \[[ x]\] (https?:\/\/\S+)/g))
      seen.add(m[1]);
  }
  if (existsSync(APPLICATIONS)) {
    for (const m of readFileSync(APPLICATIONS, 'utf-8').matchAll(/https?:\/\/[^\s|)]+/g))
      seen.add(m[0]);
  }
  return seen;
}

function loadSeenCompanyRoles() {
  const seen = new Set();
  if (existsSync(APPLICATIONS)) {
    const text = readFileSync(APPLICATIONS, 'utf-8');
    for (const match of text.matchAll(/\|[^|]+\|[^|]+\|\s*([^|]+)\s*\|\s*([^|]+)\s*\|/g)) {
      const company = match[1].trim().toLowerCase();
      const role = match[2].trim().toLowerCase();
      if (company && role && company !== 'company') {
        seen.add(`${company}::${role}`);
      }
    }
  }
  return seen;
}

// ── Pipeline / scan-history writers ────────────────────────────────────

function appendToPipeline(offers) {
  if (!offers.length) return;
  let text = existsSync(PIPELINE_PATH)
    ? readFileSync(PIPELINE_PATH, 'utf-8')
    : '## Pendientes\n\n## Procesadas\n';

  const marker = '## Pendientes';
  const idx = text.indexOf(marker);
  const block = '\n' + offers.map(o =>
    `- [ ] ${o.url} | ${o.company} | ${o.title}${o.location ? ' | ' + o.location : ''}`
  ).join('\n') + '\n';

  if (idx === -1) {
    const at = text.indexOf('## Procesadas');
    const insertAt = at === -1 ? text.length : at;
    text = text.slice(0, insertAt) + '\n' + marker + '\n' + block + '\n' + text.slice(insertAt);
  } else {
    const after = idx + marker.length;
    const next = text.indexOf('\n## ', after);
    const insertAt = next === -1 ? text.length : next;
    text = text.slice(0, insertAt) + block + text.slice(insertAt);
  }
  writeFileSync(PIPELINE_PATH, text, 'utf-8');
}

function appendToScanHistory(offers, date) {
  if (!existsSync(SCAN_HISTORY))
    writeFileSync(SCAN_HISTORY, 'url\tfirst_seen\tportal\ttitle\tcompany\tstatus\n');
  appendFileSync(SCAN_HISTORY,
    offers.map(o => `${o.url}\t${date}\t${o.source}\t${o.title}\t${o.company}\tadded`).join('\n') + '\n'
  );
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Main
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

async function main() {
  const args = process.argv.slice(2);
  const dryRun      = args.includes('--dry-run');
  const headed      = args.includes('--headed');
  const applyAssist = args.includes('--apply-assist');
  const ci          = args.indexOf('--company');
  const qi          = args.indexOf('--query');
  const li          = args.indexOf('--limit');
  const ei          = args.indexOf('--engine');
  const ni          = args.indexOf('--num');
  const loi         = args.indexOf('--location');
  const filterCo    = ci !== -1 ? args[ci + 1]?.toLowerCase() : null;
  const qFilter     = qi !== -1 ? args[qi + 1]?.toLowerCase() : null;
  const limit       = li !== -1 ? parseInt(args[li + 1]) : Infinity;
  const engineFlag  = ei !== -1 ? args[ei + 1]?.toLowerCase() : null;
  const numResults  = ni !== -1 ? parseInt(args[ni + 1]) : DEFAULT_NUM;
  const locFilter   = loi !== -1 ? args[loi + 1]?.toLowerCase() : null;

  // Phase selection: --phase1, --phase2, --phase3
  // Also support legacy flags: --api-only, --site-only, --search-only
  const hasPhaseFlag = args.includes('--phase1') || args.includes('--phase2') || args.includes('--phase3');
  const hasLegacyFlag = args.includes('--api-only') || args.includes('--site-only') || args.includes('--search-only');

  let runPhase1, runPhase2, runPhase3;

  if (hasPhaseFlag) {
    // Explicit phase selection — run only specified phases
    runPhase1 = args.includes('--phase1');
    runPhase2 = args.includes('--phase2');
    runPhase3 = args.includes('--phase3');
  } else if (hasLegacyFlag) {
    // Legacy flags
    runPhase1 = args.includes('--api-only');
    runPhase2 = args.includes('--site-only');
    runPhase3 = args.includes('--search-only');
  } else {
    // No flags → run all phases
    runPhase1 = true;
    runPhase2 = true;
    runPhase3 = true;
  }

  if (!existsSync(PORTALS_PATH)) {
    console.error('Error: portals.yml not found. Run onboarding first.');
    process.exit(1);
  }

  const config = yaml.load(readFileSync(PORTALS_PATH, 'utf-8'));
  const profile = loadProfile();
  const titleFilter = buildTitleFilter(config.title_filter);
  const companies = config.tracked_companies || [];
  const date = new Date().toISOString().slice(0, 10);

  const activeLocFilter = locFilter || profile?.location?.country || 'india';

  // Load dedup sets (shared between all phases)
  const seenUrls = loadSeenUrls();
  const seenCompanyRoles = loadSeenCompanyRoles();

  if (dryRun) console.log('(dry run — no files will be written)\n');

  const allNewOffers = [];
  const allErrors = [];

  const phaseLabels = [];
  if (runPhase1) phaseLabels.push('Phase 1 (API)');
  if (runPhase2) phaseLabels.push('Phase 2 (Portals)');
  if (runPhase3) phaseLabels.push('Phase 3 (Search)');
  console.log(`\n  Running: ${phaseLabels.join(' + ')}\n`);

  // ── Phase 1: Direct API scan ────────────────────────────────────────

  let apiStats = { companies: 0, found: 0, filtered: 0, locFiltered: 0, dupes: 0, added: 0, skipped: 0 };

  if (runPhase1) {
    const apiTargets = companies
      .filter(c => c.enabled !== false)
      .filter(c => !filterCo || c.name?.toLowerCase().includes(filterCo))
      .map(c => ({ ...c, _api: detectApi(c) }))
      .filter(c => c._api !== null);

    apiStats.companies = apiTargets.length;
    apiStats.skipped = companies.filter(c => c.enabled !== false).length - apiTargets.length;

    console.log(`${'━'.repeat(60)}`);
    console.log(`Phase 1 — API Scan (Greenhouse / Ashby / Lever)`);
    console.log(`${'━'.repeat(60)}`);
    console.log(`Scanning ${apiTargets.length} companies via API (${apiStats.skipped} without API)\n`);

    const apiOffers = [];
    let apiProgress = 0;
    const tasks = apiTargets.map(company => async () => {
      const { type, url } = company._api;
      apiProgress++;
      process.stdout.write(`  [${apiProgress}/${apiTargets.length}] ${company.name} (${type}) → ${url.substring(0, 80)}${url.length > 80 ? '...' : ''} ... `);
      try {
        const json = await fetchJson(url);
        const jobs = API_PARSERS[type](json, company.name);
        apiStats.found += jobs.length;

        let companyAdded = 0;
        for (const job of jobs) {
          if (!titleFilter(job.title)) { apiStats.filtered++; continue; }

          if (!isLocationEligible(job, activeLocFilter)) {
            apiStats.locFiltered++;
            continue;
          }

          if (seenUrls.has(job.url)) { apiStats.dupes++; continue; }
          const key = `${job.company.toLowerCase()}::${job.title.toLowerCase()}`;
          if (seenCompanyRoles.has(key)) { apiStats.dupes++; continue; }
          seenUrls.add(job.url);
          seenCompanyRoles.add(key);
          apiOffers.push({ ...job, source: `${type}-api` });
          companyAdded++;
        }
        console.log(`${jobs.length} jobs, ${companyAdded} new`);
      } catch (err) {
        console.log(`ERROR: ${err.message}`);
        allErrors.push({ name: company.name, phase: 'Phase 1', error: err.message });
      }
    });

    await parallelFetch(tasks, API_CONCURRENCY);
    apiStats.added = apiOffers.length;

    console.log(`  Total jobs found  : ${apiStats.found}`);
    console.log(`  Filtered by title : ${apiStats.filtered} removed`);
    console.log(`  Filtered by loc   : ${apiStats.locFiltered} removed`);
    console.log(`  Duplicates        : ${apiStats.dupes} skipped`);
    console.log(`  New offers        : ${apiStats.added}`);

    if (apiOffers.length > 0) {
      console.log('\n  New from API:');
      for (const o of apiOffers) {
        console.log(`    + ${o.company} | ${o.title} | ${o.location || 'N/A'}`);
      }
    }

    allNewOffers.push(...apiOffers);
  }

  // ── Phase 2: Company portal scraping (Scrapling) ────────────────────

  let siteStats = {
    companies: 0, scanned: 0, found: 0, filtered: 0,
    relevanceFiltered: 0, locFiltered: 0, dupes: 0, added: 0, failed: 0,
  };

  if (runPhase2) {
    const websiteTargets = companies
      .filter(c => c.enabled !== false)
      .filter(c => !filterCo || c.name?.toLowerCase().includes(filterCo))
      .filter(c => c.careers_url);

    siteStats.companies = websiteTargets.length;

    console.log(`\n${'━'.repeat(60)}`);
    console.log('Phase 2 — Company Portals (Scrapling)');
    console.log(`${'━'.repeat(60)}`);
    console.log(`Scanning ${websiteTargets.length} company career pages\n`);

    if (websiteTargets.length === 0) {
      console.log('  No company career pages matched the current filters.');
    } else {
      process.stdout.write('  Launching Scrapling collector ... ');
      try {
        const siteBatch = await scrapeCareerSitesWithScrapling(
          websiteTargets.map(c => ({ name: c.name, url: c.careers_url })),
          headed,
        );
        console.log('OK');

        const siteOffers = [];
        for (const page of siteBatch.results || []) {
          siteStats.scanned++;
          const targetUrl = websiteTargets[siteStats.scanned - 1]?.careers_url || '';
          process.stdout.write(`  [${siteStats.scanned}/${websiteTargets.length}] ${page.name} → ${targetUrl.substring(0, 70)}${targetUrl.length > 70 ? '...' : ''} ... `);

          if (page.error) {
            siteStats.failed++;
            process.stdout.write(`ERROR: ${page.error}\n`);
            allErrors.push({ name: page.name, phase: 'Phase 2', error: page.error });
            continue;
          }

          const wrappedResults = {
            web: {
              results: (page.links || []).map(link => ({
                url: link.url || '',
                title: link.text || link.title || link.ariaLabel || '',
                description: [link.title, link.ariaLabel].filter(Boolean).join(' | '),
              })),
            },
          };

          const jobs = extractJobsFromScrape(wrappedResults, page.name);
          siteStats.found += jobs.length;

          let added = 0;
          for (const job of jobs) {
            const relevance = classifyJobRelevance(job);
            if (!relevance.keep) {
              siteStats.relevanceFiltered++;
              continue;
            }

            if (!titleFilter(job.title) && !titleFilter(job.rawTitle || '')) {
              siteStats.filtered++;
              continue;
            }

            if (!isLocationEligible(job, activeLocFilter)) {
              siteStats.locFiltered++;
              continue;
            }

            if (seenUrls.has(job.url)) {
              siteStats.dupes++;
              continue;
            }

            const key = `${job.company.toLowerCase()}::${job.title.toLowerCase()}`;
            if (seenCompanyRoles.has(key)) {
              siteStats.dupes++;
              continue;
            }

            seenUrls.add(job.url);
            seenCompanyRoles.add(key);
            siteOffers.push({ ...job, source: 'scrapling-site' });
            added++;
          }

          process.stdout.write(`${jobs.length} candidates, ${added} new\n`);
          if (siteStats.scanned < websiteTargets.length) await sleep(SCRAPLING_DELAY_MS);
        }

        siteStats.added = siteOffers.length;
        allNewOffers.push(...siteOffers);
      } catch (err) {
        console.log('FAILED');
        siteStats.failed = websiteTargets.length;
        allErrors.push({ name: 'scrapling', phase: 'Phase 2', error: err.message });
        console.log(`  Scrapling failed: ${err.message}`);
      }
    }
  }

  // ── Phase 3: Search query URL collection (Google / DDG) ─────────────

  let searchStats = { queries: 0, totalUrls: 0, uniqueUrls: 0, added: 0, errors: 0 };

  if (runPhase3) {
    const allQueries = (config.search_queries || []).filter(q => q.enabled !== false);

    let queries = allQueries;
    if (qFilter) {
      queries = queries.filter(q =>
        (q.query || '').toLowerCase().includes(qFilter) ||
        (q.name || '').toLowerCase().includes(qFilter)
      );
    }
    if (filterCo) {
      queries = queries.filter(q =>
        (q.name || '').toLowerCase().includes(filterCo)
      );
    }
    queries = queries.slice(0, limit);

    const total = queries.length;

    console.log(`\n${'━'.repeat(60)}`);
    console.log(`Phase 3 — Search Queries (Google → DDG fallback)`);
    console.log(`${'━'.repeat(60)}`);
    console.log(`  ${total} queries to run (${numResults} results each)\n`);

    if (total === 0) {
      console.log('  No search queries matched the current filters.');
    } else {
      const engines = engineFlag ? [engineFlag] : (process.env.SERPER_API_KEY ? ['serper', 'google', 'ddg'] : ['google', 'ddg']);
      const collectedUrls = [];  // { queryName, url, title }

      if (engines.includes('google') && !engines.includes('serper')) {
        process.stdout.write('  Launching Camoufox stealth browser ... ');
        try {
          const stealthBatch = await searchGoogleStealthy(
            queries.map(q => ({ name: q.name, query: q.query })),
            numResults,
            headed
          );
          console.log('OK\n');

          for (const res of stealthBatch.results || []) {
            searchStats.queries++;
            const matchQuery = queries.find(q => q.name === res.queryName);
            const queryStr = matchQuery ? ` "${matchQuery.query.substring(0, 60)}${matchQuery.query.length > 60 ? '...' : ''}"` : '';
            process.stdout.write(`  [${searchStats.queries}/${total}] ${res.queryName}${queryStr} (stealth) ... `);

            if (res.error) {
              searchStats.errors++;
              console.log(`ERROR: ${res.error}`);
              if (res.error.includes('CAPTCHA') || res.error.includes('block')) {
                console.log('\n  ⚠ Stealth browser detected/blocked. Stopping early.');
                break;
              }
              continue;
            }

            const urls = res.urls || [];
            searchStats.totalUrls += urls.length;
            for (const u of urls) {
              collectedUrls.push({ queryName: res.queryName, url: u.url, title: u.title });
            }
            console.log(`${urls.length} URLs`);
          }
        } catch (err) {
          console.log('FAILED');
          console.error(`  Could not run stealth search: ${err.message}`);
          console.error('  Falling back to DuckDuckGo if enabled...');
          if (!engines.includes('ddg')) engines.push('ddg'); // force DDG fallback if stealth crashes entirely
        }
      }

      // Handle Serper or DDG (API or Playwright)
      if (engines.includes('serper') || (engines.includes('ddg') && !engines.includes('google'))) {
        if (engines.includes('ddg') && !engines.includes('serper')) {
          process.stdout.write('  Launching Playwright browser ... ');
          try {
            await initBrowser(headed);
            console.log('OK\n');
          } catch (err) {
            console.log('FAILED');
            console.error(`  Could not launch browser: ${err.message}`);
            process.exit(1);
          }
        } else {
          console.log('  Using Serper.dev API for search queries\n');
        }

        let queried = 0;
        for (const q of queries) {
          queried++;
          const engineLabel = engines.filter(e => e !== 'google').join('/');
          process.stdout.write(`  [${queried}/${total}] ${q.name} "${q.query.substring(0, 60)}${q.query.length > 60 ? '...' : ''}" (${engineLabel}) ... `);

          try {
            const results = await searchEngine(q.query, numResults, engines.filter(e => e !== 'google'));
            searchStats.totalUrls += results.length;

            for (const r of results) {
              collectedUrls.push({
                queryName: q.name,
                url: r.url,
                title: r.title,
              });
            }

            console.log(`${results.length} URLs`);
          } catch (err) {
            searchStats.errors++;
            console.log(`ERROR: ${err.message}`);
            if (err.message.includes('blocked')) break;
          }
          if (queried < total) await sleep(SEARCH_DELAY_MS);
        }
        await closeBrowser();
        searchStats.queries = queried;
      }

      // Deduplicate collected URLs
      const seen = new Set();
      const uniqueResults = [];
      for (const entry of collectedUrls) {
        if (seen.has(entry.url)) continue;
        seen.add(entry.url);
        uniqueResults.push(entry);
      }
      searchStats.uniqueUrls = uniqueResults.length;

      // Apply title filter + dedup against pipeline to create offers
      const searchOffers = [];
      for (const entry of uniqueResults) {
        if (!isLikelyJobUrl(entry.url, entry.title, true)) continue;

        const lower = entry.url.toLowerCase();
        if (lower.endsWith('/jobs') || lower.endsWith('/careers') || lower.endsWith('/positions')) continue;

        let company = 'Unknown';
        const ashby = entry.url.match(/jobs\.ashbyhq\.com\/([^/?#]+)/);
        const lever = entry.url.match(/jobs\.lever\.co\/([^/?#]+)/);
        const gh = entry.url.match(/greenhouse\.io\/([^/?#]+)/);
        try { company = new URL(entry.url).hostname.replace('www.', '').split('.')[0]; } catch { }
        company = ashby?.[1] || lever?.[1] || gh?.[1] || company;

        const cleanTitle = entry.title.replace(/\s*[|\u2013\u2014].*$/, '').trim() || entry.title;

        if (!titleFilter(cleanTitle) && !titleFilter(entry.title)) continue;
        if (seenUrls.has(entry.url)) continue;

        const key = `${company.toLowerCase()}::${cleanTitle.toLowerCase()}`;
        if (seenCompanyRoles.has(key)) continue;

        seenUrls.add(entry.url);
        seenCompanyRoles.add(key);
        const extractedLocation = extractLocationFromTitle(entry.title);
        searchOffers.push({
          title: cleanTitle,
          rawTitle: entry.title,
          url: entry.url,
          company,
          location: extractedLocation,
          source: 'search-query',
        });
      }

      searchStats.added = searchOffers.length;
      allNewOffers.push(...searchOffers);

    }
  }

  // ── Write results ───────────────────────────────────────────────────

  if (!dryRun && allNewOffers.length > 0) {
    appendToPipeline(allNewOffers);
    appendToScanHistory(allNewOffers, date);
  }

  if (!dryRun && applyAssist) {
    console.log(`\n${'━'.repeat(60)}`);
    console.log('Apply Assist — Pipeline Prep');
    console.log(`${'━'.repeat(60)}`);
    console.log('Preparing pending pipeline jobs and stopping before final submission.\n');

    try {
      await runApplyAssist({ headed });
    } catch (err) {
      allErrors.push({ name: 'apply-assist', phase: 'assist', error: err.message });
      console.log(`  apply-assist failed: ${err.message}`);
    }
  }

  // ── Combined summary ────────────────────────────────────────────────

  console.log(`\n${'━'.repeat(60)}`);
  console.log(`Scan Summary — ${date}`);
  console.log(`${'━'.repeat(60)}`);

  if (runPhase1) {
    console.log(`\n  Phase 1 — API:`);
    console.log(`    Companies scanned  : ${apiStats.companies}`);
    console.log(`    Total jobs found   : ${apiStats.found}`);
    console.log(`    Filtered by title  : ${apiStats.filtered}`);
    console.log(`    Filtered by loc    : ${apiStats.locFiltered}`);
    console.log(`    Duplicates skipped : ${apiStats.dupes}`);
    console.log(`    New offers added   : ${apiStats.added}`);
  }

  if (runPhase2) {
    console.log(`\n  Phase 2 — Portals (Scrapling):`);
    console.log(`    Companies scanned  : ${siteStats.companies}`);
    console.log(`    Pages completed    : ${siteStats.scanned}`);
    console.log(`    Total candidates   : ${siteStats.found}`);
    console.log(`    Filtered by fit    : ${siteStats.relevanceFiltered}`);
    console.log(`    Filtered by title  : ${siteStats.filtered}`);
    console.log(`    Filtered by loc    : ${siteStats.locFiltered}`);
    console.log(`    Duplicates skipped : ${siteStats.dupes}`);
    console.log(`    Failed pages       : ${siteStats.failed}`);
    console.log(`    New offers added   : ${siteStats.added}`);
  }

  if (runPhase3) {
    console.log(`\n  Phase 3 — Search Queries:`);
    console.log(`    Queries processed  : ${searchStats.queries}`);
    console.log(`    Total URLs found   : ${searchStats.totalUrls}`);
    console.log(`    Unique URLs        : ${searchStats.uniqueUrls}`);
    console.log(`    New offers added   : ${searchStats.added}`);
    console.log(`    Errors             : ${searchStats.errors}`);
    if (!dryRun && searchStats.uniqueUrls > 0) {
      console.log(`    Raw URLs saved to  : data/search-urls.tsv`);
    }
  }

  if (allErrors.length > 0) {
    console.log(`\n  Errors (${allErrors.length}):`);
    for (const e of allErrors)
      console.log(`    ✗ [${e.phase}] ${e.name}: ${e.error}`);
  }

  console.log(`\n  ► Total new offers   : ${allNewOffers.length}`);

  if (allNewOffers.length > 0) {
    if (dryRun) {
      console.log('\n  (dry run — run without --dry-run to save results)');
    } else {
      console.log(`\n  Results saved to ${PIPELINE_PATH} and ${SCAN_HISTORY}`);
    }
  } else {
    console.log('\n  No new offers found.');
  }

  console.log(`\n→ Run /career-ops pipeline to evaluate new offers.`);
}

main().catch(async err => {
  await closeBrowser();
  console.error('Fatal:', err.stack || err.message);
  process.exit(1);
});
