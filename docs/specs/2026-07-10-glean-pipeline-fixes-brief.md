# Claude Code Brief: Glean-run pipeline fixes (identity lock, theme match, SSE error)

Date: 2026-07-10
Author: Cowork
Status: PENDING EXEC. Do not auto-commit. Show the diff and wait for "commit" / "go".

## Context (all three verified against the code and the saved bundle)

The 2026-07-08 Glean run completed server-side and saved a bundle to
`JobApplications/Glean_Software-Engineer-Context-Platform_2026-07-08-1405/`.
The red "check your API key" banner was misleading: the stream dropped after
save. Verification done on 2026-07-10:

1. Both saved PDFs embed `https://www.linkedin.com/in/sahil-mehta-87357b1b1b9/`
   (extra `1b`). `constants/identity.js` and `RESUME_BASE_JSON` both hold the
   correct `...87357b1b9`. Confirmed by scanning the PDF bytes.
2. `scripts/validate.js:301` matches full theme phrases with
   `lower.includes(theme.toLowerCase())`, so multi-word themes like
   "Enterprise API Ecosystems" false-fail (0/6) even when topically covered.
3. `public/index.html:1303` `es.onerror` unconditionally prints
   "check your API key" and resets step 2, even though `complete` (ai.js:769)
   already fired and the bundle was saved.

Priority: Fix 1 is a correctness must-fix (blocks submission). Fix 2 and Fix 3
are quality/UX improvements.

## Guardrails

- No changes to `RESUME_BASE_JSON`, `CANDIDATE_FACTS`, or any resume content.
- No em-dashes in any new comments or copy.
- Reconcile tests (`tests/test_validate.js`) and re-run before declaring done.
- No auto-commit.

---

## Fix 1 (MUST): lock identity fields after LLM tailoring

Root cause: the tailoring LLM mutated `contact` despite the "preserve" rule.
`contact` and `name` are never tailored, so pin them to the base unconditionally
after parsing. This also fixes the cover PDF, since `saveBundle.js:99` builds the
cover contact from `resumeJson.contact`.

File: `routes/ai.js`, immediately after the parse if/else that ends near line 524
(`tailoredJson = parsed.data;` / closing brace):

```js
    } else {
      tailoredJson = parsed.data;
    }

    // LOCK identity fields. The tailoring LLM has mutated contact/name despite
    // the "preserve" instruction (2026-07-08 Glean run typo'd the LinkedIn slug
    // to ...87357b1b1b9, which flowed into both PDFs). Contact and name are
    // never tailored, so pin them to the base every run. Deep-clone so no
    // downstream mutation can leak back into RESUME_BASE_JSON. saveBundle.js
    // reads resumeJson.contact, so this also protects the cover PDF header.
    tailoredJson.contact = JSON.parse(JSON.stringify(RESUME_BASE_JSON.contact));
    tailoredJson.name = RESUME_BASE_JSON.name;
```

Apply the same lock in `generateResumeOnly` (the second `buildResumePrompt`
path near ai.js:799-809) if it renders/saves a PDF from LLM JSON. Grep for every
site that assigns a tailored JSON before render/save and pin contact+name there.

## Fix 2 (quality): token-overlap theme matching in the validator

File: `scripts/validate.js`, replace the single line at ~301:

```js
      const hits = themes.filter(t => lower.includes(String(t).toLowerCase()));
```

with:

```js
      // Token-overlap match instead of exact full-phrase substring. A theme
      // like "Enterprise API Ecosystems" almost never appears verbatim, which
      // produced false 0/N results. Count a theme as hit when a majority of its
      // significant tokens (length >= 4, minus stopwords) appear in the letter.
      const THEME_STOP = new Set(['and', 'the', 'for', 'with', 'of', 'to', 'in', 'a', 'an']);
      const themeHit = (t) => {
        const raw = String(t).toLowerCase();
        const toks = raw.split(/[^a-z0-9]+/).filter(w => w.length >= 4 && !THEME_STOP.has(w));
        if (toks.length === 0) return lower.includes(raw); // short themes: exact
        const present = toks.filter(w => lower.includes(w));
        return present.length / toks.length >= 0.6;
      };
      const hits = themes.filter(themeHit);
```

Keep the `>= 3` pass threshold on line 302 unchanged.

Test reconciliation (required): the good fixture themes are
`['AI agents', 'production systems', 'tool integration', 'RAG', 'evaluation']`
(test_validate.js:167) and it asserts `cover_hits_themes === true`. Verify the
good fixture still passes and that no negative/broken fixture flips to a false
positive. If a negative case over-hits, raise the ratio to 0.67 or add a minimum
token-length guard. Do not weaken the `>= 3` themes threshold to make a test pass.

