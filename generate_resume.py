"""
DEPRECATED — pipeline now uses routes/pdfRender.js (pure Node, pdfkit) so
there's no Python dependency on the user's machine. This file is kept as
reference documentation of the layout spec; the JS port matches it 1:1.

To re-enable Python generation, restore the spawn() calls in
routes/saveBundle.js — but you'll need reportlab + Pillow for the same
arch as your python3 interpreter, which is fragile on Apple Silicon.

----- Original docstring follows -----

Resume PDF Generator — exact match to Sahil Mehta's Pages document format.

Spec extracted from original PDF:
  - Page:        A4 (595 x 842pt), margins: L=17, R=17, T=17
  - Name:        Times-Bold 16pt, centered
  - Contact:     Times-Roman 11pt, centered, 18pt below name
  - Separator:   underscores full width x0=17 to x1=572.5, Times-Roman 11pt
  - Section hdr: Times-Bold 11pt, left x=17, 13pt line spacing
  - Job title:   Times-Bold 11pt, left — date/location right-aligned italic
  - Subsection:  Times-Bold 11pt, x=17, 26pt gap above (blank line)
  - Bullet:      Times-Roman 11pt, bullet at x=17, text at x=28, 13pt leading
  - Line gap:    13pt standard, 26pt between sections (double gap)

Usage:
  python3 generate_resume.py --content resume.json --output Sahil_Mehta_Resume.pdf
  
  Or import and call generate_pdf(content_dict, output_path) directly.
"""

import argparse
import json
import os
import sys
from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics


# ── Constants (from PDF analysis) ────────────────────────────────────────────
PAGE_W, PAGE_H = A4          # 595 x 842 pt
MARGIN_L = 17.0
MARGIN_R = 17.0
MARGIN_T = 17.0
MARGIN_B = 20.0

LINE_H    = 13.0   # standard line height
GAP_SECTION = 26.0 # gap before new section/subsection (double line)
GAP_NAME_CONTACT = 18.0

FONT_NORMAL = "Times-Roman"
FONT_BOLD   = "Times-Bold"
FONT_ITALIC = "Times-Italic"
FONT_SIZE   = 11.0
NAME_SIZE   = 16.0

TEXT_WIDTH = PAGE_W - MARGIN_L - MARGIN_R   # 561pt usable
BULLET_X   = MARGIN_L      # 17pt — bullet dot
BULLET_TEXT_X = 28.0       # 28pt — bullet text start
CONTENT_X  = MARGIN_L      # 17pt — regular content

SEPARATOR = "_" * 97  # fills full width at 11pt Times-Roman

