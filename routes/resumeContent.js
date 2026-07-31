// ─────────────────────────────────────────────────────────────────────────────
// resumeContent.js — Single source of truth for Sahil's resume.
//
// Stored as STRUCTURED JSON matching the schema consumed by generate_resume.py.
// All renderers (plain-text for prompts/UI, PDF via Python) derive from this.
// Why JSON: lets the LLM emit modified content matching a strict schema, which
// is far more reliable than parsing free-form text. Format never drifts.
// ─────────────────────────────────────────────────────────────────────────────

const PHONE = process.env.RESUME_PHONE || '608-960-5508';

// ─────────────────────────────────────────────────────────────────────────────
// CANDIDATE_FACTS — single source of truth for facts the AI prompts cite.
//
// Both the cover letter prompt and Q&A prompt in routes/ai.js interpolate this
// constant. When the resume content changes, edit this string AND update the
// corresponding bullets in RESUME_BASE_JSON. Both must stay in sync.
//
// Discovered after §9.3 (April 2026) and again 2026-05-11: the prompts
// hardcoded stats that had been trimmed from the resume. Centralizing the
// facts here makes drift visible as a single-file diff.
// ─────────────────────────────────────────────────────────────────────────────
const CANDIDATE_FACTS = `
- B.S. Computer Science + B.S. Data Science, UW-Madison (graduated May 2025; ~1 year full-time experience since)
- Full-time AI/Full-Stack Engineer at Enidus USA LLC (June 2025 - present): sole engineer on three plugins for T-Mobile for Business enterprise portal
- DOMAIN EXPERIENCE: ships production AI against regulated enterprise telecom data — billing account numbers (BANs), device SKUs/IMEIs, line state transitions (active/suspended/ported/cancelled), multi-tenant reseller hierarchies (resellers managing enterprise customer accounts). Real audit-traceable state-mutating operations on real customer data, not toy datasets. The kind of regulatory-shaped work that maps cleanly to financial services, healthcare, and other regulated-enterprise AI domains.
- Plugin 1 — Agentic AI Copilot: 53 intents, 43 Pydantic-typed tool handlers, stage-and-confirm safety pattern (every write requires user approval), 52 pytest cases parametrized to 400+ invocations, zero LLM-hallucination incidents in pilot with 15 reseller tenants / 25+ enterprise customers / 100+ daily portal users. Stack: FastAPI, Python, Qdrant per-tenant collections, Claude / GPT-4 function-calling, PostgreSQL with row-level security, 8-role RBAC.
- Engineering depth — hybrid retrieval: designed a hybrid retrieval pipeline combining Qdrant vector search with BM25 keyword retrieval via Reciprocal Rank Fusion (RRF, k around 60), with optional Cohere/Voyage re-ranker as a cost-gated precision pass for the device catalog and forthcoming knowledge base. Productionized Qdrant Cloud (aria-prod cluster, AWS us-east-1) with local Docker fallback for offline dev.
- Engineering depth — cost engineering for consumer-scale: built embedding LRU cache keyed by (query_hash, model_name) targeting at least 70% hit rate; pure-identifier fast-paths (phones, ICCIDs 19-20 digit, EIDs 32-digit, IMEIs 15-digit, reference numbers) bypass embedding entirely via regex pre-routing; designed confidence-bucketing on Qdrant intent scores so high-confidence matches skip the LLM tool-call round-trip; designed embedding model tiering (cheap text-embedding-3-small on hot path, premium text-embedding-3-large reserved for precision-critical re-ranking only).
- Engineering depth — state machine durability: replaced in-memory _sessions: dict state with durable SQL-backed flow state machine (ragbot.ai_flow_state table, optimistic locking via state_version). Supports 9 multi-step transaction flows: suspend, resume, deactivate, activate, rate-plan-change, bulk-action, order-eSIMs, order-pre-activated-SIMs, order-non-activated-SIMs.
- Engineering depth — architectural judgment: led a routing-architecture inversion from lexical-first to vector-first when product direction pivoted to consumer-facing (high paraphrase variance, typos at scale, no portal-terminology training). Required productionizing Qdrant as a hard dependency. Inverted gate logic so lexical detectors run only for pure-identifier fast-paths; everything else flows through embedding similarity plus LLM tool-call.
- Plugin 2 — Custom Reports & Dashboards: full-stack self-serve analytics product built end-to-end alone. React + Vite frontend, Node.js + Express backend, SQL Server with stored procedures. Hardened via stored-procedure CRUD contracts, two-layer filter validation, runtime tenant-clause injection, JWT + per-session CSRF, strict CSP, AES-256-CBC encryption.
- Plugin 3 — Carrier API Gateway (BFF): Node.js + Express, OAuth + per-request PoP token generation, sole integration layer to T-Mobile carrier APIs.
- RAG capstone (UW-Madison, Jan-May 2025): 22K+ documents, 300K+ embeddings, hybrid retrieval (BM25 + TF-IDF) with semantic re-ranking, 73% QA accuracy, 40% query-latency reduction. Stack: TypeScript, TimescaleDB, Docker, S3, OpenAI APIs. Led Agile delivery of 25+ production features.
- Orahi internship (Jul-Aug 2024): K-means clustering algorithm for dynamic bus route adjustment, 80% reduction in manual student-assignment effort. Flask REST APIs for telemetry ingestion.
- GSPANN internship (Jun-Aug 2023): CNN-based pneumonia detection on chest X-rays; iterated on preprocessing and data augmentation to improve generalization.
- Core skills: Python, TypeScript, JavaScript, FastAPI, Node.js, Express, React, Anthropic Claude, OpenAI APIs, tool calling, RAG, Qdrant, Pydantic, PostgreSQL, SQL, Docker, AWS S3, PyTorch, JWT/OAuth, RBAC, streaming/SSE.
- chef-drop-brief (May 2026, https://github.com/sahilmehta17/chef-drop-brief): installable Claude Code Skill that drafts Braze-ready chef-drop lifecycle campaigns (email + SMS + push + A/B variants + send-time recommendation) for CookUnity-style meal-delivery launches. Built specifically for the CookUnity AI Native Engineer, Growth Marketing application — ports the Enidus eval-gated-LLM pattern to growth-marketing copy. MIT-licensed, single-line install, brand-agnostic via swappable reference fixtures.
- chef-drop-brief — 9 deterministic copy evals that gate every draft before it ships: (1) claimed-fact verification against a pinned chef catalog (hallucination catch), (2) dietary-contradiction matching on chef tags, (3) banned-cliché regex, (4) brand-voice cosine similarity using sentence-transformers MiniLM-L6-v2 against seeded voice anchors, (5) channel-correct CTAs, (6) channel character limits, (7) personalization-token presence, (8) policy safety (no medical claims), (9) positive voice-signal detection (anthropomorphic verbs, wordplay, em-dash asides).
- chef-drop-brief — field-scoped one-shot revision loop: when an eval fails, the pipeline regenerates only the failing field and keeps every other byte identical. Most "AI marketing tools" regenerate the whole draft on every retry; this preserves work and keeps revisions cheap.
- chef-drop-brief — 20 pytest tests covering all 9 evals plus the revision logic and CLI surfaces.
- chef-drop-brief target roles: Growth-AI / Lifecycle-AI / GTM-AI roles, DTC subscription companies, companies using Braze / Klaviyo / Customer.io / Postscript or similar lifecycle platforms, roles naming Claude Code / Claude Skills / MCP / AI workflow orchestration, and any role mentioning brand voice, copy eval, content quality pipelines, or marketing AI safety.
- chef-drop-brief adjacency tags earned: Claude Code Skills, MCP, Anthropic SDK, Braze, lifecycle marketing, CRM, sentence-transformers, eval-driven LLM safety, structured-output, field-scoped revision loops.
`.trim();

