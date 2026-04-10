---
description: Generate an ATS-optimized PDF CV tailored to a specific job description
---

# career-ops pdf — PDF Generation

Generates a tailored, ATS-optimized PDF CV using the HTML template + Playwright.

## Steps

1. Read `ANTIGRAVITY.md` for tool mapping
2. Read `modes/_shared.md` for system rules
3. Read `modes/pdf.md` for full PDF generation instructions
4. Read `cv.md` for CV content
5. Read `templates/cv-template.html` for the HTML template

## Execution

Follow `modes/pdf.md` instructions:

1. Read the JD (user provides URL or text)
2. Extract keywords from the JD
3. Customize CV content for this specific role (using modes/pdf.md rules)
4. Generate temporary HTML file with customized content
5. Run PDF generation:

```bash
node generate-pdf.mjs --input /tmp/cv-temp.html --output output/cv-{name}-{company}-{date}.pdf
```

6. Verify the PDF was created successfully
7. Update tracker if applicable

## Output

- Generated PDF in `output/` directory
- Report which keywords were injected
- Confirm ATS compatibility