class ResumeWriter:
    def __init__(self, output_path):
        self.c = canvas.Canvas(output_path, pagesize=A4)
        self.y = PAGE_H - MARGIN_T - FONT_SIZE  # account for font baseline
        self.output_path = output_path

    def _y_pt(self):
        """Convert top-down y to ReportLab bottom-up y."""
        return self.y

    def _check_page_break(self, needed=LINE_H):
        if self.y - needed < MARGIN_B:
            self.c.showPage()
            self.y = PAGE_H - MARGIN_T

    def _draw_text(self, x, text, font=FONT_NORMAL, size=FONT_SIZE, align="left", max_width=None):
        """Draw a single line of text. Returns nothing — use advance_line() after."""
        self.c.setFont(font, size)
        if align == "center":
            self.c.drawCentredString(PAGE_W / 2, self._y_pt(), text)
        elif align == "right":
            self.c.drawRightString(x, self._y_pt(), text)
        else:
            self.c.drawString(x, self._y_pt(), text)

    def _text_width(self, text, font, size):
        return pdfmetrics.stringWidth(text, font, size)

    def advance(self, pts=LINE_H):
        self.y -= pts

    def draw_name(self, name):
        """Name: Times-Bold 16pt, centered."""
        self._check_page_break(GAP_NAME_CONTACT + LINE_H)
        self._draw_text(0, name, font=FONT_BOLD, size=NAME_SIZE, align="center")
        self.advance(GAP_NAME_CONTACT)

    def draw_contact(self, parts):
        """Contact line: Times-Roman 11pt, centered, pipe-separated."""
        line = " | ".join(parts)
        self._draw_text(0, line, font=FONT_NORMAL, size=FONT_SIZE, align="center")
        self.advance(LINE_H)

    def draw_separator(self):
        """Full-width separator line of underscores."""
        self._check_page_break(LINE_H * 2)
        self._draw_text(CONTENT_X, SEPARATOR, font=FONT_NORMAL, size=FONT_SIZE)
        self.advance(LINE_H)

    def draw_section_header(self, text):
        """Section header: Times-Bold 11pt, left-aligned."""
        self._check_page_break(LINE_H)
        self._draw_text(CONTENT_X, text, font=FONT_BOLD, size=FONT_SIZE)
        self.advance(LINE_H)

    def draw_job_header(self, title_left, date_right=None, location_right=None):
        """
        Job title line: bold left, italic date | bold location right.
        e.g. "Software Developer, Enidus USA LLC. (Full-Time)"  June 2025 - Present | Hicksville, NY
        """
        self._check_page_break(LINE_H)
        # Draw bold left part
        self._draw_text(CONTENT_X, title_left, font=FONT_BOLD, size=FONT_SIZE)
        
        # Build right side: italic date + bold " | " + bold location
        if date_right and location_right:
            loc_w   = self._text_width(location_right, FONT_BOLD, FONT_SIZE)
            pipe_w  = self._text_width(" | ", FONT_BOLD, FONT_SIZE)
            date_w  = self._text_width(date_right, FONT_ITALIC, FONT_SIZE)
            
            right_edge = PAGE_W - MARGIN_R
            loc_x   = right_edge - loc_w
            pipe_x  = loc_x - pipe_w
            date_x  = pipe_x - date_w
            
            self.c.setFont(FONT_ITALIC, FONT_SIZE)
            self.c.drawString(date_x, self._y_pt(), date_right)
            self.c.setFont(FONT_BOLD, FONT_SIZE)
            self.c.drawString(pipe_x, self._y_pt(), " | ")
            self.c.drawString(loc_x, self._y_pt(), location_right)
        elif date_right:
            self._draw_text(PAGE_W - MARGIN_R, date_right, font=FONT_ITALIC, size=FONT_SIZE, align="right")
        
        self.advance(LINE_H)

    def draw_subsection(self, text):
        """Subsection title: Times-Bold 11pt, left. 26pt gap above."""
        self._check_page_break(GAP_SECTION + LINE_H)
        self.advance(GAP_SECTION - LINE_H)  # extra gap above subsection
        self._draw_text(CONTENT_X, text, font=FONT_BOLD, size=FONT_SIZE)
        self.advance(LINE_H)

    def draw_bullet(self, text):
        """
        Bullet point: • at x=17, text at x=28, wraps with hanging indent at x=28.
        Times-Roman 11pt.
        """
        max_w = PAGE_W - MARGIN_R - BULLET_TEXT_X
        words = text.split()
        lines = []
        current = []
        
        for word in words:
            test = " ".join(current + [word])
            if self._text_width(test, FONT_NORMAL, FONT_SIZE) <= max_w:
                current.append(word)
            else:
                if current:
                    lines.append(" ".join(current))
                current = [word]
        if current:
            lines.append(" ".join(current))
        
        for i, line in enumerate(lines):
            self._check_page_break(LINE_H)
            if i == 0:
                self.c.setFont(FONT_NORMAL, FONT_SIZE)
                self.c.drawString(BULLET_X, self._y_pt(), "\u2022")
                self.c.drawString(BULLET_TEXT_X, self._y_pt(), line)
            else:
                self.c.setFont(FONT_NORMAL, FONT_SIZE)
                self.c.drawString(BULLET_TEXT_X, self._y_pt(), line)
            self.advance(LINE_H)

    def draw_plain(self, text, font=FONT_NORMAL, right_text=None, right_font=FONT_ITALIC):
        """Plain line of text, optional right-aligned text (e.g. graduation date)."""
        self._check_page_break(LINE_H)
        self._draw_text(CONTENT_X, text, font=font, size=FONT_SIZE)
        if right_text:
            self._draw_text(PAGE_W - MARGIN_R, right_text, font=right_font, size=FONT_SIZE, align="right")
        self.advance(LINE_H)

    def draw_skills_line(self, label, value):
        """
        Skills line: bold label + roman value on same line.
        Wraps long values with a hanging indent at the value-start position so
        wrapped text aligns under the value, not under the label.
        """
        self._check_page_break(LINE_H)
        label_text = label + ": "
        label_w = self._text_width(label_text, FONT_BOLD, FONT_SIZE)
        value_x = CONTENT_X + label_w
        max_w = PAGE_W - MARGIN_R - value_x

        # Greedy word-wrap of value at max_w.
        words = value.split()
        lines = []
        current = []
        for word in words:
            test = " ".join(current + [word])
            if self._text_width(test, FONT_NORMAL, FONT_SIZE) <= max_w:
                current.append(word)
            else:
                if current:
                    lines.append(" ".join(current))
                current = [word]
        if current:
            lines.append(" ".join(current))
        if not lines:
            lines = [""]

        # First line: bold label at left, value at value_x.
        self.c.setFont(FONT_BOLD, FONT_SIZE)
        self.c.drawString(CONTENT_X, self._y_pt(), label_text)
        self.c.setFont(FONT_NORMAL, FONT_SIZE)
        self.c.drawString(value_x, self._y_pt(), lines[0])
        self.advance(LINE_H)

        # Continuation lines: hanging indent at value_x.
        for line in lines[1:]:
            self._check_page_break(LINE_H)
            self.c.setFont(FONT_NORMAL, FONT_SIZE)
            self.c.drawString(value_x, self._y_pt(), line)
            self.advance(LINE_H)

    def save(self):
        self.c.save()
        print(f"✓ PDF saved: {self.output_path}")


