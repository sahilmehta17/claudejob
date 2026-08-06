// ─────────────────────────────────────────────────────────────────────────────
// pdfRender.js — Pure-Node PDF generation, no Python required.
//
// Direct port of generate_resume.py + generate_cover_letter.py to pdfkit.
// Same exact spec the Python file was reverse-engineered from:
//   Resume:  A4 (595 x 842pt), 17pt margins, Times-Roman 11pt body, 16pt name.
//            13pt line height, 26pt section gap, underscore separators.
//   Cover:   US Letter, 1" margins, Times-Roman 11pt body, 16pt name letterhead.
// ─────────────────────────────────────────────────────────────────────────────

const fs = require('fs');
const { Writable } = require('stream');
const PDFDocument = require('pdfkit');

// Unicode non-breaking space (U+00A0). pdfkit's Times-Roman uses WinAnsi
// encoding which maps NBSP to 0xA0, so it renders as a visible space-width
// glyph. Used by preventWidow() to glue the last 3 words of a bullet into a
// single unbreakable token. WORD_SPLIT deliberately excludes NBSP so our
// wrap/measure helpers treat NBSP-joined runs as one token.
const NBSP = ' ';
const WORD_SPLIT = /[ \t\r\n\f\v]+/;

// ─────────────────────────────────────────────────────────────────────────────
// Resume — A4, tight margins, dense layout matching Sahil's Pages template.
// ─────────────────────────────────────────────────────────────────────────────
const R = {
  PAGE_W: 595,
  PAGE_H: 842,
  MARGIN_L: 17,
  MARGIN_R: 17,
  MARGIN_T: 17,
  MARGIN_B: 20,
  LINE_H: 12,
  // Extra inter-section gap added AFTER each separator rule (on top of the
  // separator's own one-line advance). Tightened to 2pt on 2026-05-27: the
  // larger 18pt value left a ~30pt void below each separator that read as
  // "too much whitespace between sections." At 2pt the separator sits snug
  // between the previous section's last bullet and the next section header.
  // Page-fill is handled by adaptive leading (lineH) in renderResumePdf, NOT
  // by inflating this gap — inflating section gaps is what made sections
  // "float apart" and look weird. See the underfill block below.
  GAP_SECTION: 2,
  GAP_NAME_CONTACT: 14,
  // Post-item / subsection spacing — kept smaller than GAP_SECTION so the
  // resume lands on a single page. Tightened from (13/26/7/7) to
  // (12/18/5/5) on 2026-05-19 to make room for BASE content that grew
  // past the previous render budget. Visually still has breathing room.
  GAP_POST_ITEM: 5,
  // ── Asymmetric spacing (2026-08-04 hierarchy brief, Fix 1) ────────────────
  // The load-bearing change. Before this, GAP_SUBSECTION_PRE and GAP_POST_ITEM
  // were BOTH 5pt, so the gap above a project subsection and the gap above the
  // next employer were identical. Equal spacing everywhere is exactly what made
  // "Carrier API Gateway" (an Enidus project) and "Software Developer, Orahi"
  // (a different employer) read as peers. Gestalt proximity, not a horizontal
  // rule, is what separates the levels: an employer block gets 2x the gap a
  // project subsection gets, so the eye groups each project under its employer.
  //
  //   GAP_EMPLOYER_PRE (8) / GAP_SUBSECTION_PRE (4) = 2.0x
  //
  // Deliberately spacing-NEUTRAL overall. The base-content tier is the
  // renderer's last fallback; if base stops fitting, renderResumePdf throws
  // instead of falling back, so vertical cost here is not free. The employer
  // gap is paid for by halving the subsection gap and by advancing
  // GAP_POST_ITEM only after the LAST item in a section rather than after every
  // item. Net cost across the experience section is +3pt, not +18pt. Base had
  // 2pt of headroom before this brief and has 23pt after (the Fix 2 skills trim
  // paid for the indentation rewrap). Do not raise GAP_EMPLOYER_PRE without
  // re-running scripts/measure_layout.js.
  GAP_EMPLOYER_PRE: 8,
  GAP_SUBSECTION_PRE: 4,
  FONT_NORMAL: 'Times-Roman',
  FONT_BOLD: 'Times-Bold',
  FONT_ITALIC: 'Times-Italic',
  // Project subsection headers render bold-ITALIC so they are not the same
  // visual token as a bold employer header. Style differentiation is the second
  // half of Fix 1; indentation and spacing are the other two.
  FONT_BOLD_ITALIC: 'Times-BoldItalic',
  BODY_SIZE: 11,
  // Project subsection headers sit 0.5pt below body size. Combined with
  // bold-italic this puts them unambiguously a level below an employer header
  // without shrinking so far that they stop reading as headers.
  SUBSECTION_SIZE: 10.5,
  NAME_SIZE: 16,
  BULLET_X: 17,
  BULLET_TEXT_X: 28,
  CONTENT_X: 17,
  // One indent level for project subsection headers and the bullets underneath
  // them. Employer headers, and bullets that hang directly off an employer with
  // no project subsection (Orahi, GSPANN), stay flush left, so indentation
  // alone tells the reader which level a line belongs to.
  INDENT_SUB: 11,
  SEPARATOR: '_'.repeat(97),
};

