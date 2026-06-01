#!/usr/bin/env python3
import sys
import json
import os
from datetime import datetime, timedelta, timezone

def main():
    # 1. Read input filters from stdin
    try:
        inputs = json.load(sys.stdin)
    except Exception as e:
        print(json.dumps({"error": f"Failed to parse stdin JSON: {str(e)}"}))
        sys.exit(1)

    positives = [p.lower() for p in inputs.get("positives", [])]
    negatives = [n.lower() for n in inputs.get("negatives", [])]
    target_location = inputs.get("target_location", "india").lower()
    days = int(inputs.get("days", 3))

    try:
        import pandas as pd
        from huggingface_hub import HfFileSystem
    except ImportError as e:
        print(json.dumps({"error": f"Missing required python packages: {str(e)}"}))
        sys.exit(1)

    try:
        fs = HfFileSystem()
        
        # 2. Load companies lookup
        companies_path = "buckets/Invicto69/Jobs-Dataset-bucket/data/companies/companies.parquet"
        if not fs.exists(companies_path):
            print(json.dumps({"error": f"Companies metadata not found in bucket: {companies_path}"}))
            sys.exit(1)
            
        with fs.open(companies_path, "rb") as f:
            companies_df = pd.read_parquet(f)
            
        # Create a fast lookup dict: company_id -> company_name
        companies_lookup = companies_df.set_index("id")["name"].to_dict()
        
        # 3. Calculate target dates to scan
        dates = []
        for i in range(days):
            dt = datetime.now(timezone.utc) - timedelta(days=i)
            dates.append(dt.strftime("%Y-%m-%d"))
        
        # We want to scan older days first, but the final output is unified
        matching_jobs = []
        
        # 4. Fetch daily changes files
        for date_str in reversed(dates):
            changes_path = f"buckets/Invicto69/Jobs-Dataset-bucket/data/minimal/changes/{date_str}.parquet"
            if not fs.exists(changes_path):
                # It's normal if today's or a specific day's delta isn't uploaded yet
                continue
                
            with fs.open(changes_path, "rb") as f:
                jobs_df = pd.read_parquet(f)
                
            if jobs_df.empty:
                continue
                
            # Filter active jobs
            jobs_df = jobs_df[jobs_df["status"] == "active"]
            
            # Title filtering
            def match_title(title):
                if not isinstance(title, str):
                    return False
                title_lower = title.lower()
                has_pos = not positives or any(p in title_lower for p in positives)
                has_neg = any(n in title_lower for n in negatives)
                return has_pos and not has_neg
                
            jobs_df = jobs_df[jobs_df["title"].apply(match_title)]
            
            # Location filtering (preliminary rough filter)
            def match_location(row):
                if row.get("is_remote") == True:
                    return True
                country = str(row.get("country", "")).lower()
                # Check for target country (like 'india' or 'in')
                if target_location == "india" or target_location == "in":
                    if "india" in country or country == "in":
                        return True
                elif target_location in country:
                    return True
                return False
                
            jobs_df = jobs_df[jobs_df.apply(match_location, axis=1)]
            
            # 5. Extract fields and append
            for _, row in jobs_df.iterrows():
                co_id = row.get("company_id")
                company_name = companies_lookup.get(co_id, "Unknown")
                
                # Format location string
                is_remote = row.get("is_remote") == True
                workplace = str(row.get("workplace_type") or "").strip()
                country = str(row.get("country") or "").strip()
                
                loc_parts = []
                if is_remote:
                    loc_parts.append("Remote")
                elif workplace:
                    loc_parts.append(workplace.capitalize())
                if country:
                    loc_parts.append(country)
                    
                location_str = ", ".join(loc_parts)
                
                matching_jobs.append({
                    "title": row.get("title", ""),
                    "url": row.get("apply_url", ""),
                    "company": company_name,
                    "location": location_str,
                    "posted_at": str(row.get("posted_at") or "")
                })

        # 6. Output unique results (deduplicated by url)
        seen_urls = set()
        unique_jobs = []
        for job in matching_jobs:
            url = job["url"]
            if url and url not in seen_urls:
                seen_urls.add(url)
                unique_jobs.append(job)
                
        print(json.dumps({"results": unique_jobs}, indent=2))

    except Exception as e:
        print(json.dumps({"error": f"Internal scan error: {str(e)}"}))
        sys.exit(1)

if __name__ == "__main__":
    main()
