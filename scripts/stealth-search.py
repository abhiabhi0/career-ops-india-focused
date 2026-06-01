#!/usr/bin/env python3

"""
stealth-search.py — Google search via Scrapling's StealthyFetcher (Camoufox/Firefox)

Reads search queries from stdin as JSON, searches each on Google using
Scrapling's stealth browser (Camoufox), and outputs all result URLs as JSON.

Designed to bypass Google CAPTCHA that triggers with standard Playwright/Chrome.

Input (stdin JSON):
  { "queries": [{"name": "...", "query": "..."}], "num": 10, "headed": false }

Output (stdout JSON):
  { "results": [
      {"queryName": "...", "urls": [{"url": "...", "title": "..."}, ...], "error": null},
      ...
  ]}
"""

import argparse
import asyncio
import json
import logging
import os
import sys
import random

logging.disable(logging.CRITICAL)

try:
    from scrapling.fetchers import AsyncStealthySession
except ModuleNotFoundError as exc:
    print(
        "Scrapling fetchers not installed. Run: "
        '.venv-scrapling/bin/pip install "scrapling[fetchers]" && '
        ".venv-scrapling/bin/scrapling install",
        file=sys.stderr,
    )
    raise SystemExit(1) from exc


GOOGLE_URL = "https://www.google.com/search"
DELAY_RANGE = (3.0, 6.0)  # random delay between queries (seconds)


def parse_args():
    parser = argparse.ArgumentParser(description="Stealth Google search via Scrapling")
    parser.add_argument("--headed", action="store_true", help="Show browser window")
    parser.add_argument("--delay-min", type=float, default=DELAY_RANGE[0])
    parser.add_argument("--delay-max", type=float, default=DELAY_RANGE[1])
    return parser.parse_args()


def extract_search_results(response, num=10):
    """Extract organic search results from a Google SERP page."""
    items = []
    seen = set()

    # Primary: find result containers with <h3> titles
    for anchor in response.css("a"):
        href = anchor.attrib.get("href", "").strip()
        if not href or "google.com" in href or href.startswith(("javascript:", "#", "/")):
            continue

        # Clean Google redirect URLs
        if href.startswith("/url?"):
            import urllib.parse
            parsed = urllib.parse.parse_qs(urllib.parse.urlparse(href).query)
            href = parsed.get("q", parsed.get("url", [""]))[0]
            if not href:
                continue

        if href in seen:
            continue

        # Find title within the anchor
        h3 = anchor.css("h3")
        if not h3:
            # Also check span[role=heading]
            h3 = anchor.css('span[role="heading"]')
        if not h3:
            continue

        title = h3[0].get_all_text(separator=" ", strip=True) if h3 else ""
        if not title:
            continue

        seen.add(href)
        items.append({"url": href, "title": title})

        if len(items) >= num:
            break

    return items


async def search_queries(queries, num=10, headed=False, delay_min=3.0, delay_max=6.0):
    """Run multiple Google searches using a single stealth browser session."""
    results = []

    # Get chromium path from env for Scrapling (it can use Playwright's chromium)
    chromium_path = (
        os.environ.get("SCRAPLING_CHROMIUM_PATH")
        or os.environ.get("PYDOLL_CHROMIUM_PATH")
    )

    session_kwargs = {
        "headless": not headed,
        "google_search": False,  # we're going TO Google, not pretending to come FROM it
        "block_ads": True,
        "os_randomize": True,
        "humanize": True,
    }

    if chromium_path:
        session_kwargs["executable_path"] = chromium_path

    async with AsyncStealthySession(**session_kwargs) as session:
        for i, q in enumerate(queries):
            name = q.get("name", f"query-{i}")
            query_text = q.get("query", "")

            if not query_text:
                results.append({"queryName": name, "urls": [], "error": "empty query"})
                continue

            search_url = f"{GOOGLE_URL}?q={query_text}&num={num}&hl=en&gl=in"

            sys.stderr.write(f"\n[StealthSearch] [{i+1}/{len(queries)}] Starting: {name} ({query_text})\n")
            sys.stderr.flush()

            try:
                response = await session.fetch(
                    search_url,
                    timeout=20000,
                    wait_selector="h3",
                    wait_selector_state="attached",
                )

                # Check for CAPTCHA
                page_text = response.get_all_text(separator=" ", strip=True).lower()
                if "captcha" in page_text or "unusual traffic" in page_text or "robot" in page_text[:500]:
                    results.append({"queryName": name, "urls": [], "error": "CAPTCHA detected"})
                    sys.stderr.write(f"[StealthSearch] [{i+1}/{len(queries)}] Error: CAPTCHA detected\n")
                    sys.stderr.flush()
                    # If CAPTCHA'd, stop — further queries will likely also fail
                    for remaining in queries[i + 1:]:
                        results.append({
                            "queryName": remaining.get("name", ""),
                            "urls": [],
                            "error": "skipped (CAPTCHA on previous query)"
                        })
                    break

                urls = extract_search_results(response, num)
                results.append({"queryName": name, "urls": urls, "error": None})
                sys.stderr.write(f"[StealthSearch] [{i+1}/{len(queries)}] Finished: Found {len(urls)} URLs\n")
                sys.stderr.flush()

            except Exception as exc:
                error_msg = str(exc)
                results.append({"queryName": name, "urls": [], "error": error_msg})
                sys.stderr.write(f"[StealthSearch] [{i+1}/{len(queries)}] Error: {error_msg}\n")
                sys.stderr.flush()

                # If it looks like a block, stop early
                lower_err = error_msg.lower()
                if any(w in lower_err for w in ("captcha", "timeout", "blocked", "robot")):
                    for remaining in queries[i + 1:]:
                        results.append({
                            "queryName": remaining.get("name", ""),
                            "urls": [],
                            "error": "skipped (block on previous query)"
                        })
                    break

            # Random delay between queries
            if i < len(queries) - 1:
                delay = random.uniform(delay_min, delay_max)
                await asyncio.sleep(delay)

    return results


async def main():
    args = parse_args()
    payload = json.loads(sys.stdin.read() or "{}")

    queries = payload.get("queries", [])
    num = payload.get("num", 10)
    headed = payload.get("headed", False) or args.headed

    if not queries:
        json.dump({"results": []}, sys.stdout)
        return

    results = await search_queries(
        queries,
        num=num,
        headed=headed,
        delay_min=args.delay_min,
        delay_max=args.delay_max,
    )

    json.dump({"results": results}, sys.stdout)


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except Exception as exc:
        json.dump({"results": [], "error": str(exc)}, sys.stdout)
        sys.exit(1)
