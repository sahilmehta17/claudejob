# Claude Code Working Brief — ClaudeJob: wire engineering depth into resume + CANDIDATE_FACTS

**Date:** 2026-05-11
**Working directory:** `/Users/sahilmehtx/Desktop/Internships and Resume/ClaudeJob/files`
**Branch:** `main`
**Repo remote:** `https://github.com/sahilmehta17/claudejob.git`
**Parallel context:** Sahil is actively applying to jobs while you run this. Don't ask him questions mid-execution; surface findings at the end.

## Context

A recent project brief from Sahil's actual T-Mobile copilot work (codename ARIA, built at Enidus for Sensitek) surfaced substantial engineering depth that's currently invisible in his resume and AI prompts:

- Hybrid retrieval pipeline (Qdrant vector + BM25 + Reciprocal Rank Fusion + optional re-ranker)
- Embedding cost engineering (LRU cache, fast-path bypass, confidence bucketing, model tiering)
- State machine durability (`ragbot.ai_flow_state` replacing in-memory sessions, optimistic locking)
- 9 flow service implementations (not just "device purchase, line suspension")
- Architectural inversion from lexical-first to vector-first routing for consumer-facing paraphrase tolerance

This brief wires these signals into the resume (`resumeContent.js`) and the shared AI facts (`CANDIDATE_FACTS`). The portfolio updates (site.ts, copilot.mdx) are a separate Brief B.

**Dependency:** This brief assumes the `CANDIDATE_FACTS` constant exists in `resumeContent.js` (introduced by `2026-05-11-candidate-facts-single-source-prompt.md`). If it doesn't yet exist (the candidate-facts brief hasn't been fired), STOP and surface this — fire the candidate-facts brief first, then return to this one.

**Defensibility note:** Sahil is explicitly accepting that other framing concerns (tool count, intent count, mock-data pilot framing, RLS shipped vs designed) remain unaddressed in this brief. This brief layers depth signals on top. Do not "fix" those other items here; that's a separate decision.

## Standing rules

1. **Read `resumeContent.js` end-to-end before editing.** Verify `CANDIDATE_FACTS` exists.
2. **No emojis. Default to no comments unless WHY is non-obvious.**
3. **Don't auto-commit until told.** Pre-authorized commits in §"Commit plan" — proceed without re-confirming.
4. **Be precise about shipped vs designed.** The framing matrix below distinguishes the two. Don't promote a "designed" signal to "shipped" — the depth layer must not itself become an overclaim.
5. **Run `node tests/ai.test.js` and `node regenerate-base.js` after edits.** Both must succeed.

## Defensibility matrix (frame accurately)

| Signal | Phrase to use | Phrase to AVOID |
|---|---|---|
| LRU cache | "built embedding LRU cache" | n/a — shipped |
| Pure-identifier fast-paths | "built regex fast-paths" | n/a — shipped |
| State machine | "built durable SQL-backed flow state" | n/a — shipped |
| 9 flows | "implemented 9 flow services" | n/a — shipped |
| Action ledger | "designed action ledger" | n/a — shipped |
| Vector-first inversion | "led routing-architecture pivot lexical-first → vector-first" | n/a — shipped |
| Hybrid retrieval (Qdrant + BM25 + RRF) | "designed hybrid retrieval pipeline" | "shipped hybrid retrieval" |
| Confidence bucketing | "designed confidence-bucketing on intent scores" | "shipped confidence bucketing" |
| Model tiering | "designed embedding model tiering" | "shipped" |
| Re-ranker integration | "designed for Cohere/Voyage re-ranker pass" | "shipped re-ranker" |

## Fix 1 — Add 1-2 depth bullets to the copilot subsection

### File: `routes/resumeContent.js`

Locate the `AI Chatbot & Agentic Copilot for T-Mobile for Business` subsection inside the Enidus experience item. It currently has 5 bullets ending with `Enforced safe execution via parameterized SQL templates, session-scoped row-level security, and 8-role RBAC; Qdrant knowledge base with per-tenant isolation.`

Append the following bullets in order. The layout guard from the previous brief (1-page enforcement in `pdfRender.js`) will catch overflow.

**New bullet 6 (highest-priority depth signal — keep this one even if cuts are needed):**

```
Designed hybrid retrieval pipeline (Qdrant vector + BM25 + Reciprocal Rank Fusion, with optional Cohere/Voyage re-ranker for precision-critical queries) and built embedding LRU cache + confidence-bucketing on intent scores to skip LLM round-trips on unambiguous queries; led routing-architecture pivot lexical-first → vector-first for consumer-facing paraphrase tolerance.
```

Word count: ~46 words. This is above the 18-32 ceiling the layout brief sets, but the signal is too dense to split without losing the architectural-pivot story. The layout guard will accept it OR fail; if it fails the 1-page check, **first try the new bullet 6 alone (skip bullet 7), then if that still fails, trim bullet 6 by cutting "with optional Cohere/Voyage re-ranker for precision-critical queries" — saves ~9 words.**

**New bullet 7 (state machine + flow count):**

```
Built durable SQL-backed flow state machine (optimistic locking via state_version) replacing in-memory session patterns; supports 9 multi-step transaction flows including bulk action orders, eSIM provisioning, and rate-plan changes.
```

Word count: ~31 words. Within range.

**Order matters:** Insert bullet 6 BEFORE bullet 7. Bullet 6 is the higher-leverage signal (hybrid retrieval + cost eng + architectural judgment in one line); bullet 7 is supplementary (flow durability).

