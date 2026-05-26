#!/usr/bin/env node

/**
 * collect-urls.js — Collect raw search-result URLs for every search_query in portals.yml
 *
 * Fires each enabled search_query through Google (via Playwright) with DDG fallback.
 * Writes ALL result URLs (no filtering) to data/search-urls.tsv.
 *
 * Usage:
 *   node collect-urls.js                   # run all enabled queries
 *   node collect-urls.js --limit 5         # only first 5 queries
 *   node collect-urls.js --headed          # show browser window
 *   node collect-urls.js --query golang    # filter queries by keyword
 *   node collect-urls.js --num 20          # results per query (default 10)
 *   node collect-urls.js --output urls.tsv # custom output file
 *   node collect-urls.js --engine ddg      # force DuckDuckGo only
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { dirname } from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const ROOT_DIR = dirname(fileURLToPath(import.meta.url));
const yaml = require('js-yaml');

// ── Config ─────────────────────────────────────────────────────────────

const PORTALS_PATH = 'portals.yml';
const DEFAULT_OUTPUT = 'data/search-urls.tsv';
const DELAY_MS = 3500;  // respectful delay between queries
const DEFAULT_NUM = 10;

// ── CLI args ───────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const headed    = args.includes('--headed');
const li        = args.indexOf('--limit');
const qi        = args.indexOf('--query');
const ni        = args.indexOf('--num');
const oi        = args.indexOf('--output');
const ei        = args.indexOf('--engine');
const limit     = li !== -1 ? parseInt(args[li + 1]) : Infinity;
const qFilter   = qi !== -1 ? args[qi + 1]?.toLowerCase() : null;
const numResults = ni !== -1 ? parseInt(args[ni + 1]) : DEFAULT_NUM;
const outputPath = oi !== -1 ? args[oi + 1] : DEFAULT_OUTPUT;
const engineFlag = ei !== -1 ? args[ei + 1]?.toLowerCase() : null;

// ── Helpers ────────────────────────────────────────────────────────────

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ── Browser management ─────────────────────────────────────────────────

let _browser = null;
let _page = null;

async function initBrowser() {
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

// ── Google Search ──────────────────────────────────────────────────────

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

  // Extract all organic result URLs
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
    // Fallback extraction
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

// ── DuckDuckGo Search ──────────────────────────────────────────────────

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

// ── Unified search with fallback ───────────────────────────────────────

async function search(query, count, engines) {
  let lastError = null;

  for (const engine of engines) {
    try {
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

// ── Main ───────────────────────────────────────────────────────────────

async function main() {
  if (!existsSync(PORTALS_PATH)) {
    console.error('Error: portals.yml not found.');
    process.exit(1);
  }

  const config = yaml.load(readFileSync(PORTALS_PATH, 'utf-8'));
  const allQueries = (config.search_queries || []).filter(q => q.enabled !== false);

  // Apply keyword filter if provided
  let queries = allQueries;
  if (qFilter) {
    queries = queries.filter(q =>
      (q.query || '').toLowerCase().includes(qFilter) ||
      (q.name || '').toLowerCase().includes(qFilter)
    );
  }

  // Apply limit
  queries = queries.slice(0, limit);

  const total = queries.length;
  console.log(`\n${'━'.repeat(60)}`);
  console.log(`  URL Collector — ${total} search queries to process`);
  console.log(`  Results per query: ${numResults}`);
  console.log(`  Output: ${outputPath}`);
  console.log(`${'━'.repeat(60)}\n`);

  if (total === 0) {
    console.log('No queries matched. Check --query filter or portals.yml.');
    process.exit(0);
  }

  // Determine engine order
  const engines = engineFlag
    ? [engineFlag]
    : ['google', 'ddg'];

  // Launch browser
  process.stdout.write('  Launching browser ... ');
  try {
    await initBrowser();
    console.log('OK\n');
  } catch (err) {
    console.log('FAILED');
    console.error(`  Could not launch browser: ${err.message}`);
    console.error('  Run: npx playwright install chromium');
    process.exit(1);
  }

  // Collect URLs
  const allUrls = [];   // { queryName, url, title }
  let queried = 0;
  let totalUrls = 0;
  let errors = 0;

  for (const q of queries) {
    queried++;
    process.stdout.write(`  [${queried}/${total}] ${q.name} ... `);

    try {
      const results = await search(q.query, numResults, engines);
      const count = results.length;
      totalUrls += count;

      for (const r of results) {
        allUrls.push({
          queryName: q.name,
          url: r.url,
          title: r.title,
        });
      }

      console.log(`${count} URLs`);
    } catch (err) {
      errors++;
      console.log(`ERROR: ${err.message}`);

      if (err.message.includes('All engines failed')) {
        console.log('\n  ⚠ All search engines blocked. Stopping early.');
        console.log('    Tip: increase delay, reduce --limit, or try --engine ddg');
        break;
      }
    }

    if (queried < total) await sleep(DELAY_MS);
  }

  await closeBrowser();

  // Deduplicate by URL
  const seen = new Set();
  const unique = [];
  for (const entry of allUrls) {
    if (seen.has(entry.url)) continue;
    seen.add(entry.url);
    unique.push(entry);
  }

  // Write output
  if (unique.length > 0) {
    const header = 'url\ttitle\tquery_name\n';
    const rows = unique.map(e =>
      `${e.url}\t${(e.title || '').replace(/\t/g, ' ')}\t${e.queryName}`
    ).join('\n');

    writeFileSync(outputPath, header + rows + '\n', 'utf-8');
  }

  // Summary
  console.log(`\n${'━'.repeat(60)}`);
  console.log(`  Summary`);
  console.log(`${'━'.repeat(60)}`);
  console.log(`  Queries processed : ${queried}/${total}`);
  console.log(`  Total URLs found  : ${totalUrls}`);
  console.log(`  Unique URLs       : ${unique.length}`);
  console.log(`  Errors            : ${errors}`);
  console.log(`  Output file       : ${outputPath}`);
  console.log(`${'━'.repeat(60)}\n`);

  if (unique.length === 0) {
    console.log('  No URLs collected. Check if search engines are accessible.\n');
  } else {
    console.log(`  ✓ ${unique.length} URLs saved to ${outputPath}\n`);
  }
}

main().catch(async err => {
  await closeBrowser();
  console.error('Fatal:', err.stack || err.message);
  process.exit(1);
});
