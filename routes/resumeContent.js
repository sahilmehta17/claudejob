// ─────────────────────────────────────────────────────────────────────────────
// resumeContent.js — Single source of truth for Sahil's resume.
//
// Stored as STRUCTURED JSON matching the schema consumed by generate_resume.py.
// All renderers (plain-text for prompts/UI, PDF via Python) derive from this.
// Why JSON: lets the LLM emit modified content matching a strict schema, which
// is far more reliable than parsing free-form text. Format never drifts.
//
// 2026-08-05 (entry-selection-pool brief): the experience and project entries no
// longer live inline. They live in ENTRY_POOL below, each carrying selection
// metadata, and RESUME_BASE_JSON's experience/project item lists are produced by
// the deterministic selectEntries() selector. The DEFAULT selection reproduces
// today's resume EXCEPT GSPANN is benched and GoodEnough takes its freed slot.
// Selection is deterministic code, never an LLM decision.
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
- ROUTING DIRECTION (state this exactly; it is the most-often-garbled fact here). BEFORE = lexical-first: keyword and regex intent detectors ran on every query first, and embedding retrieval was the fallback. AFTER = vector-first: embedding similarity is the primary router for every query, and lexical detectors survive only as a narrow fast-path for pure identifiers (phone numbers, ICCIDs, EIDs, IMEIs, reference numbers). The naive/original state was LEXICAL, not embedding. Never describe the starting point as "just embedding everything", "embedding similarity alone", or "vector search from the start" — that inverts the story. The lesson is that keyword matching broke on paraphrases and typos, so vector retrieval replaced it as the default path.
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
- GoodEnough (started August 2026): a preregistered non-inferiority study testing whether a quantized 1.7B local model (Qwen3, Q4_K_M on a commodity CPU) holds answer quality within a fixed 10-point margin of a hosted 70B baseline (Groq Llama-3.3), evaluating ~1,700 benchmark items across 8 MMLU domains and GSM8K at 95% confidence using exact paired-item intervals (McNemar / Clopper-Pearson). Apparatus is dependency-free Python: paired-item scoring, frozen splits and seeds, a resumable budget-aware runner with per-request token, cost, and latency instrumentation. Measured: local inference costs ~90% less per query but runs ~8x HIGHER p50 latency than the hosted API (local CPU is slower than Groq, roughly 2.4s vs 0.27s per item). LATENCY DIRECTION (state exactly): local is CHEAPER but SLOWER; never say local is faster/lower-latency. Headline accuracy (non-inferior on N of 8 domains) and the exact p50 figures are pending the hosted run / build_map.py.
`.trim();

// ─────────────────────────────────────────────────────────────────────────────
// SECTION_ORDER: canonical top-to-bottom section order (2026-08-04 brief, Fix 3).
//
// Skills leads: at about a year of full-time experience, the skills block is the
// first thing most screeners look for, and it is the cheapest section to scan.
// Experience still outranks projects; education shrinks to the bottom.
//
// This is the ONLY place section order is defined. It is applied to the base at
// module load and re-applied to every tailored resume in routes/ai.js, so the
// order cannot drift just because the tailoring model emitted its sections in a
// different sequence. Same reasoning as the deterministic skills lock: a layout
// invariant belongs in code, not in a prompt instruction the model may ignore.
// ─────────────────────────────────────────────────────────────────────────────
const SECTION_ORDER = ['skills', 'experience', 'projects', 'education'];

/**
 * enforceSectionOrder(json) → json (mutated in place, and returned)
 * Stable-sorts sections into SECTION_ORDER. Any section whose `type` is not in
 * the list keeps its relative position at the end rather than being dropped;
 * reordering must never lose content.
 */
function enforceSectionOrder(json) {
  if (!json || !Array.isArray(json.sections)) return json;
  const rank = (type) => {
    const i = SECTION_ORDER.indexOf(type);
    return i === -1 ? SECTION_ORDER.length : i;
  };
  json.sections = json.sections
    .map((section, i) => ({ section, i }))
    .sort((a, b) => rank(a.section.type) - rank(b.section.type) || a.i - b.i)
    .map(x => x.section);
  return json;
}

// ═════════════════════════════════════════════════════════════════════════════
// ENTRY POOL + DETERMINISTIC SELECTOR (2026-08-05 entry-selection-pool brief)
// ═════════════════════════════════════════════════════════════════════════════

// The one-page render supports roughly THREE project entries at most. A prior
// attempt at a third project header pushed the render to two pages, and the
// recorded cause was the header itself, not just the bullet characters. Enforced
// in the selector.
const MAX_PROJECT_ENTRIES = 3;

// Guardrail: a JD cannot produce an unrecognizable resume. At most this many
// non-default entries may be swapped in per run (across all sections).
const MAX_NON_DEFAULT_SWAPS = 2;

// A small bonus applied to `default: true` entries so score ties resolve to
// today's resume. Kept BELOW 1 so a non-default with a single genuine JD tag
// match (integer score >= 1) always beats a default matching nothing.
const DEFAULT_BONUS = 0.1;

// Part 4: leave the door open for a Publications section later without a schema
// change. `publication` is a permitted kind; nothing renders it today.
const VALID_ENTRY_KINDS = ['experience', 'project', 'publication'];
function isValidEntryKind(kind) {
  return VALID_ENTRY_KINDS.includes(kind);
}

// ─────────────────────────────────────────────────────────────────────────────
// ENTRY_POOL — every experience and project entry, each with selection metadata.
//
// Shape: { id, kind, status, default, pinned, eligible, tags, weight, chrono,
//          item, bulletsByStatus? }
//   status  : 'ready' (may show results) | 'apparatus' (built, no findings) |
//             'planned' (hard-gated off, never selected)
//   default : in the default resume when nothing else wins
//   pinned  : always included, never dropped (Enidus)
//   eligible: false = can never be selected until flipped (mcp-census)
//   chrono  : experience ordering only, higher = more recent (kept chronological
//             in the experience section regardless of score)
//   item    : the existing render item (title/date/url/bullets|subsections)
//   bulletsByStatus: status-gated bullets; resolveEntryItem() picks the set
//
// The `item` objects for the entries that survive in the DEFAULT selection
// (enidus, orahi, cloudguard, claudejob) are byte-identical to the pre-brief
// inline entries — the regression guard depends on that.
// ─────────────────────────────────────────────────────────────────────────────
const ENTRY_POOL = [
  // ── Experience ────────────────────────────────────────────────────────────
  {
    id: 'enidus',
    kind: 'experience',
    status: 'ready',
    default: true,
    pinned: true,
    eligible: true,
    tags: ['fastapi', 'python', 'llm', 'agents', 'rag', 'qdrant', 'postgresql', 'node.js', 'react', 'typescript', 'tool calling', 'vector search', 'multi-tenant', 'telecom'],
    weight: 0,
    chrono: 3,
    item: {
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
  },
  {
    id: 'orahi',
    kind: 'experience',
    status: 'ready',
    default: true,
    pinned: false,
    eligible: true,
    tags: ['python', 'flask', 'rest apis', 'k-means', 'clustering', 'machine learning', 'algorithms'],
    weight: 0,
    chrono: 2,
    item: {
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
  },
  {
    // GSPANN is the weakest, oldest entry and comes OFF the default resume, but
    // it is the only evidence of TRAINING a model rather than calling an API, so
    // it stays available for ML/DS-flavored JDs. Benched, not deleted.
    id: 'gspann',
    kind: 'experience',
    status: 'ready',
    default: false,
    pinned: false,
    eligible: true,
    tags: ['ml', 'deep learning', 'pytorch', 'cnn', 'computer vision', 'data science', 'model training'],
    weight: 0,
    chrono: 1,
    item: {
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
  },

  // ── Projects ──────────────────────────────────────────────────────────────
  // Pool order matters: default project ties resolve to this order, so the
  // default resume renders CloudGuard, ClaudeJob, GoodEnough in that sequence.
  {
    id: 'cloudguard',
    kind: 'project',
    status: 'ready',
    default: true,
    pinned: false,
    eligible: true,
    tags: ['llm', 'agents', 'evals', 'safety', 'prompt injection', 'tool selection', 'mcp', 'python', 'fastapi', 'sentence-transformers', 'reliability', 'aws', 'guardrails'],
    weight: 0,
    dateSort: 202607,
    item: {
      title: 'CloudGuard - Reliability & Safety Harness for LLM Cloud Agents',
      date: 'July 2026 | Personal Project',
      url: 'https://github.com/sahilmehta17/cloudguard',
      bullets: [
        "Built a test-driven eval and safety harness (Python, FastAPI, MCP, sentence-transformers) for LLM agents operating cloud infrastructure against a real AWS mock (Moto); 57 tests, all headline numbers written to committed JSON artifacts.",
        "Showed a bag-of-words tool-router degrades tool-selection to 0.83 while an embeddings router recovers it to 1.00 (Sonnet and Haiku); added blast-radius guardrails (1.00 precision and recall) and an indirect prompt-injection red-team cutting the hijack-attempt rate to 0 percent.",
      ],
    },
  },
  {
    // ClaudeJob benched from the default (2026-08-06): a resume-tailoring tool can
    // read as counterintuitive to some employers, so it yields its default slot to
    // Denari and swaps back in for JDs about agentic pipelines, structured output,
    // SSE, validators, or Anthropic tooling. Content unchanged; still selectable.
    id: 'claudejob',
    kind: 'project',
    status: 'ready',
    default: false,
    pinned: false,
    eligible: true,
    tags: ['llm', 'agents', 'structured outputs', 'evals', 'node.js', 'anthropic', 'sse', 'pipeline', 'python', 'validators'],
    weight: 0,
    dateSort: 202604,
    item: {
      title: 'ClaudeJob - Agentic Resume Tailoring Pipeline',
      date: 'April 2026 - Present | Personal Project',
      url: 'https://github.com/sahilmehta17/claudejob',
      bullets: [
        "Built an end-to-end agentic pipeline (Node.js + Anthropic SDK + SSE streaming) that ingests live job postings, tailors a structured-output JSON resume per role, and generates pixel-matching PDFs via pdfkit; actively used to power my own AI Engineer applications.",
        "Engineered a validator suite mirroring LLM-content failure modes: 30+ banned AI-resume cliché regex, source-fact validation against a pinned base to catch fabricated stats, and a jargon-lead heuristic. Deterministic adjacency-skill injection (curated, never LLM-fabricated); 47 passing unit tests.",
      ],
    },
  },
  {
    // GoodEnough takes the default slot GSPANN vacates. Status 'apparatus':
    // emits only what is BUILT (design, harness, method), never findings. Its
    // bullets point at cost / latency / quantized-local / statistical
    // non-inferiority so they read as visibly different work from CloudGuard's
    // agent-safety framing. The `ready` bullet is a TODO placeholder with the
    // numbers left blank; Sahil flips `status` to 'ready' and fills them from
    // measured results once the per-slice map exists. No predicted results here.
    id: 'goodenough',
    kind: 'project',
    // 'ready' so the outcome bullets render. The metrics are UNMISTAKABLE
    // placeholders ([XX] / [X]) at Sahil's request, not measured results and not
    // realistic-looking fakes: they read as "fill me in" on the page and can
    // never be mistaken for a real claim if the resume ships before the per-slice
    // results map lands. Replace every [..] with a measured number, then this is
    // a fully truthful entry. The apparatus bullet set below is retained (it is
    // the honest, number-free version) if you ever want to revert to it.
    status: 'ready',
    default: true,
    pinned: false,
    eligible: true,
    tags: ['cost', 'latency', 'quantized', 'local inference', 'non-inferiority', 'evals', 'benchmarking', 'statistics', 'llm', 'reproducibility'],
    weight: 0,
    dateSort: 202608,
    item: {
      title: 'GoodEnough - Local vs Hosted LLM Non-Inferiority Study',
      date: 'August 2026 | Research',
      url: 'https://github.com/sahilmehta17/GoodEnough',
    },
    bulletsByStatus: {
      apparatus: [
        "Designed a preregistered non-inferiority study comparing quantized local inference against a hosted LLM baseline on cost, latency, and answer quality, with the non-inferiority margin fixed before any data collection and paired-item measurement across matched prompts.",
        "Built the evaluation apparatus for reproducibility: pinned local and hosted model configs, deterministic scoring, and frozen data splits and seeds, so every cost and latency comparison is auditable and re-runnable.",
      ],
      // Final, Sahil-verified wording (2026-08-06). All figures are measured or
      // conservatively defensible today: 95% CI, 10-point margin, ~1,700 items,
      // 8 MMLU domains + GSM8K, exact paired-item (McNemar / Clopper-Pearson),
      // ~90% lower cost, ~8x HIGHER p50 latency for local (CPU is slower than the
      // hosted Groq API; ~2.4s vs ~0.27s per item). Do NOT reverse the latency
      // direction: local is CHEAPER but SLOWER. Two figures become exact once the
      // hosted run + build_map.py finish (~2 days out): the exact latency p50, and
      // a headline "non-inferior on N of 8 domains" line.
      ready: [
        "Ran a preregistered non-inferiority study testing whether a quantized 1.7B local model (Qwen3, Q4_K_M on a commodity CPU) holds answer quality within a 10-point margin of a hosted 70B baseline (Llama-3.3), evaluating ~1,700 benchmark items across 8 MMLU domains and GSM8K at 95% confidence using exact paired-item (McNemar / Clopper-Pearson) intervals.",
        "Built the evaluation apparatus in dependency-free Python (paired-item scoring, frozen splits and seeds, a resumable budget-aware runner with per-request token, cost, and latency instrumentation); measured local inference at ~90% lower cost per query but ~8x higher p50 latency than the hosted API, and mapped which domains the small model matches within the margin.",
      ],
    },
  },
  {
    // Denari (RAG capstone) holds a default project slot (2026-08-06, promoted
    // from benched when ClaudeJob was benched). Content drawn from CANDIDATE_FACTS,
    // facts unchanged. Being the oldest project (2025) it renders last by date.
    id: 'denari',
    kind: 'project',
    status: 'ready',
    default: true,
    pinned: false,
    eligible: true,
    tags: ['rag', 'retrieval', 'embeddings', 'bm25', 'tf-idf', 'vector search', 'timescaledb', 'docker', 's3', 'semantic search', 're-ranking'],
    weight: 0,
    dateSort: 202505,
    item: {
      title: 'Denari - Hybrid-Retrieval RAG over 22K+ Documents',
      date: 'January 2025 - May 2025 | UW-Madison Capstone',
      bullets: [
        "Built a retrieval-augmented QA system over 22K documents and 300K embeddings (TypeScript, TimescaleDB, Docker, S3, OpenAI APIs), using hybrid BM25 + TF-IDF retrieval with semantic re-ranking to reach 73% QA accuracy.",
        "Cut query latency 40% and led Agile delivery of 25+ production features across the capstone team.",
      ],
    },
  },
  {
    // chef-drop-brief: benched, selectable for Growth-AI / lifecycle / Claude
    // Code Skills / MCP / Braze JDs. Content from CANDIDATE_FACTS.
    id: 'chef-drop-brief',
    kind: 'project',
    status: 'ready',
    default: false,
    pinned: false,
    eligible: true,
    tags: ['claude code skills', 'mcp', 'braze', 'lifecycle marketing', 'evals', 'sentence-transformers', 'anthropic sdk', 'growth', 'crm', 'copy'],
    weight: 0,
    dateSort: 202605,
    item: {
      title: 'chef-drop-brief - Eval-Gated Lifecycle Campaign Generator',
      date: 'May 2026 | Personal Project',
      url: 'https://github.com/sahilmehta17/chef-drop-brief',
      bullets: [
        "Built and published an installable Claude Code Skill that drafts Braze-ready chef-drop lifecycle campaigns (email, SMS, push, A/B variants) for meal-delivery launches, porting an eval-gated LLM pattern to growth-marketing copy.",
        "Gated every draft behind 9 deterministic copy evals (claimed-fact verification, dietary-contradiction checks, banned-cliche regex, brand-voice cosine similarity, channel limits, policy safety) with a field-scoped one-shot revision loop; 20 pytest tests.",
      ],
    },
  },
  {
    // MCP tool-selection census: not started. Hard-gated OFF (status 'planned'
    // and eligible:false) so it can never be selected until both are flipped.
    id: 'mcp-census',
    kind: 'project',
    status: 'planned',
    default: false,
    pinned: false,
    eligible: false,
    tags: ['mcp', 'model context protocol', 'tool selection', 'evals', 'census', 'benchmarking'],
    weight: 0,
    dateSort: 0,
    item: {
      title: 'MCP Tool-Selection Census',
      date: 'Planned',
      bullets: [],
    },
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// RESUME_TEMPLATE — the resume shell around the pool-selected entries. Holds the
// fixed, non-pool content: name, contact, summary, skills, education, plus the
// experience/projects section headers whose item lists the selector fills.
// ─────────────────────────────────────────────────────────────────────────────
const RESUME_TEMPLATE = {
  name: 'Sahil Mehta',
  // Contact items can be plain strings or { text, url } objects (renderers
  // make the latter clickable). Linkedin and Github show as the word with the
  // URL hidden underneath; Github is also surfaced via the (Github) suffix on
  // the ClaudeJob project entry.
  contact: [
    'New York City, NY · Open to relocation',
    'sahilmehta0204@gmail.com',
    PHONE,
    { text: 'Portfolio', url: 'https://sahilmehta.dev' },
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
    { type: 'experience', header: 'PROFESSIONAL EXPERIENCE', items: [] },
    { type: 'projects', header: 'PROJECTS', items: [] },
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
      // ── Skills (2026-08-05 brief, Part 5: balance) ────────────────────────
      // Four labeled groups, redistributed so the four rendered lines sit within
      // ~15% of each other in length and the block does NOT open with the
      // longest line (the old base opened with the long "AI / LLM Systems" line,
      // stepping the right edge inward down the block). Order now leads with
      // Languages; the longest line (Infra & Tools) sits last.
      //
      // Redistribution moves, no invented skills: PyTorch joined the AI/LLM line
      // (it is the ML runtime behind the AI work), "structured outputs
      // (Pydantic)" joined Frameworks (Pydantic is a framework/lib), and "vector
      // search (Qdrant)" joined Infra & Tools (Qdrant is the vector DB).
      //
      // Removed from the base line: "sentence-transformers". Verified against
      // ADJACENCY_MAP first — it is a MAP *key* (a JD that names it re-injects it
      // via applyAdjacency, justified by rag / pytorch / openai apis, which all
      // remain), never a justifier VALUE another key depends on, so removing it
      // severs no adjacency path. Same precedent as the 2026-08-04 removal of
      // "Claude Code Skills" and "streaming/SSE". The claim also survives in the
      // CloudGuard and chef-drop-brief project bullets and in CANDIDATE_FACTS.
      //
      // All 19 ADJACENCY_MAP justifier VALUES still appear here (aws s3, claude
      // code, django, docker, express, fastapi, flask, git, grpc, node.js,
      // postgresql, python, pytorch, qdrant, rag, react, sql, tool calling,
      // vector search), so applyAdjacency keeps every path it had. Re-check with
      // scripts/measure_layout.js before trimming further.
      //
      // "eval frameworks" is deliberately retained and kept on the AI line:
      // evaluation and observability is the differentiator most candidates omit.
      // No proficiency labels, star ratings, or self-rated years, by design.
      type: 'skills',
      header: 'TECHNICAL SKILLS',
      items: [
        { label: 'Languages', value: 'Python, JavaScript/TypeScript, Java, C, SQL, R. Cert: SnowPro Associate & Core (2024).' },
        { label: 'AI / LLM Systems', value: 'LLM APIs (Claude, OpenAI), tool calling, agent orchestration, RAG, eval frameworks, PyTorch' },
        { label: 'Frameworks', value: 'FastAPI, Node.js, Express, React, Next.js, Flask, Django, structured outputs (Pydantic)' },
        { label: 'Infra & Tools', value: 'PostgreSQL, gRPC, AWS S3, Docker, Git, Claude Code, MCP, JWT/OAuth, RBAC, vector search (Qdrant)' },
      ],
    },
  ],
};

// ─────────────────────────────────────────────────────────────────────────────
// Selector internals (all deterministic, no LLM).
// ─────────────────────────────────────────────────────────────────────────────

// Whole-token, case-insensitive match of `tag` against a JD haystack. Boundaries
// are non-alphanumeric so multi-word tags ("vector search", "model training")
// and punctuated tags ("tf-idf", "node.js") match as whole tokens, not
// substrings ("s3" must not match inside "s3cret").
function tokenMatch(tag, haystack) {
  const t = String(tag).toLowerCase().trim();
  if (!t) return false;
  const esc = t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp('(^|[^a-z0-9])' + esc + '([^a-z0-9]|$)', 'i');
  return re.test(haystack);
}

function scoreEntry(entry, haystack) {
  let tagScore = 0;
  for (const tag of entry.tags || []) if (tokenMatch(tag, haystack)) tagScore++;
  const score = tagScore + (entry.weight || 0) + (entry.default ? DEFAULT_BONUS : 0);
  return { score, tagScore };
}

// Resolve the render item for an entry, applying status gating: an 'apparatus'
// entry emits only its apparatus bullets; a 'ready' entry emits its ready
// bullets (or the item's own bullets when no status-gated set is given).
function resolveEntryItem(entry) {
  const item = JSON.parse(JSON.stringify(entry.item || {}));
  if (entry.bulletsByStatus) {
    if (entry.status === 'apparatus') {
      item.bullets = JSON.parse(JSON.stringify(entry.bulletsByStatus.apparatus || []));
    } else if (entry.status === 'ready') {
      item.bullets = JSON.parse(JSON.stringify(entry.bulletsByStatus.ready || entry.item.bullets || []));
    }
  }
  return item;
}

// Character count of an entry's resolved bullets (matches sumBulletChars scope:
// bullet text only, across item.bullets and any subsection bullets).
function entryBulletChars(entry) {
  const item = resolveEntryItem(entry);
  let n = 0;
  for (const b of item.bullets || []) n += String(b).length;
  for (const sub of item.subsections || []) {
    for (const b of sub.bullets || []) n += String(b).length;
  }
  return n;
}

// ─────────────────────────────────────────────────────────────────────────────
// enforceProjectDateOrder(json) → json (mutated, returned)
// Deterministic ORDER lock for the projects section: sort items newest-first by
// the date they actually carry, so the render order cannot drift regardless of
// how a tailoring LLM reordered them. Parses "Month YYYY" out of the date string
// (taking the LATEST month in a range like "January 2025 - May 2025"); falls back
// to a bare 4-digit year, else sorts to the end. Same rationale as the skills and
// section-order locks: a layout invariant belongs in code, not a prompt.
// ─────────────────────────────────────────────────────────────────────────────
const MONTH_INDEX = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
};
function latestYearMonth(dateStr) {
  const s = String(dateStr || '');
  const re = /(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{4})/gi;
  let best = -1, m;
  while ((m = re.exec(s))) {
    const v = Number(m[2]) * 100 + MONTH_INDEX[m[1].toLowerCase()];
    if (v > best) best = v;
  }
  if (best === -1) {
    const y = /(\d{4})/.exec(s);
    if (y) best = Number(y[1]) * 100;
  }
  return best;
}
function enforceProjectDateOrder(json) {
  if (!json || !Array.isArray(json.sections)) return json;
  const sec = json.sections.find(s => s.type === 'projects');
  if (!sec || !Array.isArray(sec.items)) return json;
  sec.items = sec.items
    .map((it, i) => ({ it, i }))
    .sort((a, b) => latestYearMonth(b.it.date) - latestYearMonth(a.it.date) || a.i - b.i)
    .map(x => x.it);
  return json;
}

function buildResumeJson(experienceItems, projectItems) {
  const json = JSON.parse(JSON.stringify(RESUME_TEMPLATE));
  const expSec = json.sections.find(s => s.type === 'experience');
  const projSec = json.sections.find(s => s.type === 'projects');
  if (expSec) expSec.items = experienceItems;
  if (projSec) projSec.items = projectItems;
  return enforceSectionOrder(json);
}

// ─────────────────────────────────────────────────────────────────────────────
// selectEntries(pool, jdRequiredSkills, jdText, budget, opts)
//
// Deterministic entry selection. Returns:
//   { json, selected: [{id, score, reason}], dropped: [{id, reason}] }
//
// Algorithm:
//   1. Drop status:'planned' and eligible:false (hard gates).
//   2. Always include pinned entries; seed defaults.
//   3. Score each entry: JD tag matches + weight + default bonus.
//   4. Rank non-default candidates (that match at least one JD tag) and swap
//      them in, at most MAX_NON_DEFAULT_SWAPS per run. Projects are capped at
//      MAX_PROJECT_ENTRIES: a swap-in displaces the lowest-scoring default
//      project only if it outscores it. Experience swap-ins are additive.
//   5. Enforce the char budget: drop the lowest-scoring non-pinned entries
//      (non-defaults first) until the total fits.
//   6. Experience stays chronological; projects are ordered by score.
// ─────────────────────────────────────────────────────────────────────────────
function selectEntries(pool, jdRequiredSkills = [], jdText = '', budget = BASE_BULLET_CHAR_BUDGET, opts = {}) {
  const maxProjects = opts.maxProjectEntries != null ? opts.maxProjectEntries : MAX_PROJECT_ENTRIES;
  const maxSwaps = opts.maxSwaps != null ? opts.maxSwaps : MAX_NON_DEFAULT_SWAPS;

  const haystack = (`${[].concat(jdRequiredSkills || []).join(' ')} ${jdText || ''}`).toLowerCase();

  const selected = [];
  const dropped = [];

  // 1. eligibility filter (hard gates)
  const eligible = [];
  for (const e of pool) {
    if (e.status === 'planned') { dropped.push({ id: e.id, reason: 'status planned (hard gate)' }); continue; }
    if (e.eligible === false) { dropped.push({ id: e.id, reason: 'eligible:false (hard gate)' }); continue; }
    eligible.push(e);
  }

  const scoreOf = new Map();
  for (const e of eligible) scoreOf.set(e.id, scoreEntry(e, haystack));

  const isProject = (e) => e.kind === 'project';
  const isExperience = (e) => e.kind === 'experience';

  // Entries of a kind with no render section today (e.g. publication) are never
  // placed. Recorded as dropped so the reason is visible on SSE/console.
  for (const e of eligible) {
    if (!isProject(e) && !isExperience(e)) {
      dropped.push({ id: e.id, reason: `kind '${e.kind}' has no render section yet` });
    }
  }

  // 2. seed pinned + defaults
  let selExp = eligible.filter(e => isExperience(e) && (e.pinned || e.default));
  let selProj = eligible.filter(e => isProject(e) && e.default);

  // 3. swap candidates: non-default, non-pinned, matched at least one JD tag
  const cmp = (a, b) => {
    const sa = scoreOf.get(a.id).score, sb = scoreOf.get(b.id).score;
    if (sb !== sa) return sb - sa;
    if (!!b.default !== !!a.default) return (b.default ? 1 : 0) - (a.default ? 1 : 0);
    if ((b.weight || 0) !== (a.weight || 0)) return (b.weight || 0) - (a.weight || 0);
    return pool.indexOf(a) - pool.indexOf(b);
  };
  const swapCandidates = eligible
    .filter(e => (isProject(e) || isExperience(e)) && !e.default && !e.pinned && scoreOf.get(e.id).tagScore >= 1)
    .sort(cmp);

  let swapsUsed = 0;
  for (const cand of swapCandidates) {
    if (swapsUsed >= maxSwaps) {
      dropped.push({ id: cand.id, reason: `swap cap reached (max ${maxSwaps} non-default swaps per run)` });
      continue;
    }
    const cScore = scoreOf.get(cand.id).score;
    if (isProject(cand)) {
      if (selProj.length < maxProjects) {
        selProj.push(cand);
        swapsUsed++;
      } else {
        // Displace the lowest-scoring droppable default; on a tie displace the
        // one later in the pool (the newest/weakest yields its slot first).
        const droppable = selProj.filter(p => !p.pinned)
          .sort((a, b) => scoreOf.get(a.id).score - scoreOf.get(b.id).score || pool.indexOf(b) - pool.indexOf(a));
        const victim = droppable[0];
        if (victim && cScore > scoreOf.get(victim.id).score) {
          selProj = selProj.filter(p => p.id !== victim.id);
          selProj.push(cand);
          swapsUsed++;
          dropped.push({ id: victim.id, reason: `displaced by higher-scoring ${cand.id} (${cScore.toFixed(1)} > ${scoreOf.get(victim.id).score.toFixed(1)}) at ${maxProjects}-project cap` });
        } else {
          dropped.push({ id: cand.id, reason: `did not outscore the lowest default project at the ${maxProjects}-project cap` });
        }
      }
    } else {
      // Experience swap-ins are additive (no hard cap on the experience section).
      selExp.push(cand);
      swapsUsed++;
    }
  }

  // 4. char-budget enforcement. Drop the lowest-SCORING non-pinned entries until
  // the total fits, so a high-scoring swap-in (e.g. GSPANN on an ML JD) is kept
  // and a JD-irrelevant default yields instead. Ties break toward dropping a
  // project before an experience entry (experience is the more valuable section),
  // then toward the newest/weakest (later in the pool). Pinned entries (Enidus)
  // are never dropped.
  const totalChars = () =>
    selExp.reduce((n, e) => n + entryBulletChars(e), 0) +
    selProj.reduce((n, e) => n + entryBulletChars(e), 0);
  while (totalChars() > budget) {
    const droppable = [...selExp, ...selProj].filter(e => !e.pinned);
    if (droppable.length === 0) break;
    droppable.sort((a, b) => {
      const sa = scoreOf.get(a.id).score, sb = scoreOf.get(b.id).score;
      if (sa !== sb) return sa - sb; // lowest score first
      const ak = a.kind === 'project' ? 0 : 1, bk = b.kind === 'project' ? 0 : 1;
      if (ak !== bk) return ak - bk; // drop a project before an experience entry
      return pool.indexOf(b) - pool.indexOf(a); // newest/weakest first
    });
    const victim = droppable[0];
    selExp = selExp.filter(e => e.id !== victim.id);
    selProj = selProj.filter(e => e.id !== victim.id);
    dropped.push({ id: victim.id, reason: `dropped to meet the ${budget}-char one-page budget` });
  }

  // 5. ordering. Both sections render newest-first by date (resume convention),
  //    independent of the score that decided WHICH entries were selected.
  //    Experience uses `chrono`; projects use `dateSort` (YYYYMM), with score as
  //    the tiebreak when two entries share a date.
  selExp.sort((a, b) => (b.chrono || 0) - (a.chrono || 0) || pool.indexOf(a) - pool.indexOf(b));
  selProj.sort((a, b) => (b.dateSort || 0) - (a.dateSort || 0) || cmp(a, b));

  // 6. reasons for survivors
  const reasonFor = (e) => {
    const { score, tagScore } = scoreOf.get(e.id);
    if (e.pinned) return 'pinned (always included)';
    if (e.default) return `default entry (score ${score.toFixed(1)}, ${tagScore} JD tag match${tagScore === 1 ? '' : 'es'})`;
    return `swapped in on ${tagScore} JD tag match${tagScore === 1 ? '' : 'es'} (score ${score.toFixed(1)})`;
  };
  for (const e of [...selExp, ...selProj]) {
    selected.push({ id: e.id, score: Number(scoreOf.get(e.id).score.toFixed(2)), reason: reasonFor(e) });
  }

  const json = buildResumeJson(selExp.map(resolveEntryItem), selProj.map(resolveEntryItem));
  return { json, selected, dropped };
}

// ─────────────────────────────────────────────────────────────────────────────
// RESUME_BASE_JSON — the DEFAULT resume, assembled by the selector with no JD.
// Reproduces today's resume except GSPANN is benched and GoodEnough holds its
// freed slot. Budget is Infinity here because the default set is known to fit one
// page (that is what BASE_BULLET_CHAR_BUDGET, computed from it below, then means).
// ─────────────────────────────────────────────────────────────────────────────
const RESUME_BASE_JSON = selectEntries(ENTRY_POOL, [], '', Infinity).json;

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
  SECTION_ORDER,
  enforceSectionOrder,
  ADJACENCY_MAP,
  applyAdjacency,
  extractUserSkills,
  sumBulletChars,
  BASE_BULLET_CHAR_BUDGET,
  SYNONYM_MAP,
  FACT_FRAGMENT_MAP,
  // 2026-08-05 entry-selection-pool brief
  ENTRY_POOL,
  MAX_PROJECT_ENTRIES,
  MAX_NON_DEFAULT_SWAPS,
  selectEntries,
  isValidEntryKind,
  VALID_ENTRY_KINDS,
  enforceProjectDateOrder,
};
