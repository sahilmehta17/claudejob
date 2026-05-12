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
const PDFDocument = require('pdfkit');

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

class ResumeWriter {
  constructor(outPath) {
    this.outPath = outPath;
    // bufferPages: true keeps every page in _pageBuffer until doc.end() flushes
    // it. Without this, pdfkit flushes each page on addPage() and
    // bufferedPageRange() always reports count: 1, defeating the overflow guard.
    this.doc = new PDFDocument({
      size: [R.PAGE_W, R.PAGE_H],
      margins: { top: 0, bottom: 0, left: 0, right: 0 },
      autoFirstPage: true,
      bufferPages: true,
    });
    this.stream = fs.createWriteStream(outPath);
    this.doc.pipe(this.stream);
    this.y = R.MARGIN_T + R.BODY_SIZE; // baseline of first line
  }

  _checkBreak(needed = R.LINE_H) {
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

  advance(pts = R.LINE_H) {
    this.y += pts;
  }

  drawName(name) {
    this._checkBreak(R.GAP_NAME_CONTACT + R.LINE_H);
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
    this.advance(R.LINE_H);
  }

  drawSummary(text) {
    // Italic positioning summary, full-width, after contact line.
    if (!text) return;
    this._checkBreak(R.LINE_H * 3);
    const maxW = R.PAGE_W - R.MARGIN_L - R.MARGIN_R;
    const lines = this._wrap(text, R.FONT_ITALIC, R.BODY_SIZE, maxW);
    for (const line of lines) {
      this._checkBreak(R.LINE_H);
      this._drawAt(R.CONTENT_X, this.y, line, R.FONT_ITALIC, R.BODY_SIZE);
      this.advance(R.LINE_H);
    }
  }

  drawSeparator() {
    this._checkBreak(R.LINE_H * 2);
    this._drawAt(R.CONTENT_X, this.y, R.SEPARATOR, R.FONT_NORMAL, R.BODY_SIZE);
    this.advance(R.LINE_H);
  }

  drawSectionHeader(text) {
    this._checkBreak(R.LINE_H);
    this._drawAt(R.CONTENT_X, this.y, text, R.FONT_BOLD, R.BODY_SIZE);
    this.advance(R.LINE_H);
  }

  drawJobHeader(titleLeft, dateRight, locationRight, linkUrl) {
    this._checkBreak(R.LINE_H);
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
    this.advance(R.LINE_H);
  }

  drawSubsection(text) {
    this._checkBreak(R.GAP_SUBSECTION_PRE + R.LINE_H);
    this.advance(R.GAP_SUBSECTION_PRE);
    this._drawAt(R.CONTENT_X, this.y, text, R.FONT_BOLD, R.BODY_SIZE);
    this.advance(R.LINE_H);
  }

  drawBullet(text) {
    const maxW = R.PAGE_W - R.MARGIN_R - R.BULLET_TEXT_X;
    const lines = this._wrap(text, R.FONT_NORMAL, R.BODY_SIZE, maxW);
    for (let i = 0; i < lines.length; i++) {
      this._checkBreak(R.LINE_H);
      if (i === 0) {
        this._drawAt(R.BULLET_X, this.y, '\u2022', R.FONT_NORMAL, R.BODY_SIZE);
      }
      this._drawAt(R.BULLET_TEXT_X, this.y, lines[i], R.FONT_NORMAL, R.BODY_SIZE);
      this.advance(R.LINE_H);
    }
  }

  drawPlain(text, opts = {}) {
    const font = opts.font || R.FONT_NORMAL;
    this._checkBreak(R.LINE_H);
    this._drawAt(R.CONTENT_X, this.y, text, font, R.BODY_SIZE);
    if (opts.rightText) {
      const rFont = opts.rightFont || R.FONT_ITALIC;
      const w = this._textWidth(opts.rightText, rFont, R.BODY_SIZE);
      const x = R.PAGE_W - R.MARGIN_R - w;
      this._drawAt(x, this.y, opts.rightText, rFont, R.BODY_SIZE);
    }
    this.advance(R.LINE_H);
  }

  drawSkillsLine(label, value) {
    this._checkBreak(R.LINE_H);
    const labelText = label + ': ';
    const labelW = this._textWidth(labelText, R.FONT_BOLD, R.BODY_SIZE);
    const valueX = R.CONTENT_X + labelW;
    const maxW = R.PAGE_W - R.MARGIN_R - valueX;
    const lines = this._wrap(value, R.FONT_NORMAL, R.BODY_SIZE, maxW);
    if (!lines.length) lines.push('');

    this._drawAt(R.CONTENT_X, this.y, labelText, R.FONT_BOLD, R.BODY_SIZE);
    this._drawAt(valueX, this.y, lines[0], R.FONT_NORMAL, R.BODY_SIZE);
    this.advance(R.LINE_H);

    for (let i = 1; i < lines.length; i++) {
      this._checkBreak(R.LINE_H);
      this._drawAt(valueX, this.y, lines[i], R.FONT_NORMAL, R.BODY_SIZE);
      this.advance(R.LINE_H);
    }
  }

  _wrap(text, font, size, maxW) {
    const words = String(text).split(/\s+/).filter(Boolean);
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
    return new Promise((resolve, reject) => {
      this.doc.end();
      this.stream.on('finish', () => resolve(this.outPath));
      this.stream.on('error', reject);
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// renderResumePdf(content, outPath) → Promise<outPath>
// content schema = same as DEFAULT_CONTENT in generate_resume.py / RESUME_BASE_JSON
// ─────────────────────────────────────────────────────────────────────────────
async function renderResumePdf(content, outPath) {
  const w = new ResumeWriter(outPath);

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
        w.advance(R.GAP_POST_ITEM);
      }
    } else if (section.type === 'projects') {
      for (const item of section.items || []) {
        w.drawJobHeader(item.title, item.date, undefined, item.url);
        for (const b of item.bullets || []) w.drawBullet(b);
        w.advance(R.GAP_POST_ITEM);
      }
    } else if (section.type === 'skills') {
      for (const item of section.items || []) {
        w.drawSkillsLine(item.label, item.value);
      }
    }

    // Draw separator between sections, but skip the trailing one — it would
    // push to a new blank page when content already fills page 1.
    if (i < sections.length - 1) {
      w.drawSeparator();
    }
  }

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
