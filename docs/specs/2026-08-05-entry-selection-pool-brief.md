# Claude Code Brief: entry selection pool, publications section, skills balancing

Date: 2026-08-05
Author: Cowork
Status: PENDING EXEC on branch `resume-layout-v2` (continue there). Do not auto-commit, do not merge.

## Context

Today the resume content in `RESUME_BASE_JSON` is a fixed set of experience and project entries. Per-JD tailoring only reorders and rewords bullets; it cannot swap which entries appear. That forces manual workarounds, already visible as code comments: chef-drop-brief and the Denari RAG capstone were pulled out of the base for page-budget reasons, live only in CANDIDATE_FACTS, and the comments say the tailoring step "can reinsert" them, with one-off `scripts/regenerate_*.js` files as the actual mechanism.

Three concrete needs now:

1. GSPANN (CNN pneumonia detection, Jun-Aug 2023) is the weakest, oldest entry and should come off the default resume, but it is the only evidence of training a model rather than calling an API, so it must stay available for ML/DS-flavored JDs. Bench it, do not delete it.
2. Denari (RAG capstone: 22K+ documents, 300K+ embeddings, hybrid BM25 + TF-IDF with semantic re-ranking, 73% QA accuracy, 40% query-latency reduction) should take the default slot GSPANN vacates, and is a strong swap-in for RAG-heavy JDs.
3. Two new entries are coming and need somewhere to live before they exist: GoodEnough (a preregistered local-vs-hosted non-inferiority study, currently mid-data-collection) and an MCP tool-selection census (not started). Plus a likely NeurIPS workshop paper, which needs a Publications section the renderer does not currently have.

## Hard rules

1. Branch `resume-layout-v2`. No commit, no merge.
2. No fabrication. Entries may be selected, deselected, reordered, and reworded. No entry may claim a result that is not in CANDIDATE_FACTS. Selection is deterministic code, never an LLM decision.
3. No em-dashes anywhere.
4. Keep intact: the one-page rule and render fallback, the contact/identity lock, the deterministic skills lock, the bullet validator, the length-fit step, and the char budget.
5. Existing behavior must not regress: with the default pool selection, output should match today's resume.

## Part 1: the entry pool

Introduce `ENTRY_POOL` in `routes/resumeContent.js`. Every experience and project entry moves into it. `RESUME_BASE_JSON` keeps its shape but its experience and project item lists are produced by the selector from the pool.

Each pool entry carries the existing item structure plus metadata:

```
{
  id: 'denari',
  kind: 'project',            // 'experience' | 'project' | 'publication'
  status: 'ready',            // 'ready' | 'apparatus' | 'planned'
  default: true,              // in the default resume when nothing else wins
  pinned: false,              // true = always included, never dropped (Enidus)
  tags: ['rag', 'retrieval', 'embeddings', 'python', 'typescript', 'evals'],
  weight: 0,                  // manual tiebreaker, higher wins
  item: { ...existing title/date/url/bullets shape... },
  bulletsByStatus: {          // optional, for status-gated entries
    apparatus: [...],
    ready: [...]
  }
}
```

Entries to seed:

- `enidus` (experience, pinned, always in)
- `orahi` (experience, default true)
- `gspann` (experience, **default false**, tags: ['ml','deep learning','pytorch','cnn','computer vision','data science','model training'])
- `cloudguard` (project, default true)
- `claudejob` (project, default true)
- `denari` (project, **default false**, benched but selectable; content from CANDIDATE_FACTS, unchanged facts; tags: ['rag','retrieval','embeddings','bm25','tf-idf','vector search','timescaledb','docker','s3'])
- `chef-drop-brief` (project, default false, tags: ['claude code skills','mcp','braze','lifecycle marketing','evals'])
- `goodenough` (project, **default true**, **status 'apparatus'**; takes the slot GSPANN vacates; see Part 2 and the slot budget below)
- `mcp-census` (project, **status 'planned'**, default false, `eligible: false` so it can never be selected until flipped)

### Project slot budget (important)

The one-page render supports roughly THREE project entries at most. A prior attempt at a third project header plus two bullets pushed the render to two pages, and the recorded cause was the header itself, not just the bullet characters. So:

- Set `MAX_PROJECT_ENTRIES = 3` (configurable) and enforce it in the selector.
- Default project set: CloudGuard, ClaudeJob, GoodEnough.
- Denari, chef-drop-brief, and any future entries compete for those three slots by score and displace a lower-scoring default when a JD calls for them (for example Denari should win a slot on a retrieval-heavy JD).
- If the budget still overflows after selection, the existing length-fit and render fallback remain the backstop, but the selector should aim to fit before either fires.

