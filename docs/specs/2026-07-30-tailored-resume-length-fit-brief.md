# Claude Code Brief: keep the tailored resume on one page (stop the base fallback)

Date: 2026-07-30
Author: Cowork
Status: PENDING EXEC. Do not auto-commit. Show the diff and wait for "commit" / "go".

## Context

The tailored resume now overflows one page on multiple JDs (Aquatic and at least one other), which triggers the 3-tier render fallback. That fallback saves the canonical BASE resume and discards all tailoring. The 1-page rule and the fallback are correct and must stay. The problem is that the tailored content is overflowing in the first place, so the fallback fires as the common case instead of a rare safety net, and the pipeline stops producing tailored resumes at all for dense JDs.

Root cause: the per-bullet/character budget is currently WARN-ONLY (a console audit), so nothing actually enforces length. The recent features lengthen bullets with no backstop except the whole-resume fallback:
- the bullet-keyword rewording (2026-07-29 brief) lets the LLM reword bullets, which tends to add length;
- the outcome-first nudge (Fix 5) tends to make bullets wordier.

Before those features, the same Aquatic JD fit on one page and saved the tailored version. So this is a length regression, not a content problem.

## Goal

Keep the hard 1-page rule. Make the tailored bullets fit within it, so the tailored resume ships instead of falling back to base. The render fallback should return to being rare.

## Hard rules

1. No edits to RESUME_BASE_JSON or CANDIDATE_FACTS content.
2. No em-dashes anywhere.
3. Do not weaken any fabrication guard. Any length-shortening regeneration must still pass the bullet validator, and reverting a bullet to its base version is always safe.
4. Keep the render fallback as the final safety net.
5. No auto-commit.

## Fix 1: enforce per-bullet length (the real fix)

After tailoring, skills-lock, and the keyword pass, and BEFORE render, add a deterministic length-fit step:

- Map each tailored bullet to the base bullet it replaces (positional match within each subsection/project; structure and order are already preserved by the tailoring rules).
- For each tailored bullet whose length exceeds its base bullet's length beyond a small tolerance (suggest 5 percent), run a bullet-scoped regeneration (reuse the existing chef-drop-brief field-scoped one-shot loop) with the instruction: shorten this bullet to at most [base bullet length] characters, preserve every fact, number, and any JD keyword already present, and stay within CANDIDATE_FACTS.
- Re-validate the regenerated bullet through the existing bullet validator. If it still exceeds the length after one regeneration, or fails validation, REVERT that single bullet to its base version.
- Guarantee after this step: total tailored bullet characters are at or below BASE_BULLET_CHAR_BUDGET, so the bullets fit the same envelope the base fits.

This turns a whole-resume overflow into at most a few per-bullet reverts, so the tailoring on the bullets that did fit is preserved.

## Fix 2: reserve headroom for the deterministic skills additions

With the skills lock, the skills section is base plus adjacency additions. If adjacency appends enough skills to grow the section past the base height, the page can still overflow even with bullets in budget. So:

- Compute the extra characters adjacency added to the skills section (known after applyAdjacency).
- Reduce the effective bullet budget by a proportional reserve so bullets plus the grown skills section still fit one page. If that reserve would force too many bullet reverts, instead cap the number of adjacency skill additions (there is already a related cap concept; extend it) so skills never grow beyond roughly one extra line.

Keep this simple and conservative; the render fallback still backstops any miss.

## Fix 3: tone down the outcome-first nudge

The Fix 5 outcome-first instruction is a likely verbosity driver. Change it from "lead with the outcome" to "lead with the outcome concisely, without adding length; the bullet must not grow versus the base." Do not remove the jargon-lead validator flag.

## Tests (extend existing suites)

- A tailored bullet longer than its base bullet is shortened by regeneration or reverted to base; total tailored bullet chars end at or below BASE_BULLET_CHAR_BUDGET.
- The length-shortening regeneration output still passes the fabrication validator (no capability injection, no inversion, no contamination introduced while shortening).
- A resume that already fit within budget is unchanged (no needless reverts).
- Reverting a single over-length bullet does not touch the other bullets.
- Skills-reserve math: when adjacency grows the skills section, the bullet budget is reduced accordingly, and the combined total stays within the one-page envelope.
- Full existing suite stays green; reconcile any fixture anchors.

## Definition of done

- Total tailored bullet characters are guaranteed at or below the one-page budget (with skills headroom reserved), so the render fallback stops firing on normal and dense JDs.
- Over-length bullets are shortened by one scoped regeneration, then reverted to base if still too long, never dropped silently and never fabricated.
- The outcome-first nudge no longer adds length.
- New and existing tests green.
- Diff shown, not committed.