const RESUME_BASE_JSON = {
  name: 'Sahil Mehta',
  // Contact items can be plain strings or { text, url } objects (renderers
  // make the latter clickable). Linkedin and Github show as the word with the
  // URL hidden underneath; Github is also surfaced via the (Github) suffix on
  // the ClaudeJob project entry.
  contact: [
    'New York City, NY · Open to relocation',
    'sahilmehta0204@gmail.com',
    PHONE,
    { text: 'sahilmehta.dev', url: 'https://sahilmehta.dev' },
    { text: 'Github', url: 'https://github.com/sahilmehta17' },
    { text: 'Linkedin', url: 'https://www.linkedin.com/in/sahil-mehta-87357b1b9/' },
  ],
  // Summary removed — every fact in it appeared elsewhere on the resume
  // within ~3 lines. The work speaks; the cover letter (per-JD via ClaudeJob)
  // does the framing job better. The "Open to relocation" tag merged into the
  // contact line so the only piece of information unique to the summary
  // doesn't get lost.
  summary: '',
  sections: [
    {
      type: 'experience',
      header: 'PROFESSIONAL EXPERIENCE',
      items: [
        {
          // Company-as-header format (Enidus only): `title` holds the company,
          // rendered as the bold header line with date/location; `role` renders
          // as an italic subline beneath. Orahi/GSPANN keep the single-line
          // "Role, Company (Internship)" title with no `role` field.
          title: 'Enidus USA LLC. (Full-Time)',
          role: 'AI/Full-Stack Engineer',
          date: 'June 2025 - Present',
          location: 'Hicksville, NY',
          subsections: [
            {
              name: 'AI Chatbot & Agentic Copilot for T-Mobile for Business',
              bullets: [
                "Shipped a multi-tenant conversational AI assistant for a T-Mobile IoT reseller platform (FastAPI, Anthropic Claude / OpenAI function-calling, Qdrant, PostgreSQL on Azure); 9 LLM-orchestrated workflows collapse 10-12 portal clicks per reseller action into a single natural-language command. In pilot with 15 tenants, 25+ customers, 100+ users.",
                "Designed a hybrid retrieval layer combining Qdrant vector search with BM25 keyword retrieval via Reciprocal Rank Fusion (k=60) and regex fast-paths for identifier inputs; led a vector-first routing inversion when the product pivoted consumer-facing, moving intent top-1 accuracy from 73.5% to 89.0% on a 442-query eval corpus.",
                "Built defense-in-depth safety at the LLM boundary: 43 Pydantic-typed tool handlers with RBAC-filtered catalogs the model never sees in full, parameterized SQL templates with row-level security at execution, per-tenant Qdrant isolation, and user-confirmed writes; zero hallucination incidents in pilot.",
                "Migrated in-memory session state to a durable SQL-backed flow state machine (optimistic locking, automatic session expiration), preserving 9 multi-step transaction flows across deploys and worker scaling.",
              ],
            },
            {
              name: 'Custom Reports & Dashboards Platform',
              bullets: [
                "Owned a self-serve full-stack analytics product end-to-end alone (React, Node.js + Express, SQL Server with stored procedures) letting enterprise customers compose reports, custom dashboards, and charts over their own data; cut analytics turnaround from days to minutes.",
                "Hardened against multi-tenant attack classes via stored-procedure CRUD contracts, two-layer filter validation, runtime tenant-clause injection, JWT auth, per-session CSRF rotation, strict CSP, and AES-256-CBC encryption.",
              ],
            },
            {
              name: 'Carrier API Gateway (BFF)',
              bullets: [
                "Built a TypeScript BFF (Node.js + Express) as the sole integration layer to T-Mobile's carrier APIs, with per-request RS256 Proof-of-Possession token generation over OAuth 2.0 and a translation layer mapping legacy portal formats to the new PIL API contract.",
              ],
            },
          ],
        },
        {
          title: 'Software Developer, Orahi (Internship)',
          date: 'July 2024 - August 2024',
          location: 'Remote',
          subsections: [
            {
              name: '',
              bullets: [
                "Designed a dynamic bus route adjustment algorithm using K-means clustering, reducing manual student-assignment effort by 80%; optimized Flask REST APIs for telemetry ingestion.",
              ],
            },
          ],
        },
        {
          title: 'Data Scientist, GSPANN Technologies Inc. (Internship)',
          date: 'June 2023 - August 2023',
          location: 'Remote',
          subsections: [
            {
              name: '',
              bullets: [
                "Built a CNN-based pneumonia detection model on chest X-ray images; iterated on preprocessing and data augmentation to improve generalization.",
              ],
            },
          ],
        },
      ],
    },
    {
      type: 'projects',
      header: 'PROJECTS',
      items: [
        // NOTE: chef-drop-brief intentionally NOT in BASE — its 2 bullets
        // (771 chars) pushed total over the 1-page render budget. The project
        // remains in CANDIDATE_FACTS (cover letters + tailored resumes pull
        // it from there) and in ADJACENCY_MAP (Claude Code Skills / MCP /
        // Braze / lifecycle-marketing JDs still trigger its adjacency tags).
        // For Growth-AI roles where chef-drop-brief should lead the resume,
        // the LLM tailoring step pulls it from CANDIDATE_FACTS and inserts
        // ahead of ClaudeJob — see the targeted regenerate scripts in
        // scripts/regenerate_*.js for examples.
        {
          title: 'CloudGuard - Reliability & Safety Harness for LLM Cloud Agents',
          date: 'July 2026 | Personal Project',
          url: 'https://github.com/sahilmehta17/cloudguard',
          bullets: [
            "Built a test-driven eval and safety harness (Python, FastAPI, MCP, sentence-transformers) for LLM agents operating cloud infrastructure against a real AWS mock (Moto); 57 tests, all headline numbers written to committed JSON artifacts.",
            "Showed a bag-of-words tool-router degrades tool-selection to 0.83 while an embeddings router recovers it to 1.00 (Sonnet and Haiku); added blast-radius guardrails (1.00 precision and recall) and an indirect prompt-injection red-team cutting the hijack-attempt rate to 0 percent.",
          ],
        },
        {
          title: 'ClaudeJob - Agentic Resume Tailoring Pipeline',
          date: 'April 2026 - Present | Personal Project',
          url: 'https://github.com/sahilmehta17/claudejob',
          bullets: [
            "Built an end-to-end agentic pipeline (Node.js + Anthropic SDK + SSE streaming) that ingests live job postings, tailors a structured-output JSON resume per role, and generates pixel-matching PDFs via pdfkit; actively used to power my own AI Engineer applications.",
            "Engineered a validator suite mirroring LLM-content failure modes: 30+ banned AI-resume cliché regex, source-fact validation against a pinned base to catch fabricated stats, and a jargon-lead heuristic. Deterministic adjacency-skill injection (curated, never LLM-fabricated); 47 passing unit tests.",
          ],
        },
        // NOTE: Denari RAG capstone moved OUT of BASE on 2026-07-23 to make room
        // for CloudGuard while keeping the resume on one page (adding CloudGuard's
        // 2 bullets + a third project header pushed the render to 2 pages; the
        // third header is the load-bearing cost, not just the bullet chars). Denari
        // remains fully in CANDIDATE_FACTS above, so cover letters and per-JD
        // tailored resumes still pull it; for capstone/academic-heavy JDs the
        // tailoring step can reinsert it ahead of a weaker entry.
      ],
    },
    {
      // Education moved below experience + projects (2026-07-23): with ~1 year
      // of full-time experience plus strong projects, the work leads; the degree
      // sits just above skills. Graduation date removed per preference.
      type: 'education',
      header: 'EDUCATION',
      items: [
        {
          institution: 'University of Wisconsin, Madison',
          degree: 'B.S. in Computer Science | B.S. in Data Science (double major)',
        },
      ],
    },
    {
      type: 'skills',
      header: 'TECHNICAL SKILLS',
      items: [
        { label: 'AI / LLM Systems', value: 'LLM APIs (Claude, OpenAI), tool calling, agent orchestration, RAG, vector search (Qdrant), prompt engineering, eval frameworks, structured outputs (Pydantic), streaming/SSE, sentence-transformers, PyTorch, TensorFlow' },
        { label: 'Languages', value: 'Python, JavaScript/TypeScript, Java, C, SQL, Kotlin, Swift, R. Cert: SnowPro Associate & Core (2024).' },
        { label: 'Frameworks', value: 'FastAPI, Node.js, Express, React, Next.js, Angular, Flask, Django, React Native' },
        { label: 'Infra & Tools', value: 'PostgreSQL, REST, gRPC, AWS S3, GCP, Docker, Kubernetes, Git, Claude Code, Claude Code Skills, MCP, JWT/OAuth, RBAC' },
      ],
    },
  ],
};