// Predict the rendered wrap of a string in body font at the given size/width
// and return the last line. Used to detect widow lines (final line < 4 words)
// without re-running the full render path. Font is forced to Times-Roman so
// the measurement matches drawBullet's _wrap exactly regardless of caller state.
function predictLastLine(doc, text, fontSize, maxWidth) {
  doc.font(R.FONT_NORMAL).fontSize(fontSize);
  // WORD_SPLIT excludes NBSP, so NBSP-joined runs stay as a single token —
  // matching the way preventWidow() forces the last 3 words to wrap as a unit.
  const words = String(text).split(WORD_SPLIT).filter(Boolean);
  let currentLine = '';
  let lastLine = '';
  for (const word of words) {
    const trial = currentLine ? `${currentLine} ${word}` : word;
    const trialWidth = doc.widthOfString(trial);
    if (trialWidth <= maxWidth) {
      currentLine = trial;
    } else {
      lastLine = currentLine;
      currentLine = word;
    }
  }
  lastLine = currentLine;
  return lastLine;
}

function isWidow(lastLine) {
  return lastLine.split(/\s+/).filter(Boolean).length < 4;
}

// Active widow guard. If the last line of a bullet would render with fewer
// than 3 visual words, replace the last two ASCII spaces with NBSP so pdfkit
// (and our wrap helpers) treat the last 3 words as one unbreakable token.
// Either the full 3-word phrase fits on the previous line, or the whole
// phrase wraps to a new line together — never 1 or 2 words alone.
function preventWidow(text, doc, fontSize, maxWidth) {
  const src = String(text);
  // Use ASCII-only split here so a text already containing NBSP still counts
  // its visual words correctly (we only need a ballpark to skip very short
  // strings).
  const words = src.split(WORD_SPLIT).filter(Boolean);
  if (words.length < 4) return src;

  const lastLine = predictLastLine(doc, src, fontSize, maxWidth);
  const lastLineWords = lastLine.split(/\s+/).filter(Boolean);
  if (lastLineWords.length >= 3) return src;

  // Find the last two ASCII spaces and swap them for NBSP. lastIndexOf
  // ignores any NBSPs already present, so calling preventWidow on text that
  // already contains NBSPs simply extends the no-break group further back.
  const lastSpace = src.lastIndexOf(' ');
  if (lastSpace < 0) return src;
  const secondLastSpace = src.lastIndexOf(' ', lastSpace - 1);
  if (secondLastSpace < 0) return src;

  return (
    src.slice(0, secondLastSpace) +
    NBSP +
    src.slice(secondLastSpace + 1, lastSpace) +
    NBSP +
    src.slice(lastSpace + 1)
  );
}

class ResumeWriter {
  constructor(outPath, opts = {}) {
    this.outPath = outPath;
    this.measureOnly = !!opts.measureOnly;
    // gaps: per-render overrides for spacing constants. `section` is the EXTRA
    // inter-section gap added on top of the separator line; defaults to the
    // tight R.GAP_SECTION (2pt) so EVERY render — including the default-spacing
    // and base-content fallback tiers — uses the same tight section rhythm.
    // The underfill adjuster NEVER inflates these gaps (doing so floats the
    // sections apart); it only grows lineH. See renderResumePdf.
    this.gaps = Object.assign(
      {
        section: R.GAP_SECTION,
        postItem: R.GAP_POST_ITEM,
        subsectionPre: R.GAP_SUBSECTION_PRE,
        employerPre: R.GAP_EMPLOYER_PRE,
      },
      opts.gaps || {}
    );
    // Per-render line height (leading). Defaults to R.LINE_H. The underfill
    // adjuster in renderResumePdf grows this — and ONLY this — by up to
    // MAX_LINE_H_BUMP to fill an underfilled page, keeping section gaps tight.
    this.lineH = typeof opts.lineH === 'number' ? opts.lineH : R.LINE_H;
    // bufferPages: true keeps every page in _pageBuffer until doc.end() flushes
    // it. Without this, pdfkit flushes each page on addPage() and
    // bufferedPageRange() always reports count: 1, defeating the overflow guard.
    this.doc = new PDFDocument({
      size: [R.PAGE_W, R.PAGE_H],
      margins: { top: 0, bottom: 0, left: 0, right: 0 },
      autoFirstPage: true,
      bufferPages: true,
    });
    // In measureOnly mode, pipe to a noop sink so pdfkit's Readable doesn't
    // build up backpressure while we walk the layout for height measurement.
    if (this.measureOnly) {
      this.stream = new Writable({ write(_c, _e, cb) { cb(); } });
    } else {
      this.stream = fs.createWriteStream(outPath);
    }
    this.doc.pipe(this.stream);
    this.y = R.MARGIN_T + R.BODY_SIZE; // baseline of first line
  }

  _checkBreak(needed = this.lineH) {
    if (this.y + needed > R.PAGE_H - R.MARGIN_B) {
      this.doc.addPage({ size: [R.PAGE_W, R.PAGE_H], margins: { top: 0, bottom: 0, left: 0, right: 0 } });
      this.y = R.MARGIN_T + R.BODY_SIZE;
    }
  }

  _textWidth(text, font, size) {
    return this.doc.font(font).fontSize(size).widthOfString(text);
  }

  // pdfkit measures y from the TOP of the text bounding box, not the baseline.
  // Convert our baseline-y to top-y by subtracting the font ascent.
  _drawAt(x, baselineY, text, font, size) {
    this.doc.font(font).fontSize(size);
    const topY = baselineY - size * 0.85; // approximate ascent for Times-Roman
    this.doc.text(text, x, topY, { lineBreak: false });
  }

