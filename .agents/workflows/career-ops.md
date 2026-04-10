---
description: Main career-ops command router — evaluate offers, generate CVs, scan portals, track applications
---

# career-ops — Main Router

When the user says "career-ops" or any variation (with or without a sub-command), follow this workflow.

## Step 1: Load Context

// turbo
1. Read `ANTIGRAVITY.md` for tool mapping
2. Read `modes/_shared.md` for system rules
3. Read `modes/_profile.md` for user customizations (if exists)

## Step 2: Route the Command

Determine the mode from what the user said:

| User says... | Mode file to read |
|-------------|-------------------|
| "career-ops" (no args) | Show the command menu (see below) |
| Pastes a job URL or JD text | Read `modes/auto-pipeline.md` and execute full pipeline |
| "career-ops scan" | Read `modes/scan.md` and execute portal scan + post-scan application artifact preparation |
| "career-ops pdf" | Read `modes/pdf.md` and execute PDF generation |
| "career-ops apply" | Read `modes/apply.md` and execute application assistant |
| "career-ops tracker" | Read `modes/tracker.md` and show status |
| "career-ops pipeline" | Read `modes/pipeline.md` and process pending URLs |
| "career-ops batch" | Process offers sequentially (batch workers not available) |
| "career-ops contacto" | Read `modes/contacto.md` and generate LinkedIn outreach |
| "career-ops deep" | Read `modes/deep.md` and do deep company research |
| "career-ops training" | Read `modes/training.md` and evaluate a course/cert |
| "career-ops project" | Read `modes/project.md` and evaluate a portfolio project |
| "evaluate/compare offers" | Read `modes/ofertas.md` |

## Step 3: Execute

Read the relevant mode file and follow its instructions, using the Antigravity tool mapping from `ANTIGRAVITY.md`.

## Command Menu (shown when no args)

```
career-ops — Command Center

Available commands:
  career-ops {paste JD}   → AUTO-PIPELINE: evaluate + report + PDF + tracker
  career-ops pipeline     → Process pending URLs from inbox (data/pipeline.md)
  career-ops scan         → Scan portals and discover new offers
  career-ops pdf          → Generate ATS-optimized CV PDF
  career-ops apply        → Live application assistant (reads form + generates answers)
  career-ops tracker      → Application status overview
  career-ops contacto     → LinkedIn outreach message
  career-ops deep         → Deep company research
  career-ops training     → Evaluate course/cert against your goals
  career-ops project      → Evaluate portfolio project idea

Inbox: add URLs to data/pipeline.md → career-ops pipeline
Or paste a JD directly to run the full pipeline.
```