// ─────────────────────────────────────────────────────────────────────────────
// renderResumeText(json) → plain text
// Used for: (a) prompt context to the LLM, (b) UI display, (c) text validation.
// PDF generation goes JSON → Python (generate_resume.py) without round-tripping.
// ─────────────────────────────────────────────────────────────────────────────
function renderResumeText(json) {
  const lines = [];
  const sep = '_'.repeat(85);

  lines.push(json.name);
  // Contact items can be plain strings or { text, url } objects.
  const contactStrs = (json.contact || []).map(p => (typeof p === 'string' ? p : p.text));
  lines.push(contactStrs.join(' | '));
  if (json.summary) lines.push(json.summary);
  lines.push(sep);

  for (const section of json.sections) {
    lines.push(section.header);
    if (section.type === 'education') {
      for (const item of section.items) {
        lines.push(item.institution);
        const right = item.graduation ? `  ${item.graduation}` : '';
        lines.push(`${item.degree}${right}`);
      }
    } else if (section.type === 'experience') {
      for (const item of section.items) {
        const right = [item.date, item.location].filter(Boolean).join(' | ');
        lines.push(`${item.title}  ${right}`.trim());
        if (item.role) lines.push(item.role);
        for (const sub of item.subsections || []) {
          if (sub.name) lines.push(sub.name);
          for (const b of sub.bullets || []) lines.push(`• ${b}`);
        }
      }
    } else if (section.type === 'projects') {
      for (const item of section.items) {
        const right = item.date ? `  ${item.date}` : '';
        lines.push(`${item.title}${right}`);
        for (const b of item.bullets || []) lines.push(`• ${b}`);
      }
    } else if (section.type === 'skills') {
      for (const item of section.items) {
        lines.push(`${item.label}: ${item.value}`);
      }
    }
    lines.push(sep);
  }

  return lines.join('\n');
}

