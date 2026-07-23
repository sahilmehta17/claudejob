// ─────────────────────────────────────────────────────────────────────────────
// docxRender.js — Generate .docx version of the resume from RESUME_BASE_JSON.
//
// Layout-equivalent to pdfRender.js so the DOCX matches the PDF when opened
// in Pages, Word, or Google Docs:
//   - A4 (8.27" × 11.69"), 17pt margins
//   - Times New Roman, 11pt body, 16pt name
//   - 13pt exact line height (matches PDF LINE_H)
//   - Underscore separators between sections (matches PDF drawSeparator)
//   - 7pt gap after each experience/project item (matches PDF GAP_POST_ITEM)
//   - Bullet text 11pt from content edge (matches PDF BULLET_TEXT_X - CONTENT_X)
//
// Apple Pages opens .docx natively, so this is the "give me an editable copy"
// path. Visual rendering will not be byte-identical to the PDF — Word/Pages
// hint glyphs differently than pdfkit — but layout structure, page geometry,
// section gaps, and typography all mirror the PDF spec.
// ─────────────────────────────────────────────────────────────────────────────

const fs = require('fs');
const {
  Document, Packer, Paragraph, TextRun, AlignmentType, ExternalHyperlink,
  TabStopType, LevelFormat, LineRuleType,
} = require('docx');

// Sizes in half-points (so 22 = 11pt, 32 = 16pt).
const NAME_SIZE = 32;          // 16pt
const BODY_SIZE = 22;          // 11pt
const FONT = 'Times New Roman';

// Spacing in twips (1pt = 20 twips). Mirrors pdfRender.js R.* constants.
const LINE = 260;              // 13pt — matches PDF LINE_H
const NAME_LINE = 320;         // 16pt — matches PDF NAME_SIZE for name paragraph
const GAP_NAME_AFTER = 60;     // small after-name pad before contact line
const GAP_POST_ITEM = 140;     // 7pt — matches PDF GAP_POST_ITEM
const GAP_SUBSECTION_PRE = 140; // 7pt — matches PDF GAP_SUBSECTION_PRE

const SEPARATOR = '_'.repeat(97); // Matches PDF R.SEPARATOR

// Page geometry — A4 in twips, 17pt margins. Mirrors pdfRender.js R.PAGE_*.
const PAGE_WIDTH = 11906;      // A4 width: 8.27"
const PAGE_HEIGHT = 16838;     // A4 height: 11.69"
const MARGIN = 340;            // 17pt — all sides except bottom
const MARGIN_BOTTOM = 400;     // 20pt — matches PDF MARGIN_B

// Right-tab position for date/location alignment (content-frame right edge).
const RIGHT_TAB = PAGE_WIDTH - MARGIN * 2; // 11906 - 680 = 11226 twips

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function spacing(opts = {}) {
  return {
    before: opts.before ?? 0,
    after: opts.after ?? 0,
    line: opts.line ?? LINE,
    lineRule: LineRuleType.EXACT,
  };
}

function plainPara(text, opts = {}) {
  return new Paragraph({
    spacing: spacing({ before: opts.before, after: opts.after, line: opts.line }),
    alignment: opts.align,
    children: [
      new TextRun({
        text,
        font: FONT,
        size: opts.size ?? BODY_SIZE,
        bold: opts.bold,
        italics: opts.italics,
      }),
    ],
  });
}

// 97-underscore line — drawn between sections (and after the contact block).
function separatorPara() {
  return new Paragraph({
    spacing: spacing(),
    children: [new TextRun({ text: SEPARATOR, font: FONT, size: BODY_SIZE })],
  });
}

// Empty paragraph used to add explicit vertical gaps that match PDF advance().
function gapPara(twips = GAP_POST_ITEM) {
  return new Paragraph({
    spacing: { before: 0, after: 0, line: twips, lineRule: LineRuleType.EXACT },
    children: [new TextRun({ text: '', font: FONT, size: BODY_SIZE })],
  });
}

