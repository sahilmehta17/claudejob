// One-off: regenerate the Rubrik cover letter (txt + PDF) for the 20:51 re-run.
//
// Why: the original cover letter didn't pull in chef-drop-brief even though
// it's in the context base. This rewrite explicitly:
//   - Leads with the JD's RBAC/security-boundaries bullet, mirrored against
//     the Enidus 8-role RBAC + parametrized SQL + per-tenant Qdrant work.
//   - Adds a chef-drop-brief paragraph (project, URL, 9 evals, pre-generation
//     routing safety) with the mandated bridge sentence about restore actions.
//   - References "Rubrik Security Cloud" and "Ruby AI" by name outside the close.
//   - Uses "Dear Ruby AI team" salutation and "Best,\nSahil Mehta" signoff.

const path = require('path');
const fs = require('fs');
const { RESUME_BASE_JSON } = require('./routes/resumeContent');
const { renderCoverPdf } = require('./routes/pdfRender');

const FOLDER = path.join(
  process.env.HOME,
  'Desktop/Internships and Resume/JobApplications',
  'Rubrik_Software-Engineer-Ruby-AI_2026-05-16-2051'
);
const TXT_OUT = path.join(FOLDER, 'Sahil_Mehta_CoverLetter.txt');
const PDF_OUT = path.join(FOLDER, 'Sahil_Mehta_CoverLetter.pdf');

const BODY = `Dear Ruby AI team,

Your JD calls for engineers who "design tool integrations that let agents safely query data, retrieve logs, and perform operations while honoring RBAC and security boundaries." That sentence describes the work I have been shipping at Enidus. The agentic copilot I built for T-Mobile for Business is in pilot across 15 reseller tenants and 100+ daily portal users, with zero LLM-hallucination incidents in production. Every tool call is gated by 8-role RBAC, parametrized SQL templates, session-scoped row-level security, and Pydantic-validated schemas; retrieval runs on per-tenant Qdrant collections so a query in one tenant cannot read another tenant's logs.

The pattern that makes that work is eval-first development. I authored a parametrized pytest suite — 52 hand-designed cases expanding to 400+ distinct invocations — that catches agent hallucinations (non-existent device SKUs, malformed BANs) before they reach the staging cluster. Hybrid retrieval combines Qdrant vector search with BM25 via Reciprocal Rank Fusion; I led the architectural pivot from lexical-first to vector-first when product direction shifted toward consumer-facing intent detection, productionizing Qdrant as a hard dependency. Cost-engineering came next: embedding LRU caching, regex pre-routing for unambiguous identifiers (phones, ICCIDs, IMEIs), and confidence bucketing to skip redundant LLM round-trips. State durability runs on a SQL-backed flow machine with 9 multi-step transaction flows and optimistic locking via state_version.

The same eval-gated pattern travels. I just shipped chef-drop-brief (github.com/sahilmehta17/chef-drop-brief), a Claude Code Skill that drafts Braze-ready chef-drop lifecycle campaigns (email + SMS + push + A/B variants + send-time) for CookUnity-style meal-delivery launches. 9 deterministic evals gate every draft before any send — claimed-fact verification against a pinned chef catalog, dietary-contradiction matching, banned-cliché regex, brand-voice cosine similarity via sentence-transformers, channel-correct CTAs and char limits, personalization-token checks, policy safety, and positive voice-signal detection — plus pre-generation routing safety that refuses misrouted briefs before a single token is spent. The product domain is incidental; the conviction is the point. LLMs reach users only behind deterministic safety layers — the same bar I would bring to Ruby AI on Rubrik Security Cloud, because the cost of an agent hallucinating a restore action is higher by orders of magnitude than a marketing subject line.

Earlier: a 300K-embedding RAG pipeline (TypeScript, TimescaleDB, hybrid retrieval, semantic re-ranking) hitting 73% QA accuracy and 40% query-latency reduction on the UW–Madison Denari capstone. Strong proficiency in Python and TypeScript, Java in reserve, comfortable ramping on Go and Kubernetes. Looking forward to the conversation.

Best,
Sahil Mehta`.trim();

const coverContent = {
  name: RESUME_BASE_JSON.name,
  contact: RESUME_BASE_JSON.contact,
  date: 'May 16, 2026',
  body: BODY,
};

(async () => {
  await fs.promises.writeFile(TXT_OUT, BODY + '\n', 'utf8');
  await renderCoverPdf(coverContent, PDF_OUT);
  const txtSize = fs.statSync(TXT_OUT).size;
  const pdfSize = fs.statSync(PDF_OUT).size;
  console.log(JSON.stringify({
    txt: TXT_OUT, txtSize,
    pdf: PDF_OUT, pdfSize,
  }, null, 2));
})().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