// ─────────────────────────────────────────────────────────────────────────────
// ADJACENCY_MAP — JD-required skill → list of user-skills that justify the claim.
//
// If the JD requires a skill the candidate doesn't list, but that skill has an
// adjacency match against a skill the candidate DOES have, the pipeline appends
// it to the skills section. No LLM = no fabrication risk.
//
// Curate conservatively. The rule of thumb: if I had a half-day to ramp up on X
// from my existing knowledge of Y, list Y as an adjacency for X. If X requires a
// week of dedicated learning beyond Y, leave it out — that's overclaiming.
//
// Edit this map whenever a JD comes through with a skill you'd legitimately put
// on a resume tomorrow if asked. Keep keys lowercased — matching is case-insensitive.
// ─────────────────────────────────────────────────────────────────────────────
const ADJACENCY_MAP = {
  // Languages — only auto-add if there's a near-syntactic-twin
  'typescript':       ['javascript'],
  'javascript':       ['typescript'],

  // Backend frameworks — same language, similar request lifecycle
  'fastapi':          ['flask', 'django'],
  'flask':            ['fastapi', 'django'],
  'django':           ['fastapi', 'flask'],
  'express':          ['node.js', 'nodejs'],
  'nestjs':           ['express', 'node.js'],

  // Frontend — same paradigm, similar component model
  'next.js':          ['react'],
  'nextjs':           ['react'],
  'remix':            ['react'],
  'preact':           ['react'],

  // Databases — same SQL family, transferable
  'postgresql':       ['sql server', 'sql', 'mysql'],
  'postgres':         ['sql server', 'sql', 'mysql'],
  'mysql':            ['postgresql', 'sql server', 'sql'],
  'sql server':       ['postgresql', 'mysql', 'sql'],
  'sqlite':           ['postgresql', 'mysql', 'sql server', 'sql'],

  // Cloud object storage — near-identical APIs across providers
  'gcs':              ['aws s3', 's3'],
  'google cloud storage': ['aws s3', 's3'],
  'azure blob':       ['aws s3', 's3'],
  'azure blob storage': ['aws s3', 's3'],
  's3':               ['aws s3'],

  // Container / orchestration
  'podman':           ['docker'],

  // ML / vector dbs — close cousins
  'pinecone':         ['qdrant', 'vector search'],
  'weaviate':         ['qdrant', 'vector search'],
  'chroma':           ['qdrant', 'vector search'],
  'chromadb':         ['qdrant', 'vector search'],
  'milvus':           ['qdrant', 'vector search'],
  'pgvector':         ['qdrant', 'postgresql', 'vector search'],

  // LLM frameworks
  'langchain':        ['anthropic claude', 'openai apis', 'function-calling'],
  'langgraph':        ['langchain', 'anthropic claude', 'openai apis', 'function-calling', 'tool calling'],
  'llamaindex':       ['rag', 'qdrant', 'openai apis'],
  'openai sdk':       ['openai apis'],
  'anthropic sdk':    ['anthropic claude'],
  'claude code':      ['anthropic claude', 'anthropic sdk'],
  'claude code skills': ['anthropic claude', 'anthropic sdk', 'claude code'],
  'claude skills':    ['anthropic claude', 'anthropic sdk', 'claude code'],
  'mcp':              ['anthropic claude', 'tool calling'],
  'model context protocol': ['anthropic claude', 'tool calling'],

  // Embeddings / NLP libs
  'sentence-transformers': ['anthropic claude', 'openai apis', 'rag', 'pytorch'],
  'sentence transformers': ['anthropic claude', 'openai apis', 'rag', 'pytorch'],

  // Lifecycle / CRM platforms — same audience-segmentation + templated-send model
  'braze':            ['lifecycle marketing'],
  'klaviyo':          ['lifecycle marketing', 'braze'],
  'customer.io':      ['lifecycle marketing', 'braze'],
  'postscript':       ['lifecycle marketing', 'braze'],
  'iterable':         ['lifecycle marketing', 'braze'],

  // RPC / API styles
  'protobuf':         ['grpc'],
  'protocol buffers': ['grpc'],

  // Workflow tools
  'github actions':   ['agile/scrum', 'git'],
  'gitlab ci':        ['agile/scrum', 'git'],
  'pytest':           ['python'],
  'jest':             ['javascript', 'typescript'],
  'mocha':            ['javascript', 'node.js'],
  'vitest':           ['javascript', 'typescript', 'jest'],
};

