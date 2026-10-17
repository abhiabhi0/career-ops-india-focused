#!/usr/bin/env python3
"""Scan recent Open Job Data changes for Go/backend roles eligible for India-based applicants.

Remote status alone does not mean an employer hires from India.
"""
import sys
import json
from datetime import datetime, timedelta, timezone

NON_INDIA_RESTRICTIONS = (
    "us only", "usa only", "united states only", "must be based in the us",
    "must reside in the us", "uk only", "europe only", "eu only", "emea only",
    "canada only", "north america only",
)
INDIA_LOCATIONS = (
    "india", "bengaluru", "bangalore", "mumbai", "delhi", "hyderabad",
    "pune", "chennai", "noida", "gurgaon", "gurugram", "kolkata", "kochi",
)
WORLDWIDE_SIGNALS = (
    "worldwide", "work from anywhere", "remote anywhere", "global remote",
    "anywhere in the world", "all countries", "remote (global)",
)

def eligible_for_india(row):
    country = str(row.get("country") or "").strip().lower()
    workplace = str(row.get("workplace_type") or "").strip().lower()
    title = str(row.get("title") or "").strip().lower()
    description = str(row.get("description") or "").strip().lower()
    text = " ".join((country, workplace, title, description))

    if any(term in text for term in NON_INDIA_RESTRICTIONS):
        return False
    if country in ("india", "in") or "india" in country:
        return True
    if any(term in text for term in INDIA_LOCATIONS):
        return True
    if any(term in text for term in WORLDWIDE_SIGNALS):
        return True
    # is_remote alone and APAC alone are ambiguous. Exclude them.
    return False

def main():
    try:
        inputs = json.load(sys.stdin)
    except Exception as exc:
        print(json.dumps({"error": f"Failed to parse stdin JSON: {exc}"}))
        sys.exit(1)

    positives = [str(p).lower() for p in inputs.get("positives", [])]
    negatives = [str(n).lower() for n in inputs.get("negatives", [])]
    days = max(1, int(inputs.get("days", 3)))

    try:
        import pandas as pd
        from huggingface_hub import HfFileSystem
    except ImportError as exc:
        print(json.dumps({"error": f"Missing required python packages: {exc}"}))
        sys.exit(1)

    try:
        fs = HfFileSystem()
        companies_path = "buckets/Invicto69/Jobs-Dataset-bucket/data/companies/companies.parquet"
        if not fs.exists(companies_path):
            print(json.dumps({"error": f"Companies metadata not found: {companies_path}"}))
            sys.exit(1)
        with fs.open(companies_path, "rb") as f:
            companies_df = pd.read_parquet(f)
        companies_lookup = companies_df.set_index("id")["name"].to_dict()

        dates = [(datetime.now(timezone.utc) - timedelta(days=i)).strftime("%Y-%m-%d")
                 for i in range(days)]
        matching_jobs = []
        for date_str in reversed(dates):
            changes_path = f"buckets/Invicto69/Jobs-Dataset-bucket/data/minimal/changes/{date_str}.parquet"
            if not fs.exists(changes_path):
                continue
            with fs.open(changes_path, "rb") as f:
                jobs_df = pd.read_parquet(f)
            if jobs_df.empty:
                continue
            jobs_df = jobs_df[jobs_df["status"] == "active"]

            def match_title(title):
                if not isinstance(title, str):
                    return False
                title_lower = title.lower()
                has_positive = not positives or any(
                    (p == "go" and "go" in title_lower.split()) or
                    (p != "go" and p in title_lower) for p in positives
                )
                has_negative = any(n in title_lower for n in negatives)
                return has_positive and not has_negative

            jobs_df = jobs_df[jobs_df["title"].apply(match_title)]
            jobs_df = jobs_df[jobs_df.apply(eligible_for_india, axis=1)]

            for _, row in jobs_df.iterrows():
                company_name = companies_lookup.get(row.get("company_id"), "Unknown")
                workplace = str(row.get("workplace_type") or "").strip()
                country = str(row.get("country") or "").strip()
                location_str = ", ".join(part for part in (workplace, country) if part) or "India eligibility indicated"
                matching_jobs.append({
                    "title": row.get("title", ""),
                    "url": row.get("apply_url", ""),
                    "company": company_name,
                    "location": location_str,
                    "posted_at": str(row.get("posted_at") or ""),
                })

        seen_urls, unique_jobs = set(), []
        for job in matching_jobs:
            url = job["url"]
            if url and url not in seen_urls:
                seen_urls.add(url)
                unique_jobs.append(job)
        print(json.dumps({"results": unique_jobs}, indent=2))
    except Exception as exc:
        print(json.dumps({"error": f"Internal scan error: {exc}"}))
        sys.exit(1)

if __name__ == "__main__":
    main()
