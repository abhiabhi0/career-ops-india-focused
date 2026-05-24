#!/usr/bin/env node

/**
 * search-scan.js — Unified job scanner for career-ops
 *
 * Three-phase scanner:
 *   Phase 1 (API):      Fetches Greenhouse, Ashby, and Lever APIs directly.
 *   Phase 2 (Website):  Scrapes career sites and portal pages directly with Scrapling.
 *   Phase 3 (Search):   Uses search engines as fallback coverage.
 *
 * Zero AI tokens — pure HTTP + JSON + browser automation.
 *
 * Usage:
 *   node search-scan.js                   # full scan (API + Scrapling + search fallback)
 *   node search-scan.js --dry-run         # preview, no file writes
 *   node search-scan.js --api-only        # Phase 1 only (API scan)
 *   node search-scan.js --site-only       # Phase 2 only (direct Scrapling scraping)
 *   node search-scan.js --search-only     # Skip API, run website + search phases
 *   node search-scan.js --company Grafana # filter to one company
 *   node search-scan.js --query "Golang"  # filter search queries by keyword
 *   node search-scan.js --limit 5         # limit search queries to N
 *   node search-scan.js --posted 3d       # keep jobs posted within last 3 days (default: 1d)
 *   node search-scan.js --headed          # show the browser window (debug)
 *   node search-scan.js --apply-assist    # prepare application artifacts for pending pipeline jobs
 *
 * Search engine selection (Phase 3 fallback):
 *   • No config needed — uses Playwright + Google by default
 *   • If BRAVE_API_KEY is set in .env, uses Brave API instead (faster)
 *   • Force browser: --engine browser  (even if BRAVE_API_KEY is set)
 *   • Force Brave:   --engine brave
 */

import { readFileSync, writeFileSync, appendFileSync, existsSync } from 'fs';
import { spawn } from 'child_process';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import pLimit from 'p-limit';
import { runStealthSearch } from './src/stealth-search.mjs';
const require = createRequire(import.meta.url);
const ROOT_DIR = dirname(fileURLToPath(import.meta.url));

try { require('dotenv').config(); } catch { }
const yaml = require('js-yaml');

// ── Config ─────────────────────────────────────────────────────────────

const PORTALS_PATH = 'portals.yml';
const SCAN_HISTORY = 'data/scan-history.tsv';
const PIPELINE_PATH = 'data/pipeline.md';
const APPLICATIONS = 'data/applications.md';
const APPLY_ASSIST_SCRIPT = resolve(ROOT_DIR, 'apply-assist.mjs');

const API_CONCURRENCY = 10;
const API_TIMEOUT_MS = 10_000;
const BRAVE_API_KEY = process.env.BRAVE_API_KEY;
const BRAVE_API_URL = 'https://api.search.brave.com/res/v1/web/search';
const BRAVE_DELAY_MS = 1200;
const BRAVE_RESULTS = 10;
const BRAVE_TIMEOUT_MS = 12_000;
const SCRAPLING_DELAY_MS = 1200;
const BROWSER_DELAY_MS = 3000;  // be respectful to Google/DDG
const BROWSER_RESULTS = 10;
const SCRAPLING_SCRIPT = resolve(ROOT_DIR, 'scripts/scrapling-site-scrape.py');
const SCRAPLING_PYTHON = resolve(ROOT_DIR, '.venv-scrapling/bin/python');

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

function detectScraplingPython() {
  if (process.env.SCRAPLING_PYTHON) return process.env.SCRAPLING_PYTHON;
  if (existsSync(SCRAPLING_PYTHON)) return SCRAPLING_PYTHON;
  return 'python3';
}

function runProcess(command, args, { input, env = {}, onStdout, onStderr } = {}) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, {
      cwd: ROOT_DIR,
      env: { ...process.env, ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', chunk => {
      const text = chunk.toString();
      stdout += text;
      if (onStdout) onStdout(text);
    });
    child.stderr.on('data', chunk => {
      const text = chunk.toString();
      stderr += text;
      if (onStderr) onStderr(text);
    });
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
    onStderr: text => process.stdout.write(text),
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

function pickFirstValue(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && String(value).trim()) return value;
  }
  return '';
}

function parseGreenhouse(json, companyName) {
  return (json.jobs || []).map(j => ({
    title: j.title || '',
    url: j.absolute_url || '',
    company: companyName,
    location: j.location?.name || '',
    description: pickFirstValue(j.content, j.metadata?.map?.(m => m?.value).join(' ')),
    postedAt: pickFirstValue(j.updated_at, j.created_at),
  }));
}

function parseAshby(json, companyName) {
  return (json.jobs || []).map(j => ({
    title: j.title || '',
    url: j.jobUrl || '',
    company: companyName,
    location: j.location || '',
    description: pickFirstValue(j.descriptionPlain, j.descriptionHtml, j.teamName),
    postedAt: pickFirstValue(j.publishedDate, j.createdAt, j.updatedAt),
  }));
}