// ─────────────────────────────────────────────────────────────────────────────
// extractUserSkills(jsonResume) → Set of lowercased skill tokens
// ─────────────────────────────────────────────────────────────────────────────
function extractUserSkills(jsonResume) {
  const skillsSection = (jsonResume.sections || []).find(s => s.type === 'skills');
  if (!skillsSection) return new Set();
  const tokens = new Set();
  for (const item of skillsSection.items || []) {
    for (const tok of String(item.value).split(/[,;]/)) {
      const t = tok.trim().toLowerCase();
      if (!t) continue;
      tokens.add(t);
      // Also index without parenthetical qualifiers: "vector search (Qdrant)" → "vector search"
      const stripped = t.replace(/\s*\([^)]*\)\s*/g, '').trim();
      if (stripped && stripped !== t) tokens.add(stripped);
      // ALSO extract anything inside parens as its own skill: "(Qdrant)" → "qdrant".
      // Resume style "vector search (Qdrant)" means BOTH are on the resume.
      const parenMatches = [...t.matchAll(/\(([^)]+)\)/g)];
      for (const m of parenMatches) {
        for (const inner of m[1].split(/[,;]/)) {
          const it = inner.trim();
          if (it) tokens.add(it);
        }
      }
    }
  }
  return tokens;
}

