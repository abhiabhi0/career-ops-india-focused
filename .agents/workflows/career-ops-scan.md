---
description: Scan job portals for new offers matching your target roles
---

# career-ops scan — Portal Scanner

Scans configured companies and job boards for new offers, then prepares application artifacts for each newly discovered role.

## Steps

// turbo-all

1. Read `ANTIGRAVITY.md` for tool mapping
2. Read `modes/_shared.md` for system rules  
3. Read `modes/scan.md` for full scanner instructions
4. Read `modes/auto-pipeline.md` for post-scan artifact generation behavior
5. Read `portals.yml` for portal configuration
6. Read `data/scan-history.tsv` for previously seen URLs (if exists)
7. Read `data/applications.md` for already-evaluated offers (if exists)
8. Read `data/pipeline.md` for already-queued URLs (if exists)

## Execution

Follow the instructions in `modes/scan.md` using these tool mappings:

- **Playwright navigation** → Use `browser_subagent` with task: "Navigate to {url}, extract all job listing titles and URLs"
- **Greenhouse API** → Use `read_url_content` to fetch JSON from `boards-api.greenhouse.io`
- **WebSearch queries** → Use `search_web` with the configured queries
- **File writes** → Use `write_to_file` or `replace_file_content` to update pipeline.md and scan-history.tsv

After scan discovery is complete, continue with post-scan preparation from `modes/scan.md`:

- Generate per-role folders under `applications/golang-jobs-{YYYY-MM-DD}/`
- Generate `resume.md` and `answers.md` for each new role
- Attempt apply assist without final submit
- Update `applications/golang-jobs-{YYYY-MM-DD}/README.md` with status rows

## Output

Show summary of:
- How many portals/companies scanned
- How many new offers found
- How many added to pipeline.md
- How many application folders were generated
- How many `resume.md` and `answers.md` files were generated
- How many apply attempts were blocked but artifacts are ready
