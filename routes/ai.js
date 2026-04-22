const express = require('express');
const Anthropic = require('@anthropic-ai/sdk');
const router = express.Router();

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ─────────────────────────────────────────────────────────────────────────────
// SAHIL'S BASE RESUME — source of truth for all AI tailoring
// ─────────────────────────────────────────────────────────────────────────────
const RESUME_BASE = `SAHIL MEHTA
New York City, NY | sahilmehta0204@gmail.com | ${process.env.RESUME_PHONE || '[phone available on request]'}

EDUCATION
University of Wisconsin, Madison
B.S. Computer Science | B.S. Data Science (double major) — May 2025

PROFESSIONAL EXPERIENCE

Software Developer — Enidus USA LLC. (Full-Time) | Jun 2025–Present, Hicksville NY

  Custom Reporting System
  • Led end-to-end development of a governed, user-configurable reporting system with multi-tenant isolation over predefined datasets.
  • Implemented tenant-scoped parameterized queries and RBAC enforcement for strict data isolation across enterprise portals.
  • Built backend services in Node.js/Express for report definitions, dynamic query execution, cron-based scheduling, and exports.
  • Secured execution pipeline with CSRF protection, XSS sanitization, and Content Security Policy enforcement.

  Backend-For-Frontend (BFF) Infrastructure
  • Built a Node.js BFF using Express, serving an Angular frontend as the sole integration layer to multiple T-Mobile carrier APIs.
  • Implemented OAuth-based auth flows with per-request PoP token generation, secure header signing, and session-scoped credential handling.
  • Orchestrated downstream API calls via Axios with validation, response aggregation, transformation, and normalization.
  • Implemented retry logic, timeout handling, and fallback paths for intermittent carrier API failure resilience.

  RAG AI Chatbot — ControlCenter T-Mobile for Business
  • Architected a production NL-to-SQL AI assistant over live telecom account data using FastAPI, GPT-4o-mini, and Qdrant, enabling business users to query BANs, SIM lines, and activations in plain English without SQL access.
  • Engineered a 3-layer security model (parameterized SQL templates + session-injected reseller scoping + SQL Server RLS) across 8 RBAC roles, with the LLM restricted to tool selection only — never raw SQL generation — eliminating prompt injection as an attack surface.
  • Built a vector knowledge layer across 4 Qdrant domains (glossary, schema, tool catalog, runbooks) with per-tenant hard-filtering, routing 100% of queries through a 6-intent classifier before any data access.
  • Instrumented 9 SQL governance tables for audit logging, tool registry, and RLS policy management; enforced PII redaction across 6 field types (MSISDN, SIM/ICCID, IMEI, IMSI, email, tax_id) from all logs and LLM context.
  • Delivered full-stack implementation with a React/TypeScript chat UI, session-aware conversation context, Dockerized services, and 52 passing pytest unit tests across intent, planning, and execution layers.

  T-Mobile PIL API Gateway
  • Designed and built a Node.js/TypeScript Express API gateway as a compatibility layer between legacy T-Mobile for Business clients and T-Mobile's Partner Integration Layer (PIL) Order API v2, allowing enterprise clients to migrate with zero client-side code changes.
  • Implemented ~20 full-stack operation adapters (SuspendLine, RestoreLine, CancelLine, SimSwap pSIM/eSIM, ChangeService, ChangePhoneNumber, device orders, UpdateOrder, NpaNxx search, usage, payments, validateAddress) with forward schema translation into PIL's productOrder envelope and reverse mappers for legacy response shapes.
  • Designed a unified auth model via a single POST /auth/token endpoint accepting client HS256 JWTs, jti-allowlist verification against a ClientTokens SQL table, and issuance of 3 tokens per request (T-Mobile access, T-Mobile ID, and a short-lived service JWT with embedded permissions).
  • Implemented T-Mobile PoP token signing (RS256 with x5t fingerprint header and ath/edts body-hash claims), ensuring zero T-Mobile credentials leave the server and that jti revocation takes effect in under 1 request round-trip rather than at token expiry.
  • Built parameterized permission middleware, per-request correlation IDs, a log scrubber rewriting secrets to last-4-character tails, and per-route file rotation.
  • Delivered an admin portal and Next.js 16 App Router developer portal with self-service token rotation in under 60 seconds, one-time JWT reveal UX, and idempotency-key headers to prevent double-mint on retried requests.
  • Executed a production recovery migration using sp_rename over a cursor on sys.check_constraints to resolve constraint dependency issues; authored node:test suites using a require.cache DB-stub pattern to eliminate network and DB dependencies in CI.

  Enterprise AI Copilot — T-Mobile Fleet Management
  • Architected an agent-ready enterprise AI copilot with a FastAPI/Python backend (6.2K LOC) and a React 19 + TypeScript + Vite + Tailwind frontend (15K LOC), designed for hot-swap replacement of the intent router by an LLM planning agent.
  • Designed a 53-intent NLU routing layer dispatching to 43 Pydantic-typed tool handlers, with contracts shaped for direct compatibility with Claude and GPT-4 function-calling and tool results structured for agent consumption.
  • Built multi-step transactional wizard flows for device purchase, line suspend, and plan upgrade, with shared state, confirmation surfaces, and cart-style orchestration across 10+ domain panels (BillingDashboard, UsageDashboard, EipDashboard, DevicePanel, FloatingCart, AlertPanel, ActivityCards).
  • Implemented streaming response infrastructure and session-aware conversation state on FastAPI, with a React 19 chat interface rendering domain-specific panels inline alongside assistant messages.
  • Designed AlertPanel to surface usage anomalies and billing spikes proactively, with the architecture prepared for agent-pushed notifications via the same streaming transport.

Software Developer — Orahi (Internship) | Jul–Aug 2024, Remote
  • Built a dynamic bus route adjustment algorithm for new student assignments, reducing manual effort by 80%.
  • Optimized vehicle telemetry ingestion using Flask REST APIs, reducing location update latency by 15%.
  • Applied K-means clustering to balance bus loads under time constraints, reducing app crashes by 10%.

Data Scientist — GSPANN Technologies (Internship) | Jun–Aug 2023, Remote
  • Built and evaluated a CNN-based pneumonia detection model using chest X-rays; achieved 97% test accuracy via preprocessing and augmentation.

PROJECTS

RAG Pipeline — Denari AI Capstone | Jan–May 2025, Madison WI
  • Built and deployed a full-stack RAG system (TypeScript, TimescaleDB, Docker, S3, OpenAI APIs) processing 22K+ documents and 300K+ embeddings.
  • Implemented hybrid retrieval (BM25, TF-IDF) with semantic re-ranking, achieving 73% QA benchmark accuracy.
  • Reduced end-to-end query latency by 40% via optimized chunking, parallel embedding generation, and hypertable indexing.
  • Led Agile/Scrum development delivering 25+ production-grade features across ingestion, embeddings, DB, and retrieval modules.

SKILLS
Languages: Java, JavaScript/TypeScript, Python, C, Kotlin, Swift, R
Frameworks: Node.js, Express, React, Next.js, Angular, Vite, Tailwind, FastAPI, Flask, Django, React Native, Pydantic
Databases & APIs: SQL, SQL Server, PostgreSQL, TimescaleDB, GraphQL, REST, gRPC, AWS S3, JWT/OAuth, PoP tokens
AI/ML: TensorFlow, Keras, PyTorch, Scikit-learn, OpenAI APIs, Claude function-calling, RAG, vector search, Qdrant
Big Data: Apache Spark, Hadoop, HDFS, Kafka, PyArrow, Pandas, NumPy, Matplotlib
Tools: Docker, Git, Bash, Postman, JIRA, Agile/Scrum
Certifications: SnowPro Associate & Core (2024)`;

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

  // Check that core sections exist
  const requiredSections = ['EDUCATION', 'PROFESSIONAL EXPERIENCE', 'SKILLS'];
  for (const section of requiredSections) {
    if (!resumeText.toUpperCase().includes(section)) {
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

  const valid = bannedFound.length === 0 && warnings.filter(w => w.includes('fabrication')).length === 0;
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

TARGET ROLE: ${job.title} at ${job.company}
REQUIRED SKILLS: ${job.tags.join(', ')}
JD: ${job.desc}
EMPHASIS: ${emphasis}

SOURCE RESUME (this is the ONLY source of truth):
${RESUME_BASE}

STRICT RULES — violations will cause rejection:

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

4. TONE: Write like a competent engineer describing their own work — concrete, specific, plain language. Not like a resume-writing service.

5. If the JD requires skills or experience the source resume does NOT clearly demonstrate, DO NOT fabricate coverage. Simply omit or leave the resume as-is for that area.

6. Return ONLY the full resume text in the same plain-text format. No commentary, no markdown, no explanation.`;
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/ai/pipeline-stream  — SSE streaming: JD → resume → cover → Q&A
// Query: job=<JSON encoded job object>
// ─────────────────────────────────────────────────────────────────────────────
router.get('/pipeline-stream', async (req, res) => {
  let job;
  try {
    job = JSON.parse(decodeURIComponent(req.query.job || ''));
  } catch {
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

    // ── STEP 2: Resume Tailoring ───────────────────────────────────────────────
    if (aborted) { res.end(); return; }
    send({ step: 'resume', status: 'start' });

    const emphasis = jdData?.emphasis || 'Backend';
    const resumePrompt = buildResumePrompt(job, emphasis);

    let resumeText = '';
    await streamText(resumePrompt, 1800, (chunk) => {
      resumeText += chunk;
      if (!aborted) send({ step: 'resume', type: 'chunk', text: chunk });
    });

    // Validate resume output
    const validation = validateResumeOutput(resumeText);
    const diff = generateResumeDiff(RESUME_BASE, resumeText);
    send({
      step: 'resume',
      status: 'done',
      validation,
      diff,
    });

    // ── STEP 3: Cover Letter ───────────────────────────────────────────────────
    if (aborted) { res.end(); return; }
    send({ step: 'cover', status: 'start' });

    const coverPrompt = `Write a cover letter for Sahil Mehta applying to ${job.title} at ${job.company}.

CANDIDATE (use ONLY these facts — do not invent):
- CS + Data Science grad, UW-Madison, May 2025
- ~1 year full-time SWE at Enidus USA LLC: Node.js BFF for T-Mobile carrier APIs with OAuth/PoP auth; governed multi-tenant reporting system with RBAC; production RAG AI chatbot (FastAPI, GPT-4o-mini, Qdrant) with 3-layer security model
- RAG capstone: 22K+ docs, 300K+ embeddings, 73% QA accuracy, 40% latency reduction
- Orahi internship: dynamic route algo (80% manual effort reduction), Flask REST APIs
- Core skills: ${job.tags.join(', ')}, Node.js, TypeScript, Python, PostgreSQL, AWS S3, PyTorch, Apache Spark

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
- Return ONLY the letter body (no date, no header, no "Dear Hiring Manager")`;

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
- CS + Data Science grad UW-Madison 2025
- Full-time SWE at Enidus: Node.js BFF for T-Mobile APIs (OAuth/PoP auth), multi-tenant RBAC reporting, RAG AI chatbot (FastAPI/Qdrant/GPT-4o-mini, 3-layer security, 8 RBAC roles, 52 pytest tests)
- RAG capstone: 22K docs, 300K+ embeddings, 73% accuracy, 40% latency reduction, 25+ features
- Orahi: 80% manual effort reduction, 15% latency improvement
- GSPANN: 97% CNN accuracy

QUESTIONS:
${defaultQs.map((q, i) => `${i + 1}. ${q}`).join('\n')}

RULES:
- 3-5 sentences per answer, first person, specific and concrete
- Cite real achievements with exact numbers from the candidate facts above
- Sound like a confident human, not a chatbot
- Never fabricate claims or metrics
- Tailor to ${job.company} specifically
- Return valid JSON array: [{"q":"...","a":"..."}]
- Return ONLY valid JSON. No markdown fences, no commentary.`;

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