// Job/project title line: bold left, italic date | bold location right.
function titlePara(titleLeft, dateRight, locationRight, linkUrl) {
  const children = [
    new TextRun({ text: titleLeft, bold: true, font: FONT, size: BODY_SIZE }),
  ];
  if (linkUrl) {
    children.push(
      new ExternalHyperlink({
        link: linkUrl,
        children: [
          new TextRun({
            text: ' (Github)',
            bold: true,
            font: FONT,
            size: BODY_SIZE,
            color: '0000EE',
            underline: {},
          }),
        ],
      })
    );
  }
  if (dateRight || locationRight) {
    children.push(new TextRun({ text: '\t', font: FONT, size: BODY_SIZE }));
    if (dateRight) {
      children.push(new TextRun({ text: dateRight, italics: true, font: FONT, size: BODY_SIZE }));
    }
    if (locationRight) {
      children.push(new TextRun({ text: ' | ', bold: true, font: FONT, size: BODY_SIZE }));
      children.push(new TextRun({ text: locationRight, bold: true, font: FONT, size: BODY_SIZE }));
    }
  }
  return new Paragraph({
    spacing: spacing(),
    tabStops: [{ type: TabStopType.RIGHT, position: RIGHT_TAB }],
    children,
  });
}

function subSectionPara(text) {
  return new Paragraph({
    spacing: spacing({ before: GAP_SUBSECTION_PRE }),
    children: [new TextRun({ text, bold: true, font: FONT, size: BODY_SIZE })],
  });
}

// Italic role subline under a company-as-header job (matches PDF drawRole).
function rolePara(text) {
  return new Paragraph({
    spacing: spacing(),
    children: [new TextRun({ text, italics: true, font: FONT, size: BODY_SIZE })],
  });
}

function bulletPara(text) {
  return new Paragraph({
    numbering: { reference: 'resume-bullets', level: 0 },
    spacing: spacing(),
    children: [new TextRun({ text, font: FONT, size: BODY_SIZE })],
  });
}

// Section header — bold body-size text, no border. Surrounding separator
// paragraphs supply the visual gap (matches PDF where drawSectionHeader is
// just bold text and drawSeparator is the visible divider).
function sectionHeader(text) {
  return new Paragraph({
    spacing: spacing(),
    children: [new TextRun({ text, bold: true, font: FONT, size: BODY_SIZE })],
  });
}

function skillsLinePara(label, value) {
  return new Paragraph({
    spacing: spacing(),
    children: [
      new TextRun({ text: `${label}: `, bold: true, font: FONT, size: BODY_SIZE }),
      new TextRun({ text: value, font: FONT, size: BODY_SIZE }),
    ],
  });
}

// Header block: name centered + contact line + optional summary.
function headerBlock(content) {
  const blocks = [];

  // Name — 16pt bold, centered, line height 16pt.
  blocks.push(
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 0, after: GAP_NAME_AFTER, line: NAME_LINE, lineRule: LineRuleType.EXACT },
      children: [new TextRun({ text: content.name, bold: true, font: FONT, size: NAME_SIZE })],
    })
  );

  // Contact line — TextRun + ExternalHyperlink for clickable items.
  const contactChildren = [];
  const items = (content.contact || []).map(p => (typeof p === 'string' ? { text: p } : p));
  items.forEach((it, i) => {
    if (i > 0) contactChildren.push(new TextRun({ text: ' | ', font: FONT, size: BODY_SIZE }));
    if (it.url) {
      contactChildren.push(
        new ExternalHyperlink({
          link: it.url,
          children: [
            new TextRun({ text: it.text, font: FONT, size: BODY_SIZE, color: '0000EE', underline: {} }),
          ],
        })
      );
    } else {
      contactChildren.push(new TextRun({ text: it.text, font: FONT, size: BODY_SIZE }));
    }
  });
  blocks.push(
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: spacing(),
      children: contactChildren,
    })
  );

  // Optional summary — currently empty in resumeContent.js but supported.
  if (content.summary) {
    blocks.push(
      new Paragraph({
        spacing: spacing(),
        children: [new TextRun({ text: content.summary, italics: true, font: FONT, size: BODY_SIZE })],
      })
    );
  }

  return blocks;
}

