#!/usr/bin/env python3

import argparse
import asyncio
import json
import os
import sys

from pydoll.browser import Chrome
from pydoll.browser.options import ChromiumOptions


CONSENT_KEYWORDS = [
    "accept",
    "accept all",
    "agree",
    "allow all",
    "allow cookies",
    "i agree",
    "got it",
    "continue",
]

LOAD_MORE_KEYWORDS = [
    "load more",
    "show more",
    "show all",
    "view more",
    "view all",
    "see more",
    "see all",
    "more jobs",
    "all jobs",
    "open roles",
]


def parse_args():
    parser = argparse.ArgumentParser(
        description="Batch scrape career pages with pydoll and return link candidates as JSON."
    )
    parser.add_argument("--binary", help="Chromium/Chrome executable path")
    parser.add_argument("--headed", action="store_true", help="Show browser window")
    parser.add_argument("--settle-ms", type=int, default=1200, help="Initial wait after navigation")
    parser.add_argument("--scroll-steps", type=int, default=6, help="Number of scroll passes")
    parser.add_argument("--scroll-pause-ms", type=int, default=900, help="Delay between scrolls")
    parser.add_argument("--timeout-seconds", type=int, default=45, help="Navigation timeout")
    return parser.parse_args()


async def script_value(tab, script: str):
    response = await tab.execute_script(script, return_by_value=True)
    return response.get("result", {}).get("result", {}).get("value")


async def click_keyword_buttons(tab, keywords: list[str], limit: int = 3):
    keyword_json = json.dumps(keywords)
    script = f"""
(() => {{
  const keywords = {keyword_json};
  const normalize = value => (value || '').toLowerCase().replace(/\\s+/g, ' ').trim();
  const isVisible = el => {{
    const style = window.getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    return style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0;
  }};
  let clicked = 0;
  for (const el of document.querySelectorAll('button, a, [role="button"], input[type="button"], input[type="submit"]')) {{
    if (clicked >= {limit}) break;
    if (!isVisible(el)) continue;
    const label = normalize(el.innerText || el.value || el.getAttribute('aria-label') || el.getAttribute('title'));
    if (!label) continue;
    if (!keywords.some(keyword => label.includes(keyword))) continue;
    try {{
      el.click();
      clicked += 1;
    }} catch (error) {{
      // Ignore and continue scanning.
    }}
  }}
  return clicked;
}})()
"""
    value = await script_value(tab, script)
    return int(value or 0)


async def scroll_page(tab, steps: int, pause_ms: int):
    for _ in range(max(steps, 0)):
        await script_value(
            tab,
            """
(() => {
  const before = Math.max(
    document.body?.scrollHeight || 0,
    document.documentElement?.scrollHeight || 0
  );
  window.scrollTo({ top: before, behavior: 'instant' });
  return before;
})()
""",
        )
        await asyncio.sleep(max(pause_ms, 0) / 1000)


async def extract_links(tab):
    script = """
(() => {
  const seen = new Set();
  const items = [];
  const normalize = value => (value || '').replace(/\\s+/g, ' ').trim();

  for (const anchor of document.querySelectorAll('a[href]')) {
    const href = anchor.href;
    if (!href || href.startsWith('javascript:') || href.startsWith('mailto:') || href.startsWith('tel:')) continue;
    if (seen.has(href)) continue;
    seen.add(href);

    const text = normalize(anchor.innerText || anchor.textContent || '');
    const title = normalize(anchor.getAttribute('title') || '');
    const ariaLabel = normalize(anchor.getAttribute('aria-label') || '');

    items.push({
      url: href,
      text,
      title,
      ariaLabel,
    });
  }

  return items;
})()
"""
    value = await script_value(tab, script)
    return value or []


async def scrape_target(tab, target: dict, args):
    url = target.get("url")
    if not url:
        raise ValueError("Target is missing url")

    await tab.go_to(url, timeout=args.timeout_seconds)
    await asyncio.sleep(max(args.settle_ms, 0) / 1000)

    await click_keyword_buttons(tab, CONSENT_KEYWORDS, limit=2)
    await asyncio.sleep(0.4)
    await click_keyword_buttons(tab, LOAD_MORE_KEYWORDS, limit=4)
    await scroll_page(tab, args.scroll_steps, args.scroll_pause_ms)

    links = await extract_links(tab)
    return {
        "name": target.get("name") or url,
        "url": url,
        "currentUrl": await tab.current_url,
        "pageTitle": await tab.title,
        "links": links,
    }


async def main():
    args = parse_args()
    payload = json.loads(sys.stdin.read() or "{}")
    targets = payload.get("targets") or []

    if not isinstance(targets, list):
        raise ValueError("Expected stdin JSON object with a 'targets' list")

    options = ChromiumOptions()
    options.headless = not args.headed
    options.start_timeout = max(args.timeout_seconds, 10)

    binary = args.binary or os.environ.get("PYDOLL_CHROMIUM_PATH") or os.environ.get("CHROME_BINARY")
    if binary:
        options.binary_location = binary

    results = []

    async with Chrome(options=options) as browser:
        tab = await browser.start()
        for target in targets:
            try:
                results.append(await scrape_target(tab, target, args))
            except Exception as exc:
                results.append(
                    {
                        "name": target.get("name") or target.get("url") or "unknown",
                        "url": target.get("url"),
                        "error": str(exc),
                        "links": [],
                    }
                )

    json.dump({"results": results}, sys.stdout)


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except Exception as exc:
        print(str(exc), file=sys.stderr)
        sys.exit(1)
