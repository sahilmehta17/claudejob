# Claude Code Brief: skills-section lock + cover-letter guard + shared validator

Date: 2026-07-29
Author: Cowork
Status: PENDING EXEC. Do not auto-commit. Show the diff and wait for "commit" / "go".

## Context

The Aquatic run (JobApplications/Aquatic_Software-Engineer_2026-07-29-2303) exposed fabrications the current guards miss:

- The resume SKILLS line gained "C++" (not in CANDIDATE_FACTS, base, or ADJACENCY_MAP). The LLM freely rewrote the skills categories and injected it. The new bullet validator does not cover the skills section.
- The COVER LETTER claimed "Python, TypeScript, and C++ (PyTorch training pipelines)" (false; PyTorch is Python), told the lexical/vector-first routing inversion backwards (directional inversion), and invented a specific incident ("last month I discovered a gap...") not in CANDIDATE_FACTS. The cover letter has no source-fact validation at all.
- The in-UI resume validator false-flagged "0%" as a number not in source, because the base writes it as "0 percent."

These are the exact gaps from the July handover (directional inversion, cross-project contamination) plus capability injection, in the two surfaces the bullet validator does not touch.

## Hard rules

1. No edits to RESUME_BASE_JSON or CANDIDATE_FACTS content (the "zero hallucination incidents" wording and the Denari-vs-CloudGuard choice are Sahil's separate content decisions, out of scope here).
2. No em-dashes anywhere in code, comments, or generated content.
3. Keep intact: the contact/identity lock, the bullet-keyword feature and its validator, applyAdjacency, the char budget.
4. No auto-commit.

## Fix 1: lock the skills section (deterministic, root cause)

The LLM must not author the skills section. After tailoring and after `applyAdjacency`, OVERWRITE the tailored resume's skills section with the deterministic result: take the BASE skills section, run it through `applyAdjacency(baseSkills, jdRequiredSkills)`, and use that. Discard whatever the LLM produced for skills (labels and values).

- Guarantees the 4 base category labels are preserved and no skill token appears that is not either in the base or justified by ADJACENCY_MAP.
- Implement as a post-tailoring step in the pipeline (pipeline-stream), before render/save, right where adjacency already runs. If adjacency already runs on the tailored json, change it to run on the base skills and replace the tailored skills section wholesale.
- Add a guard test: even if the LLM returns a skills section containing "C++", the final output skills section never contains "C++".

## Fix 2: cover-letter validator (new)

Add `validateCoverLetter(coverText, candidateFacts, baseResume, jd, opts)` run after cover-letter generation and before save. Four checks:

1. Capability injection (deterministic): build the same ALLOWLIST used for bullets (CANDIDATE_FACTS + base bullets + base skills + accelerant maps) plus TECH_VOCAB. Flag any technical term (language, framework, tool, technology) in the cover letter not covered by the allowlist. This catches "C++" and "PyTorch training pipelines" framed as C++.
2. Directional inversion (LLM-judge): flag any described decision/architecture/migration whose direction contradicts CANDIDATE_FACTS (the lexical-first to vector-first story must not be reversed).
3. Cross-project metric contamination (deterministic METRIC_OWNERSHIP map, reused): flag a metric attached to the wrong project.
4. Invented-incident / unsupported-claim (LLM-judge): flag any specific incident, event, or quantified claim ("last month I found...", a specific bug, a specific number) that does not trace to CANDIDATE_FACTS.

Enforcement: on any flag, regenerate the cover letter once with the specific violations named in the regeneration prompt (mirror the chef-drop-brief field-scoped one-shot pattern; scope to the offending paragraph if feasible, else regenerate the letter). Re-validate. If it still fails, BLOCK: surface a clear error on the SSE and in the UI, and do not save a flagged cover letter. Never ship a flagged letter silently.

## Fix 3: extract a shared checks module

Refactor the three reusable checks (capability injection, directional inversion, cross-project metric contamination) out of `validateTailoredBullets` into a shared module or set of exported functions, consumed by both the bullet validator and the new cover-letter validator. No behavior change for bullets; just DRY so the two surfaces cannot drift.

## Fix 4: normalize number formats in the number check

In the existing resume source-fact number check (the one that emitted "Contains numbers not in source resume: 0%"), normalize numeric comparison so spelled and symbol forms match: "0 percent" == "0%", "40 percent" == "40%", etc. Strip/normalize the percent token before comparing. This removes the false positive without weakening detection of genuinely new numbers.

## Fix 5 (optional): outcome-first bullet nudge

In the tailoring prompt, add a soft instruction to lead each bullet with the user or business outcome before the stack, to reduce jargon-lead flags. Keep the existing jargon-lead validator flag as-is. Low priority; do not over-tune.

## Tests (extend existing suites)

- Skills lock: an LLM skills section containing "C++" yields a final skills section with no "C++"; adjacency-justified skills still appear; the 4 base labels are preserved.
- Cover letter capability injection: a letter containing "C++" is flagged; a clean letter passes.
- Cover letter inversion: a letter reversing lexical/vector-first is flagged.
- Cover letter invented incident: a letter with a specific incident absent from CANDIDATE_FACTS is flagged.
- Cover letter contamination: capstone 40% latency attributed to the copilot is flagged.
- Cover letter enforcement: a flagged letter regenerates once, then blocks (no silent save).
- Number normalization: "0 percent" in source vs "0%" in output does not flag.
- Shared module: bullet validator behavior is unchanged (all prior bullet tests still pass).
- Full existing suite stays green; reconcile any fixture anchors.

## Definition of done

- The skills section is deterministic; no LLM-authored skill can reach output.
- The cover letter runs the four checks; flagged letters regenerate once then block.
- The three checks live in one shared module used by bullets, skills-injection allowlist, and the cover letter.
- Number normalization removes the percent false positive.
- New and existing tests green.
- Diff shown, not committed.
