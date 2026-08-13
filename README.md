# ClaudeJob: AI Job Application Workflow

AI-powered job search and application workflow. Fetches **live** job listings
from Google for Jobs (via JSearch API), runs a full AI pipeline
(JD analysis → resume tailor → cover letter → Q&A), and tracks applications
via a Kanban board.

**All applications are manual** — this tool prepares your materials, you
fill out and submit forms yourself.

## Setup (one-time)
```bash
npm install
pip3 install reportlab pdfplumber   # optional: PDF resume generation
cp .env.example .env
# Open .env and add BOTH keys
```

You need two API keys:

| Key | Where to get it | Free tier |
|-----|----------------|-----------|
| `ANTHROPIC_API_KEY` | https://console.anthropic.com/settings/api-keys | Pay-as-you-go |
| `RAPIDAPI_KEY` | https://rapidapi.com/letscrape-6bRBa3QguO5/api/jsearch | 500 requests/month free |

For the RapidAPI key: sign up, search "JSearch", subscribe to the free plan, then copy your key from the API playground.

## Run
```bash
npm start
# Opens at http://localhost:3000
```

For auto-reload during development:
```bash
npm run dev
```

## Run tests
```bash
npm test
# Runs 149 unit tests: 104 for resume validation, diff, and JSON parsing,
# plus 45 for job selection
```

## What each tab does

| Tab | What it does |
|-----|-------------|
| **Search** | Fetches live job listings from Google for Jobs. Shows posting date, direct apply links, and skill overlap score. |
| **Pipeline** | Runs all 4 AI steps: JD analysis → resume tailor → cover letter → Q&A answers |
| **Resume** | Shows your tailored resume with validation warnings, diff view, and copy/download |
| **Cover Letter** | Full cover letter in your voice. Change tone and regenerate anytime. |
| **Q&A** | Answers 5 common application questions. Add custom questions too. |
| **Tracker** | Kanban board tracking every job with status updates (wishlist → applied → phone → technical → offer/rejected) |
| **Apply Helper** | Packages your materials and opens the direct apply link. You fill out and submit manually. |
| **Paste JD** | Found a job not in the search results? Paste the full JD and the AI will analyze it. |

## Workflow
1. Go to **Search** → pick role type, location, and recency → hit **Search**
2. Click a job card to see details (with real posting date and direct apply link)
3. Hit **Run AI pipeline** — takes ~15–30 seconds via SSE streaming
4. Go to **Resume** → review validation warnings and diff, then copy or download
5. Go to **Cover Letter** → copy or download
6. Go to **Q&A** → copy answers for application forms
7. Use **Apply Helper** to package materials and open the apply page
8. Apply manually — you fill out and submit the application yourself
9. Update status in **Tracker** as you hear back

## Resume safety

The AI pipeline has multiple anti-fabrication layers:

- **Banned phrase detection**: 30+ AI-resume clichés (leveraged, spearheaded, etc.) are flagged
- **Source grounding**: Numbers, companies, and tools are validated against your base resume
- **Diff view**: Shows exactly what changed between base and tailored resume
- **Validation banner**: Pass/warn/fail indicator on every tailored resume

## Key files

| File | Purpose |
|------|---------|
| `server.js` | Express server, tracker CRUD, middleware |
| `routes/ai.js` | AI pipeline, resume prompts, validation |
| `routes/jobs.js` | Live JSearch API integration |
| `routes/apply.js` | Apply helper (manual — packages materials) |
| `public/index.html` | Full SPA frontend |
| `generate_resume.py` | Standalone PDF resume generator (ReportLab) |
| `tests/ai.test.js` | Unit tests for core validation flows |
| `data/tracker.json` | Persisted tracker data (auto-created) |

## Updating your resume base
Edit the `RESUME_BASE` constant in `routes/ai.js`. All pipeline runs use this as the source of truth.
If you change numbers, companies, or tools, update `SOURCE_FACTS` too.