function parseLever(json, companyName) {
  if (!Array.isArray(json)) return [];
  return json.map(j => ({
    title: j.text || '',
    url: j.hostedUrl || '',
    company: companyName,
    location: j.categories?.location || '',
    description: pickFirstValue(j.descriptionPlain, j.description, j.categories?.team),
    postedAt: pickFirstValue(j.createdAt, j.updatedAt),
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
// Phase 2 — Web Search (Brave API or Playwright + Google)
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
  '/job/',
  '/jobs/',
  '/career/',
  '/careers/',
  '/position/',
  '/positions/',
  '/opening/',
  '/openings/',
  '/opportunity/',
  '/opportunities/',
  '/vacancy/',
  '/vacancies/',
  '/role/',
  '/roles/',
  '/requisition/',
  '/requisitions/',
];

const GENERIC_TITLE_HINTS = [
  'engineer',
  'developer',
  'backend',
  'platform',
  'software',
  'golang',
  'lead',
];

const LOCATION_HINTS = [
  'remote',
  'india',
  'apac',
  'global',
  'worldwide',
  'bangalore',
  'bengaluru',
  'mumbai',
  'delhi',
  'new delhi',
  'hyderabad',
  'pune',
  'chennai',
  'gurgaon',
  'noida',
  'ahmedabad',
  'surat',
  'vadodara',
  'gujarat',
  'indore',
  'bhopal',
  'madhya pradesh',
  'nagpur',
  'jaipur',
  'rajasthan',
  'spain',
  'europe',
  'emea',
];

const IRRELEVANT_TITLE_PHRASES = [
  'repair engineer',
  'structural design engineer',
  'labware lims',
  'salesforce',
  'sap btp',
  'fullstack',
  'full stack',
  'frontend',
  'android',
  'ios',
  'qa engineer',
  'manual test',
  'platform engineer',
  'site reliability',
  'sre',
  'devops',
  'cloud engineer',
  'infrastructure engineer',
  'systems engineer',
  'architect',
  'manager',
  'director',
  'vice president',
  'vp ',
  'head of',
  'principal',
  'staff ',
  'lead ',
];

const TARGET_TITLE_PHRASES = [
  'golang',
  'go developer',
  'go engineer',
  'backend engineer',
  'backend developer',
  'software engineer',
  'software developer',
  'server engineer',
  'api engineer',
];

const GO_PRIMARY_SIGNALS = [
  'golang',
  'go developer',
  'go engineer',
  'written in go',
  'go backend',
  'go lang',
  'language: go',
  'primary language: go',
  'go microservices',
  'go services',
  'go api',
  'grpc',
];

const SENIORITY_BLOCKLIST = [
  'staff',
  'principal',
  'lead',
  'manager',
  'director',
  'vice president',
  'vp ',
  'head of',
];

const EXPERIENCE_MIN_YEARS = 3;
const EXPERIENCE_MAX_YEARS = 7;
const DEFAULT_POSTED_WINDOW = '1d';

const NON_JOB_URL_PATTERNS = [
  /\/career\/.*\/salaries/i,
  /[?&]campaignid=serp-more/i,
  /\/hire\/remote-software-developers/i,
  /\/career\/[^/]+\/salaries/i,
];

const APPLY_HINTS = [
  'apply',
  'apply now',
  'easy apply',
  'submit application',
  'job description',
  'responsibilities',
  'requirements',
  'qualifications',
];

const SEARCH_PORTAL_HOSTS = {
  ashby: ['jobs.ashbyhq.com'],
  greenhouse: ['boards.greenhouse.io', 'job-boards.greenhouse.io'],
  lever: ['jobs.lever.co'],
  wellfound: ['wellfound.com'],
  linkedin: ['linkedin.com'],
  naukri: ['naukri.com'],
  instahyre: ['instahyre.com'],
  cutshort: ['cutshort.io'],
  workable: ['apply.workable.com'],
  freshteam: ['freshteam.com'],
  foundit: ['foundit.in', 'monsterindia.com'],
  shine: ['shine.com'],
  indeed: ['indeed.com', 'in.indeed.com'],
  remoteok: ['remoteok.com'],
  weworkremotely: ['weworkremotely.com'],
  workatastartup: ['workatastartup.com'],
  ycombinator: ['ycombinator.com'],
  arc: ['arc.dev'],
  turing: ['turing.com'],
  contra: ['contra.com'],
  crossover: ['crossover.com'],
  remoterocketship: ['remoterocketship.com'],
};

function normalizeHost(value = '') {
  return value
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .split('/')[0]
    .split('?')[0]
    .split('#')[0]
    .replace(/[),.'"]+$/g, '')
    .trim();
}

function hostMatchesAllowed(host, allowedHosts) {
  return allowedHosts.some(allowed => host === allowed || host.endsWith(`.${allowed}`));
}

function getAllowedHostsFromQuery(query = '') {
  query = query || '';
  const hosts = new Set();
  for (const match of query.matchAll(/\bsite:([^\s()]+)/gi)) {
    const host = normalizeHost(match[1]);
    if (host) hosts.add(host);
  }
  return [...hosts];
}

function getAllowedHostsFromFilter(filter = '') {
  const lower = (filter || '').toLowerCase().trim();
  if (!lower) return [];

  const hosts = new Set();
  for (const [alias, aliasHosts] of Object.entries(SEARCH_PORTAL_HOSTS)) {
    if (lower === alias || lower.includes(alias)) {
      for (const host of aliasHosts) hosts.add(host);
    }
  }

  if (lower.includes('.')) {
    const host = normalizeHost(lower);
    if (host) hosts.add(host);
  }

  return [...hosts];
}

function getAllowedHosts(query = '', filter = '') {
  return [...new Set([
    ...getAllowedHostsFromQuery(query),
    ...getAllowedHostsFromFilter(filter),
  ])];
}

function companyMatchesQueryFilter(company = {}, qFilter = '') {
  const lowerFilter = (qFilter || '').toLowerCase().trim();
  if (!lowerFilter) return true;

  const haystack = [
    company.name,
    company.careers_url,
    company.scan_query,
    company.notes,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  return haystack.includes(lowerFilter);
}

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
  if (SENIORITY_BLOCKLIST.some(phrase => title.includes(phrase))) {
    return { keep: false, reason: 'seniority_out_of_range' };
  }

  const applySignals = APPLY_HINTS.some(hint => text.includes(hint));
  const roleSignals = TARGET_TITLE_PHRASES.some(signal => title.includes(signal));
  const goSignals = GO_PRIMARY_SIGNALS.some(signal => title.includes(signal) || description.includes(signal));

  if (!roleSignals) {
    return { keep: false, reason: 'missing_role_signal' };
  }
  if (!goSignals) {
    return { keep: false, reason: 'missing_go_signal' };
  }

  const experienceRange = extractExperienceRange(text);
  if (experienceRange && !rangesOverlap(experienceRange.min, experienceRange.max, EXPERIENCE_MIN_YEARS, EXPERIENCE_MAX_YEARS)) {
    return { keep: false, reason: 'experience_out_of_range' };
  }

  if (!applySignals && !JOB_URL_PATTERNS.some(pattern => pattern.test(url))) {
    return { keep: false, reason: 'weak_job_signal' };
  }

  return { keep: true, reason: 'relevant' };
}

function extractExperienceRange(text = '') {
  const patterns = [
    /(\d+)\s*(?:-|–|to)\s*(\d+)\s*\+?\s*(?:years|yrs?)/i,
    /(\d+)\s*\+\s*(?:years|yrs?)/i,
    /(?:experience|exp)[^\d]{0,12}(\d+)\s*(?:-|–|to)\s*(\d+)/i,
    /(?:experience|exp)[^\d]{0,12}(\d+)\s*\+/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match) continue;
    if (match[2]) {
      const min = Number(match[1]);
      const max = Number(match[2]);
      if (Number.isFinite(min) && Number.isFinite(max)) return { min, max };
    } else {
      const min = Number(match[1]);
      if (Number.isFinite(min)) return { min, max: Infinity };
    }
  }

  return null;
}

function rangesOverlap(minA, maxA, minB, maxB) {
  return minA <= maxB && minB <= maxA;
}

function parsePostedWindow(input = DEFAULT_POSTED_WINDOW) {
  const value = String(input || DEFAULT_POSTED_WINDOW).trim().toLowerCase();
  const match = value.match(/^(\d+)\s*([dw])$/);
  if (!match) {
    throw new Error(`Invalid --posted value "${input}". Use formats like 1d, 3d, 7d, 1w.`);
  }

  const amount = Number(match[1]);
  const unit = match[2];
  const days = unit === 'w' ? amount * 7 : amount;
  if (!Number.isFinite(days) || days <= 0) {
    throw new Error(`Invalid --posted value "${input}". Days must be > 0.`);
  }

  return { raw: value, days };
}

function extractPostedAgeDays(text = '') {
  const lower = String(text || '').toLowerCase();
  if (!lower) return null;
  if (/\b(today|just posted|few hours ago|moments ago)\b/.test(lower)) return 0;
  if (/\byesterday\b/.test(lower)) return 1;

  const hourMatch = lower.match(/(\d+)\s*(?:h|hr|hrs|hour|hours)\s+ago/);
  if (hourMatch) return Number(hourMatch[1]) / 24;

  const dayMatch = lower.match(/(\d+)\s*(?:d|day|days)\s+ago/);
  if (dayMatch) return Number(dayMatch[1]);

  const weekMatch = lower.match(/(\d+)\s*(?:w|week|weeks)\s+ago/);
  if (weekMatch) return Number(weekMatch[1]) * 7;

  return null;
}

function extractPostedTimestampAgeDays(value) {
  if (!value) return null;
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) return null;
  return (Date.now() - timestamp.getTime()) / 86400000;
}

function getJobAgeDays(job = {}) {
  const timestampAge = extractPostedTimestampAgeDays(job.postedAt);
  if (timestampAge !== null) return timestampAge;

  return extractPostedAgeDays([
    job.postedText,
    job.title,
    job.rawTitle,
    job.description,
    job.location,
  ].filter(Boolean).join(' '));
}

function isPostedWithinWindow(job = {}, postedWindow = { days: 1 }) {
  const ageDays = getJobAgeDays(job);
  if (ageDays === null) return true;
  return ageDays <= postedWindow.days;
}

function urlMatchesAllowedHosts(url, allowedHosts) {
  if (!allowedHosts.length) return true;
  try {
    const host = normalizeHost(new URL(url).hostname);
    return hostMatchesAllowed(host, allowedHosts);
  } catch {
    return false;
  }
}

function makeQuerySpec(name, query, company, filter = '') {
  return {
    name,
    query,
    company,
    allowedHosts: getAllowedHosts(query, filter),
  };
}

function slugify(text = '') {
  return (text || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function normalizeQuerySpaces(text = '') {
  return (text || '').replace(/\s+/g, ' ').trim();
}

function uniqueValues(values = []) {
  const seen = new Set();
  const result = [];
  for (const value of values.map(item => normalizeQuerySpaces(item)).filter(Boolean)) {
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(value);
  }
  return result;
}

function extractQuotedTerms(query = '') {
  return [...query.matchAll(/"([^"]+)"/g)].map(match => normalizeQuerySpaces(match[1]));
}

function isLocationTerm(term = '') {
  const lower = term.toLowerCase();
  return LOCATION_HINTS.some(hint => lower.includes(hint));
}

function inferPortalSearchParams(query = '') {
  const quotedTerms = extractQuotedTerms(query);
  const roleTerms = quotedTerms.filter(term => !isLocationTerm(term));
  const locationTerms = quotedTerms.filter(term => isLocationTerm(term));
  const remote = /"remote"|remote from|global remote|work from anywhere|wfh/i.test(query);

  const fallback = normalizeQuerySpaces(
    query
      .replace(/\bsite:[^\s)]+/gi, ' ')
      .replace(/\b(OR|AND)\b/gi, ' ')
      .replace(/[()"]/g, ' ')
  );

  const keywords = normalizeQuerySpaces(
    (roleTerms.length ? roleTerms : [fallback])
      .filter(Boolean)
      .slice(0, 4)
      .join(' ')
  );

  const location = normalizeQuerySpaces(
    locationTerms.find(term => !/remote|global|worldwide/i.test(term)) ||
    (remote ? 'Remote' : locationTerms[0] || '')
  );

  return {
    keywords,
    location,
    remote,
  };
}

function buildProfileLocationTerms(profile = {}) {
  const terms = [];
  const location = profile.location || {};
  const compensation = profile.compensation || {};

  terms.push(location.country || '');
  terms.push(location.city || '');
  terms.push('remote');
  terms.push('work from anywhere');

  const freeform = [
    compensation.remote_policy,
    compensation.location_flexibility,
    location.preferred_eligibility,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  if (freeform.includes('india')) terms.push('Remote - India');
  if (freeform.includes('apac')) terms.push('APAC');
  if (freeform.includes('global')) terms.push('global remote');
  if (freeform.includes('worldwide')) terms.push('worldwide');

  return uniqueValues(terms);
}

function buildProfileSearchQueries(profile, qFilter = null) {
  if (!profile) return [];

  const roles = uniqueValues([
    ...(profile.target_roles?.primary || []),
    ...((profile.target_roles?.archetypes || []).map(archetype => archetype?.name || '')),
  ]).slice(0, 8);

  if (!roles.length) return [];

  const locationTerms = buildProfileLocationTerms(profile);
  const locationClause = locationTerms.map(term => `"${term}"`).join(' OR ') || '"remote"';
  const boardTemplates = [
    { label: 'Ashby', site: 'site:jobs.ashbyhq.com' },
    { label: 'Greenhouse', site: '(site:boards.greenhouse.io OR site:job-boards.greenhouse.io)' },
    { label: 'Lever', site: 'site:jobs.lever.co' },
    { label: 'Wellfound', site: 'site:wellfound.com/jobs' },
    { label: 'WorkAtAStartup', site: 'site:workatastartup.com/jobs' },
    { label: 'LinkedIn', site: 'site:linkedin.com/jobs/view' },
  ];

  const queries = [];
  for (const role of roles) {
    for (const board of boardTemplates) {
      const name = `Profile: ${role} @ ${board.label}`;
      const query = `${board.site} "${role}" (${locationClause})`;
      if (qFilter && !query.toLowerCase().includes(qFilter) && !name.toLowerCase().includes(qFilter)) continue;
      queries.push(makeQuerySpec(name, query, null, qFilter));
    }
  }

  return queries;
}

function detectPortalAlias(spec) {
  const hosts = spec.allowedHosts || [];
  for (const [alias, aliasHosts] of Object.entries(SEARCH_PORTAL_HOSTS)) {
    if (hosts.some(host => aliasHosts.includes(host))) return alias;
  }

  const query = (spec.query || '').toLowerCase();
  for (const alias of Object.keys(SEARCH_PORTAL_HOSTS)) {
    if (query.includes(alias)) return alias;
  }

  return null;
}

function buildPortalSearchUrl(alias, params, postedWindow = { days: 1 }) {
  const keywords = params.keywords || '';
  const location = params.location || '';
  const keywordSlug = slugify(keywords);
  const locationSlug = slugify(location);

  switch (alias) {
    case 'linkedin': {
      const url = new URL('https://www.linkedin.com/jobs/search/');
      if (keywords) url.searchParams.set('keywords', keywords);
      if (location) url.searchParams.set('location', location);
      url.searchParams.set('f_TPR', `r${postedWindow.days * 86400}`);
      return url.toString();
    }
    case 'naukri': {
      const url = new URL('https://www.naukri.com/jobs');
      if (keywords) url.searchParams.set('k', keywords);
      if (location) url.searchParams.set('l', location);
      return url.toString();
    }
    case 'indeed': {
      const url = new URL('https://in.indeed.com/jobs');
      if (keywords) url.searchParams.set('q', keywords);
      if (location) url.searchParams.set('l', location);
      url.searchParams.set('fromage', String(postedWindow.days));
      return url.toString();
    }
    case 'foundit': {
      const url = new URL('https://www.foundit.in/srp/results');
      if (keywords) url.searchParams.set('query', keywords);
      if (location) url.searchParams.set('locations', location);
      return url.toString();
    }
    case 'shine': {
      const url = new URL('https://www.shine.com/job-search/');
      if (keywords) url.searchParams.set('q', keywords);
      if (location) url.searchParams.set('loc', location);
      return url.toString();
    }
    case 'remoteok':
      return `https://remoteok.com/remote-${keywordSlug || 'developer'}-jobs`;
    case 'weworkremotely': {
      const url = new URL('https://weworkremotely.com/remote-jobs/search');
      if (keywords) url.searchParams.set('term', keywords);
      return url.toString();
    }
    case 'wellfound': {
      const url = new URL('https://wellfound.com/jobs');
      if (keywords) url.searchParams.set('query', keywords);
      if (location) url.searchParams.set('location', location);
      return url.toString();
    }
    case 'workatastartup': {
      const url = new URL('https://www.workatastartup.com/jobs');
      if (keywords) url.searchParams.set('query', keywords);
      return url.toString();
    }
    case 'ycombinator': {
      const url = new URL('https://www.ycombinator.com/jobs');
      if (keywords) url.searchParams.set('query', keywords);
      return url.toString();
    }
    case 'instahyre': {
      const url = new URL('https://www.instahyre.com/candidate/opportunities/');
      if (keywords) url.searchParams.set('search', keywords);
      return url.toString();
    }
    case 'cutshort': {
      if (keywordSlug) return `https://cutshort.io/jobs/${keywordSlug}`;
      return 'https://cutshort.io/jobs';
    }
    case 'arc': {
      const url = new URL('https://arc.dev/remote-jobs');
      if (keywords) url.searchParams.set('q', keywords);
      return url.toString();
    }
    case 'turing': {
      const url = new URL('https://www.turing.com/jobs');
      if (keywords) url.searchParams.set('search', keywords);
      return url.toString();
    }
    case 'contra': {
      const url = new URL('https://contra.com/opportunities');
      if (keywords) url.searchParams.set('search', keywords);
      return url.toString();
    }
    case 'crossover': {
      const url = new URL('https://www.crossover.com/jobs');
      if (keywords) url.searchParams.set('keywords', keywords);
      return url.toString();
    }
    default:
      return null;
  }
}

function buildPortalSearchTarget(spec, postedWindow = { days: 1 }) {
  const alias = detectPortalAlias(spec);
  if (!alias) return null;

  const params = inferPortalSearchParams(spec.query || '');
  if (!params.keywords) return null;

  const url = buildPortalSearchUrl(alias, params, postedWindow);
  if (!url) return null;

  return {
    key: spec.query,
    name: spec.name,
    company: spec.company,
    allowedHosts: spec.allowedHosts || [],
    alias,
    query: spec.query,
    url,
  };
}

// ── Brave Search (optional — needs BRAVE_API_KEY) ──────────────────────

async function braveSearch(query, count = BRAVE_RESULTS) {
  const url = new URL(BRAVE_API_URL);
  url.searchParams.set('q', query);
  url.searchParams.set('count', String(count));
  url.searchParams.set('search_lang', 'en');
  url.searchParams.set('country', 'IN');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), BRAVE_TIMEOUT_MS);
  try {
    const res = await fetch(url.toString(), {
      signal: controller.signal,
      headers: {
        'Accept': 'application/json',
        'Accept-Encoding': 'gzip',
        'X-Subscription-Token': BRAVE_API_KEY,
      },
    });
    if (!res.ok) throw new Error(`Brave API ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

// ── Scrapling Fallback ───────────────────────────────────────────────────

async function runScraplingFallback(query, engine) {
  let url = '';
  if (engine === 'google') {
    url = `https://www.google.com/search?q=${encodeURIComponent(query)}`;
  } else if (engine === 'ddg') {
    url = `https://duckduckgo.com/?q=${encodeURIComponent(query)}&t=h_&ia=web`;
  } else {
    throw new Error('Unsupported engine for fallback');
  }
  
  const result = await scrapeCareerSitesWithScrapling([{ name: 'fallback', url }]);
  const page = result.results?.[0] || {};
  if (page.error) throw new Error(page.error);
  
  return { web: { results: (page.links || []).map(l => ({ url: l.url, title: l.text || l.title || l.ariaLabel, description: '' })) } };
}

// ── Unified Search Wrapper (Cascading Fallback) ────────────────────────

async function unifiedSearch(query, engineList = ['google', 'ddg', 'brave'], postedWindow = { days: 1 }, options = {}) {
  const { STEALTH_SEARCH, headed } = options;
  let lastError = null;

  for (const engine of engineList) {
    try {
      if (engine === 'brave') {
        if (!BRAVE_API_KEY) throw new Error('No BRAVE_API_KEY set');
        return await braveSearch(query);
      }

      if (STEALTH_SEARCH) {
        try {
          const result = await runStealthSearch(query, { engine, headed, postedWindow });
          if (result && result.web && result.web.results && result.web.results.length > 0) {
            return result;
          }
          process.stdout.write(`\n  ⚠  ${engine.toUpperCase()} stealth returned empty. Trying Scrapling fallback... `);
          return await runScraplingFallback(query, engine);
        } catch (err) {
          if (err.code === 'CAPTCHA_DETECTED') {
            process.stdout.write(`\n  ⚠  ${engine.toUpperCase()} stealth hit CAPTCHA. Trying Scrapling fallback... `);
            return await runScraplingFallback(query, engine);
          }
          throw err;
        }
      } else {
        return await runScraplingFallback(query, engine);
      }
    } catch (err) {
      const msg = err.message.toLowerCase();
      const isBlock = msg.includes('captcha') ||
        msg.includes('rate limit') ||
        msg.includes('robot') ||
        msg.includes('blocked') ||
        msg.includes('did not load') ||
        msg.includes('too many requests') ||
        msg.includes('brave_api_key');

      if (isBlock) {
        process.stdout.write(`\n  ⚠  ${engine.toUpperCase()} blocked/failed. Trying next... `);
        lastError = err;
        await new Promise(r => setTimeout(r, 2000));
        continue;
      }
      throw err;
    }
  }

  throw new Error(`All engines failed. Last error: ${lastError?.message}`);
}


// ── Location Filtering ────────────────────────────────────────────────

function isLocationEligible(job, targetLoc = 'india') {
  const text = `${job.title} ${job.location} ${job.url} ${job.description || ''}`.toLowerCase();

  // 1. Explicit exclusion list (High priority)
  const negatives = [
    'us only', 'usa only', 'united states', 'uk only', 'united kingdom',
    'europe only', 'emea', 'americas', 'canada', 'germany', 'france',
    'london', 'new york', 'san francisco', 'north america', 'latam'
  ];

  // 2. Explicit inclusion list
  const positives = [
    'india', 'bangalore', 'bengaluru', 'mumbai', 'delhi', 'hyderabad',
    'pune', 'chennai', 'gurgaon', 'noida', 'apac', 'global', 'worldwide', 'anywhere'
  ];

  // If it mentions India or an Indian city, it's a strong keeper
  const hasPositive = positives.some(p => text.includes(p));
  if (hasPositive) return true;

  // If it contains an exclusion keyword and NO positive mention, skip it
  const hasNegative = negatives.some(n => text.includes(n));
  if (hasNegative) return false;

  // If it's just "Remote" without exclusion, we'll keep it as a "Global" candidate
  if (text.includes('remote') || text.includes('wfh')) return true;

  // If we have a targetLoc (like 'india') and it's not found anywhere, skip
  if (targetLoc && !text.includes(targetLoc.toLowerCase())) return false;

  return true;
}

// ── Extract jobs from search results (works with both engines) ─────────

function extractJobs(searchResult, companyHint, { directSite = false } = {}) {
  const results = searchResult?.web?.results || [];
  const jobs = [];

  for (const r of results) {
    const url = r.url || '';
    const title = r.title || '';
    const desc = r.description || '';
    const lower = url.toLowerCase();

    if (process.env.DEBUG_SCANNER) {
      console.log(`    [EXTRACT] Checking: ${title.slice(0, 30)}... URL: ${url}`);
    }

    const isJob = isLikelyJobUrl(url, title, directSite);
    if (!isJob) continue;

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
      description: desc,
      postedText: [title, desc].join(' ').trim(),
    });
  }
  return jobs;
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
  const STEALTH_SEARCH = !args.includes('--no-stealth-search');
  const SEARCH_CONCURRENCY = 4;
  const dryRun = args.includes('--dry-run');
  const apiOnly = args.includes('--api-only');
  const siteOnly = args.includes('--site-only');
  const searchOnly = args.includes('--search-only');
  const headed = args.includes('--headed');
  const ci = args.indexOf('--company');
  const qi = args.indexOf('--query');
  const li = args.indexOf('--limit');
  const ei = args.indexOf('--engine');
  const ri = args.indexOf('--raw-query');
  const loi = args.indexOf('--location');
  const poi = args.indexOf('--posted');
  const applyAssist = args.includes('--apply-assist');
  const filterCo = ci !== -1 ? args[ci + 1]?.toLowerCase() : null;
  const qFilter = qi !== -1 ? args[qi + 1]?.toLowerCase() : null;
  const limit = li !== -1 ? parseInt(args[li + 1]) : Infinity;
  const engineFlag = ei !== -1 ? args[ei + 1]?.toLowerCase() : null;
  const rawQuery = ri !== -1 ? args[ri + 1] : null;
  const locFilter = loi !== -1 ? args[loi + 1]?.toLowerCase() : null;
  const postedRaw = poi !== -1 ? args[poi + 1] : DEFAULT_POSTED_WINDOW;
  const queryOnlyMode = !!rawQuery;

  if (apiOnly && siteOnly) {
    console.error('Error: --api-only and --site-only cannot be combined.');
    process.exit(1);
  }

  if (!existsSync(PORTALS_PATH)) {
    console.error('Error: portals.yml not found. Run onboarding first.');
    process.exit(1);
  }

  const config = yaml.load(readFileSync(PORTALS_PATH, 'utf-8'));
  const profile = loadProfile();
  const postedWindow = parsePostedWindow(postedRaw);
  const titleFilter = buildTitleFilter(config.title_filter);
  const companies = config.tracked_companies || [];
  const date = new Date().toISOString().slice(0, 10);

  // Auto-detect location from profile if not provided via flag
  const activeLocFilter = locFilter || profile?.location?.country || 'india';
  const websiteTargets = queryOnlyMode
    ? []
    : companies
      .filter(c => c.enabled !== false)
      .filter(c => !filterCo || c.name?.toLowerCase().includes(filterCo))
      .filter(c => companyMatchesQueryFilter(c, qFilter))
      .filter(c => c.careers_url)
      .map(c => ({ ...c, _api: detectApi(c) }))
      .filter(c => c._api === null);

  // ── Build query list ────────────────────────────────────────────────

  const queries = [];

  if (rawQuery) {
    queries.push(makeQuerySpec('raw-query', rawQuery, null));
  } else {
    if (!filterCo) {
      queries.push(...buildProfileSearchQueries(profile, qFilter));
    }

    // 2. Fallback to portals.yml explicit queries if no profile or supplemental
    if (config.search_queries) {
      for (const q of config.search_queries) {
        if (q.enabled === false) continue;
        if (filterCo && !q.name?.toLowerCase().includes(filterCo)) continue;
        if (qFilter && !q.query?.toLowerCase().includes(qFilter) &&
          !q.name?.toLowerCase().includes(qFilter)) continue;
        queries.push(makeQuerySpec(q.name || 'query', q.query, null, qFilter));
      }
    }

    for (const c of companies) {
      if (c.enabled === false || c.scan_method !== 'websearch' || !c.scan_query) continue;
      if (filterCo && !c.name?.toLowerCase().includes(filterCo)) continue;
      if (qFilter && !(c.scan_query || '').toLowerCase().includes(qFilter) &&
        !c.name?.toLowerCase().includes(qFilter)) continue;
      queries.push(makeQuerySpec(c.name, c.scan_query, c.name, qFilter));
    }
  }

  // Deduplicate queries by query string
  const uniqueQueries = [];
  const seenQueries = new Set();
  for (const q of queries) {
    if (!seenQueries.has(q.query)) {
      seenQueries.add(q.query);
      uniqueQueries.push(q);
    }
  }

  const portalTargets = [];
  const seenPortalUrls = new Set();
  for (const spec of uniqueQueries) {
    const target = buildPortalSearchTarget(spec, postedWindow);
    if (!target || seenPortalUrls.has(target.url)) continue;
    seenPortalUrls.add(target.url);
    portalTargets.push(target);
  }

  // Load dedup sets (shared between both phases)
  const seenUrls = loadSeenUrls();
  const seenCompanyRoles = loadSeenCompanyRoles();

  if (dryRun) console.log('(dry run — no files will be written)\n');

  const allNewOffers = [];
  const allErrors = [];

  // ── Phase 1: Direct API scan ────────────────────────────────────────

  let apiStats = { companies: 0, found: 0, filtered: 0, locFiltered: 0, dupes: 0, added: 0, skipped: 0 };

  if (!searchOnly && !siteOnly && !queryOnlyMode) {
    const apiTargets = companies
      .filter(c => c.enabled !== false)
      .filter(c => !filterCo || c.name?.toLowerCase().includes(filterCo))
      .map(c => ({ ...c, _api: detectApi(c) }))
      .filter(c => c._api !== null);

    apiStats.companies = apiTargets.length;
    apiStats.skipped = companies.filter(c => c.enabled !== false).length - apiTargets.length;

    console.log(`\n${'━'.repeat(55)}`);
    console.log(`Phase 1 — API Scan (Greenhouse / Ashby / Lever)`);
    console.log(`${'━'.repeat(55)}`);
    console.log(`Scanning ${apiTargets.length} companies via API (${apiStats.skipped} skipped — no API detected)\n`);

    const apiOffers = [];
    const tasks = apiTargets.map(company => async () => {
      const { type, url } = company._api;
      try {
        const json = await fetchJson(url);
        const jobs = API_PARSERS[type](json, company.name);
        apiStats.found += jobs.length;

        for (const job of jobs) {
          const relevance = classifyJobRelevance(job);
          if (!relevance.keep) { apiStats.filtered++; continue; }
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
        }
      } catch (err) {
        allErrors.push({ name: company.name, phase: 'api', error: err.message });
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

  // ── Phase 2: Website scrape ────────────────────────────────────────

  let siteStats = {
    companies: websiteTargets.length,
    scanned: 0,
    found: 0,
    filtered: 0,
    relevanceFiltered: 0,
    locFiltered: 0,
    dupes: 0,
    added: 0,
    failed: 0,
  };
  let portalStats = {
    targets: portalTargets.length,
    scanned: 0,
    found: 0,
    filtered: 0,
    relevanceFiltered: 0,
    locFiltered: 0,
    siteFiltered: 0,
    dupes: 0,
    added: 0,
    failed: 0,
  };
  let searchStats = { queries: 0, found: 0, added: 0, locFiltered: 0, siteFiltered: 0, relevanceFiltered: 0 };
  const engineLabel = engineFlag || 'auto (Google -> DDG -> Brave)';
  const successfulPortalQueries = new Set();

  if (!apiOnly && !searchOnly) {
    console.log(`\n${'━'.repeat(55)}`);
    console.log('Phase 2 — Website Scrape (Scrapling)');
    console.log(`${'━'.repeat(55)}`);
    console.log(`Scanning ${websiteTargets.length} company career pages\n`);

    if (websiteTargets.length === 0) {
      console.log('  No direct career pages matched the current filters.');
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
          process.stdout.write(`  [${siteStats.scanned}/${websiteTargets.length}] ${page.name} ... `);

          if (page.error) {
            siteStats.failed++;
            process.stdout.write(`ERROR: ${page.error}\n`);
            allErrors.push({ name: page.name, phase: 'site', error: page.error });
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

          const jobs = extractJobs(wrappedResults, page.name, { directSite: true });
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

            if (dryRun) {
              console.log(`\n      [FOUND] ${job.company} | ${job.title}`);
              console.log(`      Link: ${job.url}`);
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
        allErrors.push({ name: 'scrapling', phase: 'site', error: err.message });
        console.log(`  Scrapling site scrape failed: ${err.message}`);
        console.log('  Continuing with search-query fallback only.\n');
      }
    }
  }

  if (!apiOnly && !searchOnly) {
    console.log(`\n${'━'.repeat(55)}`);
    console.log('Phase 2b — Portal Search Pages (Scrapling)');
    console.log(`${'━'.repeat(55)}`);
    console.log(`Scanning ${portalTargets.length} portal queries directly\n`);

    if (portalTargets.length === 0) {
      console.log('  No supported direct portal targets matched the current filters.');
    } else {
      process.stdout.write('  Launching portal collector ... ');
      try {
        const portalBatch = await scrapeCareerSitesWithScrapling(
          portalTargets.map(target => ({ name: target.name, url: target.url })),
          headed,
        );
        console.log('OK');

        const portalOffers = [];
        for (const [index, page] of (portalBatch.results || []).entries()) {
          const target = portalTargets[index];
          portalStats.scanned++;
          process.stdout.write(`  [${portalStats.scanned}/${portalTargets.length}] ${page.name} ... `);

          if (page.error) {
            portalStats.failed++;
            process.stdout.write(`ERROR: ${page.error}\n`);
            allErrors.push({ name: page.name, phase: 'portal', error: page.error });
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

          const jobs = extractJobs(wrappedResults, target.company || target.name, { directSite: true });
          portalStats.found += jobs.length;
          if (jobs.length > 0) successfulPortalQueries.add(target.key);

          let added = 0;
          for (const job of jobs) {
            if (!urlMatchesAllowedHosts(job.url, target.allowedHosts || [])) {
              portalStats.siteFiltered++;
              continue;
            }

            const relevance = classifyJobRelevance(job);
            if (!relevance.keep) {
              portalStats.relevanceFiltered++;
              continue;
            }

            if (!titleFilter(job.title) && !titleFilter(job.rawTitle || '')) {
              portalStats.filtered++;
              continue;
            }

            if (!isLocationEligible(job, activeLocFilter)) {
              portalStats.locFiltered++;
              continue;
            }

            if (seenUrls.has(job.url)) {
              portalStats.dupes++;
              continue;
            }

            const key = `${job.company.toLowerCase()}::${job.title.toLowerCase()}`;
            if (seenCompanyRoles.has(key)) {
              portalStats.dupes++;
              continue;
            }

            if (dryRun) {
              console.log(`\n      [FOUND] ${job.company} | ${job.title}`);
              console.log(`      Link: ${job.url}`);
            }

            seenUrls.add(job.url);
            seenCompanyRoles.add(key);
            portalOffers.push({ ...job, source: `scrapling-${target.alias}` });
            added++;
          }

          process.stdout.write(`${jobs.length} candidates, ${added} new\n`);
          if (portalStats.scanned < portalTargets.length) await sleep(SCRAPLING_DELAY_MS);
        }

        portalStats.added = portalOffers.length;
        allNewOffers.push(...portalOffers);
      } catch (err) {
        console.log('FAILED');
        portalStats.failed = portalTargets.length;
        allErrors.push({ name: 'portal-scrapling', phase: 'portal', error: err.message });
        console.log(`  portal scrape failed: ${err.message}`);
        console.log('  Continuing with search-engine fallback.\n');
      }
    }
  }

  // ── Phase 3: Web search fallback ───────────────────────────────────

  if (!apiOnly && !siteOnly) {
    console.log(`\n${'━'.repeat(55)}`);
    console.log(`Phase 3 — Search Fallback (${engineLabel})`);
    console.log(`${'━'.repeat(55)}`);

    const fallbackQueries = uniqueQueries.filter(spec => !successfulPortalQueries.has(spec.query));
    const total = Math.min(fallbackQueries.length, limit);
    console.log(`  ${total} queries to run\n`);

    if (total === 0) {
      console.log('  No search queries matched the current filters.');
    } else {
      const engineList = engineFlag === 'browser'
        ? ['google', 'ddg']
        : engineFlag
          ? [engineFlag]
          : ['google', 'ddg', 'brave'];
        const searchOffers = [];
        let queried = 0;
        
        const limitFunc = pLimit(SEARCH_CONCURRENCY);
        const tasks = fallbackQueries.slice(0, limit).map(spec => limitFunc(async () => {
          const { name, query, company, allowedHosts } = spec;
        queried++;
        process.stdout.write(`  [${queried}/${total}] ${name} ... `);
          try {
            const result = await unifiedSearch(query, engineList, postedWindow, { STEALTH_SEARCH, headed });

            const jobs = extractJobs(result, company);
          searchStats.found += jobs.length;
          let added = 0;
          for (const job of jobs) {
            if (!urlMatchesAllowedHosts(job.url, allowedHosts || [])) {
              searchStats.siteFiltered++;
              continue;
            }

            const relevance = classifyJobRelevance(job);
            if (!relevance.keep) {
              searchStats.relevanceFiltered++;
              continue;
            }

            if (!isLocationEligible(job, activeLocFilter)) {
              searchStats.locFiltered++;
              continue;
            }

            if (dryRun) {
              console.log(`\n      [FOUND] ${job.company} | ${job.title}`);
              console.log(`      Link: ${job.url}`);
              console.log(`      Loc : ${job.location || 'N/A'}`);
            }

            if (!titleFilter(job.title) && !titleFilter(job.rawTitle || '')) continue;
            if (seenUrls.has(job.url)) continue;
            const key = `${job.company.toLowerCase()}::${job.title.toLowerCase()}`;
            if (seenCompanyRoles.has(key)) continue;

            seenUrls.add(job.url);
            seenCompanyRoles.add(key);
            searchOffers.push({ ...job, source: 'web-search' });
            added++;
          }
          console.log(`${jobs.length} results, ${added} new`);
        } catch (err) {
          process.stdout.write(`ERROR: ${err.message}\n`);
          allErrors.push({ name, phase: 'search', error: err.message });

          if (err.message.includes('All engines failed')) {
            console.log(`\n  ⚠  Critical failure: ${err.message}.`);
            console.log('     Recommendation: Reduce --limit or try again later.');
            return;
          }
        }
        }));
        
        await Promise.all(tasks);

      searchStats.queries = queried;
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
    console.log(`\n${'━'.repeat(55)}`);
    console.log('Apply Assist — Pipeline Prep');
    console.log(`${'━'.repeat(55)}`);
    console.log('Preparing pending pipeline jobs and stopping before final submission.\n');

    try {
      await runApplyAssist({ headed });
    } catch (err) {
      allErrors.push({ name: 'apply-assist', phase: 'assist', error: err.message });
      console.log(`  apply-assist failed: ${err.message}`);
    }
  }

  // ── Combined summary ────────────────────────────────────────────────

  console.log(`\n${'━'.repeat(55)}`);
  console.log(`Combined Scan Summary — ${date}`);
  console.log(`${'━'.repeat(55)}`);

  if (!searchOnly && !siteOnly && !queryOnlyMode) {
    console.log(`\n  API scan:`);
    console.log(`    Companies scanned  : ${apiStats.companies}`);
    console.log(`    Total jobs found   : ${apiStats.found}`);
    console.log(`    Filtered by title : ${apiStats.filtered}`);
    console.log(`    Filtered by loc   : ${apiStats.locFiltered}`);
    console.log(`    Duplicates skipped : ${apiStats.dupes}`);
    console.log(`    New offers added   : ${apiStats.added}`);
  }

  if (!apiOnly && !searchOnly) {
    console.log(`\n  Website scrape (Scrapling):`);
    console.log(`    Companies scanned  : ${siteStats.companies}`);
    console.log(`    Pages completed    : ${siteStats.scanned}`);
    console.log(`    Total candidates   : ${siteStats.found}`);
    console.log(`    Filtered by fit    : ${siteStats.relevanceFiltered}`);
    console.log(`    Filtered by title  : ${siteStats.filtered}`);
    console.log(`    Filtered by loc    : ${siteStats.locFiltered}`);
    console.log(`    Duplicates skipped : ${siteStats.dupes}`);
    console.log(`    Failed pages       : ${siteStats.failed}`);
    console.log(`    New offers added   : ${siteStats.added}`);

    console.log(`\n  Portal pages (Scrapling):`);
    console.log(`    Targets scanned    : ${portalStats.targets}`);
    console.log(`    Pages completed    : ${portalStats.scanned}`);
    console.log(`    Total candidates   : ${portalStats.found}`);
    console.log(`    Filtered by site   : ${portalStats.siteFiltered}`);
    console.log(`    Filtered by fit    : ${portalStats.relevanceFiltered}`);
    console.log(`    Filtered by title  : ${portalStats.filtered}`);
    console.log(`    Filtered by loc    : ${portalStats.locFiltered}`);
    console.log(`    Duplicates skipped : ${portalStats.dupes}`);
    console.log(`    Failed pages       : ${portalStats.failed}`);
    console.log(`    New offers added   : ${portalStats.added}`);

  }

  if (!apiOnly && !siteOnly) {
    console.log(`\n  Search fallback (${engineLabel}):`);
    console.log(`    Queries run        : ${searchStats.queries}`);
    console.log(`    Total results      : ${searchStats.found}`);
    console.log(`    Filtered by site   : ${searchStats.siteFiltered}`);
    console.log(`    Filtered by fit    : ${searchStats.relevanceFiltered}`);
    console.log(`    Filtered by loc    : ${searchStats.locFiltered}`);
    console.log(`    New offers added   : ${searchStats.added}`);
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
