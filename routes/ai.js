const express = require('express');
const Anthropic = require('@anthropic-ai/sdk');
const router = express.Router();
const { RESUME_BASE_JSON, CANDIDATE_FACTS, renderResumeText, applyAdjacency, sumBulletChars, BASE_BULLET_CHAR_BUDGET } = require('./resumeContent');
const { saveApplicationBundle } = require('./saveBundle');
const { runChecks: runBundleChecks } = require('../scripts/validate');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ─────────────────────────────────────────────────────────────────────────────
// SAHIL'S BASE RESUME — source of truth for all AI tailoring
// JSON content lives in resumeContent.js. We derive the plain-text version here
// for the LLM prompt context, the frontend diff display, and the validators.
// PDF generation goes JSON → Python (generate_resume.py), never text → PDF.
// ─────────────────────────────────────────────────────────────────────────────
const RESUME_BASE = renderResumeText(RESUME_BASE_JSON);


// ─────────────────────────────────────────────────────────────────────────────
// RESUME GUARDRAILS — banned phrases and validation
// ─────────────────────────────────────────────────────────────────────────────
const BANNED_RESUME_PHRASES = [
  'leveraged', 'spearheaded', 'utilized', 'results-driven', 'dynamic professional',
  'passionate about', 'excited to bring', 'proven track record', 'cutting-edge',
  'synergized', 'revolutionized', 'transformative', 'game-changing', 'best-in-class',
  'thought leader', 'self-starter', 'go-getter', 'team player',
  'drove innovation', 'deep expertise', 'unparalleled', 'world-class',
  'highly motivated', 'detail-oriented professional', 'results-oriented',
  'passionate engineer', 'seasoned professional', 'extensive experience',
  'unique ability', 'strong communicator', 'thrive in fast-paced',
  'hit the ground running', 'paradigm shift', 'ecosystem',
  'stakeholder alignment', 'cross-functional synergy',
];