## Fix 3 (UX): stop the false "API key" error on a post-complete stream drop

File: `public/index.html`.

Step A: at pipeline start (in the run function that creates the EventSource,
near line 1291), initialize a completion flag:

```js
  S.pipelineComplete = false;
```

Step B: in `handlePipelineEvent`, where `data.step === 'complete'` is handled,
set the flag as the first line of that branch:

```js
  if (data.step === 'complete') {
    S.pipelineComplete = true;
```

Step C: replace the `es.onerror` body (1303-1314) with:

```js
  es.onerror = () => {
    es.close();
    S.currentES = null;
    if (!S.running) return;
    S.running = false;
    runBtn.disabled = false;
    runBtn.textContent = 'Run Pipeline';
    if (S.pipelineComplete) {
      // Stream dropped after the bundle was generated and saved. Not an error.
      // Leave the results and saved-folder banner in place.
      return;
    }
    const el = document.getElementById('pipe-error');
    el.style.display = 'flex';
    el.textContent = 'Pipeline stream closed before finishing. The API key may be invalid, or the connection dropped. Check the server console; any saved output is in JobApplications/.';
    markStep(2, 'pending', 'Stream closed');
    setProgress(0, '');
  };
```

Optional server keepalive (nice-to-have, only if the drop recurs): during the
long Q&A generation in `ai.js`, write an SSE comment heartbeat every ~15s
(`res.write(': keepalive\n\n')`) so proxies do not close an idle stream. Guard it
with the existing `aborted` check and clear the interval on `complete`/`end`.

## Fix 4 (defense in depth): never let the LLM see or emit the real contact

Fix 1 catches a mutated `contact` after the fact. Fix 4 removes the opportunity
at the source, so the two together are belt-and-suspenders. Strip the real
contact from the JSON the model sees, hand it a sentinel, and tell it the block
is injected downstream. The identity lock (Fix 1) then supplies the real value,
so nothing depends on the model reproducing it.

File: `routes/ai.js`, function `buildResumePrompt` (starts line 266).

Step A: at the top of the function, build a sanitized copy and embed THAT
instead of `RESUME_BASE_JSON`:

```js
function buildResumePrompt(job, emphasis) {
  // Never expose the real contact block to the LLM. It has mutated URLs before
  // (2026-07-08 Glean run typo'd the LinkedIn slug). Swap in a sentinel; the
  // real contact is pinned downstream by the identity lock. This removes the
  // chance to corrupt it at the source.
  const promptResume = JSON.parse(JSON.stringify(RESUME_BASE_JSON));
  promptResume.contact = ['CONTACT_INJECTED_DOWNSTREAM_DO_NOT_MODIFY'];
  return `You are tailoring a resume for a specific job. ...
```

Step B: change the source-resume embed (line ~277) from
`${JSON.stringify(RESUME_BASE_JSON, null, 2)}` to
`${JSON.stringify(promptResume, null, 2)}`.

Step C: change the preserve rule (lines ~281-282) from:

```
You may modify the values within bullets/skills (per rules below). You MUST preserve:
  - The top-level keys (name, contact, sections)
```

to:

```
You may modify the values within bullets/skills (per rules below). You MUST preserve:
  - The top-level keys (name, contact, sections). Output the `contact` value
    EXACTLY as given (the sentinel string). It is replaced downstream. Never
    invent, reformat, expand, or "correct" any contact URL, email, or phone.
```

Ordering guarantee (already satisfied): Fix 1's lock runs right after the JSON
parse and before any `renderResumeText`/`generateResumeDiff`/save, so the
sentinel never reaches a rendered artifact. Do not move the lock below the first
text derivation.

---

## Post-fix action (before submitting to Glean)

The saved PDFs in the Glean bundle still contain the wrong URL; the code fix only
affects future runs. After Fix 1 lands, re-run the Glean pipeline (or the
targeted regenerate path) to produce corrected `Sahil_Mehta_Resume.pdf` and
`Sahil_Mehta_CoverLetter.pdf`, then re-validate that `linkedin_correct` passes.
Do not hand-edit the existing PDFs.

## Definition of done

- Fix 1 applied at every tailored-JSON render/save site; a fresh run embeds
  `...87357b1b9` in both PDFs; `linkedin_correct` passes.
- Fix 4 applied; the prompt embeds the sentinel, not the real contact; a run
  where the LLM is deliberately prompted to alter contact still yields the
  correct URL (the lock plus sentinel both hold).
- Fix 2 applied; `node tests/test_validate.js` green; Glean-style themes now
  report a realistic hit count.
- Fix 3 applied; a manually killed stream after `complete` shows no false error.
- Glean bundle regenerated with the correct URL.
- Diff shown, not committed, pending explicit approval.
