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
  LINE_H: 13,
  GAP_SECTION: 26,
  GAP_NAME_CONTACT: 16,
  // Post-item / subsection spacing — kept smaller than GAP_SECTION so the
  // resume lands on a single page. Re-loosened from 4pt → 7pt now that the
  // top summary line is gone (frees ~26pt of vertical budget). Layout still
  // fits page 1 with comfortable breathing room.
  GAP_POST_ITEM: 7,
  GAP_SUBSECTION_PRE: 7,
  FONT_NORMAL: 'Times-Roman',
  FONT_BOLD: 'Times-Bold',
  FONT_ITALIC: 'Times-Italic',
  BODY_SIZE: 11,
  NAME_SIZE: 16,
  BULLET_X: 17,
  BULLET_TEXT_X: 28,
  CONTENT_X: 17,
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
    // gaps: per-render overrides for spacing constants. The underfill
    // distribution pass measures with the defaults, then re-instantiates the
    // writer with expanded values so an underfilled page LOOKS full without
    // changing typography. `section` is the EXTRA inter-section gap added on
    // top of the separator line; defaults to 0 to preserve baseline behavior.
    this.gaps = Object.assign(
      {
        section: 0,
        postItem: R.GAP_POST_ITEM,
        subsectionPre: R.GAP_SUBSECTION_PRE,
      },
      opts.gaps || {}
    );
    // Per-render line height. Defaults to R.LINE_H so unaltered callers
    // behave identically; the underfill adjuster bumps this by up to
    // MAX_LINE_H_BUMP when gap expansion alone can't reach TARGET_FILL_PCT.
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

  drawSubsection(text) {
    this._checkBreak(this.gaps.subsectionPre + this.lineH);
    this.advance(this.gaps.subsectionPre);
    this._drawAt(R.CONTENT_X, this.y, text, R.FONT_BOLD, R.BODY_SIZE);
    this.advance(this.lineH);
  }

  drawBullet(text) {
    const maxW = R.PAGE_W - R.MARGIN_R - R.BULLET_TEXT_X;
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
        this._drawAt(R.BULLET_X, this.y, '\u2022', R.FONT_NORMAL, R.BODY_SIZE);
      }
      this._drawAt(R.BULLET_TEXT_X, this.y, lines[i], R.FONT_NORMAL, R.BODY_SIZE);
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
    const pageRange = this.doc.bufferedPageRange();
    if (pageRange.count > 1) {
      this.doc.destroy?.();
      this.stream.destroy();
      try { fs.unlinkSync(this.outPath); } catch (_) {}
      throw new Error(
        `Resume overflow: tailored output rendered to ${pageRange.count} pages. ` +
        `LLM-side layout constraint failed. Either retry tailoring with stricter ` +
        `brevity guidance, or fall back to RESUME_BASE_JSON.`
      );
    }
    // Always log the realized page-fill percentage so the two-pass underfill
    // adjuster's result is visible. The < 70% branch keeps the original
    // prompt-regression warning for cases the adjuster can't fully recover
    // (e.g., MAX_GAP_MULTIPLIER caps the expansion).
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
    return new Promise((resolve, reject) => {
      this.doc.end();
      this.stream.on('finish', () => resolve(this.outPath));
      this.stream.on('error', reject);
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Underfill page distribution — two-pass render with line-height fallback.
//
// TARGET_FILL_PCT: aim for this fraction of usable page height. 0.95 matches
// the BASE resume's natural density so tailored resumes don't look thinner.
//
// MAX_GAP_MULTIPLIER: cap on how much a single inter-section gap can grow
// (relative to R.GAP_SECTION). 4.0 gives the gap-distribution path enough
// runway on very sparse tailored resumes before LINE_H expansion kicks in.
//
// MAX_LINE_H_BUMP: cap on the per-line height bump used as a fallback when
// gap expansion alone can't reach TARGET_FILL_PCT. +2pt is the point beyond
// which the typography reads as padded.
// ─────────────────────────────────────────────────────────────────────────────
const TARGET_FILL_PCT = 0.95;
const MAX_GAP_MULTIPLIER = 4.0;
const MAX_LINE_H_BUMP = 2.0;

// Count the gap slots the underfill adjuster can grow: inter-section gaps
// (sections.length - 1) + post-item gaps for experience/project items. Used
// as the divisor for distributing the extra page-fill height per gap.
function countResumeGaps(content) {
  const sections = content.sections || [];
  let n = sections.length > 0 ? sections.length - 1 : 0;
  for (const s of sections) {
    if (s.type === 'experience' || s.type === 'projects') {
      n += (s.items || []).length;
    }
  }
  return n;
}

// Approximate the total wrapped-line count for the line-height fallback. The
// division by 80 is a deliberate rough estimate of wrapped lines per bullet —
// exact precision doesn't matter because the divisor only sets extraPerLine,
// and the cap (MAX_LINE_H_BUMP) plus the page-overflow guard absorb the rest.
function countTotalLinesInContent(content) {
  let n = 0;
  if (content.name) n += 1;
  if (content.contact && content.contact.length) n += 1;
  if (content.summary) n += Math.ceil(String(content.summary).length / 80);
  for (const s of content.sections || []) {
    n += 1; // section header
    if (s.type === 'education') {
      for (const item of s.items || []) n += 2;
    } else if (s.type === 'experience') {
      for (const item of s.items || []) {
        n += 1; // job header
        for (const sub of item.subsections || []) {
          if (sub.name) n += 1;
          for (const b of sub.bullets || []) n += Math.ceil(String(b).length / 80);
        }
      }
    } else if (s.type === 'projects') {
      for (const item of s.items || []) {
        n += 1; // job header
        for (const b of item.bullets || []) n += Math.ceil(String(b).length / 80);
      }
    } else if (s.type === 'skills') {
      n += (s.items || []).length;
    }
  }
  return n;
}

// Render-or-measure path shared by both passes. Mutating writer.gaps before
// calling this controls how much vertical space the layout consumes.
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
      for (const item of section.items || []) {
        w.drawJobHeader(item.title, item.date, item.location);
        for (const sub of item.subsections || []) {
          if (sub.name) w.drawSubsection(sub.name);
          for (const b of sub.bullets || []) w.drawBullet(b);
        }
        w.advance(w.gaps.postItem);
      }
    } else if (section.type === 'projects') {
      for (const item of section.items || []) {
        w.drawJobHeader(item.title, item.date, undefined, item.url);
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
// Two-pass: measure with baseline gaps, then if the page is underfilled,
// expand GAP_SECTION / GAP_POST_ITEM / GAP_SUBSECTION_PRE proportionally so
// the rendered output fills TARGET_FILL_PCT of the page.
// ─────────────────────────────────────────────────────────────────────────────
async function renderResumePdf(content, outPath) {
  // Pass A: measure baseline content height with a discarded PDF.
  const measurerA = new ResumeWriter(null, { measureOnly: true });
  drawResumeContent(measurerA, content);
  const usedHeight = measurerA.y - R.MARGIN_T;
  try { measurerA.doc.end(); } catch (_) { /* noop sink */ }

  const pageContentHeight = R.PAGE_H - R.MARGIN_T - R.MARGIN_B;
  const targetHeight = TARGET_FILL_PCT * pageContentHeight;

  // Compute adjusted gaps if (and only if) Pass A came in short of target.
  let gaps;
  if (usedHeight < targetHeight) {
    const extra = targetHeight - usedHeight;
    const gapCount = countResumeGaps(content);
    if (gapCount > 0) {
      // Cap at (MAX_GAP_MULTIPLIER - 1) * R.GAP_SECTION so extra per slot
      // can't exceed 3× R.GAP_SECTION (78pt). Beyond that the layout starts
      // looking like blank-page padding even with section gaps doing the work.
      const extraPerGap = Math.min(
        extra / gapCount,
        R.GAP_SECTION * (MAX_GAP_MULTIPLIER - 1)
      );
      gaps = {
        section: extraPerGap,
        postItem: R.GAP_POST_ITEM + extraPerGap * 0.7,
        subsectionPre: R.GAP_SUBSECTION_PRE + extraPerGap * 0.6,
      };
    }
  }

  // Pass B: simulate height with the expanded gaps. If the gap-distribution
  // weights still leave the page short of target (subsection weights add up
  // to < 1.0× per-gap, so very sparse content can't reach 95% on gaps
  // alone), bump LINE_H by up to MAX_LINE_H_BUMP to close the rest.
  let lineH;
  if (gaps) {
    const measurerB = new ResumeWriter(null, { measureOnly: true, gaps });
    drawResumeContent(measurerB, content);
    const projectedHeight = measurerB.y - R.MARGIN_T;
    try { measurerB.doc.end(); } catch (_) { /* noop sink */ }

    if (projectedHeight < targetHeight) {
      const stillNeeded = targetHeight - projectedHeight;
      const lineCount = countTotalLinesInContent(content);
      if (lineCount > 0) {
        const extraPerLine = Math.min(MAX_LINE_H_BUMP, stillNeeded / lineCount);
        if (extraPerLine > 0) lineH = R.LINE_H + extraPerLine;
      }
    }
  }

  // Pass C: real render with the (possibly expanded) gaps and lineH.
  const w = new ResumeWriter(outPath, { gaps, lineH });
  drawResumeContent(w, content);
  return w.finish();
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

  // Contact line.
  // Items can be plain strings or { text, url } objects (the resume PDF
  // renders the latter as clickable links via drawContact). The cover letter
  // only shows visible text, so flatten both shapes to strings.
  doc.font(C.FONT_NORMAL).fontSize(C.CONTACT_SIZE);
  const contactStrs = (content.contact || []).map(c =>
    typeof c === 'string' ? c : (c && c.text) || ''
  ).filter(Boolean);
  const contact = contactStrs.join(' | ');
  const contactW = doc.widthOfString(contact);
  doc.text(contact, (C.PAGE_W - contactW) / 2, y - C.CONTACT_SIZE * 0.85, { lineBreak: false });
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

module.exports = { renderResumePdf, renderCoverPdf };
