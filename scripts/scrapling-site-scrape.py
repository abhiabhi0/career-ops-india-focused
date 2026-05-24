#!/usr/bin/env python3

import argparse
import asyncio
import json
import logging
import os
import sys
from urllib.parse import urljoin

logging.disable(logging.CRITICAL)

try:
    from scrapling.fetchers import AsyncDynamicSession, AsyncStealthySession
except ModuleNotFoundError as exc:
    print(
        "Scrapling fetchers are not installed. Create .venv-scrapling and run "
        'pip install "scrapling[fetchers]"',
        file=sys.stderr,
    )
    raise SystemExit(1) from exc


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
        description="Batch scrape career pages with Scrapling and return link candidates as JSON."
    )
    parser.add_argument("--binary", help="Chromium/Chrome executable path")
    parser.add_argument("--headed", action="store_true", help="Show browser window")
    parser.add_argument("--stealthy", action="store_true", help="Use Scrapling stealthy session")
    parser.add_argument("--settle-ms", type=int, default=1200, help="Initial wait after navigation")
    parser.add_argument("--scroll-steps", type=int, default=6, help="Number of scroll passes")
    parser.add_argument("--scroll-pause-ms", type=int, default=900, help="Delay between scrolls")
    parser.add_argument("--timeout-seconds", type=int, default=45, help="Navigation timeout")
    parser.add_argument("--max-pages", type=int, default=4, help="Maximum concurrent browser tabs")
    return parser.parse_args()


def clean_text(value):
    return " ".join(str(value or "").split()).strip()


def log_progress(message):
    print(message, file=sys.stderr, flush=True)


async def click_keyword_buttons(page, keywords, limit=3):
    script = """
({ keywords, limit }) => {
  const normalize = value => (value || '').toLowerCase().replace(/\\s+/g, ' ').trim();
  const isVisible = el => {
    const style = window.getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    return style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0;
  };

  let clicked = 0;
  for (const el of document.querySelectorAll('button, a, [role="button"], input[type="button"], input[type="submit"]')) {
    if (clicked >= limit) break;
    if (!isVisible(el)) continue;
    const label = normalize(el.innerText || el.value || el.getAttribute('aria-label') || el.getAttribute('title'));
    if (!label) continue;
    if (!keywords.some(keyword => label.includes(keyword))) continue;
    try {
      el.click();
      clicked += 1;
    } catch (error) {
      // Ignore and continue scanning.
    }
  }

  return clicked;
}
"""
    value = await page.evaluate(script, {"keywords": keywords, "limit": limit})
    return int(value or 0)


async def scroll_page(page, steps, pause_ms):
    for _ in range(max(steps, 0)):
        await page.evaluate(
            """
() => {
  const before = Math.max(
    document.body?.scrollHeight || 0,
    document.documentElement?.scrollHeight || 0
  );
  window.scrollTo({ top: before, behavior: 'instant' });
  return before;
}
"""
        )
        await page.wait_for_timeout(max(pause_ms, 0))
        await click_keyword_buttons(page, LOAD_MORE_KEYWORDS, limit=2)


def build_page_action(args):
    async def page_action(page):
        await page.wait_for_timeout(max(args.settle_ms, 0))
        await click_keyword_buttons(page, CONSENT_KEYWORDS, limit=2)
        await page.wait_for_timeout(400)
        await click_keyword_buttons(page, LOAD_MORE_KEYWORDS, limit=4)
        await scroll_page(page, args.scroll_steps, args.scroll_pause_ms)
        await page.wait_for_timeout(250)

    return page_action


def extract_links(response):
    seen = set()
    items = []

    for anchor in response.css("a[href]"):
        href = clean_text(anchor.attrib.get("href", ""))
        if not href or href.startswith(("javascript:", "mailto:", "tel:", "#")):
            continue

        absolute_url = clean_text(urljoin(response.url, href))
        if not absolute_url or absolute_url in seen:
            continue
        seen.add(absolute_url)

        items.append(
            {
                "url": absolute_url,
                "text": clean_text(anchor.get_all_text(separator=" ", strip=True)),
                "title": clean_text(anchor.attrib.get("title", "")),
                "ariaLabel": clean_text(anchor.attrib.get("aria-label", "")),
            }
        )

    return items


async def scrape_target(session, target, args):
    url = target.get("url")
    if not url:
        raise ValueError("Target is missing url")

    response = await session.fetch(
        url,
        timeout=max(args.timeout_seconds, 10) * 1000,
        wait_selector="a",
        wait_selector_state="attached",
        page_action=build_page_action(args),
    )

    return {
        "name": target.get("name") or url,
        "url": url,
        "currentUrl": response.url,
        "pageTitle": clean_text(response.css("title::text").get("")),
        "links": extract_links(response),
    }


def build_session(args):
    session_class = AsyncStealthySession if args.stealthy else AsyncDynamicSession
    session_kwargs = {
        "headless": not args.headed,
        "max_pages": max(args.max_pages, 1),
        "network_idle": True,
        "google_search": False,
        "locale": os.environ.get("SCRAPLING_LOCALE", "en-IN"),
        "block_ads": True,
        "timeout": max(args.timeout_seconds, 10) * 1000,
    }

    binary = args.binary or os.environ.get("SCRAPLING_CHROMIUM_PATH") or os.environ.get("CHROME_BINARY")
    if binary:
        session_kwargs["executable_path"] = binary

    return session_class, session_kwargs


async def main():
    args = parse_args()
    payload = json.loads(sys.stdin.read() or "{}")
    targets = payload.get("targets") or []

    if not isinstance(targets, list):
        raise ValueError("Expected stdin JSON object with a 'targets' list")

    results = [None] * len(targets)
    session_class, session_kwargs = build_session(args)

    async with session_class(**session_kwargs) as session:
        total = len(targets)

        async def worker(index, target):
            name = target.get("name") or target.get("url") or "unknown"
            log_progress(f"    [Scrapling {index + 1}/{total}] START {name}")
            try:
                results[index] = await scrape_target(session, target, args)
                link_count = len((results[index] or {}).get("links") or [])
                log_progress(f"    [Scrapling {index + 1}/{total}] DONE  {name} ({link_count} links)")
            except Exception as exc:
                results[index] = {
                    "name": name,
                    "url": target.get("url"),
                    "error": str(exc),
                    "links": [],
                }
                log_progress(f"    [Scrapling {index + 1}/{total}] ERROR {name} :: {exc}")

        await asyncio.gather(*(worker(index, target) for index, target in enumerate(targets)))

    json.dump({"results": results}, sys.stdout)


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except Exception as exc:
        print(str(exc), file=sys.stderr)
        sys.exit(1)
