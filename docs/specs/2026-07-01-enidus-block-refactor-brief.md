# Claude Code Working Brief — ClaudeJob: Enidus block refactor + LangGraph adjacency

**Date:** 2026-07-01
**Working directory:** `/Users/sahilmehtx/Desktop/Internships and Resume/ClaudeJob/files`
**Branch:** `main`
**Repo remote:** `https://github.com/sahilmehta17/claudejob.git`
**Parallel context:** Sahil is actively applying to jobs. Don't ask him questions mid-execution; surface findings at the end.

## Context

Compared the base Enidus resume block against Sahil's coworker Ashwin Ugale's resume (both work at Enidus USA on the same T-Mobile for Business portal). Three issues surfaced:

1. **Fabrication risk in current base bullet 2:** says "deployed on AWS." The FastAPI backend + PostgreSQL actually run on Azure. Qdrant Cloud is separately hosted on AWS us-east-1. The current phrasing misleads an interviewer to assume the whole app is on AWS. Same failure mode as the Burford application flag earlier.

2. **Plugin 3 (Carrier API Gateway / pilBackend) is missing from the resume entirely.** Currently only in `CANDIDATE_FACTS`. Sahil is sole owner of pilBackend per his ownership profile. Ashwin's resume covers this work in one bullet; Sahil's has zero.

3. **Business-impact framing is thin.** Ashwin surfaces "9 LLM-orchestrated workflows collapsing 10-12 portal clicks per reseller action into a single chat command." Sahil has "9 multi-step transaction flows" in `CANDIDATE_FACTS` but nothing on the resume itself. The click-collapse framing is the strongest business-impact signal available for this work.

4. **LangGraph adjacency gap.** Ashwin claims LangGraph directly (his bill-anomaly agent lane). Sahil does NOT use LangGraph and should not claim it as a shipped skill. However `ADJACENCY_MAP` only has `langchain` — `langgraph` is missing, so JDs that require it don't get auto-appended to the skills line via adjacency.

This brief updates `RESUME_BASE_JSON` with a refactored Enidus block (three subsections, seven bullets, ~2100 chars) and adds `langgraph` to `ADJACENCY_MAP`.

## Standing rules

1. **Read `routes/resumeContent.js` and `tests/ai.test.js` end-to-end before editing.**
2. **No emojis. No em-dashes anywhere in resume content. Default to no comments unless WHY is non-obvious.**
3. **Don't auto-commit until told.** Pre-authorized commits in §"Commit plan" — proceed without re-confirming.
4. **Do NOT invent claims.** Every bullet below has been fact-checked against `CANDIDATE_FACTS` and Sahil's ownership profile. If a bullet has a factual claim you cannot map back to `CANDIDATE_FACTS`, STOP and surface.
5. **Run `node tests/ai.test.js` after edits.** All 47 tests must pass. If test fixtures reference base-resume strings that this refactor changes (e.g., "deployed on AWS" as an anchor), update fixtures to match new base — do NOT weaken the new base to preserve fixtures.
6. **Do NOT change the 3-tier render fallback in `pdfRender.js`, the ClaudeJob project entry, RAG capstone entry, or the skills section.** This brief is the Enidus block ONLY, plus one line in `ADJACENCY_MAP`.

## Fix 1 — Replace the Enidus block in `RESUME_BASE_JSON`

### File: `routes/resumeContent.js`

Locate the experience section item where `title` is `'AI/Full-Stack Engineer, Enidus USA LLC. (Full-Time)'`. Replace the two-subsection `subsections` array with the following THREE-subsection structure. Copy bullet text verbatim — the exact phrasing has been vetted for character budget, verb diversity (max 2 per lead verb), Azure vs AWS accuracy, and JD-keyword surfacing.

