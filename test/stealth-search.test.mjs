import assert from 'node:assert';
import { describe, it } from 'node:test';
import { runStealthSearch } from '../src/stealth-search.mjs';
import { isCaptchaPage, extractJobLinksFromPage } from '../src/utils.mjs';

describe('utils.mjs', () => {
  it('detects google captcha pages', () => {
    const html = '<form id="captcha-form"></form>';
    assert.strictEqual(isCaptchaPage(html, 'Index'), true);
  });

  it('detects ddg captcha pages', () => {
    const html = '<body>too many requests</body>';
    assert.strictEqual(isCaptchaPage(html, 'DuckDuckGo'), true);
  });

  it('allows normal pages', () => {
    const html = '<body>normal page</body>';
    assert.strictEqual(isCaptchaPage(html, 'Search'), false);
  });
});

describe('stealth-search.mjs', () => {
  it('performs a basic google search and returns links', async () => {
    // Note: this uses Playwright and network, it might be slow.
    const result = await runStealthSearch('test query "golang"', { engine: 'google', headed: false });
    assert.ok(result.web);
    assert.ok(result.web.results.length > 0);
    assert.ok(result.web.results[0].url);
  });

  it('performs a basic ddg search and returns links', async () => {
    const result = await runStealthSearch('test query "golang"', { engine: 'ddg', headed: false });
    assert.ok(result.web);
    assert.ok(result.web.results.length > 0);
    assert.ok(result.web.results[0].url);
  });
});
