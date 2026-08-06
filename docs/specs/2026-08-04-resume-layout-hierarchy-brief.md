# Claude Code Brief: resume visual hierarchy, skills redesign, section reorder

Date: 2026-08-04
Author: Cowork (from deep research, recruiter lens)
Status: PENDING EXEC on a NEW BRANCH. Experimental. Do not auto-commit, do not merge.

## Context

Two concrete readability problems in the current one-page render:

1. Under Enidus, the three project subsection headers (AI Chatbot & Agentic Copilot, Custom Reports & Dashboards Platform, Carrier API Gateway) are bold, body-size, and flush-left, which is the SAME visual weight as the employer/role headers below them (Software Developer, Orahi; Data Scientist, GSPANN). A reader cannot tell where the current employer's work ends and the internships begin. NN/g's layer-cake research documents this exact failure: subheadings in the same typeface, size, and weight as the level above get skipped and read out of order.
2. The TECHNICAL SKILLS section is four dense comma-runs that read as a wall of text.

Research findings driving the changes (sources at the end):
- Whitespace asymmetry (Gestalt proximity), not horizontal rules, is what creates unambiguous section boundaries.
- Gergely Orosz (hiring manager, The Tech Resume Inside Out): 3-4 labeled skill groups, strongest first, on page one; cut anything trivial or non-relevant; never use proficiency labels or star ratings.
- March 2026 survey (n=1,000 hiring managers): ~85% jump to the skills section first. For an early-career candidate, skills belong ABOVE experience.
- 39.6% of AI-first roles explicitly require evaluation/observability skills; evals are the top differentiator most candidates omit.
- 93.1% of AI-first roles require skills beyond GenAI, so the full-stack material stays.

## Hard rules

1. NEW BRANCH ONLY (suggest `resume-layout-v2`). Do not commit to the working branch, do not merge, do not auto-commit at all.
2. No content fabrication. This brief is layout and organization only. Skills content may be REORDERED, REGROUPED, and TRIMMED of genuinely redundant entries, but no new skill may be invented.
3. No em-dashes anywhere.
4. Keep intact: the one-page hard rule and the 3-tier render fallback, the contact/identity lock, the deterministic skills lock (applyAdjacency remains the only path that adds skills), the bullet validator, and the length-fit step.
5. The render must still fill 90-95% of the page and never spill to 2 pages.

## Fix 1: visual hierarchy in the experience section (pdfRender.js / generate_resume.py)

Goal: an employer block and a project subsection must be unmistakably different levels.

- Indentation: indent project subsection headers and their bullets one level (suggest 10-12pt) relative to employer headers. Employer headers stay flush left.
- Style differentiation: employer/company stays bold at body size. Project subsection headers become bold-italic, or bold at 0.5-1pt smaller. They must not be visually identical to an employer line.
- Asymmetric spacing (the load-bearing change): the gap ABOVE an employer block must be roughly 1.5x to 2x the gap between a project subsection header and its first bullet. Equal spacing everywhere is the actual cause of the ambiguity. Tune so the eye groups each project under its employer.
- Suppress employer-level signals on project lines: project subsections get NO right-aligned date and NO location. Those cues stay exclusive to employer blocks (this is already mostly true; make it explicit and consistent).
- Do not add horizontal rules between employer blocks. Whitespace is cheaper in vertical space and reads better.

## Fix 2: skills section redesign

- Keep 4 labeled groups (do not expand to 5+). Order them strongest and most role-relevant first. Recommended order for this profile: AI / LLM Systems, then Languages, then Frameworks, then Infra and Tools.
- Tighten each line. The readability problem is line length, not category count. Target roughly 8 to 12 items per line, and cut entries that are trivial, stale, or non-differentiating for AI and backend roles. Do not cut anything that ADJACENCY_MAP depends on as a justifier without checking the map first.
- Do not add proficiency labels, star ratings, or years. Orosz: self-rated experts get rejected on depth, and self-rating below expert reads as not proficient.
- Consider (optional, only if it saves lines) a trailing "Working knowledge of:" line for tech that is real but secondary. Do not add one unless the content genuinely calls for it.
- Keep the section machine-parseable: plain text, comma-separated, no tables, no columns, no icons.

## Fix 3: section reorder

New order: Header, TECHNICAL SKILLS, PROFESSIONAL EXPERIENCE, PROJECTS, EDUCATION.

Rationale: at about 1 year of experience, skills on page one is the convention and the majority of screeners look there first; experience still outranks projects; education shrinks and moves below.

Vertical-space caution: moving skills up costs nothing by itself, but the section must be TRIMMED per Fix 2 first, or the page will overflow and trigger the base fallback. Implement Fix 2 before Fix 3 and verify the fill percentage after each.

## Fix 4 (content, flag only, do NOT implement)

Research finding worth acting on separately: evaluation and reliability work is the single highest-leverage differentiator in AI hiring right now and is currently buried in the projects section. Surfacing the eval work (the 442-query eval corpus, CloudGuard's harness, the validator suite) higher in the resume is likely worth more than any layout change. This touches RESUME_BASE_JSON content, so it is Sahil's decision, not part of this brief. Do not change base content.

## Verification (required, this is layout work so tests are not enough)

1. Run the pipeline on 3 saved JDs of different shapes: one AI-heavy, one backend-heavy, one full-stack. Suggested existing bundles: Warp (full stack), Aquatic (backend/quant), and any AI-forward JD.
2. For each run, confirm: the render did NOT fall back to base, page fill is 90-95%, and the output is exactly one page.
3. Render each resume PDF to an image and LOOK at it. Confirm at a glance that the boundary between the last Enidus project (Carrier API Gateway) and the first internship (Software Developer, Orahi) is unambiguous.
4. Confirm no fabrication guard regressed: no C++ or other uninjected tech in skills, LinkedIn URL still ...87357b1b9, bullets still trace to CANDIDATE_FACTS.
5. Report the before and after fill percentages.

## Definition of done

- Employer blocks and project subsections are visually distinct levels via indentation, style, and asymmetric spacing.
- Skills section is 4 tight labeled groups, reordered, no proficiency labels, above experience.
- Section order is Skills, Experience, Projects, Education.
- Three JDs render on one page at 90-95% fill with no base fallback.
- Rendered images reviewed and the internship boundary is obvious.
- All existing tests green. Work sits on a new branch, uncommitted, for review.

## Sources

- NN/g, layer-cake scanning and heading hierarchy: https://www.nngroup.com/articles/layer-cake-pattern-scanning/
- Gergely Orosz, The Tech Resume Inside Out, resume structure: https://thetechresume.com/samples/resume-structure.html
- Gergely Orosz, common mistakes: https://thetechresume.com/samples/common-mistakes
- Forbes, 85% of hiring managers want a skills section (Mar 2026): https://www.forbes.com/sites/rachelwells/2026/03/25/85-of-hiring-managers-want-a-resume-skills-section-is-yours-ready/
- Alexey Grigorev, AI Engineering Field Guide, skills analysis of 895 JDs: https://github.com/alexeygrigorev/ai-engineering-field-guide/blob/main/role/02-skills.md
- interviewing.io, recruiters vs coin flip (median 1m40s per resume): https://interviewing.io/blog/are-recruiters-better-than-a-coin-flip-at-judging-resumes