## Fix 2 — Expand `CANDIDATE_FACTS` with engineering depth

### File: `routes/resumeContent.js`

Find the `CANDIDATE_FACTS` constant. Currently it contains lines for the three Enidus plugins, RAG capstone, Orahi, GSPANN, core skills, plus the DOMAIN EXPERIENCE line added in the candidate-facts brief.

Add four NEW lines BETWEEN the Plugin 1 description and the Plugin 2 description (i.e., immediately after the existing Plugin 1 line). The new lines describe depth signals that the cover letter / Q&A prompts can quote when the JD calls for them:

```
- Engineering depth — hybrid retrieval: designed a hybrid retrieval pipeline combining Qdrant vector search with BM25 keyword retrieval via Reciprocal Rank Fusion (RRF, k≈60), with optional Cohere/Voyage re-ranker as a cost-gated precision pass for the device catalog and forthcoming knowledge base. Productionized Qdrant Cloud (aria-prod cluster, AWS us-east-1) with local Docker fallback for offline dev.
- Engineering depth — cost engineering for consumer-scale: built embedding LRU cache keyed by (query_hash, model_name) targeting ≥70% hit rate; pure-identifier fast-paths (phones, ICCIDs 19-20 digit, EIDs 32-digit, IMEIs 15-digit, reference numbers) bypass embedding entirely via regex pre-routing; designed confidence-bucketing on Qdrant intent scores so high-confidence matches skip the LLM tool-call round-trip; designed embedding model tiering (cheap text-embedding-3-small on hot path, premium text-embedding-3-large reserved for precision-critical re-ranking only).
- Engineering depth — state machine durability: replaced in-memory _sessions: dict state with durable SQL-backed flow state machine (ragbot.ai_flow_state table, optimistic locking via state_version). Supports 9 multi-step transaction flows: suspend, resume, deactivate, activate, rate-plan-change, bulk-action, order-eSIMs, order-pre-activated-SIMs, order-non-activated-SIMs.
- Engineering depth — architectural judgment: led a routing-architecture inversion from lexical-first to vector-first when product direction pivoted to consumer-facing (high paraphrase variance, typos at scale, no portal-terminology training). Required productionizing Qdrant as a hard dependency. Inverted gate logic so lexical detectors run only for pure-identifier fast-paths; everything else flows through embedding similarity plus LLM tool-call.
```

**Placement matters:** insert immediately after the existing Plugin 1 line, BEFORE the Plugin 2 line. The reading order in `CANDIDATE_FACTS` matters because the LLM tends to weight earlier content more heavily; putting depth signals right after the headline plugin description keeps them adjacent to the project they describe.

## Fix 3 — Verify nothing regressed

After Fix 1 and Fix 2 land:

1. `node regenerate-base.js` from `/Users/sahilmehtx/Desktop/Internships and Resume/ClaudeJob/files`. Confirm BASE PDF + DOCX render successfully and PDF is 1 page (pdfinfo). If overflow, follow the cut-rule in Fix 1.
2. `node tests/ai.test.js` — 47 tests pass.
3. Restart `node server.js` and re-run the pipeline against a saved job (Amex AI Engineer II from `data/tracker.json` is fine). Spot-check the cover letter:
   - Should now include hybrid retrieval, cost engineering, state machine, or architectural pivot mentions IF the LLM judges them relevant to the JD's RULES (regulated-enterprise domain rule + general fit)
   - Should remain 3 tight paragraphs
   - Should not contradict the resume
4. Confirm the resume PDF mirror at `Portfolio/sahilmehta-portfolio/public/Sahil_Mehta_Resume.pdf` updated (regenerate-base.js does this automatically).

## Commit plan (pre-authorized — proceed without re-confirming)

Two commits, in order:

```
resume: add hybrid-retrieval + state-machine depth bullets to copilot section
ai: expand CANDIDATE_FACTS with engineering depth lines (hybrid retrieval, cost eng, state machine, architectural pivot)
```

For commit 1, include a body line: source is the ARIA project brief; depth signals were absent from prior framing. Bullet 6 frames hybrid retrieval and model tiering as "designed" not "shipped" per defensibility matrix.

For commit 2, body short: lines added immediately after Plugin 1 description so the LLM associates depth with the project. Defensibility framing matched to brief's Phase status.

Push to `origin/main` after both land:
```bash
git push origin main
```

## What to do AFTER this lands

1. Surface anything you discovered:
   - If `CANDIDATE_FACTS` didn't exist (the candidate-facts brief hasn't been fired yet), surface this and STOP. Don't inline the facts into the prompts; that would create a second source of truth.
   - If the PDF overflows to 2 pages even after the cut rule in Fix 1, flag specifically which bullet was at the edge.
   - If the cover letter on the next test run drops the depth signals entirely (LLM ignored them), it may mean the prompt's RULES need a hint about when to surface engineering-depth language. Flag for next brief.
2. **Do not** start the portfolio updates (site.ts, copilot.mdx). That's Brief B in a separate repo.
3. **Do not** update HANDOVER.md.
4. **Do not** reconcile the tool/intent count or RLS framing. Sahil explicitly accepted those remain unaddressed.

## Operating model reminder

Cowork writes briefs. You execute. Sahil is applying in parallel — surface findings concisely at the end.

---

End of brief. Read `routes/resumeContent.js` first to verify `CANDIDATE_FACTS` exists, then proceed with Fix 1.
