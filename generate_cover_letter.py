"""
DEPRECATED — pipeline now uses routes/pdfRender.js (pure Node, pdfkit).
Kept for reference. See generate_resume.py for context.

----- Original docstring follows -----

Cover Letter PDF Generator — paired aesthetic to generate_resume.py.

Times-Roman 11pt body to match resume font.
1-inch margins (standard business letter format, NOT the resume's tight 17pt).
Letterhead block at top: name (16pt bold centered) + contact line (11pt centered).
Single horizontal separator under letterhead, like the resume.
Date line, then prose paragraphs separated by blank line.

Usage:
  python3 generate_cover_letter.py \
      --content cover.json \
      --output Sahil_Mehta_CoverLetter.pdf

  cover.json schema:
  {
    "name": "Sahil Mehta",
    "contact": ["New York City, NY", "sahilmehta0204@gmail.com", "+1 (...)"],
    "date": "April 25, 2026",
    "body": "Para 1...\\n\\nPara 2..."   # paragraphs separated by \\n\\n
  }
"""

import argparse
import json
import os
import sys
from reportlab.lib.pagesizes import LETTER
from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics


PAGE_W, PAGE_H = LETTER          # 612 x 792 pt
MARGIN_L = 72.0                  # 1 inch
MARGIN_R = 72.0
MARGIN_T = 72.0
MARGIN_B = 72.0

FONT_NORMAL = "Times-Roman"
FONT_BOLD = "Times-Bold"
BODY_SIZE = 11.0
NAME_SIZE = 16.0
CONTACT_SIZE = 10.5
LINE_H = 14.0                    # ~1.27 leading on 11pt body
PARA_GAP = 8.0                   # blank line between paragraphs


def wrap_text(text, font, size, max_width):
    """Greedy word-wrap. Returns list of lines."""
    words = text.split()
    lines, current = [], []
    for word in words:
        test = " ".join(current + [word])
        if pdfmetrics.stringWidth(test, font, size) <= max_width:
            current.append(word)
        else:
            if current:
                lines.append(" ".join(current))
            current = [word]
    if current:
        lines.append(" ".join(current))
    return lines


def generate_cover_pdf(content, output_path):
    c = canvas.Canvas(output_path, pagesize=LETTER)
    text_w = PAGE_W - MARGIN_L - MARGIN_R
    y = PAGE_H - MARGIN_T

    # Letterhead — name centered, bold 16pt
    c.setFont(FONT_BOLD, NAME_SIZE)
    c.drawCentredString(PAGE_W / 2, y, content["name"])
    y -= 18

    # Contact line — centered, 10.5pt
    c.setFont(FONT_NORMAL, CONTACT_SIZE)
    contact_line = " | ".join(content.get("contact", []))
    c.drawCentredString(PAGE_W / 2, y, contact_line)
    y -= 10

    # Separator
    c.setFont(FONT_NORMAL, BODY_SIZE)
    sep = "_" * 95
    c.drawCentredString(PAGE_W / 2, y, sep)
    y -= 28

    # Date
    c.setFont(FONT_NORMAL, BODY_SIZE)
    date_str = content.get("date", "")
    if date_str:
        c.drawString(MARGIN_L, y, date_str)
        y -= LINE_H + PARA_GAP

    # Body — paragraphs separated by blank line
    body = content.get("body", "").strip()
    paragraphs = [p.strip() for p in body.split("\n\n") if p.strip()]
    for para in paragraphs:
        # Some cover letters use single newlines for things like salutation/signoff;
        # treat them as line breaks within the paragraph.
        sub_lines = para.split("\n")
        for sub in sub_lines:
            wrapped = wrap_text(sub, FONT_NORMAL, BODY_SIZE, text_w)
            for line in wrapped:
                if y < MARGIN_B:
                    c.showPage()
                    c.setFont(FONT_NORMAL, BODY_SIZE)
                    y = PAGE_H - MARGIN_T
                c.drawString(MARGIN_L, y, line)
                y -= LINE_H
        y -= PARA_GAP

    c.save()
    return output_path


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Generate cover letter PDF")
    parser.add_argument("--content", required=True, help="Path to JSON content file")
    parser.add_argument("--output", required=True, help="Output PDF path")
    args = parser.parse_args()

    with open(args.content) as f:
        content = json.load(f)

    out = generate_cover_pdf(content, args.output)
    print(f"wrote: {out}")
