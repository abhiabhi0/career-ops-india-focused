#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { basename, resolve } from 'path';
import { chromium } from 'playwright';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const yaml = require('js-yaml');

const ROOT = process.cwd();
const PIPELINE_PATH = resolve(ROOT, 'data/pipeline.md');
const PROFILE_PATH = resolve(ROOT, 'config/profile.yml');
const RESUME_PDF_PATH = resolve(ROOT, 'resume.pdf');
const APPLICATIONS_DIR = resolve(ROOT, 'applications');
const IRRELEVANT_ROLE_PHRASES = [
  'repair engineer',
  'structural design engineer',
  'labware lims',
  'salesforce',
  'sap btp',
];

const BLOCKED_PAGE_PHRASES = [
  'access denied',
  "you don't have permission",
  'captcha',
  'forbidden',
  '403',
];

function slugify(text = '') {
  return (text || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 100);
}

function loadProfile() {
  if (!existsSync(PROFILE_PATH)) return null;
  return yaml.load(readFileSync(PROFILE_PATH, 'utf-8'));
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function ensureDir(path) {
  mkdirSync(path, { recursive: true });
}

// ── Pipeline line parser ─────────────────────────────────────────────────

/**
 * Parse the trailing portion of a pipeline line after the URL.
 * Format: " | company | title" or " | company | title | location"
 * Returns { title, location } where title includes company prefix for display.
 */
function parsePipelineFields(trailingText) {
  const raw = (trailingText || '').trim();
  // Split on ' | ' to get fields: [company, title, location?]
  const parts = raw.split(/\s*\|\s*/).filter(Boolean);
  
  if (parts.length >= 3) {
    // Has company, title, and location
    const company = parts[0].trim();
    const title = parts[1].trim();
    const location = parts.slice(2).join(' | ').trim();
    return { title: `${company} | ${title}`, location };
  } else if (parts.length === 2) {
    // Has company and title, no location
    const company = parts[0].trim();
    const title = parts[1].trim();
    return { title: `${company} | ${title}`, location: '' };
  } else {
    // Fallback: treat entire text as title
    return { title: raw, location: '' };
  }
}

// ── Search URLs Evaluation & Launcher Generation ─────────────────────────

function evaluateJobTitle(title, criteria) {
  const content = (title || '').toLowerCase();
  
  if (!criteria) return true; // Fallback if criteria not defined

  // Quick filter to ensure it's not totally irrelevant
  const blocked = criteria.blocked_phrases || IRRELEVANT_ROLE_PHRASES;
  if (blocked.some(phrase => content.includes(phrase.toLowerCase()))) {
    return false;
  }
  
  const allowed = criteria.allowed_titles || [];
  if (allowed.length === 0) return true;
  
  return allowed.some(k => k.toLowerCase() === 'go' ? /\bgo\b/.test(content) : content.includes(k.toLowerCase()));
}

function evaluatePageText(pageText, criteria) {
  const content = (pageText || '').toLowerCase();
  
  if (!criteria) return true;

  const blocked = criteria.blocked_phrases || IRRELEVANT_ROLE_PHRASES;
  if (blocked.some(phrase => content.includes(phrase.toLowerCase()))) {
    return false;
  }
  
  const skills = criteria.required_skills || [];
  if (skills.length > 0) {
    const hasSkill = skills.some(k => k.toLowerCase() === 'go' ? /\bgo\b/.test(content) : content.includes(k.toLowerCase()));
    if (!hasSkill) return false;
  }

  const locations = criteria.allowed_locations || [];
  if (locations.length > 0) {
    // Lenient check: Only block if it EXPLICITLY mentions US ONLY or similar without mentioning an allowed location
    const hasLocation = locations.some(k => content.includes(k.toLowerCase()));
    // If it mentions "us only" or "uk only" but doesn't mention our allowed locations, block it
    if (!hasLocation && (content.includes("us only") || content.includes("uk only") || content.includes("remote - us") || content.includes("remote - usa"))) {
      return false;
    }
    // Otherwise we leniantly accept it
  }

  // Experience parsing
  if (criteria.experience) {
    const minExp = criteria.experience.min_years || 0;
    const maxExp = criteria.experience.max_years || 99;
    
    // Look for "X years", "X+ years", "X-Y years"
    const expRegex = /(\d+)(?:\+|-(\d+))?\s+years?/g;
    let match;
    let foundExp = false;
    let expPassed = false;
    
    while ((match = expRegex.exec(content)) !== null) {
      foundExp = true;
      const lowerBound = parseInt(match[1], 10);
      const upperBound = match[2] ? parseInt(match[2], 10) : lowerBound;
      
      // If the required range overlaps with the profile range, it passes
      if (lowerBound <= maxExp && upperBound >= minExp) {
        expPassed = true;
        break;
      }
    }
    
    if (foundExp && !expPassed) {
      return false; // Found experience requirements, but none matched our range
    }
  }
  
  return true;
}

function generateLauncherHtml(passedUrls) {
  const batchSize = 10;
  const batches = [];
  
  for (let i = 0; i < passedUrls.length; i += batchSize) {
    batches.push(passedUrls.slice(i, i + batchSize));
  }
  
  const batchesJson = JSON.stringify(batches.map(b => b.map(u => u.url)));
  
  let html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Job Application Launcher</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; max-width: 900px; margin: 40px auto; padding: 0 20px; color: #333; line-height: 1.6; }
    h1 { border-bottom: 2px solid #eaecef; padding-bottom: 10px; }
    .btn { display: inline-block; background-color: #2ea44f; color: white; padding: 10px 20px; text-decoration: none; border-radius: 6px; font-weight: bold; cursor: pointer; border: none; font-size: 16px; margin-bottom: 20px; }
    .btn:hover { background-color: #2c974b; }
    .btn-secondary { background-color: #f3f4f6; color: #24292e; border: 1px solid #d1d5da; margin-left: 10px; }
    .btn-secondary:hover { background-color: #e1e4e8; }
    .btn-small { padding: 5px 10px; font-size: 13px; margin-left: auto; }
    .batch-card { border: 1px solid #e1e4e8; border-radius: 6px; margin-bottom: 20px; overflow: hidden; }
    .batch-header { background-color: #f6f8fa; padding: 10px 15px; border-bottom: 1px solid #e1e4e8; display: flex; align-items: center; }
    .batch-header input[type="checkbox"] { margin-right: 10px; transform: scale(1.2); cursor: pointer; }
    .batch-header label { cursor: pointer; user-select: none; }
    .links-list { list-style-type: none; padding: 15px; margin: 0; }
    .links-list li { margin-bottom: 8px; padding-bottom: 8px; border-bottom: 1px solid #eaecef; }
    .links-list li:last-child { margin-bottom: 0; padding-bottom: 0; border-bottom: none; }
    .links-list a { color: #0366d6; text-decoration: none; font-weight: 500; }
    .links-list a:hover { text-decoration: underline; }
    .location { display: inline-block; font-size: 12px; color: #586069; background: #f1f3f5; border-radius: 12px; padding: 2px 10px; margin-left: 8px; vertical-align: middle; }
    .location::before { content: '📍 '; }
    .controls { margin-bottom: 20px; display: flex; align-items: center; flex-wrap: wrap; }
  </style>
</head>
<body>
  <h1>Job Application Launcher (${todayIso()})</h1>
  <p>Found ${passedUrls.length} jobs matching your criteria.</p>
  
  <div class="controls">
    <button class="btn" id="openSelectedBtn">Open Selected Batches</button>
    <button class="btn btn-secondary" id="selectAllBtn">Select All</button>
    <button class="btn btn-secondary" id="deselectAllBtn">Deselect All</button>
  </div>
  
  <div id="batches-container">
`;

  batches.forEach((batch, batchIdx) => {
    const startIdx = batchIdx * batchSize + 1;
    const endIdx = startIdx + batch.length - 1;
    
    html += `
    <div class="batch-card">
      <div class="batch-header">
        <input type="checkbox" class="batch-checkbox" value="${batchIdx}" id="batch-${batchIdx}" checked>
        <label for="batch-${batchIdx}"><strong>Batch ${batchIdx + 1}</strong> (Jobs ${startIdx} - ${endIdx})</label>
        <button class="btn btn-secondary btn-small" onclick="openBatch(${batchIdx})">Open Just Batch ${batchIdx + 1}</button>
      </div>
      <ul class="links-list">
`;
    
    batch.forEach((u, i) => {
      const globalIdx = startIdx + i;
      const locBadge = u.location ? ` <span class="location">${u.location}</span>` : '';
      html += `        <li><a href="${u.url}" target="_blank" rel="noopener noreferrer">${globalIdx}. ${u.title || u.url}</a>${locBadge}</li>\n`;
    });
    
    html += `      </ul>
    </div>\n`;
  });

  html += `
  </div>

  <script>
    const batches = ${batchesJson};
    
    function openUrls(urlsToOpen) {
      if (urlsToOpen.length === 0) {
        alert("No batches selected!");
        return;
      }
      if (urlsToOpen.length > 50) {
        if (!confirm(\`You are about to open \${urlsToOpen.length} tabs at once. This might freeze your browser. Continue?\`)) {
          return;
        }
      }
      
      let delay = 0;
      urlsToOpen.forEach(url => {
        setTimeout(() => {
          window.open(url, '_blank');
        }, delay);
        delay += 500; // stagger to prevent popup blockers
      });
    }

    function openBatch(idx) {
      openUrls(batches[idx]);
    }

    document.getElementById('openSelectedBtn').addEventListener('click', () => {
      const checkboxes = document.querySelectorAll('.batch-checkbox:checked');
      let urlsToOpen = [];
      checkboxes.forEach(cb => {
        const idx = parseInt(cb.value, 10);
        urlsToOpen = urlsToOpen.concat(batches[idx]);
      });
      openUrls(urlsToOpen);
    });
    
    document.getElementById('selectAllBtn').addEventListener('click', () => {
      document.querySelectorAll('.batch-checkbox').forEach(cb => cb.checked = true);
    });
    
    document.getElementById('deselectAllBtn').addEventListener('click', () => {
      document.querySelectorAll('.batch-checkbox').forEach(cb => cb.checked = false);
    });
  </script>
</body>
</html>`;

  return html;
}

async function evaluateLocalPipeline(candidates, profile, headed) {
  let browser = null;
  let page = null;
  const passedItems = [];
  const failedItems = [];
  
  if (candidates.length > 0) {
    browser = await chromium.launch({ headless: !headed });
    page = await browser.newPage();
  }
  
  try {
    for (let i = 0; i < candidates.length; i++) {
      const item = candidates[i];
      process.stdout.write(`  [${i+1}/${candidates.length}] ${item.title.substring(0, 50)}... `);
      
      // Step 1: Quick Title Filter
      if (item.title && !evaluateJobTitle(item.title, profile.job_criteria)) {
        console.log('SKIP (Title mismatch)');
        failedItems.push(item);
        continue;
      }
      
      // Step 2: Page Content Filter
      try {
        await page.goto(item.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        const content = await page.evaluate(() => document.body?.innerText || '');
        
        if (evaluatePageText(content, profile.job_criteria)) {
          passedItems.push(item);
          console.log('PASS');
        } else {
          console.log('SKIP (Criteria mismatch)');
          failedItems.push(item);
        }
      } catch (err) {
        console.log(`ERROR (${err.message})`);
        // Include if title passed but page failed to load
        if (evaluateJobTitle(item.title, profile.job_criteria)) {
          passedItems.push(item);
        } else {
          failedItems.push(item);
        }
      }
    }
  } finally {
    if (browser) await browser.close();
  }
  
  return { passedItems, failedItems };
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const headed = args.has('--headed');
  const profile = loadProfile();

  if (!args.has('--filter-local') && !args.has('--launch')) {
    console.log('Please specify a mode:');
    console.log('  --filter-local  (Evaluates pending jobs [-] and marks them [L] or [-])');
    console.log('  --launch        (Adds [L] and [x] jobs to launcher and marks them [D])');
    return;
  }

  const PIPELINE_PATH = resolve(ROOT, 'data/pipeline.md');
  if (!existsSync(PIPELINE_PATH)) {
    console.log('No data/pipeline.md found.');
    return;
  }
  
  const text = readFileSync(PIPELINE_PATH, 'utf-8');
  const lines = text.split('\n');
  
  const pending = [];
  const localPassed = [];
  const aiPassed = [];
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    
    // Parse pipeline format: - [X] URL | company | title | location
    // - [ ]
    let m = line.match(/^- \[ \] (https?:\/\/\S+)(.*)/);
    if (m) {
      const { title, location } = parsePipelineFields(m[2]);
      pending.push({ url: m[1], lineIndex: i, title, location });
      continue;
    }
    
    // - [L]
    m = line.match(/^- \[L\] (https?:\/\/\S+)(.*)/);
    if (m) {
      const { title, location } = parsePipelineFields(m[2]);
      localPassed.push({ url: m[1], lineIndex: i, title, location });
      continue;
    }
    
    // - [x]
    m = line.match(/^- \[x\] (https?:\/\/\S+)(.*)/);
    if (m) {
      const { title, location } = parsePipelineFields(m[2]);
      aiPassed.push({ url: m[1], lineIndex: i, title, location });
      continue;
    }
  }

  ensureDir(APPLICATIONS_DIR);
  const launcherPath = resolve(APPLICATIONS_DIR, `launcher-${todayIso()}.html`);
  const existingLauncherUrls = [];
  
  if (existsSync(launcherPath)) {
    const oldHtml = readFileSync(launcherPath, 'utf-8');
    const aTagRegex = /<li><a href="(.*?)"[^>]*>\d+\.\s*(.*?)<\/a>(?:\s*<span class="location">(.*?)<\/span>)?<\/li>/g;
    let m;
    while ((m = aTagRegex.exec(oldHtml)) !== null) {
      existingLauncherUrls.push({ url: m[1], title: m[2], location: m[3] || '' });
    }
  }

  // 1. Local Keyword Filter
  if (args.has('--filter-local')) {
    if (pending.length === 0) {
      console.log('No pending [ ] jobs found in pipeline.md to evaluate.');
      return;
    }
    
    console.log(`\nEvaluating ${pending.length} pending URLs locally...\n`);
    const { passedItems, failedItems } = await evaluateLocalPipeline(pending, profile, headed);
    
    for (const item of passedItems) {
      lines[item.lineIndex] = lines[item.lineIndex].replace(/^- \[ \]/, '- [L]');
    }
    for (const item of failedItems) {
      lines[item.lineIndex] = lines[item.lineIndex].replace(/^- \[ \]/, '- [-]');
    }
    
    writeFileSync(PIPELINE_PATH, lines.join('\n'), 'utf-8');
    console.log(`\nUpdated pipeline.md: ${passedItems.length} passed [L], ${failedItems.length} rejected [-].`);
    return;
  }

  // 2. Generate Launcher
  if (args.has('--launch')) {
    let toLaunch = [...localPassed, ...aiPassed];
    let isPendingFallback = false;

    if (toLaunch.length === 0) {
      if (pending.length > 0) {
        toLaunch = [...pending];
        isPendingFallback = true;
        console.log('No approved [L] or [x] jobs found. Falling back to pending [ ] jobs.');
      } else {
        console.log('No approved [L], [x], or pending [ ] jobs found in pipeline.md to launch.');
        return;
      }
    } else {
      console.log(`Found ${localPassed.length} [L] jobs and ${aiPassed.length} [x] jobs.`);
    }
    
    const newItems = toLaunch.filter(a => !existingLauncherUrls.some(e => e.url === a.url));
    const passedUrls = [...existingLauncherUrls, ...newItems];
    
    if (passedUrls.length > 0) {
      writeFileSync(launcherPath, generateLauncherHtml(passedUrls), 'utf-8');
      console.log(`\n✅ Generated/Updated HTML Launcher with ${passedUrls.length} total valid jobs.`);
      console.log(`   ${launcherPath}`);
    }
    
    // Update statuses to [D]
    for (const item of toLaunch) {
      if (isPendingFallback) {
        lines[item.lineIndex] = lines[item.lineIndex].replace(/^- \[ \]/, '- [D]');
      } else {
        lines[item.lineIndex] = lines[item.lineIndex].replace(/^- \[[Lx]\]/, '- [D]');
      }
    }
    
    writeFileSync(PIPELINE_PATH, lines.join('\n'), 'utf-8');
    console.log('\nUpdated pipeline.md statuses to [D] (Done).');
    return;
  }
}

main().catch(error => {
  console.error(error.stack || error.message);
  process.exit(1);
});
