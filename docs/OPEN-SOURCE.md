# Getting Started (Open Source)

Welcome to **Career-Ops**! This project is designed to help engineers automate their job search and application process using AI and resilient automation.

## Quick Start for New Users

### 1. Fork and Clone
Fork this repository and clone it to your local machine.

### 2. Configure Your Profile
The most important step is to tell the system who you are and what you're looking for.
- Copy `config/profile.example.yml` to `config/profile.yml`.
- Fill out your details, target roles, and preferred locations.

```yaml
candidate:
  full_name: "Your Name"
  location: "Your City, Country"

target_roles:
  primary:
    - "Senior Backend Engineer (Go)"
    - "Golang Developer"
```

### 3. Install Dependencies
```bash
npm install
npx playwright install --with-deps chromium
```

### 4. Run Your First Scan
Run the unified scanner to find new job offers. It will automatically use your profile to generate search queries and use a cascading search strategy to avoid being blocked.

```bash
node search-scan.js --dry-run
```

## How It Works

- **Phase 1 (API)**: Fetches direct job data from Greenhouse, Ashby, and Lever APIs (no search engine needed).
- **Phase 2 (Search)**: Runs targeted searches across the web using Google and DuckDuckGo.
- **Cascading Fallback**: If Google shows a CAPTCHA, the system automatically switches to DuckDuckGo or Brave to keep the scan running.

## Contributing

We welcome contributions! 
- **New Portals**: Add support for new job boards in `search-scan.js`.
- **Improved Parsing**: Improve how job details are extracted from search snippets.
- **Reporting**: Improve the dashboard or application tracking logic.

---

*Happy hunting!*
