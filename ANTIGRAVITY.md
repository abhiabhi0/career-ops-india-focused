# Career-Ops — Antigravity Tool Mapping

This file maps Claude Code tool references in `modes/*.md` to their Antigravity equivalents.
When following instructions from mode files, use this mapping.

## Tool Mapping

| Claude Code Tool | Antigravity Equivalent | Notes |
|-----------------|----------------------|-------|
| `browser_navigate` + `browser_snapshot` | `browser_subagent` | Use browser_subagent with a task like "Navigate to URL and extract all job listing text" |
| `WebSearch` | `search_web` | Same capability — web search with query |
| `WebFetch` | `read_url_content` | Fetches URL content as markdown |
| `Read` (file) | `view_file` | Read any local file |
| `Write` (file) | `write_to_file` | Create new files |
| `Edit` (file) | `replace_file_content` / `multi_replace_file_content` | Edit existing files |
| `Bash` / shell | `run_command` | Execute shell commands |
| `Agent()` subagent | `browser_subagent` (for browser tasks) | For non-browser tasks, execute inline |
| `/career-ops` slash command | Say "career-ops" or use workflow triggers | See `.agents/workflows/` |

## Batch Processing

Claude Code batch uses `claude -p` workers, which are not available. Instead:
- Process offers **sequentially** in the main conversation
- For bulk processing, paste multiple URLs and they'll be evaluated one by one
- All merge/dedup scripts still work: `node merge-tracker.mjs`, `node dedup-tracker.mjs`

## Browser Automation

When modes reference Playwright directly (`browser_navigate`, `browser_snapshot`):
- Use `browser_subagent` with a clear task description
- Example: "Navigate to https://jobs.lever.co/company, take a snapshot, and return all job titles and URLs visible on the page"
- The browser_subagent handles navigation, scrolling, and content extraction

## Workflow Invocation

Instead of `/career-ops scan`, just say:
- "career-ops scan" → scans portals
- "career-ops pdf" → generates PDF
- "career-ops apply" → application assistant
- Paste a job URL → auto-pipeline (evaluate + PDF + tracker)
- "evaluate this offer" → evaluation mode
- "career-ops tracker" → show application status

## Session Startup Checklist

At the start of each career-ops session, the AI should:
1. Read `ANTIGRAVITY.md` (this file) for tool mapping
2. Read `CLAUDE.md` for system instructions
3. Read `modes/_shared.md` for scoring/rules
4. Read `modes/_profile.md` for user customizations (if exists)
5. Check if `cv.md`, `config/profile.yml`, `portals.yml` exist
6. Run `node update-system.mjs check` silently