def generate_pdf(content, output_path="Sahil_Mehta_Resume.pdf"):
    """
    Generate resume PDF from content dict.
    
    content = {
        "name": str,
        "contact": [str, ...],       # pipe-separated parts
        "sections": [
            {
                "type": "education" | "experience" | "projects" | "skills",
                "header": str,
                "items": [...]        # type-specific, see below
            }
        ]
    }
    
    Experience item:
    {
        "title": str,                 # bold left
        "date": str,                  # italic right
        "location": str,              # bold right after pipe
        "subsections": [
            {
                "name": str,          # bold subsection title (optional)
                "bullets": [str]
            }
        ]
    }
    
    Project item:
    {
        "title": str,
        "date": str,
        "bullets": [str]
    }
    
    Skills item:
    {
        "label": str,
        "value": str
    }
    """
    w = ResumeWriter(output_path)
    
    # Header
    w.draw_name(content["name"])
    w.draw_contact(content["contact"])
    w.draw_separator()
    
    for section in content["sections"]:
        stype = section["type"]
        w.draw_section_header(section["header"])
        
        if stype == "education":
            for item in section["items"]:
                w.draw_plain(item["institution"], font=FONT_BOLD)
                w.draw_plain(item["degree"], right_text=item.get("graduation"), right_font=FONT_ITALIC)
        
        elif stype == "experience":
            for item in section["items"]:
                w.draw_job_header(item["title"], date_right=item.get("date"), location_right=item.get("location"))
                for sub in item.get("subsections", []):
                    if sub.get("name"):
                        w.draw_subsection(sub["name"])
                    for bullet in sub.get("bullets", []):
                        w.draw_bullet(bullet)
                # Gap after each job entry
                w.advance(GAP_SECTION - LINE_H)
        
        elif stype == "projects":
            for item in section["items"]:
                # Project title line
                w.draw_job_header(item["title"], date_right=item.get("date"))
                for bullet in item.get("bullets", []):
                    w.draw_bullet(bullet)
                w.advance(GAP_SECTION - LINE_H)
        
        elif stype == "skills":
            for item in section["items"]:
                w.draw_skills_line(item["label"], item["value"])
        
        w.draw_separator()
    
    w.save()
    return output_path