```js
subsections: [
  {
    name: 'AI Chatbot & Agentic Copilot for T-Mobile for Business',
    bullets: [
      "Shipped a multi-tenant conversational AI assistant for a T-Mobile IoT reseller platform (FastAPI, Anthropic Claude / OpenAI function-calling, Qdrant, PostgreSQL on Azure); 9 LLM-orchestrated workflows collapse 10-12 portal clicks per reseller action (SIM/eSIM ordering, line-state changes, plan changes, bulk actions) into a single natural-language command, with human-in-the-loop confirmation gates. In pilot with 15 tenants, 25+ customers, 100+ users.",
      "Designed a hybrid retrieval layer combining Qdrant vector search over per-tenant collections with BM25 keyword retrieval via Reciprocal Rank Fusion (k=60), regex fast-paths for structured identifiers (phone, BAN, ICCID), and an LRU embedding cache targeting 70% hit rate; led a vector-first routing inversion when the product pivoted consumer-facing, moving intent top-1 accuracy from 73.5% to 89.0% against a 442-query eval corpus.",
      "Built defense-in-depth safety at the LLM boundary: 43 Pydantic-typed tool handlers with RBAC-filtered catalogs the model never sees in full, parameterized SQL templates with row-level security at execution, per-tenant Qdrant isolation, and user-confirmed writes, with zero hallucination incidents in pilot.",
      "Migrated in-memory session state to a durable SQL-backed flow state machine (typed transitions, optimistic locking via state_version, automatic session expiration), preserving 9 multi-step transaction flows across deploys and horizontal worker scaling.",
    ],
  },
  {
    name: 'Custom Reports & Dashboards Platform',
    bullets: [
      "Owned a self-serve full-stack analytics product end-to-end alone (React, Node.js + Express, SQL Server with stored procedures) letting enterprise customers compose reports, custom dashboards, and charts over their own data; cut analytics turnaround from days to minutes.",
      "Hardened against multi-tenant attack classes via stored-procedure CRUD contracts, two-layer filter validation, runtime tenant-clause injection, JWT auth, per-session CSRF rotation, strict CSP, and AES-256-CBC encryption for stored Excel passwords.",
    ],
  },
  {
    name: 'Carrier API Gateway (BFF)',
    bullets: [
      "Built a TypeScript BFF (Node.js + Express) as the sole integration layer to T-Mobile's carrier APIs (order, billing, eligibility, device search), with per-request RS256 Proof-of-Possession token generation over OAuth 2.0 and a translation layer mapping legacy portal request formats to the new PIL API contract.",
    ],
  },
],
```

### Changes vs. current base

- **Azure fix (critical):** Bullet 1 now says "PostgreSQL on Azure." Bullet 2 (formerly "deployed on AWS") drops the misleading cloud claim. Qdrant Cloud's AWS us-east-1 hosting is a Qdrant-managed detail, not a Sahil-authored architectural decision — omitting it removes the fabrication risk.
- **Click-collapse framing added to bullet 1:** "9 LLM-orchestrated workflows collapse 10-12 portal clicks per reseller action ... into a single natural-language command."
- **Bullets 2 + 3 (old base) merged into new bullet 2:** hybrid retrieval + routing pivot + eval accuracy delta in one dense bullet.
- **New bullet 4 (state machine durability):** promotes the SQL-backed flow state machine from `CANDIDATE_FACTS` into the resume itself.
- **Dropped old bullet 5 (cost/latency):** LRU cache + regex fast-paths preserved in new bullet 2. Confidence-bucketing + telemetry cut to make budget. Tailoring pipeline can still pull these from `CANDIDATE_FACTS` for JDs that emphasize cost engineering.
- **New third subsection (Carrier API Gateway):** surfaces Plugin 3 (pilBackend) on the resume for the first time. Uses "sole integration layer" phrasing to signal ownership — this is Sahil's solo work per his profile.

### Verb-diversity check

Lead verbs: Shipped, Designed, Built, Migrated, Owned, Hardened, Built. Two "Built" — within the max-2 rule. Other verbs distinct.

## Fix 2 — Add `langgraph` to `ADJACENCY_MAP`

### File: `routes/resumeContent.js`

Locate the `ADJACENCY_MAP` block. Find the line:

```js
'langchain':        ['anthropic claude', 'openai apis', 'function-calling'],
```

Add this line directly below it:

```js
'langgraph':        ['langchain', 'anthropic claude', 'openai apis', 'function-calling', 'tool calling'],
```

Rationale: LangGraph is a state-machine orchestrator layered on LangChain. Sahil has shipped a custom tool-calling orchestrator + custom SQL-backed state machine (per the Enidus block). That's a legitimate half-day ramp path — which is exactly the adjacency-map bar per the block comment. Do NOT add LangGraph to the base skills line — the adjacency map handles it on-demand for JDs that require it.

## Fix 3 — Test fixture reconciliation

### File: `tests/ai.test.js`

Per prior handover context, the test suite uses base-resume bullet substrings as `.replace()` anchors to construct fixture variants. The Enidus block rewrite changes several anchor strings.