// ─────────────────────────────────────────────────────────────────────────────
// applyAdjacency(jsonResume, jdRequiredSkills, opts)
//
// For each JD-required skill not already on the resume, check the adjacency map.
// If any user-skill in the adjacency list is present, append the JD skill to the
// most appropriate skills line (heuristic: use the line that contains the most
// adjacency matches; default to "Tools & Practices").
//
// Returns { json: modifiedJson, added: [{skill, justifiedBy, addedTo}] }
// ─────────────────────────────────────────────────────────────────────────────
function applyAdjacency(jsonResume, jdRequiredSkills) {
  if (!Array.isArray(jdRequiredSkills) || jdRequiredSkills.length === 0) {
    return { json: jsonResume, added: [] };
  }

  const userSkills = extractUserSkills(jsonResume);
  const skillsSectionIdx = jsonResume.sections.findIndex(s => s.type === 'skills');
  if (skillsSectionIdx === -1) return { json: jsonResume, added: [] };

  // Deep-clone the skills section so we don't mutate the source.
  const next = JSON.parse(JSON.stringify(jsonResume));
  const skillsSection = next.sections[skillsSectionIdx];
  const added = [];

  for (const rawSkill of jdRequiredSkills) {
    const skill = String(rawSkill).trim();
    if (!skill) continue;
    const skillLower = skill.toLowerCase();

    // Skip if already on the resume.
    if (userSkills.has(skillLower)) continue;

    // Look up adjacency — must match a known JD-skill key.
    const adjacencyJustifiers = ADJACENCY_MAP[skillLower];
    if (!adjacencyJustifiers || adjacencyJustifiers.length === 0) continue;

    // Need at least one user-skill to justify the claim.
    const justifiedBy = adjacencyJustifiers.find(j => userSkills.has(j.toLowerCase()));
    if (!justifiedBy) continue;

    // Pick the line to append to. Heuristic: line that already has `justifiedBy`.
    let targetItem = skillsSection.items.find(it =>
      String(it.value).toLowerCase().includes(justifiedBy.toLowerCase())
    );
    if (!targetItem) {
      targetItem = skillsSection.items.find(it => it.label === 'Tools & Practices')
                || skillsSection.items[skillsSection.items.length - 1];
    }

    // Avoid double-add if a previous iteration already added this skill.
    const lineLower = String(targetItem.value).toLowerCase();
    if (lineLower.includes(skillLower)) continue;

    targetItem.value = `${targetItem.value}, ${skill}`;
    userSkills.add(skillLower); // prevent dup adds in same pass
    added.push({ skill, justifiedBy, addedTo: targetItem.label });
  }

  return { json: next, added };
}

