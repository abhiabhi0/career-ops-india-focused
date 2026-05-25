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

function parsePendingPipelineItems() {
  if (!existsSync(PIPELINE_PATH)) return [];
  const text = readFileSync(PIPELINE_PATH, 'utf-8');
  const pendingSection = text.split(/^## Procesadas$/m)[0] || text;
  const lines = pendingSection.split('\n');
  const items = [];

  for (const line of lines) {
    const match = line.match(/^- \[ \] (.+)$/);
    if (!match) continue;
    const parts = match[1].split('|').map(part => part.trim()).filter(Boolean);
    const [url, company = 'Unknown', role = 'Unknown Role', location = ''] = parts;
    items.push({ url, company, role, location, raw: line });
  }

  return items;
}

function batchName() {
  return `golang-jobs-${todayIso()}`;
}

function buildBatchReadmePath() {
  return resolve(APPLICATIONS_DIR, batchName(), 'README.md');
}

function ensureBatchReadme() {
  const path = buildBatchReadmePath();
  if (existsSync(path)) return path;
  ensureDir(resolve(APPLICATIONS_DIR, batchName()));
  writeFileSync(
    path,
    [
      '# Golang Jobs Application Tracker',
      '',
      'This file tracks application prep for current pipeline roles.',
      '',
      '## Application Status',
      '',
      '| Role | Company | Status | Resume | Answers | Notes |',
      '|---|---|---|---|---|---|',
      '',
    ].join('\n'),
    'utf-8'
  );
  return path;
}

function upsertBatchRow({ company, role, status, resumePath, answersPath, notes }) {
  const readmePath = ensureBatchReadme();
  const text = readFileSync(readmePath, 'utf-8');
  const lines = text.split('\n');
  const row = `| ${role} | ${company} | ${status} | ${resumePath} | ${answersPath} | ${notes} |`;
  const prefix = `| ${role} | ${company} |`;
  const index = lines.findIndex(line => line.startsWith(prefix));

  if (index !== -1) {
    lines[index] = row;
  } else {
    lines.push(row);
  }

  writeFileSync(readmePath, lines.join('\n'), 'utf-8');
}

function genericAnswers(profile, item) {
  const headline = profile?.narrative?.headline || '';
  const superpowers = profile?.narrative?.superpowers || [];
  const proofPoints = profile?.narrative?.proof_points || [];
  const compensation = profile?.compensation || {};
  const candidate = profile?.candidate || {};

  return `# Application Answers

## Why this role
I am targeting backend and distributed systems roles where I can contribute immediately with production Golang experience. ${headline}

## Why this company
${item.company} looks aligned with the kind of engineering work I am actively targeting: backend systems, scalable services, and ownership of production reliability.

## Relevant strengths
${superpowers.map(point => `- ${point}`).join('\n')}

## Proof points
${proofPoints.map(point => `- ${point.name}: ${point.metric || point.hero_metric || ''}`.trim()).join('\n')}

## Work authorization / location
- Current location: ${candidate.location || profile?.location?.city || ''}, ${profile?.location?.country || ''}
- Remote preference: ${compensation.remote_policy || compensation.location_flexibility || ''}

## Compensation
- Target range: ${compensation.target_range || ''}
- Minimum: ${compensation.minimum || ''}

## Resume used
- PDF: ${basename(RESUME_PDF_PATH)}
`;
}

function genericResumeMd(profile, item) {
  const candidate = profile?.candidate || {};
  const narrative = profile?.narrative || {};
  const roles = profile?.target_roles?.primary || [];

  return `# ${candidate.full_name || 'Candidate'}
**${item.role}** | ${item.company} | ${candidate.location || ''}

${candidate.github ? `GitHub: ${candidate.github}` : ''}
${candidate.linkedin ? `\nLinkedIn: ${candidate.linkedin}` : ''}
${candidate.email ? `\nEmail: ${candidate.email}` : ''}

## Summary
${narrative.headline || ''}

## Target role alignment
${roles.map(role => `- ${role}`).join('\n')}

## Why I fit this role
${(narrative.superpowers || []).map(point => `- ${point}`).join('\n')}

## Proof points
${(narrative.proof_points || []).map(point => `- ${point.name}: ${point.metric || point.hero_metric || ''}`.trim()).join('\n')}
`;
}

function validateJobTarget(item) {
  const text = `${item.company} ${item.role} ${item.url}`.toLowerCase();
  if (IRRELEVANT_ROLE_PHRASES.some(phrase => text.includes(phrase))) {
    return { ok: false, reason: 'blocked_irrelevant_role' };
  }
  if (/\/career\/.*\/salaries/i.test(item.url) || /[?&]campaignid=serp-more/i.test(item.url)) {
    return { ok: false, reason: 'blocked_non_job_url' };
  }
  return { ok: true, reason: 'valid_target' };
}

async function inspectApplyFlow(page, item) {
  await page.goto(item.url, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForTimeout(1500);

  const data = await page.evaluate(() => {
    const norm = value => (value || '').replace(/\s+/g, ' ').trim();
    const labels = Array.from(document.querySelectorAll('label')).map(el => norm(el.innerText)).filter(Boolean).slice(0, 30);
    const inputs = Array.from(document.querySelectorAll('input, textarea, select')).map(el => ({
      tag: el.tagName.toLowerCase(),
      type: (el.getAttribute('type') || '').toLowerCase(),
      name: el.getAttribute('name') || '',
      id: el.id || '',
      placeholder: el.getAttribute('placeholder') || '',
      required: el.required || false,
    })).slice(0, 50);
    const buttons = Array.from(document.querySelectorAll('button, a, input[type="submit"]')).map(el => norm(el.innerText || el.value || el.getAttribute('aria-label'))).filter(Boolean).slice(0, 30);
    return {
      title: document.title,
      labels,
      inputs,
      buttons,
      textSnippet: norm(document.body?.innerText || '').slice(0, 4000),
    };
  });

  let uploadAttempted = false;
  let uploadSucceeded = false;

  if (existsSync(RESUME_PDF_PATH)) {
    const fileInput = page.locator('input[type="file"]').first();
    if (await fileInput.count()) {
      uploadAttempted = true;
      try {
        await fileInput.setInputFiles(RESUME_PDF_PATH);
        uploadSucceeded = true;
      } catch {
        uploadSucceeded = false;
      }
    }
  }

  return {
    ...data,
    uploadAttempted,
    uploadSucceeded,
  };
}

function decideStatus(inspection) {
  const text = `${inspection.title || ''} ${inspection.textSnippet || ''}`.toLowerCase();
  if (BLOCKED_PAGE_PHRASES.some(phrase => text.includes(phrase))) {
    return 'Blocked (access denied)';
  }
  if (inspection.isMismatch) {
    return 'Blocked (irrelevant role)';
  }
  if (inspection.inputs.some(input => input.type === 'file') && inspection.uploadSucceeded) {
    return 'Not submitted (needs review)';
  }
  if (inspection.inputs.length > 0) {
    return 'Not submitted (needs form run)';
  }
  return 'Blocked (apply flow not detected)';
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
  const linksHtml = passedUrls.map((u, i) => 
    `<li><a href="${u.url}" target="_blank" rel="noopener noreferrer">${i+1}. ${u.title || u.url}</a></li>`
  ).join('\n');
  
  const urlsJson = JSON.stringify(passedUrls.map(u => u.url));
  
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Job Application Launcher</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; max-width: 800px; margin: 40px auto; padding: 0 20px; color: #333; line-height: 1.6; }
    h1 { border-bottom: 2px solid #eaecef; padding-bottom: 10px; }
    .btn { display: inline-block; background-color: #2ea44f; color: white; padding: 10px 20px; text-decoration: none; border-radius: 6px; font-weight: bold; cursor: pointer; border: none; font-size: 16px; margin-bottom: 20px; }
    .btn:hover { background-color: #2c974b; }
    .links-list { list-style-type: none; padding: 0; }
    .links-list li { margin-bottom: 10px; padding: 15px; border: 1px solid #e1e4e8; border-radius: 6px; }
    .links-list a { color: #0366d6; text-decoration: none; font-weight: 500; }
    .links-list a:hover { text-decoration: underline; }
  </style>
</head>
<body>
  <h1>Job Application Launcher (${todayIso()})</h1>
  <p>Found ${passedUrls.length} jobs matching your criteria.</p>
  
  <button class="btn" id="openAllBtn">Open All Links in New Tabs</button>
  
  <ul class="links-list">
    ${linksHtml}
  </ul>

  <script>
    const urls = ${urlsJson};
    document.getElementById('openAllBtn').addEventListener('click', () => {
      let delay = 0;
      urls.forEach(url => {
        setTimeout(() => {
          window.open(url, '_blank');
        }, delay);
        delay += 500; // stagger to prevent popup blockers
      });
    });
  </script>
</body>
</html>`;
}

async function handleSearchUrls({ profile, headed, limit, SEARCH_URLS_PATH }) {
  console.log(`\nEvaluating URLs for Launcher...\n`);
  
  const rawUrlsMap = new Map();
  
  // 1. Read Phase 3 URLs from search-urls.tsv
  if (existsSync(SEARCH_URLS_PATH)) {
    const text = readFileSync(SEARCH_URLS_PATH, 'utf-8');
    const lines = text.split('\n').filter(Boolean);
    for (const line of lines.slice(1)) {
      const [url, title, queryName] = line.split('\t');
      if (url && url.startsWith('http')) {
        rawUrlsMap.set(url, { url, title: title || '', queryName });
      }
    }
  }

  // 2. Read Phase 1 & 2 URLs from scan-history.tsv for today
  const SCAN_HISTORY_PATH = resolve(ROOT, 'data/scan-history.tsv');
  if (existsSync(SCAN_HISTORY_PATH)) {
    const today = todayIso();
    const text = readFileSync(SCAN_HISTORY_PATH, 'utf-8');
    const lines = text.split('\n').filter(Boolean);
    for (const line of lines.slice(1)) {
      const [url, date, source, title] = line.split('\t');
      if (date === today && source !== 'search-query' && source !== 'web-search' && url && url.startsWith('http')) {
        rawUrlsMap.set(url, { url, title: title || '', queryName: source });
      }
    }
  }

  const rawUrls = Array.from(rawUrlsMap.values());
  if (rawUrls.length === 0) {
    console.log('No Phase 1, 2, or 3 URLs found for today to process.');
    return;
  }

  // 3. Check existing launcher to avoid re-evaluating and for appending
  ensureDir(APPLICATIONS_DIR);
  const launcherPath = resolve(APPLICATIONS_DIR, `launcher-${todayIso()}.html`);
  const existingPassedUrls = [];
  
  if (existsSync(launcherPath)) {
    const oldHtml = readFileSync(launcherPath, 'utf-8');
    const aTagRegex = /<a href="(.*?)"[^>]*>\d+\.\s*(.*?)<\/a>/g;
    let m;
    while ((m = aTagRegex.exec(oldHtml)) !== null) {
      existingPassedUrls.push({ url: m[1], title: m[2] });
    }
    console.log(`Found existing launcher with ${existingPassedUrls.length} jobs.`);
  }

  let candidates = rawUrls.filter(c => !existingPassedUrls.some(e => e.url === c.url));
  
  if (limit < Infinity) candidates = candidates.slice(0, limit);
  
  console.log(`Processing ${candidates.length} NEW URLs...`);
  
  let browser = null;
  let page = null;
  const passedUrls = [...existingPassedUrls];
  
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
        continue;
      }
      
      // Step 2: Page Content Filter
      try {
        await page.goto(item.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        const content = await page.evaluate(() => document.body?.innerText || '');
        
        if (evaluatePageText(content, profile.job_criteria)) {
          passedUrls.push(item);
          console.log('PASS');
        } else {
          console.log('SKIP (Criteria mismatch)');
        }
      } catch (err) {
        console.log(`ERROR (${err.message})`);
        // We'll still include it if the title passed but page failed to load, to be safe.
        if (evaluateJobTitle(item.title, profile.job_criteria)) {
          passedUrls.push(item);
        }
      }
    }
  } finally {
    if (browser) await browser.close();
  }
  
  if (passedUrls.length > 0) {
    writeFileSync(launcherPath, generateLauncherHtml(passedUrls), 'utf-8');
    console.log(`\n✅ Generated/Updated HTML Launcher with ${passedUrls.length} total valid jobs:`);
    console.log(`   ${launcherPath}`);
    console.log(`\nOpen this file in your browser to 1-click apply to all matching roles.`);
  } else {
    console.log('\n❌ No jobs matched your criteria today.');
  }
  
  // Clear search-urls.tsv so it's not processed again
  if (existsSync(SEARCH_URLS_PATH)) {
    writeFileSync(SEARCH_URLS_PATH, 'url\ttitle\tquery_name\n', 'utf-8');
  }
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const limitIndex = process.argv.indexOf('--limit');
  const limit = limitIndex !== -1 ? Number(process.argv[limitIndex + 1]) : Infinity;
  const headed = args.has('--headed');

  const profile = loadProfile();

  const SEARCH_URLS_PATH = resolve(ROOT, 'data/search-urls.tsv');
  const hasSearchUrls = existsSync(SEARCH_URLS_PATH) && readFileSync(SEARCH_URLS_PATH, 'utf-8').trim().split('\n').length > 1;

  if (args.has('--from-search') || hasSearchUrls) {
    await handleSearchUrls({ profile, headed, limit, SEARCH_URLS_PATH });
    return;
  }

  const pendingItems = parsePendingPipelineItems().slice(0, limit);

  if (!pendingItems.length) {
    console.log('No pending pipeline items found.');
    return;
  }

  ensureDir(resolve(APPLICATIONS_DIR, batchName()));
  ensureBatchReadme();

  const browser = await chromium.launch({ headless: !headed });
  const page = await browser.newPage();

  try {
    for (const item of pendingItems) {
      const slug = slugify(`${item.company}-${item.role}`) || slugify(item.url);
      const itemDir = resolve(APPLICATIONS_DIR, batchName(), slug);
      ensureDir(itemDir);

      const resumeMdPath = resolve(itemDir, 'resume.md');
      const answersMdPath = resolve(itemDir, 'answers.md');
      const assistJsonPath = resolve(itemDir, 'apply-assist.json');

      const targetValidation = validateJobTarget(item);
      if (!targetValidation.ok) {
        writeFileSync(assistJsonPath, JSON.stringify({
          company: item.company,
          role: item.role,
          url: item.url,
          inspectedAt: new Date().toISOString(),
          inspection: {
            title: item.role,
            labels: [],
            inputs: [],
            buttons: [],
            textSnippet: '',
            uploadAttempted: false,
            uploadSucceeded: false,
            isMismatch: true,
            error: targetValidation.reason,
          },
        }, null, 2), 'utf-8');

        upsertBatchRow({
          company: item.company,
          role: item.role,
          status: 'Blocked (irrelevant role)',
          resumePath: '-',
          answersPath: '-',
          notes: targetValidation.reason,
        });

        console.log(`${item.company} | ${item.role} -> Blocked (irrelevant role)`);
        continue;
      }

      writeFileSync(resumeMdPath, genericResumeMd(profile, item), 'utf-8');
      writeFileSync(answersMdPath, genericAnswers(profile, item), 'utf-8');

      let inspection;
      try {
        inspection = await inspectApplyFlow(page, item);
        const pageText = `${inspection.title || ''} ${inspection.textSnippet || ''}`.toLowerCase();
        inspection.isMismatch = IRRELEVANT_ROLE_PHRASES.some(phrase => pageText.includes(phrase));
      } catch (error) {
        inspection = {
          title: item.role,
          labels: [],
          inputs: [],
          buttons: [],
          textSnippet: '',
          uploadAttempted: false,
          uploadSucceeded: false,
          isMismatch: false,
          error: error.message,
        };
      }

      writeFileSync(assistJsonPath, JSON.stringify({
        company: item.company,
        role: item.role,
        url: item.url,
        inspectedAt: new Date().toISOString(),
        inspection,
      }, null, 2), 'utf-8');

      const status = inspection.error ? 'Blocked (apply flow failed)' : decideStatus(inspection);
      const notes = inspection.error
        ? inspection.error
        : inspection.isMismatch
          ? 'Live page content does not match target role'
          : `Upload attempted: ${inspection.uploadAttempted ? 'yes' : 'no'}, uploaded: ${inspection.uploadSucceeded ? 'yes' : 'no'}`;

      upsertBatchRow({
        company: item.company,
        role: item.role,
        status,
        resumePath: `[resume.md](${resumeMdPath})`,
        answersPath: `[answers.md](${answersMdPath})`,
        notes,
      });

      console.log(`${item.company} | ${item.role} -> ${status}`);
    }
  } finally {
    await browser.close();
  }
}

main().catch(error => {
  console.error(error.stack || error.message);
  process.exit(1);
});