Read `tests/ai.test.js` end-to-end. For every `.replace('<anchor>', ...)` where `<anchor>` was a substring of the old Enidus base, update the anchor to a substring of the NEW base. Common anchors likely to need updating:

- Any anchor containing "deployed on AWS" — the new base does not contain this substring anywhere.
- Any anchor containing "cost- and latency-engineered" or "Qdrant result cache and embedding cache" — old bullet 5 phrasing, dropped.
- Any anchor containing "confidence-bucketed routing" — dropped in the rewrite.
- Any anchor containing "Architected a vector-first routing inversion" as standalone verb — merged into new bullet 2 as "led a vector-first routing inversion."

Update the tests, do NOT walk back the base. If a test asserts semantic content that's still true in the new base but phrased differently, rewrite the assertion — do not add stale content back.

## Verification before commit

1. `node tests/ai.test.js` — 47/47 pass.
2. Verify the budget number hasn't ballooned:
   ```bash
   node -e "const { BASE_BULLET_CHAR_BUDGET } = require('./routes/resumeContent'); console.log('budget:', BASE_BULLET_CHAR_BUDGET);"
   ```
   Expected: within 5% of the pre-refactor value (was around 2700-3000). If the new value is significantly higher, flag — the tailoring pipeline's char-budget rule uses this constant as the ceiling.
3. Restart `node server.js`. Run the pipeline against any saved AI/ML JD to confirm the tailored PDF renders on 1 page and the new bullets survive tailoring.
4. Grep the codebase for `deployed on AWS` — should return zero hits after this lands:
   ```bash
   grep -rn "deployed on AWS" .
   ```
5. Confirm `langgraph` appears in `ADJACENCY_MAP` and run a synthetic test: pass `['langgraph']` as `jdRequiredSkills` to `applyAdjacency` — it should append LangGraph to the skills line.

## Commit plan (pre-authorized — proceed without re-confirming)

Two commits:

```
resumeContent: refactor Enidus block — 3 subsections, add BFF, fix AWS→Azure, add click-collapse framing

resumeContent: add langgraph to ADJACENCY_MAP with langchain/tool-calling justifiers
```

For commit 1 body: The old Enidus block had a fabrication risk ("deployed on AWS" — actual backend is Azure), no coverage of Plugin 3 (Carrier API Gateway / pilBackend, which Sahil owns solo), and buried the strongest business-impact signal (9 workflows collapsing 10-12 portal clicks per reseller action). This refactor fixes all three: Azure named correctly, BFF gets its own subsection, click-collapse framing surfaced to bullet 1. Old bullets 2+3 merged, old bullet 5 (cost/latency) cut to make budget — surviving content preserved in CANDIDATE_FACTS for tailoring pull-through. Verb diversity maintained (max 2 per lead verb).

For commit 2 body: LangGraph is a state-machine orchestrator layered on LangChain; Sahil has shipped a custom tool-calling orchestrator + SQL-backed state machine at Enidus but does NOT use LangGraph directly. Adjacency-map entry lets JDs that require LangGraph get it auto-appended to the skills line via the ramp-in-a-day path, without adding a shipped-it claim to the base resume.

Push to `origin/main`:
```bash
git push origin main
```

If branch protection blocks: surface to user — they'll push from Terminal.

## What to do AFTER this lands

1. Surface anything you discovered:
   - The new `BASE_BULLET_CHAR_BUDGET` value.
   - Any test fixtures updated (list which anchors were changed).
   - Confirm the `grep -rn "deployed on AWS"` returned zero hits across the repo (including `CANDIDATE_FACTS` — the string should not appear anywhere).
2. **Do not** modify the ClaudeJob project bullet, RAG capstone bullet, or skills section. This brief is Enidus + adjacency map ONLY.
3. **Do not** add LangGraph to the base skills line even if the tailoring prompt seems tempted to. LangGraph is adjacency-only.
4. If any tailored variant since this lands emits a warning that the base is now under-budget (< -200 chars), the budget cushion has grown — that's fine, no action needed.

## Operating model reminder

Cowork writes briefs. You execute. Sahil is applying in parallel — surface findings concisely at the end.

---

End of brief. Read `routes/resumeContent.js` (Enidus block structure + ADJACENCY_MAP) and `tests/ai.test.js` (fixture anchors), then proceed with Fix 1.