// ─────────────────────────────────────────────────────────────────────────────
// SYNONYM_MAP: JD term to the base term(s) it may legitimately replace.
//
// Feeds two consumers: (a) the tailoring prompt, as a hint that these JD
// phrasings are permitted, and (b) the bullet validator's allowlist. The rule
// the validator enforces is deliberately conditional: a synonym may surface in
// a bullet ONLY when that bullet already contains one of its mapped base terms.
// That keeps "semantic search" from appearing on a bullet that never did vector
// search, while still letting the resume speak the JD's vocabulary where the
// underlying work is genuinely the same.
//
// Curate conservatively, same rule of thumb as ADJACENCY_MAP: only pairs where
// the JD term and the base term describe the SAME work, not merely adjacent
// work. Keys and values are lowercased; matching is case-insensitive.
// ─────────────────────────────────────────────────────────────────────────────
const SYNONYM_MAP = {
  'rest apis':               ['apis', 'api', 'rest'],
  'restful':                 ['apis', 'api', 'rest'],
  'restful apis':            ['apis', 'api', 'rest'],
  'semantic search':         ['vector search', 'embedding'],
  'vector database':         ['qdrant', 'vector search'],
  'vector db':               ['qdrant', 'vector search'],
  'hybrid search':           ['hybrid retrieval'],
  'reciprocal rank fusion':  ['rrf'],
  'function calling':        ['function-calling', 'tool calling'],
  'tool use':                ['tool calling', 'function-calling'],
};