  advance(pts = this.lineH) {
    this.y += pts;
  }

  drawName(name) {
    this._checkBreak(R.GAP_NAME_CONTACT + this.lineH);
    this.doc.font(R.FONT_BOLD).fontSize(R.NAME_SIZE);
    const w = this.doc.widthOfString(name);
    const x = (R.PAGE_W - w) / 2;
    this._drawAt(x, this.y, name, R.FONT_BOLD, R.NAME_SIZE);
    this.advance(R.GAP_NAME_CONTACT);
  }

  drawContact(parts) {
    // Each part is either a string or { text, url }. URL items render as
    // clickable blue links (with link annotation rectangle for clickability).
    const items = parts.map(p => (typeof p === 'string' ? { text: p } : p));
    const sep = ' | ';
    this.doc.font(R.FONT_NORMAL).fontSize(R.BODY_SIZE);
    const totalW = items.reduce((acc, it, i) => {
      return acc + this.doc.widthOfString(it.text) + (i > 0 ? this.doc.widthOfString(sep) : 0);
    }, 0);
    let x = (R.PAGE_W - totalW) / 2;
    const topY = this.y - R.BODY_SIZE * 0.85;
    const sepW = this.doc.widthOfString(sep);
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (i > 0) {
        // Separator in default color
        this.doc.fillColor('#000000');
        this.doc.text(sep, x, topY, { lineBreak: false });
        x += sepW;
      }
      const itemW = this.doc.widthOfString(it.text);
      if (it.url) {
        this.doc.fillColor('#0000EE');
        this.doc.text(it.text, x, topY, { lineBreak: false });
        // underline
        const ulY = topY + R.BODY_SIZE - 1;
        this.doc.moveTo(x, ulY).lineTo(x + itemW, ulY).strokeColor('#0000EE').lineWidth(0.5).stroke();
        this.doc.fillColor('#000000').strokeColor('#000000');
        // clickable annotation
        this.doc.link(x, topY, itemW, R.BODY_SIZE, it.url);
      } else {
        this.doc.fillColor('#000000');
        this.doc.text(it.text, x, topY, { lineBreak: false });
      }
      x += itemW;
    }
    this.advance(this.lineH);
  }

  drawSummary(text) {
    // Italic positioning summary, full-width, after contact line.
    if (!text) return;
    this._checkBreak(this.lineH * 3);
    const maxW = R.PAGE_W - R.MARGIN_L - R.MARGIN_R;
    const lines = this._wrap(text, R.FONT_ITALIC, R.BODY_SIZE, maxW);
    for (const line of lines) {
      this._checkBreak(this.lineH);
      this._drawAt(R.CONTENT_X, this.y, line, R.FONT_ITALIC, R.BODY_SIZE);
      this.advance(this.lineH);
    }
  }

  drawSeparator() {
    this._checkBreak(this.lineH * 2);
    this._drawAt(R.CONTENT_X, this.y, R.SEPARATOR, R.FONT_NORMAL, R.BODY_SIZE);
    this.advance(this.lineH);
  }

  drawSectionHeader(text) {
    this._checkBreak(this.lineH);
    this._drawAt(R.CONTENT_X, this.y, text, R.FONT_BOLD, R.BODY_SIZE);
    this.advance(this.lineH);
  }

  drawJobHeader(titleLeft, dateRight, locationRight, linkUrl) {
    this._checkBreak(this.lineH);
    this._drawAt(R.CONTENT_X, this.y, titleLeft, R.FONT_BOLD, R.BODY_SIZE);

    // Optional clickable "(Github)" suffix for projects with a public repo.
    // Rendered in blue (no underline — pdfkit's underline+lineBreak:false combo
    // computes NaN positions). Link annotation drawn separately as a rectangle.
    if (linkUrl) {
      const titleW = this._textWidth(titleLeft, R.FONT_BOLD, R.BODY_SIZE);
      const suffix = ' (Github)';
      const suffixW = this._textWidth(suffix, R.FONT_BOLD, R.BODY_SIZE);
      const topY = this.y - R.BODY_SIZE * 0.85;
      this.doc.font(R.FONT_BOLD).fontSize(R.BODY_SIZE).fillColor('#0000EE');
      this.doc.text(suffix, R.CONTENT_X + titleW, topY, { lineBreak: false });
      // Manual underline: draw a thin line under the suffix.
      const underlineY = topY + R.BODY_SIZE - 1;
      this.doc.moveTo(R.CONTENT_X + titleW, underlineY)
              .lineTo(R.CONTENT_X + titleW + suffixW, underlineY)
              .strokeColor('#0000EE')
              .lineWidth(0.5)
              .stroke();
      this.doc.fillColor('#000000').strokeColor('#000000');
      // Clickable link annotation rectangle over the suffix text.
      this.doc.link(R.CONTENT_X + titleW, topY, suffixW, R.BODY_SIZE, linkUrl);
    }

    if (dateRight && locationRight) {
      const locW = this._textWidth(locationRight, R.FONT_BOLD, R.BODY_SIZE);
      const pipeW = this._textWidth(' | ', R.FONT_BOLD, R.BODY_SIZE);
      const dateW = this._textWidth(dateRight, R.FONT_ITALIC, R.BODY_SIZE);
      const rightEdge = R.PAGE_W - R.MARGIN_R;
      const locX = rightEdge - locW;
      const pipeX = locX - pipeW;
      const dateX = pipeX - dateW;
      this._drawAt(dateX, this.y, dateRight, R.FONT_ITALIC, R.BODY_SIZE);
      this._drawAt(pipeX, this.y, ' | ', R.FONT_BOLD, R.BODY_SIZE);
      this._drawAt(locX, this.y, locationRight, R.FONT_BOLD, R.BODY_SIZE);
    } else if (dateRight) {
      const w = this._textWidth(dateRight, R.FONT_ITALIC, R.BODY_SIZE);
      const x = R.PAGE_W - R.MARGIN_R - w;
      this._drawAt(x, this.y, dateRight, R.FONT_ITALIC, R.BODY_SIZE);
    }
    this.advance(this.lineH);
  }

  // Role subline under a company-as-header job (Enidus). Italic so it reads as
  // the position, distinct from the bold company header above and the bold
  // subsection (project) names below. No pre-gap: sits snug under the company.
  drawRole(text) {
    this._checkBreak(this.lineH);
    this._drawAt(R.CONTENT_X, this.y, text, R.FONT_ITALIC, R.BODY_SIZE);
    this.advance(this.lineH);
  }

  // Project subsection header (the three Enidus projects). Three signals put it
  // a level below an employer header, per the 2026-08-04 hierarchy brief:
  //   1. indented one level (INDENT_SUB) while employer headers stay flush left
  //   2. bold-italic at 10.5pt, so it is never the same token as a bold 11pt
  //      employer line
  //   3. a smaller pre-gap than an employer block gets (see GAP_EMPLOYER_PRE)
  //
  // It deliberately takes NO date and NO location argument. Right-aligned date
  // and location are employer-level signals and stay exclusive to
  // drawJobHeader; a project subsection that carried them would re-create the
  // exact ambiguity this change exists to remove.
  drawSubsection(text) {
    this._checkBreak(this.gaps.subsectionPre + this.lineH);
    this.advance(this.gaps.subsectionPre);
    this._drawAt(R.CONTENT_X + R.INDENT_SUB, this.y, text, R.FONT_BOLD_ITALIC, R.SUBSECTION_SIZE);
    this.advance(this.lineH);
  }

  // indent: horizontal offset for bullets that hang off a project subsection.
  // Bullets that hang directly off an employer (Orahi, GSPANN) pass 0 and stay
  // flush with the employer header above them.
  drawBullet(text, indent = 0) {
    const maxW = R.PAGE_W - R.MARGIN_R - R.BULLET_TEXT_X - indent;
    // Active widow guard. preventWidow returns the original text unchanged if
    // it's already widow-safe, otherwise NBSP-joins the last 3 words so they
    // wrap as a unit. Warn only if the fix can't succeed (e.g., 3-word group
    // too long for one line) \u2014 should be near-zero on a well-tuned base.
    const safeText = preventWidow(text, this.doc, R.BODY_SIZE, maxW);
    const lastLine = predictLastLine(this.doc, safeText, R.BODY_SIZE, maxW);
    const wc = lastLine.split(/\s+/).filter(Boolean).length;
    if (wc < 3) {
      console.warn(`[pdfRender] widow remains after NBSP fix: bullet ends with "${lastLine}" (${wc} words on last line)`);
      console.warn(`[pdfRender] full bullet: ${String(text).slice(0, 100)}...`);
    }
    const lines = this._wrap(safeText, R.FONT_NORMAL, R.BODY_SIZE, maxW);
    for (let i = 0; i < lines.length; i++) {
      this._checkBreak(this.lineH);
      if (i === 0) {
        this._drawAt(R.BULLET_X + indent, this.y, '\u2022', R.FONT_NORMAL, R.BODY_SIZE);
      }
      this._drawAt(R.BULLET_TEXT_X + indent, this.y, lines[i], R.FONT_NORMAL, R.BODY_SIZE);
      this.advance(this.lineH);
    }
  }

  drawPlain(text, opts = {}) {
    const font = opts.font || R.FONT_NORMAL;
    this._checkBreak(this.lineH);
    this._drawAt(R.CONTENT_X, this.y, text, font, R.BODY_SIZE);
    if (opts.rightText) {
      const rFont = opts.rightFont || R.FONT_ITALIC;
      const w = this._textWidth(opts.rightText, rFont, R.BODY_SIZE);
      const x = R.PAGE_W - R.MARGIN_R - w;
      this._drawAt(x, this.y, opts.rightText, rFont, R.BODY_SIZE);
    }
    this.advance(this.lineH);
  }

  drawSkillsLine(label, value) {
    this._checkBreak(this.lineH);
    const labelText = label + ': ';
    const labelW = this._textWidth(labelText, R.FONT_BOLD, R.BODY_SIZE);
    const valueX = R.CONTENT_X + labelW;
    const maxW = R.PAGE_W - R.MARGIN_R - valueX;
    const lines = this._wrap(value, R.FONT_NORMAL, R.BODY_SIZE, maxW);
    if (!lines.length) lines.push('');

    this._drawAt(R.CONTENT_X, this.y, labelText, R.FONT_BOLD, R.BODY_SIZE);
    this._drawAt(valueX, this.y, lines[0], R.FONT_NORMAL, R.BODY_SIZE);
    this.advance(this.lineH);

    for (let i = 1; i < lines.length; i++) {
      this._checkBreak(this.lineH);
      this._drawAt(valueX, this.y, lines[i], R.FONT_NORMAL, R.BODY_SIZE);
      this.advance(this.lineH);
    }
  }

  _wrap(text, font, size, maxW) {
    // WORD_SPLIT excludes NBSP so any NBSP-joined run (from preventWidow)
    // becomes a single token and stays on one line as a unit.
    const words = String(text).split(WORD_SPLIT).filter(Boolean);
    const lines = [];
    let current = [];
    for (const word of words) {
      const test = current.concat(word).join(' ');
      if (this._textWidth(test, font, size) <= maxW) {
        current.push(word);
      } else {
        if (current.length) lines.push(current.join(' '));
        current = [word];
      }
    }
    if (current.length) lines.push(current.join(' '));
    return lines;
  }

  finish() {
    // Hard guard: tailored resume MUST be 1 page. The LLM-side constraint in
    // ai.js asks for this but doesn't enforce it; this is the safety net.
    //
    // Defense-in-depth only — renderResumePdf below uses measure-first preflight
    // so overflow is detected BEFORE the real write stream is opened. We do NOT
    // touch the on-disk file here: fs.createWriteStream's open() is async via
    // libuv, and racing stream.destroy() + unlinkSync against that open is the
    // exact bug that produced 0-byte zombie PDFs (the deferred open lands AFTER
    // unlinkSync returns ENOENT, creating an empty file the caller can't clean).
    const pageRange = this.doc.bufferedPageRange();
    if (pageRange.count > 1) {
      throw new Error(
        `Resume overflow: tailored output rendered to ${pageRange.count} pages. ` +
        `(This should have been caught by the measure-first preflight in ` +
        `renderResumePdf; reaching this branch means a measure/render divergence.)`
      );
    }
    // Always log the realized page-fill percentage so the adaptive-leading
    // result is visible. The < 70% branch keeps the prompt-regression warning
    // for cases leading can't fully recover (the MAX_LINE_H_BUMP cap is hit on
    // genuinely sparse content — i.e. the LLM under-produced).
    const usable = R.PAGE_H - R.MARGIN_T - R.MARGIN_B;
    const used = this.y - R.MARGIN_T;
    const fillPct = used / usable;
    console.log(
      `[pdfRender] page filled at ${(fillPct * 100).toFixed(0)}% ` +
      `(${used.toFixed(0)}pt of ${usable}pt)`
    );
    if (fillPct < 0.7) {
      console.warn(
        `[pdfRender] underfill: page 1 below 70% even after gap distribution. ` +
        `LLM may have dropped roles/bullets it shouldn't have — check the ` +
        `tailoring prompt's "preserve all content" constraint.`
      );
    }
    // Capture the realized fill ratio so renderResumePdf can plumb it through
    // to the UI (used by the warning banner copy when a fallback fires).
    this._fillPct = fillPct;
    return new Promise((resolve, reject) => {
      this.doc.end();
      this.stream.on('finish', () => resolve({ path: this.outPath, fillPct }));
      this.stream.on('error', reject);
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Underfill page distribution — ADAPTIVE LEADING (v4).
//
// Spec: docs/specs/2026-05-26-selective-underfill-distribution-design.md
//
// History (read before changing constants — each prior approach was rejected
// for a specific, documented reason; don't reintroduce them):
//   v1: inflated GAP_SECTION + GAP_POST_ITEM + GAP_SUBSECTION_PRE + LINE_H to
//       ~98% fill. Bullets/items looked puffy ("extra lines between points").
//       USER-REJECTED.
//   v2 (TARGET_FILL_PCT=0): all inflation off. Tight bullets, but ~25% bottom
//       whitespace on under-budget tailored output. USER-REJECTED.
//   v3: selective inflation of GAP_SECTION + LINE_H. The GAP_SECTION growth
//       (up to 30pt) floated sections apart — "too much whitespace between
//       sections, sits weird." USER-REJECTED.
//   v4 (this code): section gaps are FIXED tight (R.GAP_SECTION = 2pt, never
//       inflated). The ONLY dial used to fill an underfilled page is LINE_H
//       (leading) — a uniform per-line stretch that fills the page without
//       changing the relative rhythm between sections, items, or bullets.
//       Empirically (see spec) leading ≈12.5–13.0pt fills a 1-page resume to
//       97–99% across the realistic tailored char-count range, with a hard
//       overflow cliff just above — so leading is grown in small steps with a
//       measure-and-stop search rather than a single computed bump.
//
// TARGET_FILL_PCT: stop growing leading once the page reaches this fill. 0.97
//   leaves a small safety margin below the 1→2 page overflow cliff while still
//   reading as a full page.
// LINE_H_STEP: leading search granularity. 0.25pt is fine enough to land near
//   the sweet spot without overshooting the cliff.
// MAX_LINE_H_BUMP: hard cap on leading growth (LINE_H + 2.0 = 14pt max, ~17%).
//   On genuinely sparse content the search hits this cap and the page keeps
//   some bottom whitespace rather than stretching leading into "spaced-out"
//   territory — graceful degradation. (Signal to watch: that means the LLM
//   under-produced; fix the tailoring prompt, not the renderer.)
// LINE_H_SAFETY_BUFFER: keep measured height this far below the usable area so
//   baseline drift / kerning can't tip a "fits" measurement into a 2-page
//   render.
//
// The 3-tier overflow fallback below remains load-bearing — do NOT touch it.
// The realized-fill log + <70% warning at finish() still fires as the
// LLM-content-drop signal.
// ─────────────────────────────────────────────────────────────────────────────
const TARGET_FILL_PCT = 0.97;
const LINE_H_STEP = 0.25;
const MAX_LINE_H_BUMP = 2.0;
const LINE_H_SAFETY_BUFFER = 6;

// Render-or-measure path shared by both passes. Mutating writer.gaps before
// calling this controls how much vertical space the layout consumes.
// Split a project date like "August 2026 | Research" into { date, qualifier }
// on the LAST " | " so the qualifier can render bold (like an experience
// location). A date with no " | " returns an undefined qualifier.
function splitProjectDate(raw) {
  if (!raw) return { date: raw, qualifier: undefined };
  const i = raw.lastIndexOf(' | ');
  if (i === -1) return { date: raw, qualifier: undefined };
  return { date: raw.slice(0, i), qualifier: raw.slice(i + 3) };
}

function drawResumeContent(w, content) {
  w.drawName(content.name);
  w.drawContact(content.contact || []);
  if (content.summary) w.drawSummary(content.summary);
  w.drawSeparator();

  const sections = content.sections || [];
  for (let i = 0; i < sections.length; i++) {
    const section = sections[i];
    w.drawSectionHeader(section.header);

    if (section.type === 'education') {
      for (const item of section.items || []) {
        w.drawPlain(item.institution, { font: R.FONT_BOLD });
        w.drawPlain(item.degree, { rightText: item.graduation, rightFont: R.FONT_ITALIC });
      }
    } else if (section.type === 'experience') {
      // Asymmetric spacing (Fix 1). The gap goes ABOVE each employer block
      // rather than below, and only between blocks, so the space that
      // separates two employers is a single deliberate GAP_EMPLOYER_PRE
      // instead of the old "postItem after every item" rhythm that spent the
      // same 5pt between employers and between projects. GAP_POST_ITEM is
      // spent once, after the last item, to keep the section separator off the
      // final bullet.
      const items = section.items || [];
      for (let j = 0; j < items.length; j++) {
        const item = items[j];
        if (j > 0) w.advance(w.gaps.employerPre);
        w.drawJobHeader(item.title, item.date, item.location);
        if (item.role) w.drawRole(item.role);
        for (const sub of item.subsections || []) {
          // A named subsection is a project under this employer: header and
          // bullets both step in one level. An unnamed subsection is just the
          // employer's own bullets (Orahi, GSPANN) and stays flush left.
          const indent = sub.name ? R.INDENT_SUB : 0;
          if (sub.name) w.drawSubsection(sub.name);
          for (const b of sub.bullets || []) w.drawBullet(b, indent);
        }
        if (j === items.length - 1) w.advance(w.gaps.postItem);
      }
    } else if (section.type === 'projects') {
      for (const item of section.items || []) {
        // Split the project date on its last " | " so the qualifier (Personal
        // Project / Research / Capstone) renders BOLD like an experience
        // location, while the date itself stays italic. drawJobHeader already
        // bolds the "location" slot, so route the qualifier through it.
        const { date, qualifier } = splitProjectDate(item.date);
        w.drawJobHeader(item.title, date, qualifier, item.url);
        for (const b of item.bullets || []) w.drawBullet(b);
        w.advance(w.gaps.postItem);
      }
    } else if (section.type === 'skills') {
      for (const item of section.items || []) {
        w.drawSkillsLine(item.label, item.value);
      }
    }

    // Draw separator between sections, but skip the trailing one — it would
    // push to a new blank page when content already fills page 1. The
    // optional extra inter-section gap is added AFTER the separator so the
    // separator stays anchored to the previous section visually.
    if (i < sections.length - 1) {
      w.drawSeparator();
      if (w.gaps.section > 0) w.advance(w.gaps.section);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// renderResumePdf(content, outPath) → Promise<outPath>
// content schema = same as DEFAULT_CONTENT in generate_resume.py / RESUME_BASE_JSON
//
// Section gaps stay FIXED tight (R.GAP_SECTION); if the page is underfilled,
// fill it by growing leading (lineH) only, via a measure-and-stop search —
// see the "ADAPTIVE LEADING (v4)" constants header block above for rationale.
// ─────────────────────────────────────────────────────────────────────────────
async function renderResumePdf(content, outPath) {
  const pageContentHeight = R.PAGE_H - R.MARGIN_T - R.MARGIN_B;
  const targetHeight = TARGET_FILL_PCT * pageContentHeight;
  const safeMax = pageContentHeight - LINE_H_SAFETY_BUFFER;

  // Section gaps are FIXED tight (R.GAP_SECTION). The underfill adjuster never
  // touches them — section-gap inflation is what made v3 "float apart." All
  // page-filling is done by growing leading (lineH) only.
  // employerPre is listed explicitly even though the ResumeWriter constructor
  // already defaults it. This object is the single place the tier-1 gap set is
  // enumerated, so a knob missing here is a knob that silently keeps its
  // default if this set is ever tuned — and employerPre is exactly the gap the
  // hierarchy depends on (see GAP_EMPLOYER_PRE).
  const gaps = {
    section: R.GAP_SECTION,
    postItem: R.GAP_POST_ITEM,
    subsectionPre: R.GAP_SUBSECTION_PRE,
    employerPre: R.GAP_EMPLOYER_PRE,
  };

  // Helper: measure used height + page count for a candidate leading.
  const measure = (lineH) => {
    const m = new ResumeWriter(null, { measureOnly: true, gaps, lineH });
    drawResumeContent(m, content);
    const used = m.y - R.MARGIN_T;
    const pages = m.doc.bufferedPageRange().count;
    try { m.doc.end(); } catch (_) { /* noop sink */ }
    return { used, pages };
  };

  // Adaptive-leading search. Start at baseline; if the page is underfilled and
  // fits on one page, grow leading in LINE_H_STEP increments until we either
  // reach TARGET_FILL_PCT or the next step would spill to page 2 / cross the
  // safety buffer. There's a hard 1→2-page cliff just above the sweet spot
  // (see spec), so we step-and-measure rather than computing a single bump that
  // could overshoot. `lineH` holds the largest leading verified to fit.
  let lineH = R.LINE_H;
  const baseline = measure(R.LINE_H);
  if (baseline.pages === 1 && baseline.used < targetHeight) {
    for (let lh = R.LINE_H + LINE_H_STEP; lh <= R.LINE_H + MAX_LINE_H_BUMP + 1e-9; lh += LINE_H_STEP) {
      const { used, pages } = measure(lh);
      if (pages > 1 || used > safeMax) break; // would overflow — keep last good leading
      lineH = lh;                             // this leading fits
      if (used >= targetHeight) break;        // reached target fill — stop growing
    }
  }

  // Pass C: real render with the tight fixed gaps and the chosen leading.
  //
  // Three-tier fallback: adjusted → default-spacing → RESUME_BASE_JSON.
  // Each tier MEASURES FIRST (no file stream) and only opens the real write
  // stream once the page-count guard passes. This kills two bugs at once:
  //   (a) the fs.createWriteStream async-open race that left 0-byte zombie
  //       PDFs when finish() tried to clean up via stream.destroy() + unlinkSync
  //       before libuv's open() syscall had completed,
  //   (b) the cascading-cleanup mess where 3 tiers each opened a stream then
  //       tried to unlink, leaving the last race-winner on disk.
  //
  // Returns { path, fallback, fillPct } so callers (saveBundle → SSE → UI)
  // can surface which tier landed. fallback ∈ 'none' | 'default-spacing' |
  // 'base-content'. When non-'none' the UI MUST warn the user that the saved
  // PDF differs from the tailored output rendered above.
  const tiers = [
    { content,           opts: { gaps, lineH }, label: 'tailored adjusted',         fallback: 'none' },
    { content,           opts: {},              label: 'tailored default-spacing',  fallback: 'default-spacing' },
    null, // base-content — content resolved lazily below to avoid require cycles
  ];

  for (let i = 0; i < tiers.length; i++) {
    let tier = tiers[i];
    if (!tier) {
      const { RESUME_BASE_JSON } = require('./resumeContent');
      tier = { content: RESUME_BASE_JSON, opts: {}, label: 'base-content', fallback: 'base-content' };
    }

    // Measure-only pass: build the PDF in memory, count pages, discard.
    // No file stream involved → no race condition, no zombie file.
    const measurer = new ResumeWriter(null, { measureOnly: true, ...tier.opts });
    drawResumeContent(measurer, tier.content);
    const measuredPages = measurer.doc.bufferedPageRange().count;
    try { measurer.doc.end(); } catch (_) { /* discard noop sink */ }

    if (measuredPages > 1) {
      const tag = tier.label;
      if (i < tiers.length - 1) {
        console.warn(`[pdfRender] ${tag} measures ${measuredPages} pages — falling through to next tier`);
        continue;
      }
      // Final tier (base-content) also overflows — content-level bug, not a
      // render bug. Throw a clear actionable error rather than emitting an
      // empty file. saveBundle.js surfaces this to the UI via the SSE
      // 'save' status:'error' event so the user knows submission is blocked.
      throw new Error(
        `Resume overflow: all 3 render tiers produced >1 page even at base-content fallback ` +
        `(measured ${measuredPages} pages). RESUME_BASE_JSON has grown beyond 1 page — ` +
        `trim bullets in resumeContent.js until base measures 1 page.`
      );
    }

    // Measure passed — render for real. Only NOW do we open the file stream,
    // which means destroy/unlink races are impossible: if we got here, the
    // render will complete and finish() will resolve cleanly.
    const w = new ResumeWriter(outPath, tier.opts);
    drawResumeContent(w, tier.content);
    const r = await w.finish();
    if (i > 0) {
      console.warn(`[pdfRender] rendered via fallback tier: ${tier.label}`);
    }
    return { path: r.path, fallback: tier.fallback, fillPct: r.fillPct };
  }

  // Unreachable — the loop above either returns or throws.
  throw new Error('renderResumePdf: tier loop exited without returning (unreachable)');
}

// ─────────────────────────────────────────────────────────────────────────────
// Cover letter — US Letter, 1" margins, paragraphs separated by blank lines.
// ─────────────────────────────────────────────────────────────────────────────
const C = {
  PAGE_W: 612,
  PAGE_H: 792,
  MARGIN_L: 72,
  MARGIN_R: 72,
  MARGIN_T: 72,
  MARGIN_B: 72,
  FONT_NORMAL: 'Times-Roman',
  FONT_BOLD: 'Times-Bold',
  BODY_SIZE: 11,
  NAME_SIZE: 16,
  CONTACT_SIZE: 10.5,
  LINE_H: 14,
  PARA_GAP: 8,
  SEPARATOR: '_'.repeat(95),
};

async function renderCoverPdf(content, outPath) {
  const doc = new PDFDocument({
    size: [C.PAGE_W, C.PAGE_H],
    margins: { top: 0, bottom: 0, left: 0, right: 0 },
    autoFirstPage: true,
  });
  const stream = fs.createWriteStream(outPath);
  doc.pipe(stream);

  let y = C.MARGIN_T + C.NAME_SIZE * 0.85;
  const textW = C.PAGE_W - C.MARGIN_L - C.MARGIN_R;

  // Letterhead — name centered.
  doc.font(C.FONT_BOLD).fontSize(C.NAME_SIZE);
  const nameW = doc.widthOfString(content.name || '');
  doc.text(content.name || '', (C.PAGE_W - nameW) / 2, y - C.NAME_SIZE * 0.85, { lineBreak: false });
  y += 18;

  // Contact line — mirrors drawContact() in the resume writer. Items can be
  // plain strings or { text, url } objects. URL items render as clickable
  // blue underlined links with link annotation rectangles; plain strings
  // render in black. Centered as a single horizontal row.
  doc.font(C.FONT_NORMAL).fontSize(C.CONTACT_SIZE);
  const cItems = (content.contact || []).map(p => (typeof p === 'string' ? { text: p } : p))
    .filter(it => it && it.text);
  const cSep = ' | ';
  const cSepW = doc.widthOfString(cSep);
  const cTotalW = cItems.reduce((acc, it, i) => {
    return acc + doc.widthOfString(it.text) + (i > 0 ? cSepW : 0);
  }, 0);
  let cx = (C.PAGE_W - cTotalW) / 2;
  const cTopY = y - C.CONTACT_SIZE * 0.85;
  for (let i = 0; i < cItems.length; i++) {
    const it = cItems[i];
    if (i > 0) {
      doc.fillColor('#000000');
      doc.text(cSep, cx, cTopY, { lineBreak: false });
      cx += cSepW;
    }
    const itemW = doc.widthOfString(it.text);
    if (it.url) {
      doc.fillColor('#0000EE');
      doc.text(it.text, cx, cTopY, { lineBreak: false });
      const ulY = cTopY + C.CONTACT_SIZE - 1;
      doc.moveTo(cx, ulY).lineTo(cx + itemW, ulY).strokeColor('#0000EE').lineWidth(0.5).stroke();
      doc.fillColor('#000000').strokeColor('#000000');
      doc.link(cx, cTopY, itemW, C.CONTACT_SIZE, it.url);
    } else {
      doc.fillColor('#000000');
      doc.text(it.text, cx, cTopY, { lineBreak: false });
    }
    cx += itemW;
  }
  doc.fillColor('#000000');
  y += 10;

  // Separator.
  doc.font(C.FONT_NORMAL).fontSize(C.BODY_SIZE);
  const sepW = doc.widthOfString(C.SEPARATOR);
  doc.text(C.SEPARATOR, (C.PAGE_W - sepW) / 2, y - C.BODY_SIZE * 0.85, { lineBreak: false });
  y += 28;

  // Date.
  if (content.date) {
    doc.text(content.date, C.MARGIN_L, y - C.BODY_SIZE * 0.85, { lineBreak: false });
    y += C.LINE_H + C.PARA_GAP;
  }

  // Body — paragraphs split on \n\n; intra-paragraph \n is line break.
  const body = String(content.body || '').trim();
  const paragraphs = body.split('\n\n').map(p => p.trim()).filter(Boolean);

  function wrap(text, font, size, maxW) {
    doc.font(font).fontSize(size);
    const words = text.split(/\s+/).filter(Boolean);
    const out = [];
    let cur = [];
    for (const word of words) {
      const test = cur.concat(word).join(' ');
      if (doc.widthOfString(test) <= maxW) cur.push(word);
      else {
        if (cur.length) out.push(cur.join(' '));
        cur = [word];
      }
    }
    if (cur.length) out.push(cur.join(' '));
    return out;
  }

  for (const para of paragraphs) {
    for (const sub of para.split('\n')) {
      const wrapped = wrap(sub, C.FONT_NORMAL, C.BODY_SIZE, textW);
      for (const line of wrapped) {
        if (y + C.LINE_H > C.PAGE_H - C.MARGIN_B) {
          doc.addPage({ size: [C.PAGE_W, C.PAGE_H], margins: { top: 0, bottom: 0, left: 0, right: 0 } });
          y = C.MARGIN_T + C.BODY_SIZE * 0.85;
        }
        doc.font(C.FONT_NORMAL).fontSize(C.BODY_SIZE);
        doc.text(line, C.MARGIN_L, y - C.BODY_SIZE * 0.85, { lineBreak: false });
        y += C.LINE_H;
      }
    }
    y += C.PARA_GAP;
  }

  doc.end();
  return new Promise((resolve, reject) => {
    stream.on('finish', () => resolve(outPath));
    stream.on('error', reject);
  });
}

// Measure-only probe used by scripts/measure_layout.js. Walks the same layout
// path as a real render at baseline leading and returns the vertical budget,
// so layout changes can be costed before they are rendered. No file is written.
function measureResumeHeight(content, opts = {}) {
  const m = new ResumeWriter(null, { measureOnly: true, ...opts });
  drawResumeContent(m, content);
  const used = m.y - R.MARGIN_T;
  const pages = m.doc.bufferedPageRange().count;
  try { m.doc.end(); } catch (_) { /* noop sink */ }
  return { used, usable: R.PAGE_H - R.MARGIN_T - R.MARGIN_B, pages };
}

module.exports = { renderResumePdf, renderCoverPdf, measureResumeHeight };
