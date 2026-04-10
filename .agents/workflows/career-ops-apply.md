---
description: Help fill out job application forms with AI-generated responses
---

# career-ops apply — Application Assistant

Interactive mode for when you're filling out a job application form.

## Steps

1. Read `ANTIGRAVITY.md` for tool mapping
2. Read `modes/_shared.md` for system rules
3. Read `modes/apply.md` for full application assistant instructions
4. Read `cv.md` for your CV content

## Execution

Follow `modes/apply.md` instructions. The workflow is:

1. **Detect the offer** — User shares URL, screenshot, or pastes form questions
2. **Find existing context** — Search `reports/` for a matching evaluation report
3. **If no report exists** — Offer to run a quick evaluation first
4. **Analyze form questions** — Identify all questions visible
5. **Generate answers** — Using report context + cv.md + profile, generate personalized answers
6. **Present for copy-paste** — Format answers ready to paste into the form

## Browser Automation (Optional)

If the user shares a URL to the application form:
- Use `browser_subagent` to navigate and extract form questions
- Return questions to the main conversation for answer generation

## Important

**NEVER submit the application automatically.** Generate answers for the user to review and submit manually.
