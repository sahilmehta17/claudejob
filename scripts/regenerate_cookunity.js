// regenerate_cookunity.js
// One-off: re-tailor the CookUnity application with chef-drop-brief now in context.
//
// Overwrites the Sahil_Mehta_Resume.pdf in the May-16 CookUnity folder.
// Leaves the cover letter alone (it already has chef-drop-brief).
//
// Run from ClaudeJob/files: node scripts/regenerate_cookunity.js

require('dotenv').config();
const fs = require('fs/promises');
const path = require('path');
const Anthropic = require('@anthropic-ai/sdk');
const { renderResumePdf } = require('../routes/pdfRender');
const {
  RESUME_BASE_JSON,
  ADJACENCY_MAP,
} = require('../routes/resumeContent');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Same character-budget constant ai.js uses
function sumBulletChars(json) {
  let n = 0;
  for (const s of json.sections || []) {
    if (s.type === 'experience') {
      for (const it of s.items || []) {
        for (const sub of it.subsections || []) {
          for (const b of sub.bullets || []) n += String(b).length;
        }
      }
    } else if (s.type === 'projects') {
      for (const it of s.items || []) {
        for (const b of it.bullets || []) n += String(b).length;
      }
    }
  }
  return n;
}
const BASE_BULLET_CHAR_BUDGET = sumBulletChars(RESUME_BASE_JSON);
console.log('[base budget]', BASE_BULLET_CHAR_BUDGET, 'chars');

// ─── CookUnity job spec ───
const job = {
  title: 'AI Native Engineer, Growth Marketing',
  company: 'CookUnity',
  tags: [
    'Python', 'TypeScript', 'Claude API', 'Anthropic SDK', 'OpenAI APIs',
    'LLM APIs', 'agent orchestration', 'tool calling', 'RAG',
    'Braze', 'lifecycle marketing', 'CRM', 'email/SMS/push', 'Snowflake',
    'n8n', 'Make', 'Zapier', 'Agent SDK', 'Vercel AI SDK',
    'MCP', 'Claude Code Skills', 'prompt engineering', 'evals',
    'A/B testing', 'creative ops', 'Slack bots', 'internal tools',
  ],
  desc: `AI Native Engineer, Growth Marketing at CookUnity (Remote, $130K-$140K).

We're hiring an AI Native Engineer to embed AI into every corner of Growth: performance marketing, creative production, CRM, landing pages, growth ops. Equal parts engineer and growth practitioner — write Python in the morning, ship a Braze-connected AI workflow by afternoon, explain business impact to non-technical stakeholders by EOD.

Responsibilities:
- Performance Marketing: AI-powered tools for bid strategy analysis, budget pacing alerts, creative performance scoring, anomaly detection across paid channels.
- Creative Studio: AI workflows for ad copy generation, creative brief automation, image asset variation, feedback loops between analytics and studio.
- CRM & Lifecycle: AI-driven personalization and send-time optimization across email, SMS, push, in-app; agentic workflows pulling Snowflake data, generating segment logic, triggering Braze campaigns.
- Landing Pages & Conversion: LP variant generation, headline testing ideation, personalization logic by audience segment.
- Growth Ops: Internal AI tools (dashboards, Slack bots, report generators) reducing repetitive analytical work.
- Tooling & Infrastructure: Evaluate, implement, and maintain the AI/ML toolstack.

Qualifications:
- 2-5 years engineering or technical experience; meaningful hands-on work applying AI/LLMs to real business problems.
- Proficiency in Python or TypeScript and comfort with APIs (OpenAI, Anthropic, or similar).
- Build repeatable skills or plugins for popular LLM clients to empower your team.
- A builder's mentality.
Preferred: workflow orchestration tools (Agent SDK, n8n, Make, Zapier), DTC/subscription experience, prompt engineering / RAG, internal tools used by non-technical teams, marketing platforms (Braze, Google Ads, Meta Ads Manager, Snowflake).

Technologies: Claude API, OpenAI, Anthropic SDK, Braze, Google Ads, Meta Ads Manager, Snowflake, SQL, Tableau, dbt, Hex, TypeScript, Agent SDK, Vercel AI SDK, Python, n8n, Make, Slack, Notion.`,
};

