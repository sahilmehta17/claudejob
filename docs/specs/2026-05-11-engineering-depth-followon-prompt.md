# Claude Code Working Brief — ClaudeJob: engineering-depth follow-on (resume merge + brief/code drift closure)

**Date:** 2026-05-11
**Working directory:** `/Users/sahilmehtx/Desktop/Internships and Resume/ClaudeJob/files`
**Branch:** `main`
**Repo remote:** `https://github.com/sahilmehta17/claudejob.git`
**Parallel context:** Sahil is actively applying to jobs while you run this. Don't ask him questions mid-execution; surface findings at the end.

## Context

This brief closes three loose ends from the previous engineering-depth brief (`2026-05-11-engineering-depth-claudejob-prompt.md`):

1. **Fix 1 didn't land** — the resume couldn't accept additional bullets (page constraint exhausted per Code's escalation). Need to free space by merging two overlapping safety bullets, then add the depth bullet.
2. **DOMAIN EXPERIENCE line missing from CANDIDATE_FACTS** — was specified in the candidate-facts brief AFTER Code ran it. Now closing.
3. **Fix 1c (regulated-enterprise domain rule in prompts) never applied** — same brief/code drift. Now closing.

All three are small. Single brief, three commits, push.

## Standing rules

1. **Read `routes/resumeContent.js` and `routes/ai.js` end-to-end before editing.**
2. **No emojis. Default to no comments unless WHY is non-obvious.**
3. **Don't auto-commit until told.** Pre-authorized commits in §"Commit plan" — proceed without re-confirming.
4. **Verify 1-page render after Fix 1.** The whole point of this brief is the bullet swap stays within 1 page. Run `node regenerate-base.js` and `pdfinfo` to confirm.
5. **Run `node tests/ai.test.js` after edits.** 47 tests should pass.

## Fix 1 — Merge bullets 4 + 5 in the copilot subsection, then add the depth bullet

### File: `routes/resumeContent.js`

Locate the `AI Chatbot & Agentic Copilot for T-Mobile for Business` subsection inside the Enidus experience item. Current state (5 bullets):

```
1. "Built an AI assistant for T-Mobile for Business..." (pilot scale bullet)
2. "Built an agentic workflow that stages each transaction..." (stage-and-confirm)
3. "Built a parametrized pytest eval suite (52 hand-designed cases fanning out to 400+ distinct test invocations)..." (eval suite)
4. "Prevented hallucinated tool calls in production via Pydantic-validated tool schemas + strict tool gating..." (LLM-boundary safety)
5. "Enforced safe execution via parameterized SQL templates, session-scoped row-level security, and 8-role RBAC; Qdrant knowledge base with per-tenant isolation." (execution-boundary safety)
```

**Replace bullets 4 AND 5 with these two new bullets** (so the section stays at 5 bullets but the content shifts):

**New bullet 4 (defense-in-depth, combines old 4 + 5):**

```
Built defense-in-depth safety: Pydantic-validated tool schemas + strict tool gating at the LLM boundary (model constrained to tool selection only, never raw SQL), then parameterized SQL templates + session-scoped row-level security + 8-role RBAC at the execution boundary, with per-tenant Qdrant collections for retrieval isolation.
```

Word count: ~38 words. Above the 18-32 ceiling the layout brief enforces. If layout overflow fires after this swap, trim by cutting "with per-tenant Qdrant collections for retrieval isolation" (saves ~7 words) — the per-tenant isolation detail also appears in CANDIDATE_FACTS so it's not lost.

**New bullet 5 (the depth bullet — same as previous brief's bullet 6):**

```
Designed hybrid retrieval pipeline (Qdrant vector + BM25 + Reciprocal Rank Fusion) and built embedding LRU cache + confidence-bucketing on intent scores to skip LLM round-trips on unambiguous queries; led routing-architecture pivot lexical-first → vector-first for consumer-facing paraphrase tolerance.
```

Word count: ~42 words. Above ceiling but signal-dense. If layout overflow fires, trim by cutting "and built embedding LRU cache + confidence-bucketing on intent scores to skip LLM round-trips on unambiguous queries" (saves ~16 words) — those details also live in CANDIDATE_FACTS.

**Escalation rule for this brief (if both new bullets don't fit):**

1. Try both new bullets as written → if 2-page overflow,
2. Trim new bullet 5 (drop the LRU cache + confidence-bucketing clause) → if still overflow,
3. Trim new bullet 4 (drop the per-tenant Qdrant clause) → if still overflow,
4. Drop new bullet 5 entirely (keep just the defense-in-depth merge) → if even THIS fails to fit, STOP. Restore the original 5-bullet state and flag. Do not delete primary bullets 1-3 to make room.

The "Do not delete primary bullets 1-3" rule is non-negotiable — those carry the headline signals (pilot scale, agentic workflow, eval suite).

## Fix 2 — Add DOMAIN EXPERIENCE line to CANDIDATE_FACTS

### File: `routes/resumeContent.js`

The candidate-facts brief was UPDATED to include a DOMAIN EXPERIENCE line but Code ran the original version before the update landed. Adding now.

Find the existing `CANDIDATE_FACTS` constant. Insert this new line AFTER the line that starts with `Full-time SWE at Enidus USA LLC (June 2025 - present): sole engineer on three plugins...` and BEFORE the line that starts with `Engineering depth — hybrid retrieval:`:

```
- DOMAIN EXPERIENCE: ships production AI against regulated enterprise telecom data — billing account numbers (BANs), device SKUs/IMEIs, line state transitions (active/suspended/ported/cancelled), multi-tenant reseller hierarchies (resellers managing enterprise customer accounts). Real audit-traceable state-mutating operations on real customer data, not toy datasets. The kind of regulatory-shaped work that maps cleanly to financial services, healthcare, and other regulated-enterprise AI domains.
```

This signal is high-leverage for fintech, banking, healthcare, regulated-enterprise applications. Placement immediately after the Enidus headline line means the LLM associates the domain expertise with the project.

## Fix 3 — Add regulated-enterprise domain rule to cover letter + Q&A prompts

### File: `routes/ai.js`

The candidate-facts brief specified a "Fix 1c" adding a conditional surfacing rule to both prompts but Code ran the brief before that addition. Adding now.

**Cover letter prompt** (the one with `TONE: Confident & direct` and the banned-phrase list). Locate the RULES block. Add this new bullet at the END of the RULES list (after the existing rules about "3 tight paragraphs," "NO filler," "DO NOT fabricate," "Return ONLY the letter body"):

```
- If the TARGET company is in a regulated-enterprise domain (financial services, banking, telecom, healthcare, insurance, government, fintech, regtech, compliance tech), explicitly highlight in one body paragraph that the candidate has shipped production AI against regulated enterprise data (T-Mobile billing accounts, device identifiers, line state transitions, multi-tenant reseller hierarchies, audit-traceable state-mutating operations). This is a 0-3yr engineer differentiator — most candidates at this level have only touched toy datasets. Do NOT include this paragraph if the TARGET is a pure AI-research shop or general-purpose tooling company where regulated-data experience isn't load-bearing.
```

**Q&A prompt.** Locate the RULES block in the Q&A prompt. Add this new bullet at the END of the RULES list:

```
- For questions about your background or fit, if the company is in a regulated-enterprise domain (financial services, telecom, healthcare, insurance, government, fintech), explicitly note the candidate's production experience with regulated enterprise data — billing data, customer identifiers, audit-traceable transactions, multi-tenant reseller hierarchies. This is rare experience at the 0-3yr level and a real differentiator for these domains.
```

## Verification before commit

1. `node regenerate-base.js` — must succeed; BASE PDF is exactly 1 page (confirm via `pdfinfo`); BASE DOCX renders; portfolio mirror at `Portfolio/sahilmehta-portfolio/public/Sahil_Mehta_Resume.pdf` updates.
2. `node tests/ai.test.js` — 47/47 pass.
3. **Eyeball the rendered BASE PDF.** Open in Preview, scan the copilot bullets — should see the new defense-in-depth bullet (4) and the hybrid-retrieval bullet (5). Should NOT see the old "Prevented hallucinated tool calls..." or "Enforced safe execution..." bullets.
4. No widow warnings in `console.warn` output during regenerate-base.js run (the widow detector from the layout brief will log if any bullet ends with < 4 words on the last line).

## Commit plan (pre-authorized — proceed without re-confirming)

Three commits, in order:

```
resume: merge LLM- and execution-boundary safety bullets; add hybrid-retrieval depth bullet
ai: add DOMAIN EXPERIENCE line to CANDIDATE_FACTS for fintech / regulated-enterprise signal
ai: add regulated-enterprise domain surfacing rule to cover-letter + Q&A prompts
```

For commit 1, body line: previous attempt overflowed; this version merges two related safety bullets into a defense-in-depth bullet, freeing space for the depth bullet without losing material content. Per-tenant Qdrant detail still lives in CANDIDATE_FACTS.

For commit 2, body short: closes brief/code drift from the candidate-facts brief.

For commit 3, body short: same drift closure; conditional rule so AI-first targets don't get regulated-data paragraph dilution.

Push to `origin/main` after all three land:
```bash
git push origin main
```

(There's also a previously-unpushed commit `e64fae9` on the local branch from the previous brief — the engineering-depth CANDIDATE_FACTS expansion. That gets pushed along with these three on the same `git push origin main`.)

## What to do AFTER this lands

1. Surface anything you discovered:
   - If the merged bullet 4 (defense-in-depth) fails the page constraint even after trimming, flag specifically which combination got closest.
   - If the new hybrid-retrieval bullet 5 still triggers widow warnings, the predict-last-line math may need tuning — flag.
   - If running the pipeline against a fintech JD doesn't surface the DOMAIN EXPERIENCE paragraph in the cover letter, the rule wording may need to be more imperative — flag.
2. **Do not** start the portfolio updates (Brief B engineering-depth portfolio brief). That's still pending and handles `site.ts` + `copilot.mdx`.
3. **Do not** reconcile the tool/intent count or RLS framing. Still parked per Sahil's prior call.

## Operating model reminder

Cowork writes briefs. You execute. Sahil is applying in parallel — surface findings concisely at the end.

---

End of brief. Read `routes/resumeContent.js` and `routes/ai.js` first, then proceed with Fix 1.