// ─────────────────────────────────────────────────────────────────────────────
// renderResumeDocx(content, outPath) → Promise<outPath>
// ─────────────────────────────────────────────────────────────────────────────
async function renderResumeDocx(content, outPath) {
  const children = [...headerBlock(content)];

  // Separator after the header block — matches PDF drawSeparator() before loop.
  children.push(separatorPara());

  const sections = content.sections || [];
  for (let i = 0; i < sections.length; i++) {
    const section = sections[i];
    children.push(sectionHeader(section.header));

    if (section.type === 'education') {
      for (const item of section.items || []) {
        children.push(plainPara(item.institution, { bold: true }));
        const degreeChildren = [
          new TextRun({ text: item.degree, font: FONT, size: BODY_SIZE }),
        ];
        if (item.graduation) {
          degreeChildren.push(new TextRun({ text: '\t', font: FONT, size: BODY_SIZE }));
          degreeChildren.push(
            new TextRun({ text: item.graduation, italics: true, font: FONT, size: BODY_SIZE })
          );
        }
        children.push(
          new Paragraph({
            spacing: spacing(),
            tabStops: [{ type: TabStopType.RIGHT, position: RIGHT_TAB }],
            children: degreeChildren,
          })
        );
      }
    } else if (section.type === 'experience') {
      for (const item of section.items || []) {
        children.push(titlePara(item.title, item.date, item.location));
        if (item.role) children.push(rolePara(item.role));
        for (const sub of item.subsections || []) {
          if (sub.name) children.push(subSectionPara(sub.name));
          for (const b of sub.bullets || []) children.push(bulletPara(b));
        }
        // GAP_POST_ITEM — matches PDF advance(GAP_POST_ITEM) after each item.
        children.push(gapPara(GAP_POST_ITEM));
      }
    } else if (section.type === 'projects') {
      for (const item of section.items || []) {
        children.push(titlePara(item.title, item.date, undefined, item.url));
        for (const b of item.bullets || []) children.push(bulletPara(b));
        children.push(gapPara(GAP_POST_ITEM));
      }
    } else if (section.type === 'skills') {
      for (const item of section.items || []) {
        children.push(skillsLinePara(item.label, item.value));
      }
    }

    // Inter-section separator — matches PDF (skip after the last section).
    if (i < sections.length - 1) {
      children.push(separatorPara());
    }
  }

  const doc = new Document({
    creator: content.name || 'Resume',
    title: `${content.name || 'Resume'} — Resume`,
    styles: { default: { document: { run: { font: FONT, size: BODY_SIZE } } } },
    numbering: {
      config: [
        {
          reference: 'resume-bullets',
          levels: [
            {
              level: 0,
              format: LevelFormat.BULLET,
              text: '•',
              alignment: AlignmentType.LEFT,
              // Match PDF: bullet at content edge (0pt), text 11pt (220 twips) right.
              style: { paragraph: { indent: { left: 220, hanging: 220 } } },
            },
          ],
        },
      ],
    },
    sections: [
      {
        properties: {
          page: {
            // A4, 17pt margins (20pt bottom) — matches pdfRender.js spec exactly.
            size: { width: PAGE_WIDTH, height: PAGE_HEIGHT },
            margin: { top: MARGIN, right: MARGIN, bottom: MARGIN_BOTTOM, left: MARGIN },
          },
        },
        children,
      },
    ],
  });

  const buf = await Packer.toBuffer(doc);
  fs.writeFileSync(outPath, buf);
  return outPath;
}

module.exports = { renderResumeDocx };
