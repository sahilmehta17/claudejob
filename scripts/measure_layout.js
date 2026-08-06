// ─────────────────────────────────────────────────────────────────────────────
// measure_layout.js — vertical-budget probe for resume layout work.
//
// Reports, for RESUME_BASE_JSON (or any saved tailored JSON via --json=<file>):
//   - total used height, usable height, headroom, fill %
//   - the wrapped line count of each skills line (the cheapest space to reclaim)
//
// The renderer only ever GROWS leading to fill an underfilled page; it never
// shrinks it. So the number that matters when adding vertical structure is
// HEADROOM at baseline leading. Once headroom goes negative the render falls
// through to the base-content tier and all tailoring is discarded.
//
// Usage: node scripts/measure_layout.js [--json=<tailored.json>]
// ─────────────────────────────────────────────────────────────────────────────

const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const { RESUME_BASE_JSON } = require('../routes/resumeContent');

// Re-measure skills wrapping with the same font metrics the renderer uses.
function skillsLineCounts(json) {
  const doc = new PDFDocument({ size: [595, 842], autoFirstPage: true });
  const out = [];
  const skills = (json.sections || []).find(s => s.type === 'skills');
  if (!skills) return out;
  for (const item of skills.items || []) {
    const labelText = item.label + ': ';
    const labelW = doc.font('Times-Bold').fontSize(11).widthOfString(labelText);
    const valueX = 17 + labelW;
    const maxW = 595 - 17 - valueX;
    doc.font('Times-Roman').fontSize(11);
    const words = String(item.value).split(/[ \t\r\n\f\v]+/).filter(Boolean);
    let lines = 1;
    let cur = [];
    for (const word of words) {
      const test = cur.concat(word).join(' ');
      if (doc.widthOfString(test) <= maxW) cur.push(word);
      else { lines++; cur = [word]; }
    }
    const itemCount = String(item.value).split(',').filter(s => s.trim()).length;
    out.push({ label: item.label, lines, items: itemCount, chars: item.value.length });
  }
  try { doc.end(); } catch (_) { /* not piped */ }
  return out;
}

function measure(json) {
  // Require lazily so edits to pdfRender are always picked up fresh.
  const pdfRenderPath = require.resolve('../routes/pdfRender');
  delete require.cache[pdfRenderPath];
  const pdfRender = require('../routes/pdfRender');
  // measureHeight is exported for this probe; fall back to a local walk if the
  // renderer has not exposed it.
  return pdfRender.measureResumeHeight(json);
}

function main() {
  const jsonArg = process.argv.find(a => a.startsWith('--json='));
  const label = jsonArg ? path.basename(jsonArg.slice(7)) : 'RESUME_BASE_JSON';
  const json = jsonArg
    ? JSON.parse(fs.readFileSync(jsonArg.slice(7), 'utf8'))
    : RESUME_BASE_JSON;

  const m = measure(json);
  console.log(`── ${label}`);
  console.log(`   used ${m.used.toFixed(1)}pt / usable ${m.usable}pt  ` +
              `fill ${(m.used / m.usable * 100).toFixed(1)}%  ` +
              `headroom ${(m.usable - m.used).toFixed(1)}pt  pages ${m.pages}`);
  console.log(`   section order: ${(json.sections || []).map(s => s.header).join(' > ')}`);
  for (const s of skillsLineCounts(json)) {
    console.log(`   skills "${s.label}": ${s.lines} line(s), ${s.items} items, ${s.chars} chars`);
  }
}

main();
