# Claude Code Brief: JD keywords into bullets (truth-bounded) + validator hardening

Date: 2026-07-29
Author: Cowork (brainstormed with Sahil)
Status: PENDING EXEC. Do not auto-commit. Show the diff and wait for "commit" / "go".

## Context and goal

Today `applyAdjacency` injects missing JD keywords ONLY into the skills section (deterministic, no LLM). We want JD keywords to also shape experience/project BULLETS, to improve JD-vocabulary match for ATS and recruiter skim.

Approved approach (brainstormed): LLM-driven phrasing with full freedom over HOW to present true material, HARD-bounded by "must trace to CANDIDATE_FACTS," with a hardened validator as the backstop and field-scoped regeneration on any violation.

Expectation-setting (from this session's research, keep in the record): resume keyword match is a marginal lever; the real funnel bottleneck is cold-channel plus sponsorship. Build this, but it is not the primary fix for callback rate.

## Hard rules (do not relax)

1. No fabrication. No bullet may name a tool, technology, framework, metric, number, or capability that is not present in CANDIDATE_FACTS or the base resume.
2. No em-dashes anywhere in code, comments, or generated content.
3. The contact/name identity lock from the 2026-07-10 brief still applies and must not be removed.
4. No auto-commit. Show the diff and wait for explicit approval.

## Design overview (three parts)

1. Tailoring prompt change in `buildResumePrompt` (routes/ai.js): license the LLM to rephrase and reorder bullets to surface JD-relevant TRUE material in the JD's vocabulary, with an explicit prohibition on introducing anything not in CANDIDATE_FACTS or the base.
2. Optional curated accelerants (resumeContent.js): a synonym map and a fact-fragment map that bias the prompt and feed the validator allowlist. May start small or empty; the LLM-plus-validator path is primary.
3. Validator hardening: three checks, hard-block, and field-scoped regeneration (reuse the chef-drop-brief one-shot loop pattern).

## Part 1: tailoring prompt (routes/ai.js, buildResumePrompt)

- Ensure the prompt includes the JD required skills (`job.tags`) and the full `CANDIDATE_FACTS` (import from resumeContent if not already in scope).
- Add an instruction block, verbatim intent (reword to fit, no em-dashes):
  - "You may rephrase and reorder bullets to surface the material most relevant to the REQUIRED SKILLS, using the JD's exact terminology WHERE IT ACCURATELY DESCRIBES WORK ALREADY PRESENT in the source resume or CANDIDATE_FACTS."
  - "You may NOT introduce any tool, technology, framework, metric, number, or capability that does not appear in CANDIDATE_FACTS or the source resume."
  - "Do not move a metric or number from the project that earned it to any other project."
  - "Do not reverse the direction of any described decision, architecture, or migration."
- Keep all existing preserve rules (numbers, names, structure), the char budget, the contact sentinel and identity lock, and the skills-line adjacency behavior unchanged.

## Part 2: curated accelerants (routes/resumeContent.js, optional for v1)

- `SYNONYM_MAP`: JD term to the base term(s) it may replace, lowercased. Example: `{ 'rest apis': ['apis','api'], 'restful': ['apis','api'], 'semantic search': ['vector search'], 'reciprocal rank fusion': ['rrf'] }`. Rule enforced downstream: a synonym may appear in a bullet only if that bullet already contains one of its mapped base terms.
- `FACT_FRAGMENT_MAP`: JD keyword to an approved TRUE fragment plus the bullet topic it may attach to. Example: `{ 'row-level security': { fragment: 'row-level security', topics: ['copilot-safety'] }, 'optimistic concurrency': { fragment: 'optimistic concurrency control via state_version', topics: ['state-machine'] } }`. Every fragment must be true and traceable to CANDIDATE_FACTS.
- Curate conservatively, same rule of thumb as ADJACENCY_MAP. These feed the prompt as hints and the validator allowlist (synonym targets and fragments are allowed terms). Shipping them small or empty in v1 is fine.

## Part 3: validator (three checks plus enforcement)

Add `validateTailoredBullets(tailoredJson, baseJson, candidateFacts, jd)` that runs AFTER tailoring and BEFORE render/save.

Check 1, capability/keyword injection (deterministic, primary defense):
- Build `ALLOWLIST` = normalized token and phrase set from CANDIDATE_FACTS + base resume (all bullets and all skills lines) + `SYNONYM_MAP` targets + `FACT_FRAGMENT_MAP` fragments.
- Maintain a small `TECH_VOCAB` recognizer (known tools/languages/frameworks/acronyms). For each output bullet, extract candidate technical terms (TECH_VOCAB hits plus acronym/proper-noun tokens). If a technical term is not covered by ALLOWLIST (exact or normalized), FLAG it as possible injection.
- Term extraction is heuristic; prefer false positives (flag) over false negatives. Tune with tests.

Check 2, directional inversion (LLM-judge, targeted):
- For bullets describing a decision/architecture/migration, run a judge-model pass: given CANDIDATE_FACTS and the bullet, return PASS or FAIL plus reason. FAIL means the direction or claim contradicts the facts (for example lexical-first vs vector-first reversed). FAIL => flag.

Check 3, cross-project metric contamination (deterministic map preferred):
- Maintain `METRIC_OWNERSHIP` mapping each distinctive metric to its owning project, e.g. `'40%' + 'latency' -> capstone`, `'73.5% to 89.0%' -> copilot`, `'80%' + 'student-assignment' -> orahi`. If a metric appears in a bullet belonging to a different project, FLAG. Metrics are enumerable, so a map beats an LLM here.

Enforcement:
- Any flagged bullet triggers field-scoped regeneration: re-prompt the LLM to rewrite ONLY that bullet, naming the specific violation, and keep every other bullet byte-identical (reuse the chef-drop-brief field-scoped one-shot loop).
- Re-validate the regenerated bullet. If it fails a second time, fall back to the untouched BASE bullet for that slot. Never ship a flagged bullet.
- Log every flag and its resolution to the server console and surface it on the pipeline SSE as a non-fatal warning.

## Config and limits

- `MAX_TAILORED_BULLETS`: cap how many bullets may be reworded (for example 60 percent of bullets, or an absolute number) to prevent keyword stuffing. Beyond the cap, keep base wording.
- `ENABLE_BULLET_KEYWORDS` feature flag (default on) so the behavior can be disabled quickly.

## Tests (TDD, extend tests/test_validate.js and the ai tests)

- Injection: a bullet containing "Go" or "Kubernetes" not present in facts is flagged.
- Synonym: an "APIs" bullet with JD "REST APIs" yields "REST APIs" and is NOT flagged.
- Fact surfacing: "row-level security" placed into the copilot safety bullet is allowed.
- Inversion: a bullet reversing lexical-first vs vector-first is flagged by the judge.
- Contamination: the 40 percent latency figure placed on a copilot bullet is flagged by METRIC_OWNERSHIP.
- Regeneration: a flagged bullet regenerates once; on a second failure it falls back to the base bullet.
- Cap: never reword more than MAX_TAILORED_BULLETS.
- Regression: the full existing suite stays green; reconcile any `.replace()` or fixture anchors that reference changed strings.

## Guardrails and non-goals

- Do not modify RESUME_BASE_JSON content or CANDIDATE_FACTS.
- Do not remove the contact/identity lock or the char-budget logic.
- METRIC_OWNERSHIP, TECH_VOCAB, and the accelerant maps are curated; keep them conservative and true.
- Not in scope: any change to the skills-line adjacency injector (leave applyAdjacency as-is).

## Definition of done

- Bullets can carry JD keywords, but every shipped bullet traces to CANDIDATE_FACTS or the base.
- All three validator checks are live; flagged bullets regenerate once, then fall back to base.
- New and existing tests are green.
- Diff shown, not committed, pending explicit approval.