// ─────────────────────────────────────────────────────────────────────────────
// FACT_FRAGMENT_MAP: JD keyword to an approved TRUE fragment plus the bullet
// topic(s) it may attach to. Every fragment must be true and traceable to
// CANDIDATE_FACTS. The topic keys match the project classifier in the validator
// (copilot, reports, bff, orahi, gspann, capstone, cloudguard, claudejob), so a
// fragment can only be surfaced on the bullet that actually earned it.
//
// Feeds the prompt as a hint and the validator allowlist as a topic-scoped
// allowed term (stricter than a global allowlist entry: right phrase, right
// bullet, or it flags). Ship small; grow only with facts to back each entry.
// ─────────────────────────────────────────────────────────────────────────────
const FACT_FRAGMENT_MAP = {
  // Facts: "PostgreSQL with row-level security"; base copilot safety bullet
  // already carries "row-level security at execution".
  'row-level security':      { fragment: 'row-level security', topics: ['copilot'] },
  'rls':                     { fragment: 'row-level security', topics: ['copilot'] },
  // Facts: "optimistic locking via state_version" on the SQL-backed flow state
  // machine. Optimistic concurrency control is the standard name for that.
  'optimistic concurrency':  { fragment: 'optimistic concurrency control via state_version', topics: ['copilot'] },
  'optimistic concurrency control': { fragment: 'optimistic concurrency control via state_version', topics: ['copilot'] },
  // Facts + base: "per-tenant Qdrant isolation" / "Qdrant per-tenant collections".
  'multi-tenant isolation':  { fragment: 'per-tenant Qdrant isolation', topics: ['copilot'] },
  'tenant isolation':        { fragment: 'per-tenant Qdrant isolation', topics: ['copilot'] },
};

/**
 * Sum character count of all bullet text across experience + projects sections.
 * Used by the resume tailoring prompt as the hard upper bound for tailored
 * output — the base is known to fit 1 page, so its total bullet char count is
 * the budget tailored variants must not exceed.
 *
 * Skills section is excluded because it's constrained separately (4 lines).
 * Section headers, job titles, dates, subsection names also excluded — they're
 * structural and don't shrink under tailoring.
 */
function sumBulletChars(resumeJson) {
  let total = 0;
  for (const section of resumeJson.sections || []) {
    if (section.type === 'experience') {
      for (const item of section.items || []) {
        for (const sub of item.subsections || []) {
          for (const b of sub.bullets || []) total += String(b).length;
        }
      }
    } else if (section.type === 'projects') {
      for (const item of section.items || []) {
        for (const b of item.bullets || []) total += String(b).length;
      }
    }
  }
  return total;
}

const BASE_BULLET_CHAR_BUDGET = sumBulletChars(RESUME_BASE_JSON);

module.exports = {
  RESUME_BASE_JSON,
  CANDIDATE_FACTS,
  renderResumeText,
  ADJACENCY_MAP,
  applyAdjacency,
  extractUserSkills,
  sumBulletChars,
  BASE_BULLET_CHAR_BUDGET,
  SYNONYM_MAP,
  FACT_FRAGMENT_MAP,
};