// ─── Resume prompt (replicates buildResumePrompt in ai.js) ───
function buildResumePrompt(job, emphasis) {
  return require('fs').readFileSync(
    path.join(__dirname, '..', 'routes', 'ai.js'), 'utf8'
  ); // we'll grab the prompt by extracting — but cleaner to just inline
}
// Cleaner: inline the prompt directly from ai.js verbatim (Section: HARDENED RESUME PROMPT).
// Loaded via require/eval-ish trick would be messier. Use the full template here.
function buildPrompt(job, emphasis) {
  return `You are tailoring a resume for a specific job. Your ONLY job is conservative editing — NOT rewriting.

You are tailoring a 1-page resume. Layout discipline matters as much as content relevance.

TARGET ROLE: ${job.title} at ${job.company}
REQUIRED SKILLS: ${job.tags.join(', ')}
JD: ${job.desc}
EMPHASIS: ${emphasis}

SOURCE RESUME (this is the ONLY source of truth — JSON, the canonical schema):
${JSON.stringify(RESUME_BASE_JSON, null, 2)}

EXPLICIT OVERRIDE FOR THIS RUN:
- This is the CookUnity Growth-Marketing-AI application. The chef-drop-brief project in PROJECTS is the SINGLE highest-signal artifact for this role — installable Claude Code Skill, 9 evals, Braze-shaped output, lifecycle marketing. It MUST appear as the lead PROJECTS item.
- ClaudeJob may be dropped or consolidated to 1 short bullet to make room — chef-drop-brief is the more recent, more relevant version of the same eval-driven LLM pattern.
- Keep Enidus T-Mobile copilot (production AI cred).
- Keep Denari RAG capstone (scale signal).
- Keep Orahi and GSPANN internships (preserve the full work history).
- HARD: total bullet chars must NOT exceed ${BASE_BULLET_CHAR_BUDGET}. Compress wording in any bullet rather than dropping entire roles. If you absolutely must drop something to fit, drop one ClaudeJob bullet, not a real internship.

OUTPUT FORMAT: Return ONLY a JSON object matching the SAME SCHEMA as the source above. No markdown fences, no commentary, no prose explanation. The JSON will be parsed by JSON.parse() — anything other than valid JSON breaks the pipeline.

PRESERVE: top-level keys, section types, item structure, all numbers/percentages/dates/company names/tool names exactly.

STRICT RULES:
1. PRESERVE ALL FACTS EXACTLY. Every number, percentage, metric, date, company name, tool name, and claim must come directly from the source resume. Do not round, approximate, inflate, or invent.
2. ALLOWED EDITS: reorder bullets within sections; reorder sections; tighten wording (keep meaning); swap JD-relevant phrasing only when source supports; highlight JD-matching skills first.
3. NEVER: invent tools/frameworks/metrics; add scope beyond source; use banned phrases [leveraged, spearheaded, utilized, results-driven, dynamic professional, passionate about, excited to bring, proven track record, cutting-edge, synergized, revolutionized, transformative, game-changing, best-in-class, thought leader, self-starter, go-getter, drove innovation, deep expertise, seasoned, extensive experience]; expand weak evidence; pretend; add summary/objective; change format.
4. TONE: outcome-first; tech stacks trail.
5. SKILLS section: exactly 4 category lines (AI/LLM Systems, Languages, Frameworks, Infra & Tools).
6. VERB DIVERSITY: no more than 2 bullets starting with the same verb across the resume.
7. Each bullet 20-35 words. Final rendered line ≥ 4 words (no widows).
8. Return ONLY a JSON object. First char "{", last char "}".`;
}

