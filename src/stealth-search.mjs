import { chromium } from 'playwright';
import { PlaywrightBlocker } from '@cliqz/adblocker-playwright';
import { isCaptchaPage } from './utils.mjs';

const BROWSER_RESULTS = 10;

function googleRecencyTbs(postedWindow = { days: 1 }) {
  if (postedWindow.days <= 1) return 'qdr:d';
  if (postedWindow.days <= 7) return 'qdr:w';
  return 'qdr:m';
}

function buildGoogleSearchUrl(query, count = BROWSER_RESULTS, postedWindow = { days: 1 }) {
  return `https://www.google.com/search?q=${encodeURIComponent(query)}&num=${count}&hl=en&gl=in&tbs=${encodeURIComponent(googleRecencyTbs(postedWindow))}`;
}

export async function runStealthSearch(query, options = {}) {
  const { 
    headed = false, 
    engine = 'google', 
    postedWindow = { days: 1 } 
  } = options;

  let url = '';
  if (engine === 'google') {
    url = buildGoogleSearchUrl(query, BROWSER_RESULTS, postedWindow);
  } else if (engine === 'ddg') {
    const recencyHint = postedWindow.days <= 1
      ? ' posted today OR "1 day ago"'
      : ` "posted ${postedWindow.days} days ago" OR "last ${postedWindow.days} days"`;
    url = `https://duckduckgo.com/?q=${encodeURIComponent(query + recencyHint)}&t=h_&ia=web`;
  } else {
    // Treat as direct URL
    url = query; 
  }

  const browser = await chromium.launch({ 
    headless: !headed,
    args: [
      '--disable-blink-features=AutomationControlled',
      '--no-sandbox',
    ]
  });

  try {
    const context = await browser.newContext({
      locale: 'en-IN',
      timezoneId: 'Asia/Kolkata',
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
      viewport: { width: 1280 + Math.floor(Math.random() * 100), height: 800 + Math.floor(Math.random() * 100) }
    });

    const blocker = await PlaywrightBlocker.fromPrebuiltAdsAndTracking(fetch);

    const page = await context.newPage();
    await blocker.enableBlockingInPage(page);
    
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
    
    // Add a slight jitter delay
    await new Promise(resolve => setTimeout(resolve, 1000 + Math.random() * 1000));

    const html = await page.content();
    const title = await page.title();

    if (isCaptchaPage(html, title)) {
      const err = new Error('CAPTCHA_DETECTED');
      err.code = 'CAPTCHA_DETECTED';
      throw err;
    }

    let results = [];

    if (engine === 'google') {
      results = await page.evaluate(() => {
        const items = [];
        const searchDiv = document.querySelector('#search') || document.body;
        for (const a of searchDiv.querySelectorAll('a')) {
          const href = a.href;
          if (!href || href.includes('google.com') || href.startsWith('javascript:')) continue;
          const titleEl = a.querySelector('h3, h1, span[role="heading"], div[role="heading"]');
          const titleText = titleEl?.innerText.trim();
          if (!titleText) continue;

          let container = a.closest('.g') || a.closest('[data-hveid]') || a.parentElement;
          let description = '';
          if (container) {
            const snippet = container.querySelector('[data-sncf="1"], .VwiC3b, [style*="-webkit-line-clamp"], .st, .yBF60b');
            description = snippet?.innerText.trim() || '';
          }
          items.push({ url: href, title: titleText, description });
        }
        return items;
      });
    } else if (engine === 'ddg') {
      results = await page.evaluate(() => {
        const items = [];
        const links = document.querySelectorAll('a[data-testid="result-title-a"], h2 a, .result__a');
        for (const a of links) {
          const href = a.href;
          if (!href || href.includes('duckduckgo.com')) continue;
          const titleText = (a.querySelector('span') || a).innerText.trim();
          if (!titleText) continue;
          let snippet = '';
          const container = a.closest('[data-testid="result"]') || a.closest('article') || a.closest('.result');
          if (container) {
            const snippetEl = container.querySelector('[data-testid="result-snippet"], .result__snippet, .OgUvY6nI90Y96p65pY_j');
            snippet = snippetEl?.innerText.trim() || '';
          }
          items.push({ url: href, title: titleText, description: snippet });
        }
        return items;
      });
    }

    return { web: { results: results.slice(0, BROWSER_RESULTS) } };

  } finally {
    await browser.close();
  }
}