const RESUME_BANNED_REGEX = new RegExp(
  BANNED_RESUME_PHRASES.map(p => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'),
  'gi'
);

// Source facts extracted from RESUME_BASE for validation
const SOURCE_FACTS = {
  numbers: ['80%', '15%', '10%', '97%', '22K+', '300K+', '73%', '40%', '25+', '52',
            '8 RBAC', '4 Qdrant', '6-intent', '9 SQL', '6 field', '3-layer', '100%',
            '53-intent', '43', '20', '6.2K', '15K', '3 tokens', '10+', '60 seconds',
            'RS256', 'HS256', 'PIL', 'Next.js 16', 'React 19'],
  companies: ['Enidus USA', 'Orahi', 'GSPANN', 'Denari', 'T-Mobile'],
  tools: ['Node.js', 'Express', 'Angular', 'FastAPI', 'GPT-4o-mini', 'Qdrant',
          'TypeScript', 'TimescaleDB', 'Docker', 'S3', 'OpenAI', 'Flask',
          'React', 'Next.js', 'Vite', 'Tailwind', 'Pydantic',
          'SQL Server', 'PostgreSQL', 'Axios', 'K-means',
          'BM25', 'TF-IDF', 'PyTorch', 'TensorFlow', 'Keras', 'Scikit-learn',
          'Apache Spark', 'Hadoop', 'Kafka', 'Pandas', 'NumPy',
          'Python', 'Java', 'JavaScript', 'C', 'Kotlin', 'Swift', 'R',
          'GraphQL', 'REST', 'gRPC', 'AWS S3', 'Git', 'Bash', 'Postman', 'JIRA',
          'JWT', 'OAuth', 'PoP', 'node:test'],
};

/**
 * Validate resume output against guardrails.
 * Returns { valid: boolean, warnings: string[], bannedFound: string[] }
 */
function validateResumeOutput(resumeText) {
  const warnings = [];
  const bannedFound = [];

  if (!resumeText || resumeText.trim().length < 200) {
    warnings.push('Resume output is suspiciously short (< 200 chars)');
    return { valid: false, warnings, bannedFound };
  }

  // Check for banned phrases
  const matches = resumeText.match(RESUME_BANNED_REGEX);
  if (matches) {
    const unique = [...new Set(matches.map(m => m.toLowerCase()))];
    bannedFound.push(...unique);
    warnings.push(`Contains banned AI-resume phrases: ${unique.join(', ')}`);
  }

  // Check that core sections exist.
  // Match the section name as a whole word against the raw (case-sensitive) text:
  // headers are rendered in uppercase, body values are mixed-case, so this
  // cleanly separates a real header from incidental matches like "Claude Skills"
  // inside a skill-line value.
  const requiredSections = ['EDUCATION', 'PROFESSIONAL EXPERIENCE', 'SKILLS'];
  for (const section of requiredSections) {
    if (!new RegExp(`\\b${section}\\b`).test(resumeText)) {
      warnings.push(`Missing expected section: ${section}`);
    }
  }

  // Check that key facts are preserved (at least some numbers should match)
  const numbersPresent = SOURCE_FACTS.numbers.filter(n => resumeText.includes(n));
  if (numbersPresent.length < 3) {
    warnings.push(`Only ${numbersPresent.length} of ${SOURCE_FACTS.numbers.length} source numbers preserved — possible fabrication`);
  }

  // Check for numbers not in source (possible fabrication)
  const outputNumbers = resumeText.match(/\d+%|\d+K\+|\d+\+/g) || [];
  const sourceNumberSet = new Set(SOURCE_FACTS.numbers);
  const suspiciousNumbers = outputNumbers.filter(n => !sourceNumberSet.has(n) && !['100%'].includes(n));
  if (suspiciousNumbers.length > 0) {
    warnings.push(`Contains numbers not in source resume: ${[...new Set(suspiciousNumbers)].join(', ')} — verify these`);
  }

  // Check company names are preserved
  const companiesPresent = SOURCE_FACTS.companies.filter(c => resumeText.includes(c));
  if (companiesPresent.length < SOURCE_FACTS.companies.length) {
    const missing = SOURCE_FACTS.companies.filter(c => !resumeText.includes(c));
    warnings.push(`Missing companies from source: ${missing.join(', ')}`);
  }

  // Narrative-before-jargon heuristic: flag bullets that open with stacked tech
  // terms instead of a user-facing outcome. A non-engineer should understand
  // sentence one. Tech inside parens is fine — that's a trailing detail by design.
  const TECH_LEAD_TERMS = new Set([
    ...SOURCE_FACTS.tools.map(t => t.toLowerCase()),
    'rag', 'llm', 'nl-to-sql', 'crud', 'mvc', 'orm', 'spa', 'sse', 'cnn',
    'fastapi/python', 'node.js/typescript', 'node.js/express', 'react/typescript',
  ]);
  const bulletLines = resumeText.split('\n').filter(l => /^\s*[•\-*]\s+\S/.test(l));
  const jargonLeadBullets = [];
  for (const line of bulletLines) {
    const raw = line.replace(/^\s*[•\-*]\s*/, '').trim();
    // Strip parenthetical content — that's explicit trailing detail, not the lead.
    const stripped = raw.replace(/\([^)]*\)/g, ' ');
    // Tokenize on whitespace AND slash so "FastAPI/Python" counts as two tech tokens.
    const firstWords = stripped.split(/[\s/]+/).slice(0, 12)
      .map(w => w.toLowerCase().replace(/[.,;:'"`]/g, ''))
      .filter(Boolean);
    const techCount = firstWords.filter(w => TECH_LEAD_TERMS.has(w)).length;
    if (techCount >= 3) {
      jargonLeadBullets.push(raw.slice(0, 70) + (raw.length > 70 ? '…' : ''));
    }
  }
  if (jargonLeadBullets.length > 0) {
    warnings.push(`Bullet leads with tech jargon (rewrite to lead with user outcome): "${jargonLeadBullets.join('"; "')}"`);
  }

  const valid = bannedFound.length === 0
    && warnings.filter(w => w.includes('fabrication')).length === 0
    && jargonLeadBullets.length === 0;
  return { valid, warnings, bannedFound };
}

/**
 * Generate a simple diff between base and tailored resume.
 * Returns array of { type: 'same'|'added'|'removed', text: string }
 */
function generateResumeDiff(base, tailored) {
  const baseLines = base.split('\n');
  const tailoredLines = tailored.split('\n');
  const diff = [];

  // Simple line-by-line comparison
  const baseSet = new Set(baseLines.map(l => l.trim()).filter(Boolean));
  const tailoredSet = new Set(tailoredLines.map(l => l.trim()).filter(Boolean));

  for (const line of tailoredLines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (baseSet.has(trimmed)) {
      diff.push({ type: 'same', text: trimmed });
    } else {
      diff.push({ type: 'added', text: trimmed });
    }
  }

  for (const line of baseLines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (!tailoredSet.has(trimmed)) {
      diff.push({ type: 'removed', text: trimmed });
    }
  }

  return diff;
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPER: stream text from Anthropic and call chunk/done callbacks
// ─────────────────────────────────────────────────────────────────────────────
async function streamText(prompt, maxTokens, onChunk) {
  let full = '';
  const stream = await client.messages.stream({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: maxTokens,
    messages: [{ role: 'user', content: prompt }],
  });
  for await (const chunk of stream) {
    if (chunk.type === 'content_block_delta' && chunk.delta?.type === 'text_delta') {
      full += chunk.delta.text;
      onChunk(chunk.delta.text);
    }
  }
  return full;
}

/**
 * Safely parse JSON from model output, stripping markdown fences.
 * Returns { data, error } — never throws.
 */
function safeParseJSON(raw) {
  if (!raw || typeof raw !== 'string') {
    return { data: null, error: 'Empty or non-string response from model' };
  }
  const cleaned = raw.trim().replace(/^```(?:json)?\s*/gm, '').replace(/```\s*$/gm, '').trim();
  try {
    return { data: JSON.parse(cleaned), error: null };
  } catch (e) {
    return { data: null, error: `JSON parse failed: ${e.message}. Raw output (first 200 chars): ${cleaned.slice(0, 200)}` };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// HARDENED RESUME PROMPT — conservative, source-grounded, anti-fabrication
// ─────────────────────────────────────────────────────────────────────────────
function buildResumePrompt(job, emphasis) {
  return `You are tailoring a resume for a specific job. Your ONLY job is conservative editing — NOT rewriting.

You are tailoring a 1-page resume. Layout discipline matters as much as content relevance.

TARGET ROLE: ${job.title} at ${job.company}
REQUIRED SKILLS: ${job.tags.join(', ')}
JD: ${job.desc}
EMPHASIS: ${emphasis}

SOURCE RESUME (this is the ONLY source of truth — JSON, the canonical schema):
${JSON.stringify(RESUME_BASE_JSON, null, 2)}

OUTPUT FORMAT: Return ONLY a JSON object matching the SAME SCHEMA as the source above. No markdown fences, no commentary, no prose explanation. The JSON will be parsed by JSON.parse() — anything other than valid JSON breaks the pipeline.

You may modify the values within bullets/skills (per rules below). You MUST preserve:
  - The top-level keys (name, contact, sections)
  - Section types and order keys
  - Item structure (title/date/location/subsections, etc.)
  - All numbers, percentages, dates, company names, and tool names exactly

JD FOCUS DETECTION:
Before generating the tailored resume, classify the TARGET role's primary focus into ONE of these buckets:
  - frontend: roles emphasizing React, UI/UX, mobile, accessibility, design systems (e.g., "Frontend Engineer", "UI Engineer", "Mobile Engineer", "Web Developer").
  - backend: roles emphasizing services, databases, APIs, distributed systems, infrastructure (e.g., "Backend Engineer", "Platform Engineer", "Infrastructure Engineer", "Site Reliability Engineer").
  - ai_infra: roles emphasizing LLM systems, agents, RAG, vector DBs, MLOps (e.g., "AI Engineer", "ML Engineer", "Applied AI", "Forward Deployed Engineer at AI shop").
  - fullstack: roles requiring both frontend and backend (e.g., "Software Engineer" with no specialization, "Full-Stack Engineer", "Founding Engineer").
  - data: roles emphasizing data pipelines, analytics, modeling, statistics (e.g., "Data Engineer", "Data Scientist", "ML Engineer with pipeline focus").

Classify based on the JD's bullet density — count how many JD bullets describe each area, pick the dominant one. The classification drives the SUBSECTION REORDERING and BULLET ORDERING rules below.

TIEBREAKER FOR HYBRID-FLAVOR TITLES:
If the JD title contains AI keywords (AI, ML, LLM, GenAI, Agentic, Intelligent) BUT primarily describes one of the other focus areas in the body, classify based on the BODY, not the title. Specifically:
  - "Frontend Engineer" / "UI Engineer" / "Mobile Engineer" / "Web Developer" / "Web Engineer" in the title (with or without AI qualifier) → classify as 'frontend' UNLESS the body explicitly says >50% of the work is on AI/ML infrastructure (model serving, vector DB ops, agent orchestration as primary).
  - "Backend Engineer" / "Platform Engineer" / "Infrastructure Engineer" in the title (with or without AI qualifier) → classify as 'backend' under the same rule.
  - "AI Experiences" / "AI Features" / "AI Platform" / "Intelligent X" qualifier in a frontend/backend title means "this team builds AI-flavored features" — the engineering work itself is still frontend/backend.
  - 'ai_infra' is reserved for roles where the JD body describes BUILDING the AI/ML platform itself (LLM serving, RAG indexing, agent runtimes, evaluation harnesses) as primary work.
  - When in doubt between two buckets, weight by the "WHAT YOU'LL DO" section: count keywords for each area (frontend: React, UI, mobile, accessibility, components; backend: services, databases, APIs, scaling; ai_infra: LLM, RAG, agents, MLOps, eval harness).

STRICT RULES — violations will cause rejection:

HARD CHARACTER BUDGET (most important rule — output is rejected if violated):
- The total character count of all bullet text across experience + projects sections must NOT exceed ${BASE_BULLET_CHAR_BUDGET} characters.
- This is the budget the base resume uses, which fits on exactly 1 page. Tailored versions that exceed this budget overflow page 1 and trigger fallback to the base resume — meaning your tailoring is discarded entirely.
- Count BEFORE submitting: sum the .length of every bullet string. If your output exceeds ${BASE_BULLET_CHAR_BUDGET}, COMPRESS bullets: drop redundant clauses, tighten phrasing, or drop the lowest-relevance bullet entirely.
- Skills section is constrained separately (4 lines). This budget applies only to bullet content.
- This budget OVERRIDES all other content goals. If preserving a JD-keyword anchor or following verb diversity would push you over budget, COMPRESS something else FIRST. The budget is non-negotiable.

1. PRESERVE ALL FACTS EXACTLY. Every number, percentage, metric, date, company name, tool name, and claim must come directly from the source resume. Do not round, approximate, inflate, or invent any number or claim.

2. ALLOWED EDITS ONLY:
   - Reorder bullet points within a section to lead with the most relevant work
   - Reorder sections (e.g., put RAG chatbot subsection before BFF if the role is AI-focused)
   - Tighten wording by removing filler words (keep the meaning identical)
   - Swap in JD-relevant phrasing ONLY when the source already supports the claim
   - Highlight skills from the Skills section that match the JD by listing them first

3. NEVER DO ANY OF THESE:
   - Invent tools, frameworks, metrics, or responsibilities not in the source
   - Add scope, scale, or impact beyond what the source states
   - Use ANY of these banned phrases: leveraged, spearheaded, utilized, results-driven, dynamic professional, passionate about, excited to bring, proven track record, cutting-edge, synergized, revolutionized, transformative, game-changing, best-in-class, thought leader, self-starter, go-getter, drove innovation, deep expertise, seasoned, extensive experience
   - Expand weak evidence into stronger claims
   - Pretend the candidate has experience they don't have
   - Add a summary/objective section
   - Change the format, section headers, or structure

LAYOUT CONSTRAINTS (hard requirements — output is rejected if violated):
- The tailored resume MUST FILL exactly 1 page (A4, 17pt margins, Times-Roman 11pt, 13pt line height). A half-page or 3/4-page output is just as broken as a 2-page output — the full page must be used. Target ~4000-4800 characters of bullet content combined across all sections; anything under 3500 is too sparse and gets rejected.
- PRESERVE every role, internship, and project from the base resume. Do NOT drop entire roles (e.g., GSPANN, Orahi) or subsections. Reorder is fine; deletion is not.
- PRESERVE bullet count per subsection. Tighten wording inside a bullet if needed; do not silently drop bullets. Dropping a bullet is acceptable ONLY if keeping it would force overflow to page 2.
- Each bullet should be 20-35 words. Bullets under 15 words read as filler and get rejected. Bullets over 40 words wrap to too many lines.
- NEVER write a bullet whose final rendered line will contain fewer than 4 words (a "widow line"). Specifically: avoid sentences that end with a short clause like "from days to minutes." or "stored Excel passwords." which would wrap such that the period falls alone on a final line. Instead, either tighten the sentence so it ends mid-line, or pad the final clause so the last line has 4+ words.
- For the Skills section: keep ALL skill categories from the base resume. The section must occupy EXACTLY 4 lines (matching the base resume's 4-category structure). See SKILLS SECTION LINE COUNT below.
- If your tailored output would push past 1 page, TIGHTEN wording inside bullets rather than dropping content. Cutting bullets or roles is a LAST resort, not the first move. The failure mode this brief is fixing is half-page output, not overflow — err toward keeping content.

SKILLS SECTION LINE COUNT (hard requirement — output is rejected if violated):
- The TECHNICAL SKILLS section must contain EXACTLY 4 category lines, matching the base resume's structure. The base has: AI / LLM Systems, Languages, Frameworks, Infra & Tools.
- You may RENAME and REORDER categories to match JD focus (e.g., "Frontend & Mobile: ..." instead of "Frameworks: ..." for frontend roles) but you may NOT add a 5th category line.
- If you need to surface both frontend AND backend frameworks for a fullstack JD, combine them under a single line: "Frameworks & APIs: React, Node.js, Express, FastAPI, ...".
- Total skills section height must fit within the 4-line budget the base resume uses. Adding a 5th line overflows the page and triggers fallback to base.

VERB DIVERSITY (hard requirement — output is rejected if violated):
- Across the entire resume, no more than 2 bullets may start with the same verb.
- Avoid the default "Built" lead. Specifically: rephrase bullets so the resume uses a variety of opening verbs. Draw from this pool, picking the verb that most accurately describes what the candidate did for that bullet:
  Architected, Authored, Designed, Drove, Engineered, Established, Hardened, Implemented, Instrumented, Integrated, Launched, Led, Migrated, Optimized, Owned, Productionized, Refactored, Reduced, Replaced, Shipped, Scaled, Stabilized, Streamlined.
- If a bullet's most accurate verb truly is "Built" or "Created," that is fine — but use it sparingly (max 2 across the whole resume).
- Do not fabricate scope to fit a verb. "Architected" implies design authority; "Led" implies you directed others. Use accurately.

JD-KEYWORD ANCHOR PRESERVATION (hard requirement):
When rewriting bullets for verb diversity or JD-focus reordering, PRESERVE any technology / framework keywords from the JD's required-skills section in the bullet text. Specifically:
- Identify the top 5-8 technology keywords from the JD's "What you'll be doing" / "Who you are looking for" / "Qualifications" sections (e.g., React, React Native, TypeScript, GraphQL, REST, accessibility, A/B testing, feature flags).
- For each Enidus subsection, ensure at least ONE bullet within that subsection mentions a relevant JD keyword in its body text (not just the skills section at the bottom of the resume — recruiters scan bullets, not just skills lists).
- If a bullet's original phrasing included a JD keyword (e.g., "React + TypeScript frontend UI"), DO NOT drop that keyword during the verb-diversity rewrite. Find a way to keep it in the new phrasing.
- Acceptable: "Shipped a React + TypeScript frontend for the AI assistant..." (preserved React+TS).
- Unacceptable: "Shipped an AI assistant enabling natural-language queries..." (lost React+TS anchor that was in the JD).
- The skills section listing is necessary but not sufficient. Bullets must demonstrate use of the JD keywords, not just claim them.

SUBSECTION REORDERING (JD-focus-aware):
Within the "Software Developer, Enidus USA LLC." experience item, the Enidus subsections (AI Chatbot & Agentic Copilot, Custom Reports & Dashboards Platform, and any others) should be ordered based on JD FOCUS:
  - frontend → lead with Custom Reports & Dashboards Platform (React frontend), then AI Copilot.
  - backend → lead with AI Copilot (FastAPI backend depth), then Reports.
  - ai_infra → lead with AI Copilot (the headline agentic work), then Reports.
  - fullstack → lead with AI Copilot, then Reports (both have full-stack but AI is the marquee).
  - data → lead with Reports (data infra + multi-tenant analytics), then AI Copilot.
Do not invent new subsections; reorder existing ones.

BULLET ORDERING WITHIN SUBSECTIONS (JD-focus-aware):
Within each subsection, order bullets to lead with the most JD-aligned content:
  - frontend → lead with bullets that mention React, TypeScript, UI, UX, mobile, accessibility. Demote backend infra bullets (hybrid retrieval, RLS, RBAC, SQL templates, validators) to the bottom of the subsection — or omit entirely if the subsection has 5+ bullets and the backend-infra one is the weakest signal for this JD.
  - backend → lead with bullets about services, databases, APIs, distributed systems. Demote pure-frontend bullets.
  - ai_infra → lead with bullets about agentic systems, LLM safety, evaluation, retrieval, governance. Demote pure-frontend bullets.
  - fullstack → preserve current ordering (both signals matter); minor tweaks only.
  - data → lead with bullets about data pipelines, transformations, analytics. Demote pure-frontend or pure-AI-eval bullets.

When demoting, do not delete bullets unless asked. Reordering only.

4. TONE: Write like a competent engineer describing what they built FOR USERS, not like a developer listing what they used. Concrete, specific, plain language. Lead with outcomes; let stack lists trail.

5. NARRATIVE BEFORE JARGON — every bullet must pass the "non-engineer test." A reader who doesn't know FastAPI from Flask should be able to read the first sentence of any bullet and understand what was built and who it helps. Technology stacks belong at the END of a bullet (in a trailing fragment) or in the SKILLS section — never as the opening clause.

   Apply this test to every bullet you write or edit:
   - Does the first 8 words name a user-facing outcome (what users can now do, or what problem is solved)? If no, rewrite.
   - Are 3+ of the first 10 words technology names (FastAPI, React, Pydantic, etc.)? If yes, rewrite.
   - Could a product manager understand what was shipped from sentence one alone? If no, rewrite.

   BAD (jargon stack, no user outcome):
   "Architected an agent-ready enterprise AI copilot on a FastAPI/Python backend with React 19 + TypeScript frontend, designed for hot-swap replacement of the intent router by an LLM planning agent."

   GOOD (outcome first, stack trails):
   "Built a conversational AI copilot for managing enterprise telecom accounts: users order devices, suspend lines, and upgrade plans through chat instead of clicking through 10+ portal screens. FastAPI + Python backend, React 19 + TypeScript frontend."

   BAD (NL-to-SQL is jargon for "asks questions"):
   "Architected a production NL-to-SQL AI assistant over live telecom account data using FastAPI, GPT-4o-mini, and Qdrant."

   GOOD (the system's actual job, then the stack):
   "Built a production AI assistant that lets account admins ask plain-English questions about their accounts ('how many lines on BAN 9234?') and get answers pulled live from the database. FastAPI, GPT-4o-mini, Qdrant."

6. If the JD requires skills or experience the source resume does NOT clearly demonstrate, DO NOT fabricate coverage. Simply omit or leave the resume as-is for that area.

7. Return ONLY a JSON object matching the source schema. No markdown fences, no commentary, no prose. The very first character of your response must be \`{\` and the very last must be \`}\`.`;
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/ai/pipeline-stream  — SSE streaming: JD → resume → cover → Q&A
// Query: job=<JSON encoded job object>
// ─────────────────────────────────────────────────────────────────────────────
router.get('/pipeline-stream', async (req, res) => {
  let job;
  try {
    // Express has already URL-decoded req.query — calling decodeURIComponent
    // again would double-decode any '%' in the JD (e.g. "20% YoY") and either
    // corrupt the JSON or throw URIError on malformed sequences like "%YoY".
    job = JSON.parse(req.query.job || '{}');
  } catch (e) {
    console.error('[pipeline-stream] JSON.parse failed:', e.message);
    return res.status(400).json({ error: 'Invalid job param — must be URL-encoded JSON' });
  }

  if (!job.title || !job.company || !job.tags) {
    return res.status(400).json({ error: 'Job object must have title, company, and tags' });
  }

  // SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const send = (data) => {
    try { res.write(`data: ${JSON.stringify(data)}\n\n`); } catch (e) {
      console.error('SSE write error:', e.message);
    }
  };

  // Handle client disconnect
  let aborted = false;
  req.on('close', () => { aborted = true; });

  try {
    // ── STEP 1: JD Analysis ───────────────────────────────────────────────────
    send({ step: 'jd', status: 'start' });

    const jdPrompt = `Analyze this job description and return structured JSON only.

JD: ${job.title} at ${job.company}
${job.desc}
Tags: ${job.tags.join(', ')}

Sahil's profile: Node.js, TypeScript, Python, PostgreSQL, AWS, PyTorch, RAG, Qdrant, Apache Spark, REST APIs, Docker, Flask, FastAPI, React, Angular, SQL Server, TimescaleDB, Kafka, gRPC.

Rules for "missing_skills":
- Only list recognizable technologies, languages, frameworks, libraries, or platforms (e.g., Python, Go, Kubernetes, GraphQL, vSphere, Terraform, Snowflake).
- Do NOT list product names, brand names, internal assistant names, or platform names that happen to appear capitalized in the JD (e.g., "Ruby AI", "Sage", "Copilot", "Einstein", "Watson"). These are products, not skills a candidate would learn.
- If a token appears in the JD only adjacent to words like "AI", "Cloud", "Assistant", "Platform", "Suite", or as the name of the hiring company's product, treat it as a proper noun and exclude it.
- When in doubt, omit — false positives here mislead the tailoring step downstream.

Return this JSON (no markdown fences, no commentary):
{
  "match_score": <0-100>,
  "matched_skills": ["skill1","skill2"],
  "missing_skills": ["gap1","gap2"],
  "key_themes": ["theme1","theme2"],
  "emphasis": "one of: AI/ML | Data Engineering | Backend | Full Stack",
  "headline": "one-line positioning statement for Sahil for this role"
}`;

    let jdRaw = '';
    if (!aborted) {
      await streamText(jdPrompt, 600, (chunk) => {
        jdRaw += chunk;
        if (!aborted) send({ step: 'jd', type: 'chunk', text: chunk });
      });
    }

    const jdParsed = safeParseJSON(jdRaw);
    if (jdParsed.error) {
      send({ step: 'jd', status: 'done', data: null, parseError: jdParsed.error });
      console.warn('JD analysis JSON parse failed:', jdParsed.error);
    } else {
      send({ step: 'jd', status: 'done', data: jdParsed.data });
    }

    const jdData = jdParsed.data;

    // ── STEP 2: Resume Tailoring (JSON-out) ───────────────────────────────────
    // The LLM emits JSON matching RESUME_BASE_JSON's schema. We parse, apply
    // adjacency-skill injection (deterministic, not LLM), then render the text
    // version for UI display + validation. PDF generation later uses the JSON
    // directly via generate_resume.py — text never round-trips.
    if (aborted) { res.end(); return; }
    send({ step: 'resume', status: 'start' });

    const emphasis = jdData?.emphasis || 'Backend';
    const resumePrompt = buildResumePrompt(job, emphasis);

    // Stream into a buffer instead of pushing chunks to UI — JSON tokens look
    // ugly mid-flight, and we render the polished text in one shot at the end.
    let resumeJsonRaw = '';
    await streamText(resumePrompt, 4000, (chunk) => {
      resumeJsonRaw += chunk;
      // Keep UI alive with a heartbeat that doesn't dump JSON tokens to it.
      if (!aborted && resumeJsonRaw.length % 400 < chunk.length) {
        send({ step: 'resume', type: 'progress', generated: resumeJsonRaw.length });
      }
    });

    let tailoredJson;
    const parsed = safeParseJSON(resumeJsonRaw);
    if (parsed.error) {
      console.warn('[resume] LLM did not return valid JSON, falling back to base. Error:', parsed.error);
      tailoredJson = RESUME_BASE_JSON;
      send({ step: 'resume', type: 'warning', message: 'LLM JSON parse failed — using base resume. ' + parsed.error });
    } else {
      tailoredJson = parsed.data;
    }

    // Post-LLM character-budget audit. Warn-only — the 3-tier render fallback
    // in pdfRender.js is the real safety net. This log gives a clear signal
    // BEFORE the render attempts, so prompt drift (LLM ignoring the budget
    // rule) is visible in the server console without waiting for a fallback.
    try {
      const tailoredChars = sumBulletChars(tailoredJson);
      const overBudget = tailoredChars - BASE_BULLET_CHAR_BUDGET;
      if (overBudget > 0) {
        console.warn(
          `[ai.tailoring] tailored output exceeds char budget by ${overBudget} chars ` +
          `(${tailoredChars} of ${BASE_BULLET_CHAR_BUDGET}) — render fallback likely to fire`
        );
      } else if (overBudget < -200) {
        // Tailored is significantly under-budget — flag for the opposite reason
        // (page may render thin even after gap distribution).
        console.log(
          `[ai.tailoring] tailored output is ${-overBudget} chars under budget ` +
          `(${tailoredChars} of ${BASE_BULLET_CHAR_BUDGET}) — page may underfill`
        );
      }
    } catch (e) {
      console.warn('[ai.tailoring] budget audit threw:', e.message);
    }

    // Apply adjacency: inject JD-required skills the candidate lacks but has a
    // close-enough adjacent skill for. Skills NOT in the curated map are never
    // added — no fabrication.
    const jdRequiredSkills = (jdData?.matched_skills || [])
      .concat(jdData?.missing_skills || [])
      .concat(job.tags || []);
    const adjacencyResult = applyAdjacency(tailoredJson, jdRequiredSkills);
    tailoredJson = adjacencyResult.json;

    // Render text version for UI display + validation.
    const resumeText = renderResumeText(tailoredJson);
    const validation = validateResumeOutput(resumeText);
    const diff = generateResumeDiff(RESUME_BASE, resumeText);

    // Send the rendered text as a single chunk so the UI shows the final resume.
    send({ step: 'resume', type: 'chunk', text: resumeText });
    send({
      step: 'resume',
      status: 'done',
      validation,
      diff,
      adjacencyAdded: adjacencyResult.added,
    });

    // ── STEP 3: Cover Letter ───────────────────────────────────────────────────
    if (aborted) { res.end(); return; }
    send({ step: 'cover', status: 'start' });

    const coverPrompt = `Write a cover letter for Sahil Mehta applying to ${job.title} at ${job.company}.

Current date: ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}.

CANDIDATE FACTS (use ONLY these — do not invent):
${CANDIDATE_FACTS}

JD-specific tech tags from this listing: ${job.tags.join(', ')}.

TARGET: ${job.title} at ${job.company}
JD: ${job.desc}
TONE: Confident & direct

RULES:
- 3 tight paragraphs: opening hook → core evidence → confident close
- NO filler: never use "I am excited to apply", "I would be a great fit", "I am writing to express my interest", "passionate about", "excited to bring", "proven track record"
- Write as Sahil, first person, natural and specific
- Reference 2-3 specific achievements WITH exact numbers from the candidate facts above
- Name the company and role specifically
- End with a direct, confident call to action
- DO NOT fabricate any claim, metric, or experience not listed above
- Return ONLY the letter body (no date, no header, no "Dear Hiring Manager")
- If the TARGET company is in a regulated-enterprise domain (financial services, banking, telecom, healthcare, insurance, government, fintech, regtech, compliance tech), explicitly highlight in one body paragraph that the candidate has shipped production AI against regulated enterprise data (T-Mobile billing accounts, device identifiers, line state transitions, multi-tenant reseller hierarchies, audit-traceable state-mutating operations). This is a 0-3yr engineer differentiator — most candidates at this level have only touched toy datasets. Do NOT include this paragraph if the TARGET is a pure AI-research shop or general-purpose tooling company where regulated-data experience isn't load-bearing.`;

    let coverText = '';
    await streamText(coverPrompt, 900, (chunk) => {
      coverText += chunk;
      if (!aborted) send({ step: 'cover', type: 'chunk', text: chunk });
    });
    send({ step: 'cover', status: 'done' });

    // ── STEP 4: Q&A ────────────────────────────────────────────────────────────
    if (aborted) { res.end(); return; }
    send({ step: 'qa', status: 'start' });

    const defaultQs = [
      'Why are you interested in this role?',
      'Describe a challenging technical project you led end-to-end.',
      'How do you approach debugging a complex production issue?',
      `Tell us about your experience with ${job.tags[0] || 'your primary tech stack'}.`,
      'Where do you see yourself in 3 years?',
    ];

    const qaPrompt = `Answer these job application questions for Sahil Mehta applying to ${job.title} at ${job.company}.

CANDIDATE FACTS (use ONLY these — do not invent):
${CANDIDATE_FACTS}

QUESTIONS:
${defaultQs.map((q, i) => `${i + 1}. ${q}`).join('\n')}

RULES:
- 3-5 sentences per answer, first person, specific and concrete
- Cite real achievements with exact numbers from the candidate facts above
- Sound like a confident human, not a chatbot
- Never fabricate claims or metrics
- Tailor to ${job.company} specifically
- Return valid JSON array: [{"q":"...","a":"..."}]
- Return ONLY valid JSON. No markdown fences, no commentary.
- For questions about your background or fit, if the company is in a regulated-enterprise domain (financial services, telecom, healthcare, insurance, government, fintech), explicitly note the candidate's production experience with regulated enterprise data — billing data, customer identifiers, audit-traceable transactions, multi-tenant reseller hierarchies. This is rare experience at the 0-3yr level and a real differentiator for these domains.`;

    let qaRaw = '';
    await streamText(qaPrompt, 1800, (chunk) => {
      qaRaw += chunk;
      if (!aborted) send({ step: 'qa', type: 'chunk', text: chunk });
    });

    const qaParsed = safeParseJSON(qaRaw);
    if (qaParsed.error) {
      send({ step: 'qa', status: 'done', data: null, parseError: qaParsed.error });
      console.warn('Q&A JSON parse failed:', qaParsed.error);
    } else {
      send({ step: 'qa', status: 'done', data: qaParsed.data });
    }

    // ── STEP 5: Save bundle to ~/Desktop/JobApplications/{slug}/ ──────────────
    // Best-effort — if save fails (e.g., disk full, permissions), pipeline still
    // completes successfully and surfaces the error to the UI as a warning.
    let saveResult = null;
    try {
      saveResult = await saveApplicationBundle({
        company: job.company,
        title: job.title,
        resumeJson: tailoredJson,
        coverText,
        jdAnalysis: jdData,
        candidateName: RESUME_BASE_JSON.name,
      });
      send({
        step: 'save',
        status: 'done',
        folder: saveResult.folder,
        files: saveResult.files,
        renderInfo: saveResult.renderInfo,
      });

      // Surface 3-tier render fallback to the UI. When the resume couldn't
      // render at adjusted spacing (or at all), the saved PDF on disk differs
      // from the tailored output the user just saw stream in — they MUST be
      // told before they submit, otherwise they ship the wrong artifact.
      const fb = saveResult.renderInfo && saveResult.renderInfo.resumeFallback;
      if (fb && fb !== 'none') {
        send({
          step: 'resume',
          status: 'warning',
          fallback: fb,
          fillPct: saveResult.renderInfo.resumeFillPct,
          message: fb === 'base-content'
            ? 'Tailored content was too long for 1 page — fell back to BASE resume. The PDF saved is your canonical base, not the tailored version shown above.'
            : 'Tailored content overflowed at adjusted spacing — fell back to default spacing. PDF is tailored but with reduced page fill.',
        });
      }

      // ── Post-generation validator ───────────────────────────────────────
      // Runs 12 deterministic checks against the saved bundle (file integrity,
      // identity drift, resume structure, cover salutation/signoff, JD
      // relevance). Catches the failure mode where Rubrik's resume shipped
      // as 0 bytes plus the FreedomCare-class issues (missing salutation,
      // wrong company spelling). Hard fails surface as a 'validation' SSE
      // event marked status:'fail' so the UI can block submit. We do NOT
      // auto-retry — the user decides.
      try {
        send({ step: 'validation', status: 'start' });
        const valResult = await runBundleChecks(saveResult.folder);
        const hardFails = valResult.checks.filter(c => !c.passed && c.severity !== 'warn');
        const warns     = valResult.checks.filter(c => !c.passed && c.severity === 'warn');
        const status    = hardFails.length === 0 ? 'done' : 'fail';
        send({
          step: 'validation',
          status,
          passed: valResult.checks.length - hardFails.length - warns.length,
          total:  valResult.checks.length,
          hardFails: hardFails.map(c => ({ name: c.name, reason: c.reason })),
          warns:     warns.map(c => ({ name: c.name, reason: c.reason })),
          checks:    valResult.checks,
        });
        if (hardFails.length > 0) {
          console.warn(
            `[validate] ${saveResult.folder} failed ${hardFails.length} check(s): ` +
            hardFails.map(c => `${c.name} (${c.reason})`).join('; ')
          );
        }
      } catch (e) {
        console.error('[validate] Validator threw:', e.message);
        send({ step: 'validation', status: 'error', message: e.message });
      }
    } catch (e) {
      console.error('[save] Failed to save application bundle:', e.message);
      send({ step: 'save', status: 'error', message: e.message });
    }

    // ── DONE ──────────────────────────────────────────────────────────────────
    send({
      step: 'complete',
      status: 'done',
      resume: resumeText,
      cover: coverText,
      qa: qaParsed.data,
      jd: jdData,
      resumeValidation: validation,
      resumeDiff: diff,
      savedTo: saveResult?.folder || null,
      adjacencyAdded: adjacencyResult.added,
    });
    res.end();

  } catch (e) {
    console.error('Pipeline stream error:', e.message, e.stack);
    send({ step: 'error', message: e.message });
    res.end();
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/ai/tailor-resume  (non-streaming fallback)
// ─────────────────────────────────────────────────────────────────────────────
router.post('/tailor-resume', async (req, res) => {
  const { job } = req.body;
  if (!job) return res.status(400).json({ error: 'job object required' });
  if (!job.title || !job.company || !job.tags) {
    return res.status(400).json({ error: 'job must have title, company, and tags' });
  }

  const prompt = buildResumePrompt(job, 'Backend');

  try {
    const msg = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1800,
      messages: [{ role: 'user', content: prompt }],
    });
    const resumeText = msg.content[0].text;
    const validation = validateResumeOutput(resumeText);
    const diff = generateResumeDiff(RESUME_BASE, resumeText);
    res.json({ resume: resumeText, validation, diff });
  } catch (e) {
    console.error('tailor-resume error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/ai/cover-letter
// ─────────────────────────────────────────────────────────────────────────────
router.post('/cover-letter', async (req, res) => {
  const { job, tone = 'Confident & direct' } = req.body;
  if (!job) return res.status(400).json({ error: 'job object required' });

  const prompt = `Write a cover letter for Sahil Mehta applying to ${job.title} at ${job.company}.

CANDIDATE FACTS (use ONLY these — do not invent):
- CS + Data Science UW-Madison 2025
- Enidus SWE: Node.js BFF (OAuth/PoP), multi-tenant RBAC reporting, RAG chatbot (FastAPI/Qdrant/GPT-4o-mini)
- RAG capstone: 73% accuracy, 40% latency reduction, 22K+ docs
- Core skills: ${job.tags.join(', ')}
JD: ${job.desc}
TONE: ${tone}

3 tight paragraphs. No filler openers ("excited to apply", "passionate about", etc.). Specific achievements with exact numbers. Direct close. Do not fabricate.
Return ONLY the letter body (no date/header).`;

  try {
    const msg = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 900,
      messages: [{ role: 'user', content: prompt }],
    });
    res.json({ letter: msg.content[0].text });
  } catch (e) {
    console.error('cover-letter error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/ai/qa
// ─────────────────────────────────────────────────────────────────────────────
router.post('/qa', async (req, res) => {
  const { job, questions } = req.body;
  if (!job) return res.status(400).json({ error: 'job object required' });

  const defaultQs = [
    'Why are you interested in this role?',
    'Describe a challenging technical project you led end-to-end.',
    'How do you handle debugging a complex production issue?',
    `Tell us about your experience with ${job.tags?.[0] || 'your primary tech stack'}.`,
    'Where do you see yourself in 3 years?',
  ];
  const qs = questions?.length ? questions : defaultQs;

  const prompt = `Answer these questions for Sahil Mehta applying to ${job.title} at ${job.company}.
CANDIDATE FACTS (use ONLY these — do not invent): SWE at Enidus (Node.js BFF, OAuth, RBAC, RAG chatbot w/ 52 tests). RAG capstone (73% accuracy, 40% latency, 22K+ docs). Orahi (80% manual effort reduction). GSPANN (97% CNN accuracy). Skills: ${job.tags.join(', ')}.
QUESTIONS:
${qs.map((q, i) => `${i + 1}. ${q}`).join('\n')}
3-5 sentences each, first person, cite exact numbers. Do not fabricate claims. Return JSON array [{"q":"...","a":"..."}] only. No markdown fences.`;

  try {
    const msg = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1500,
      messages: [{ role: 'user', content: prompt }],
    });
    const parsed = safeParseJSON(msg.content[0].text);
    if (parsed.error) {
      return res.status(502).json({ error: 'Model returned invalid JSON', detail: parsed.error });
    }
    res.json({ qa: parsed.data });
  } catch (e) {
    console.error('qa error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/ai/custom-question
// ─────────────────────────────────────────────────────────────────────────────
router.post('/custom-question', async (req, res) => {
  const { question, job } = req.body;
  if (!question) return res.status(400).json({ error: 'question required' });

  const prompt = `Answer this application question for Sahil Mehta${job ? ` applying to ${job.title} at ${job.company}` : ''}.

QUESTION: ${question}

CANDIDATE FACTS (use ONLY these — do not invent): CS + DS grad UW-Madison 2025. Full-time SWE at Enidus (Node.js BFF, OAuth/PoP, multi-tenant RBAC reporting, RAG AI chatbot with FastAPI/Qdrant, 52 pytest tests). RAG capstone (22K docs, 73% accuracy, 40% latency reduction). Core skills: Node.js, TypeScript, Python, PostgreSQL, AWS, PyTorch, Apache Spark.

3-5 sentences, first person, cite specific achievements with exact numbers from the facts above. Do not fabricate. Confident, human tone. Return ONLY the answer text.`;

  try {
    const msg = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 400,
      messages: [{ role: 'user', content: prompt }],
    });
    res.json({ answer: msg.content[0].text });
  } catch (e) {
    console.error('custom-question error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/ai/analyze-jd  — analyze a pasted JD
// ─────────────────────────────────────────────────────────────────────────────
router.post('/analyze-jd', async (req, res) => {
  const { jd } = req.body;
  if (!jd) return res.status(400).json({ error: 'jd text required' });
  if (jd.length < 50) return res.status(400).json({ error: 'JD text too short — paste the full description' });

  const prompt = `Analyze this job description and return structured JSON only.

JD TEXT: ${jd}

Sahil's profile: Node.js, TypeScript, Python, PostgreSQL, AWS, PyTorch, RAG, Qdrant, Apache Spark, REST APIs, Docker, Flask, FastAPI, React, Angular, SQL Server, TimescaleDB.

Return this JSON (no markdown fences, no commentary):
{
  "title": "inferred title",
  "company": "company name if visible",
  "skills": ["skill1","skill2"],
  "experience_years": "e.g. 0-2",
  "role_type": "one of: AI Engineer | Software Engineer | Data Engineer | Data Scientist | ML Engineer",
  "key_themes": ["theme1","theme2"],
  "match_score": <0-100>,
  "matched_skills": ["matched1"],
  "missing_skills": ["gap1"],
  "headline": "one-line positioning statement for Sahil"
}`;

  try {
    const msg = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 600,
      messages: [{ role: 'user', content: prompt }],
    });
    const parsed = safeParseJSON(msg.content[0].text);
    if (parsed.error) {
      return res.status(502).json({ error: 'Model returned invalid JSON', detail: parsed.error });
    }
    res.json(parsed.data);
  } catch (e) {
    console.error('analyze-jd error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/ai/bulk-qa — answer any list of questions in one call
// Body: { questions: string[], job?: object }
// Returns: { qa: [{q, a}] }
// ─────────────────────────────────────────────────────────────────────────────
router.post('/bulk-qa', async (req, res) => {
  const { questions, job } = req.body;
  if (!questions || !Array.isArray(questions) || questions.length === 0) {
    return res.status(400).json({ error: 'questions array required' });
  }
  if (questions.length > 25) {
    return res.status(400).json({ error: 'Max 25 questions per call' });
  }

  const roleCtx = job ? `${job.title} at ${job.company}` : 'a software engineering role';
  const skillCtx = job?.tags?.length ? job.tags.join(', ') : 'Node.js, TypeScript, Python, PostgreSQL, AWS, PyTorch, RAG, Docker';

  const prompt = `You are answering job application questions on behalf of Sahil Mehta, applying for ${roleCtx}.

CANDIDATE FACTS — use ONLY these, never invent:
- CS + Data Science double major, University of Wisconsin-Madison, May 2025
- Software Developer at Enidus USA LLC (full-time, Jun 2025–present, NYC):
  • RAG AI Chatbot: FastAPI, GPT-4o-mini, Qdrant, 3-layer security (parameterized SQL + session scoping + RLS), 8 RBAC roles, 6-intent classifier, 9 audit tables, 52 pytest tests; React/TypeScript chat UI; Dockerized
  • Node.js BFF for T-Mobile carrier APIs: OAuth/PoP auth, secure header signing, Axios orchestration with retry/fallback
  • Multi-tenant reporting system: RBAC enforcement, parameterized queries, cron scheduling, CSRF/XSS protection
- RAG capstone (Denari, Jan–May 2025): 22K+ docs, 300K+ embeddings, 73% QA accuracy, 40% latency reduction, 25+ features, TypeScript/TimescaleDB/Docker/S3/OpenAI
- Orahi internship (Jul–Aug 2024): bus route algorithm (80% manual effort reduction), Flask REST APIs (15% latency improvement), K-means clustering (10% crash reduction)
- GSPANN internship (Jun–Aug 2023): CNN pneumonia detection, 97% test accuracy
- Core skills: ${skillCtx}
- Work authorization: US authorized, no sponsorship needed

QUESTIONS TO ANSWER:
${questions.map((q, i) => `${i + 1}. ${q}`).join('\n')}

RULES:
- Answer each question in 3–5 sentences, first person, conversational but professional
- Cite specific numbers and achievements from the facts above — never round or inflate them
- Tailor each answer to ${job ? `${job.company} and ` : ''}the question asked
- If a question is personal preference (e.g. pronouns, salary, availability), provide a direct factual answer based on: pronouns=he/him, salary=open to market rate, availability=2 weeks notice or immediate
- If it's a values/culture question, answer authentically based on Sahil's actual work (collaboration, clear systems, ownership)
- Sound human — not corporate, not a chatbot, not a resume bullet list
- Never fabricate tools, metrics, or experience not in the facts above

Return ONLY a valid JSON array with no markdown fences:
[{"q": "exact question text", "a": "answer text"}, ...]`;

  try {
    const msg = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 300 * questions.length + 200,
      messages: [{ role: 'user', content: prompt }],
    });
    const parsed = safeParseJSON(msg.content[0].text);
    if (parsed.error) {
      return res.status(502).json({ error: 'Model returned invalid JSON', detail: parsed.error, raw: msg.content[0].text.slice(0, 500) });
    }
    res.json({ qa: parsed.data });
  } catch (e) {
    console.error('bulk-qa error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/ai/resume-base — return the source resume for diff display
// ─────────────────────────────────────────────────────────────────────────────
router.get('/resume-base', (req, res) => {
  res.json({ resume: RESUME_BASE });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/ai/validate-resume — validate resume text against guardrails
// ─────────────────────────────────────────────────────────────────────────────
router.post('/validate-resume', (req, res) => {
  const { resume } = req.body;
  if (!resume) return res.status(400).json({ error: 'resume text required' });
  const validation = validateResumeOutput(resume);
  const diff = generateResumeDiff(RESUME_BASE, resume);
  res.json({ validation, diff });
});

module.exports = router;
module.exports.RESUME_BASE = RESUME_BASE;
module.exports.validateResumeOutput = validateResumeOutput;
module.exports.generateResumeDiff = generateResumeDiff;
module.exports.safeParseJSON = safeParseJSON;
module.exports.BANNED_RESUME_PHRASES = BANNED_RESUME_PHRASES;