Note for bullet writing: CloudGuard and GoodEnough are both evaluation and reliability work. Keep their bullets pointed at visibly different things (CloudGuard: agent safety, tool selection, blast-radius guardrails, prompt injection; GoodEnough: cost, latency, quantized local inference, statistical non-inferiority) so they do not read as the same project twice.

## Part 2: status gating (the honesty mechanism)

`status` controls which bullets an entry emits, so an in-progress project can appear without claiming results it does not have.

- `apparatus`: emit only `bulletsByStatus.apparatus`, describing what is built and committed (design, harness, method), never findings.
- `ready`: emit `bulletsByStatus.ready` (or `item.bullets`), which may include results.
- `planned`: never selected, regardless of tags. A hard gate.

For `goodenough`, seed the apparatus bullet from what is true today (preregistered non-inferiority design, margin fixed before data, paired-item measurement path, pinned local and hosted configs, deterministic scoring, frozen splits and seeds) and leave a `ready` bullet as a TODO placeholder with the numbers blank. Sahil flips `status` to `ready` and fills the numbers when the per-slice map exists. Do NOT write predicted results into the ready bullet.

## Part 3: the selector

Add `selectEntries(pool, jdRequiredSkills, jdText, budget)` in `resumeContent.js`, deterministic, no LLM:

1. Filter out `status: 'planned'` and anything explicitly `eligible: false`.
2. Always include `pinned: true` entries.
3. Score each remaining entry: count tag matches against the JD required-skills list and JD text (case-insensitive, whole-token), plus `weight`, plus a small bonus for `default: true` so ties resolve to today's resume.
4. Sort by score, then take entries until the char budget is reached. Reuse `BASE_BULLET_CHAR_BUDGET` and the existing length-fit logic; the selector must respect the same one-page envelope.
5. Preserve section semantics: experience entries stay in chronological order within the experience section regardless of score; projects may be reordered by score.
6. Return `{ json, selected: [{id, score, reason}], dropped: [{id, reason}] }` and surface that on the SSE and in the console so Sahil can see why an entry was in or out.

Guardrail: cap swaps so a JD cannot produce an unrecognizable resume. Suggest at most 2 non-default entries swapped in per run.

## Part 4: publications section (DEFERRED, do not build)

Not needed yet. A publication entry may exist later (a workshop paper is in progress), but there is nothing to render today and an empty section is wasted page budget.

Do NOT add a publications section type in this pass. The only thing to do now is leave the door open: allow `kind: 'publication'` as a valid value in the pool schema so an entry can be added later without a schema change. Nothing renders it yet.

## Part 5: skills line balancing

Carry over from the layout work: the four skill lines are visually top-heavy because the longest line (AI / LLM Systems) sits first, so the right edge steps inward down the block. Two fixes:

- Redistribute items across the four labeled groups so line lengths are within roughly 15% of each other.
- Order so the block does not open with the longest line.

Do not add or invent skills. Do not remove any skill that ADJACENCY_MAP relies on as a justifier without checking the map first. Keep exactly four groups, no proficiency labels.

## Tests

- Default selection reproduces today's resume except for the two intended changes: GSPANN out, GoodEnough in. Everything else byte-identical (regression guard).
- GSPANN is excluded by default, and IS selected for a JD heavy in ML, PyTorch, CNN, or model-training terms.
- Denari is excluded by default and DOES win a project slot on a retrieval or RAG-heavy JD, displacing the lowest-scoring default project.
- Never more than MAX_PROJECT_ENTRIES (3) projects are rendered, on any JD.
- `goodenough` at `status: 'apparatus'` emits only apparatus bullets; flipping to `ready` emits ready bullets.
- `mcp-census` at `status: 'planned'` is never selected, even when every tag matches.
- Selection never exceeds the char budget; the one-page render never falls back to base on three sample JDs.
- Pinned entries (Enidus) are never dropped, even at budget pressure.
- Publications section renders when populated and is omitted entirely when empty.
- No fabrication regression: skills contain no uninjected tech, LinkedIn URL intact, bullets trace to CANDIDATE_FACTS.
- Full existing suite green.

## Verification

Run three JD shapes (AI/RAG-heavy, backend-heavy, ML/data-science-heavy). For each: confirm no base fallback, 90-95% page fill, one page, and that the selected entries make sense for the JD. Render to images and review. Report the selection decisions per run.

## Definition of done

- All entries live in `ENTRY_POOL`; the resume is assembled by a deterministic selector.
- GSPANN benched but selectable; GoodEnough holds the freed default slot; Denari benched but wins a slot on retrieval-heavy JDs.
- Project entries never exceed 3.
- Status gating works; GoodEnough sits on the resume as apparatus-only; MCP census is hard-gated off.
- No publications section built; `kind: 'publication'` is merely a permitted schema value.
- Skills lines balanced.
- Tests green, three JDs verified visually, work uncommitted on the branch.
