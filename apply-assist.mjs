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

async function main() {
  const args = new Set(process.argv.slice(2));
  const limitIndex = process.argv.indexOf('--limit');
  const limit = limitIndex !== -1 ? Number(process.argv[limitIndex + 1]) : Infinity;
  const headed = args.has('--headed');

  const profile = loadProfile();
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
