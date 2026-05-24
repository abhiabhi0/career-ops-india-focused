#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';

const ROOT = process.cwd();
const PIPELINE_PATH = resolve(ROOT, 'data/pipeline.md');
const APPLICATIONS_DIR = resolve(ROOT, 'applications');

const BLOCKED_ROLE_PHRASES = [
  'repair engineer',
  'structural design engineer',
  'labware lims',
  'salesforce',
  'sap btp',
  'full stack',
  'fullstack',
  'frontend',
  'android',
  'ios',
  'qa ',
  'site reliability',
  'sre',
  'devops',
  'platform engineer',
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

const TARGET_ROLE_PHRASES = [
  'golang',
  'go developer',
  'go engineer',
  'backend engineer',
  'backend developer',
  'software engineer',
  'software developer',
  'api engineer',
  'server engineer',
];

const GO_PRIMARY_SIGNALS = [
  'golang',
  'go developer',
  'go engineer',
  'go lang',
  'go backend',
];

const EXPERIENCE_MIN_YEARS = 3;
const EXPERIENCE_MAX_YEARS = 7;

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function batchName() {
  return `golang-jobs-${todayIso()}`;
}

function ensureDir(path) {
  mkdirSync(path, { recursive: true });
}

function buildBatchLauncherPath() {
  return resolve(APPLICATIONS_DIR, batchName(), 'apply-launcher.html');
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

function normalizeText(text = '') {
  return String(text).toLowerCase().replace(/\s+/g, ' ').trim();
}

function extractExperienceRange(text = '') {
  const normalized = normalizeText(text);
  const patterns = [
    /(\d+)\s*(?:-|–|to)\s*(\d+)\s*\+?\s*(?:years|yrs?)/i,
    /(\d+)\s*\+\s*(?:years|yrs?)/i,
    /(?:experience|exp)[^\d]{0,12}(\d+)\s*(?:-|–|to)\s*(\d+)/i,
    /(?:experience|exp)[^\d]{0,12}(\d+)\s*\+/i,
  ];

  for (const pattern of patterns) {
    const match = normalized.match(pattern);
    if (!match) continue;
    if (match[2]) {
      return { min: Number(match[1]), max: Number(match[2]) };
    }
    return { min: Number(match[1]), max: Infinity };
  }

  return null;
}

function rangesOverlap(minA, maxA, minB, maxB) {
  return minA <= maxB && minB <= maxA;
}

function isLauncherTarget(item) {
  const role = normalizeText(item.role);
  const location = normalizeText(item.location);
  const combined = `${role} ${location} ${normalizeText(item.url)}`;

  if (!item.url || !/^https?:\/\//i.test(item.url)) {
    return { keep: false, reason: 'invalid_url' };
  }
  if (BLOCKED_ROLE_PHRASES.some(phrase => combined.includes(phrase))) {
    return { keep: false, reason: 'blocked_role' };
  }

  const hasRoleSignal = TARGET_ROLE_PHRASES.some(phrase => role.includes(phrase));
  if (!hasRoleSignal) {
    return { keep: false, reason: 'missing_target_role' };
  }

  const hasGoSignal = GO_PRIMARY_SIGNALS.some(phrase => combined.includes(phrase));
  if (!hasGoSignal) {
    return { keep: false, reason: 'missing_go_signal' };
  }

  const experience = extractExperienceRange(`${item.role} ${item.location}`);
  if (experience && !rangesOverlap(experience.min, experience.max, EXPERIENCE_MIN_YEARS, EXPERIENCE_MAX_YEARS)) {
    return { keep: false, reason: 'experience_out_of_range' };
  }

  return { keep: true, reason: 'target_match' };
}

function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function createApplyLauncher(items) {
  const generatedAt = new Date().toISOString();
  const payload = JSON.stringify(items, null, 2);
  const cards = items.map((item, index) => `
      <article class="card">
        <div class="meta">#${index + 1}</div>
        <h2>${escapeHtml(item.role)}</h2>
        <p class="company">${escapeHtml(item.company)}</p>
        <p class="location">${escapeHtml(item.location || 'Remote / Unspecified')}</p>
        <div class="actions">
          <a class="button secondary" href="${escapeHtml(item.url)}" target="_blank" rel="noreferrer">Open</a>
        </div>
      </article>`).join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Career-Ops Apply Launcher</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f5f1e8;
      --panel: #fffdf8;
      --ink: #1e1a16;
      --muted: #6b6258;
      --accent: #0f766e;
      --accent-2: #134e4a;
      --line: #ddd2c2;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: Georgia, "Times New Roman", serif;
      background: linear-gradient(180deg, #efe6d8 0%, var(--bg) 100%);
      color: var(--ink);
    }
    main {
      max-width: 1080px;
      margin: 0 auto;
      padding: 32px 20px 64px;
    }
    .hero {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 20px;
      padding: 28px;
      box-shadow: 0 20px 50px rgba(24, 20, 16, 0.08);
    }
    h1 {
      margin: 0 0 8px;
      font-size: clamp(2rem, 4vw, 3.5rem);
      line-height: 1;
    }
    .lede, .hint {
      margin: 0;
      color: var(--muted);
      font-size: 1rem;
      line-height: 1.5;
    }
    .toolbar {
      display: flex;
      gap: 12px;
      flex-wrap: wrap;
      margin-top: 20px;
    }
    .button, button {
      appearance: none;
      border: 0;
      border-radius: 999px;
      padding: 12px 18px;
      background: var(--accent);
      color: white;
      font: inherit;
      text-decoration: none;
      cursor: pointer;
    }
    .button.secondary {
      background: transparent;
      color: var(--accent-2);
      border: 1px solid var(--line);
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
      gap: 16px;
      margin-top: 24px;
    }
    .card {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 18px;
      padding: 18px;
      box-shadow: 0 10px 30px rgba(24, 20, 16, 0.05);
    }
    .meta, .company, .location {
      color: var(--muted);
    }
    .card h2 {
      margin: 8px 0 6px;
      font-size: 1.1rem;
      line-height: 1.3;
    }
    .actions {
      margin-top: 14px;
    }
    pre {
      margin-top: 24px;
      padding: 16px;
      background: #1a1714;
      color: #f7f1e6;
      border-radius: 16px;
      overflow: auto;
      font-size: 12px;
    }
  </style>
</head>
<body>
  <main>
    <section class="hero">
      <h1>Apply Launcher</h1>
      <p class="lede">${items.length} filtered Go/backend application URL${items.length === 1 ? '' : 's'} prepared from pending pipeline jobs.</p>
      <p class="hint">Generated at ${escapeHtml(generatedAt)}. If your browser blocks popups, allow them for this local file and click again.</p>
      <div class="toolbar">
        <button id="open-all" type="button">Open All URLs</button>
        <button id="copy-all" class="button secondary" type="button">Copy URL List</button>
      </div>
    </section>
    <section class="grid">
${cards}
    </section>
    <pre id="url-list">${escapeHtml(items.map(item => item.url).join('\n'))}</pre>
  </main>
  <script>
    const items = ${payload};
    document.getElementById('open-all').addEventListener('click', () => {
      const opened = [];
      for (const item of items) {
        const win = window.open('about:blank', '_blank');
        if (win) {
          opened.push([win, item.url]);
        }
      }
      for (const [win, url] of opened) {
        try {
          win.location = url;
        } catch {}
      }
    });
    document.getElementById('copy-all').addEventListener('click', async () => {
      const text = items.map(item => item.url).join('\\n');
      try {
        await navigator.clipboard.writeText(text);
      } catch {
        const pre = document.getElementById('url-list');
        const range = document.createRange();
        range.selectNodeContents(pre);
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
      }
    });
  </script>
</body>
</html>`;
}

function writeApplyLauncher(items) {
  const batchDir = resolve(APPLICATIONS_DIR, batchName());
  ensureDir(batchDir);
  const launcherPath = buildBatchLauncherPath();
  writeFileSync(launcherPath, createApplyLauncher(items), 'utf-8');
  return launcherPath;
}

async function main() {
  const limitIndex = process.argv.indexOf('--limit');
  const limit = limitIndex !== -1 ? Number(process.argv[limitIndex + 1]) : Infinity;
  const pendingItems = parsePendingPipelineItems().slice(0, limit);

  if (!pendingItems.length) {
    console.log('No pending pipeline items found.');
    return;
  }

  const launcherItems = [];
  for (const item of pendingItems) {
    const target = isLauncherTarget(item);
    if (!target.keep) continue;
    launcherItems.push({
      company: item.company,
      role: item.role,
      location: item.location,
      url: item.url,
    });
  }

  const uniqueByUrl = [];
  const seenUrls = new Set();
  for (const item of launcherItems) {
    if (seenUrls.has(item.url)) continue;
    seenUrls.add(item.url);
    uniqueByUrl.push(item);
  }

  const launcherPath = writeApplyLauncher(uniqueByUrl);
  console.log(`Apply launcher written: ${launcherPath}`);
  console.log(`Filtered launcher URLs: ${uniqueByUrl.length}/${pendingItems.length}`);
}

main().catch(error => {
  console.error(error.stack || error.message);
  process.exit(1);
});