# ── Default resume content (base resume) ──────────────────────────────────────
DEFAULT_CONTENT = {
    "name": "Sahil Mehta",
    "contact": [
        "New York City, NY",
        "sahilmehta0204@gmail.com",
        os.environ.get("RESUME_PHONE", "[phone available on request]"),
        "Linkedin"
    ],
    "sections": [
        {
            "type": "education",
            "header": "EDUCATION",
            "items": [
                {
                    "institution": "University of Wisconsin, Madison",
                    "degree": "B.S. in Computer Science | B.S. in Data Science (double major)",
                    "graduation": "Graduation: May 2025"
                }
            ]
        },
        {
            "type": "experience",
            "header": "PROFESSIONAL EXPERIENCE",
            "items": [
                {
                    "title": "AI/Full-Stack Engineer, Enidus USA LLC. (Full-Time)",
                    "date": "June 2025 - Present",
                    "location": "Hicksville, NY",
                    "subsections": [
                        {
                            "name": "Custom Reporting System",
                            "bullets": [
                                "Led end-to-end development and integration into existing enterprise portals of a governed, user-configurable reporting system over predefined datasets.",
                                "Implemented multi-tenant report execution using tenant-scoped, parameterized queries and role-based access control (RBAC) to enforce strict data isolation.",
                                "Developed backend services in Node.js and Express to store report definitions, execute dynamic queries, and manage cron-based scheduling and exports.",
                                "Secured report execution and input handling using CSRF protection, XSS sanitization, and Content Security Policy enforcement."
                            ]
                        },
                        {
                            "name": "Backend-For-Frontend (BFF) Infrastructure",
                            "bullets": [
                                "Implemented a Node.js Backend-for-Frontend (BFF) using Express, serving an Angular frontend and acting as the sole integration layer to multiple T-Mobile carrier APIs.",
                                "Built authentication and authorization flows using OAuth-based access tokens with per-request PoP token generation, secure header signing, and session-scoped credential handling.",
                                "Orchestrated downstream API calls using Axios, handling validation, response aggregation, transformation, and normalization before returning frontend-ready payloads.",
                                "Implemented retry logic, timeout handling, and fallback paths to handle intermittent carrier API failures during in-store purchase flows."
                            ]
                        },
                        {
                            "name": "RAG AI Chatbot \u2014 ControlCenter T-Mobile for Business",
                            "bullets": [
                                "Architected a production NL-to-SQL AI assistant over live telecom account data using FastAPI, GPT-4o-mini, and Qdrant, enabling business users to query BANs, SIM lines, and activations in plain English without SQL access.",
                                "Engineered a 3-layer security model (parameterized SQL templates + session-injected reseller scoping + SQL Server RLS) across 8 RBAC roles, with the LLM restricted to tool selection only \u2014 never raw SQL generation \u2014 eliminating prompt injection as an attack surface.",
                                "Built a vector knowledge layer across 4 Qdrant domains (glossary, schema, tool catalog, runbooks) with per-tenant hard-filtering, routing 100% of queries through a 6-intent classifier before any data access.",
                                "Instrumented 9 SQL governance tables for audit logging, tool registry, and RLS policy management; enforced PII redaction across 6 field types (MSISDN, SIM/ICCID, IMEI, IMSI, email, tax_id) from all logs and LLM context.",
                                "Delivered full-stack implementation with a React/TypeScript chat UI, session-aware conversation context, Dockerized services, and 52 passing pytest unit tests across intent, planning, and execution layers."
                            ]
                        }
                    ]
                },
                {
                    "title": "Software Developer, Orahi (Internship)",
                    "date": "July 2024 - August 2024",
                    "location": "Remote",
                    "subsections": [
                        {
                            "name": "",
                            "bullets": [
                                "Developed a dynamic bus route adjustment algorithm to handle new student assignments, reducing manual efforts by 80%.",
                                "Optimized vehicle telemetry ingestion using Flask-based REST APIs, reducing location update latency by 15%.",
                                "Applied K-means clustering to balance bus loads under time constraints, reducing app crashes by 10%."
                            ]
                        }
                    ]
                },
                {
                    "title": "Data Scientist, GSPANN Technologies Inc. (Internship)",
                    "date": "June 2023 - August 2023",
                    "location": "Remote",
                    "subsections": [
                        {
                            "name": "",
                            "bullets": [
                                "Built and evaluated a CNN-based pneumonia detection model using chest X-ray images, achieving 97% test accuracy and improved generalization through preprocessing and augmentation."
                            ]
                        }
                    ]
                }
            ]
        },
        {
            "type": "projects",
            "header": "PROJECTS",
            "items": [
                {
                    "title": "RAG Pipeline - Denari AI Capstone (Github)",
                    "date": "January 2025 - May 2025 | Madison, WI",
                    "bullets": [
                        "Built and deployed a full-stack Retrieval-Augmented Generation (RAG) system using TypeScript, TimescaleDB (PostgreSQL), Docker, S3, and OpenAI APIs, processing 22K+ documents and 300K+ embeddings.",
                        "Implemented hybrid retrieval (BM25, TF-IDF) with semantic re-ranking, achieving 73% QA benchmark accuracy.",
                        "Reduced end-to-end query latency by 40% via optimized chunking, parallel embedding generation, and hypertable indexing.",
                        "Led development using Agile methodologies (Scrum) with JIRA and Slack for sprint management, delivering 25+ production-grade features across ingestion, embeddings, database, and retrieval modules."
                    ]
                }
            ]
        },
        {
            "type": "skills",
            "header": "TECHNICAL SKILLS",
            "items": [
                {"label": "Languages", "value": "Java, JavaScript/TypeScript, Python, C, Kotlin, Swift, R"},
                {"label": "Frameworks & Platforms", "value": "Node.js, React, Angular, FastAPI, Flask, Django, React Native"},
                {"label": "Databases & APIs", "value": "SQL, SQL Server, PostgreSQL, TimescaleDB, GraphQL, REST APIs, gRPC, AWS S3"},
                {"label": "AI/ML", "value": "TensorFlow, Keras, PyTorch, Scikit-learn, OpenAI APIs, RAG, vector search, Qdrant"},
                {"label": "Big Data and Data Analysis", "value": "Apache Spark, Hadoop, HDFS, PyArrow, Kafka, Pandas, NumPy, Matplotlib, OpenCV"},
                {"label": "Tools & Practices", "value": "Docker, Git, Bash, Postman, JIRA, Slack, Agile/Scrum"},
                {"label": "Certifications", "value": "SnowPro Associate and Core Certification (2024)"}
            ]
        }
    ]
}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Generate Sahil Mehta resume PDF")
    parser.add_argument("--content", help="Path to JSON content file (optional, uses base resume if omitted)")
    parser.add_argument("--output", default="Sahil_Mehta_Resume.pdf", help="Output PDF path")
    args = parser.parse_args()

    if args.content:
        with open(args.content) as f:
            content = json.load(f)
    else:
        content = DEFAULT_CONTENT

    generate_pdf(content, args.output)