async function callClaude(prompt, maxTokens) {
  let full = '';
  const stream = await client.messages.stream({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: maxTokens,
    messages: [{ role: 'user', content: prompt }],
  });
  for await (const chunk of stream) {
    if (chunk.type === 'content_block_delta' && chunk.delta?.type === 'text_delta') {
      full += chunk.delta.text;
    }
  }
  return full;
}

function safeParseJSON(raw) {
  const cleaned = String(raw).trim().replace(/^```(?:json)?\s*/gm, '').replace(/```\s*$/gm, '').trim();
  return JSON.parse(cleaned);
}

// Same applyAdjacency logic as ai.js (curated, never LLM-fabricated)
function extractUserSkills(json) {
  const skillsSection = (json.sections || []).find(s => s.type === 'skills');
  if (!skillsSection) return new Set();
  const out = new Set();
  for (const item of skillsSection.items || []) {
    const text = `${item.label || ''} ${item.value || ''}`;
    for (const token of text.split(/[,;()|]/).map(t => t.trim().toLowerCase()).filter(Boolean)) {
      out.add(token);
    }
  }
  return out;
}

function applyAdjacency(tailoredJson, jdRequiredSkills) {
  const userSkills = extractUserSkills(tailoredJson);
  const added = [];
  for (const jdSkill of jdRequiredSkills) {
    const key = String(jdSkill).toLowerCase().trim();
    if (!key || userSkills.has(key)) continue;
    const adjacencies = ADJACENCY_MAP[key];
    if (!adjacencies) continue;
    const justifier = adjacencies.find(a => userSkills.has(a.toLowerCase()));
    if (!justifier) continue;
    // Add to AI / LLM Systems by default (matches ai.js behavior)
    const skillsSection = tailoredJson.sections.find(s => s.type === 'skills');
    if (skillsSection && skillsSection.items?.length) {
      skillsSection.items[0].value = skillsSection.items[0].value.trimEnd().replace(/\.$/, '') + ', ' + jdSkill;
      added.push({ skill: jdSkill, justifier });
    }
  }
  return { json: tailoredJson, added };
}

// ─── Main ───
(async () => {
  const outDir = path.join(
    process.env.HOME,
    'Desktop',
    'Internships and Resume',
    'JobApplications',
    'Cook-Unity_AI-Native-Engineer-Growth-Marketing_2026-05-16-2013',
  );
  const outPath = path.join(outDir, 'Sahil_Mehta_Resume.pdf');

  console.log('[step 1/3] calling Claude (haiku-4-5) with explicit chef-drop-brief priority...');
  const prompt = buildPrompt(job, 'AI/ML');
  const raw = await callClaude(prompt, 4000);
  let tailored;
  try {
    tailored = safeParseJSON(raw);
  } catch (e) {
    console.error('[parse] LLM JSON parse failed, falling back to base:', e.message);
    tailored = RESUME_BASE_JSON;
  }

  // Verify chef-drop-brief is in the output
  const hasChefDropBrief = JSON.stringify(tailored).toLowerCase().includes('chef-drop-brief');
  console.log('[step 2/3] LLM output contains chef-drop-brief?', hasChefDropBrief ? 'YES ✓' : 'NO ✗');
  if (!hasChefDropBrief) {
    console.error('[abort] LLM dropped chef-drop-brief despite explicit instructions. Not writing PDF.');
    process.exit(1);
  }

  console.log('[step 2.5/3] tailored char total:', sumBulletChars(tailored), 'vs budget', BASE_BULLET_CHAR_BUDGET);

  const adjResult = applyAdjacency(tailored, [...job.tags]);
  console.log('[adjacency] added:', adjResult.added.map(a => a.skill).join(', ') || '(none)');

  console.log('[step 3/3] rendering PDF to', outPath, '...');
  try {
    const r = await renderResumePdf(adjResult.json, outPath);
    const stat = await fs.stat(outPath);
    console.log('[done] fallback tier:', r.fallback, '| size:', stat.size, 'bytes | fillPct:', r.fillPct?.toFixed(2));
  } catch (e) {
    console.error('[render] FAILED:', e.message);
    process.exit(2);
  }
})();
