/**
 * routes/apply.js — Apply Helper workflow
 *
 * This is a MANUAL apply helper — it packages materials, provides a cheat sheet,
 * and opens the job URL. It does NOT submit applications automatically.
 *
 * Endpoints:
 *   POST /api/apply/prepare   → packages resume + cover letter + Q&A for a job
 *   POST /api/apply/launch    → opens the job URL (returns URL + clipboard payload)
 *
 * All actual form-filling and submission is done by the user manually.
 */

const express = require('express');
const router = express.Router();

// ─────────────────────────────────────────────────────────────────────────────
// PROFILE — used for form-fill cheat sheet (copy-paste reference)
// ─────────────────────────────────────────────────────────────────────────────
const PROFILE = {
  first_name: 'Sahil',
  last_name: 'Mehta',
  email: 'sahilmehta0204@gmail.com',
  phone: process.env.RESUME_PHONE || '[phone available on request]',
  location: 'New York City, NY',
  linkedin: 'https://linkedin.com/in/sahilmehta',
  github: 'https://github.com/sahilmehta',
  school: 'University of Wisconsin, Madison',
  degree: 'B.S. Computer Science & Data Science',
  graduation: 'May 2025',
  work_authorization: 'Yes — US Work Authorization',
  sponsorship: 'No sponsorship required',
  years_experience: '1',
  salary_expectation: '150000',
  quick_answers: {
    'years_of_experience': '1',
    'authorized_to_work': 'Yes',
    'require_sponsorship': 'No',
    'willing_to_relocate': 'Yes',
    'remote_preference': 'Hybrid or Remote',
  }
};

// Detect ATS type from URL
function detectATS(url) {
  if (!url) return 'unknown';
  const u = url.toLowerCase();
  if (u.includes('greenhouse.io') || u.includes('boards.greenhouse')) return 'greenhouse';
  if (u.includes('lever.co') || u.includes('jobs.lever')) return 'lever';
  if (u.includes('workday') || u.includes('myworkdayjobs')) return 'workday';
  if (u.includes('linkedin.com/jobs')) return 'linkedin';
  if (u.includes('careers.google.com') || u.includes('jobs.google')) return 'google';
  if (u.includes('metacareers.com')) return 'meta';
  if (u.includes('amazon.jobs')) return 'amazon';
  if (u.includes('careers.microsoft.com')) return 'microsoft';
  if (u.includes('jobs.apple.com')) return 'apple';
  if (u.includes('ashbyhq.com')) return 'ashby';
  if (u.includes('rippling') || u.includes('rippling-ats')) return 'rippling';
  return 'generic';
}

function getATSInstructions(ats, jobTitle, company) {
  const map = {
    greenhouse: `Greenhouse ATS — standard fields. Upload resume PDF, paste cover letter in the text field. Typically asks: name, email, phone, LinkedIn, GitHub, resume, cover letter, work authorization.`,
    lever: `Lever ATS — clean apply flow. Fields: name, email, phone, LinkedIn/GitHub URL, resume upload, cover letter (text or upload), and custom questions.`,
    workday: `Workday ATS (common at ${company}) — requires account creation. Uploads resume, parses it automatically. Then confirm/edit parsed fields. Usually asks EEO questions at end.`,
    linkedin: `LinkedIn Easy Apply — uses your saved profile. Typically 1-3 screens. May ask a few custom screening questions.`,
    google: `Google Careers — requires Google account. Upload resume (PDF preferred). Fills name/email/phone automatically. Will ask about authorization and preferences.`,
    meta: `Meta Careers — requires Meta account. 2-3 step process. Upload resume, add work experience, fill screening questions.`,
    amazon: `Amazon Jobs — Workday-based. Create account, upload resume, fill detailed work history. STAR-method responses for behavioral questions.`,
    microsoft: `Microsoft Careers — requires Microsoft account. Upload resume PDF. Typically 3-4 screens with standard info + EEO.`,
    apple: `Apple Jobs — iCloud account required. Upload resume, fill work history, answer a few screening questions.`,
    ashby: `Ashby ATS — modern, clean. Name, email, phone, LinkedIn/GitHub, resume upload, cover letter. Usually 1-2 screens.`,
    generic: `Standard application form — complete all required fields. Name, email, phone, resume upload, cover letter, work authorization.`,
  };
  return map[ats] || map.generic;
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/apply/prepare — package all materials + ATS analysis
// Body: { job, resume, cover, qa }
// ─────────────────────────────────────────────────────────────────────────────
router.post('/prepare', (req, res) => {
  const { job, resume, cover, qa } = req.body;
  if (!job) return res.status(400).json({ error: 'job required' });

  const ats = detectATS(job.url);
  const instructions = getATSInstructions(ats, job.title, job.company);

  // Build form-fill cheat sheet (for copy-paste reference only)
  const cheatSheet = {
    personal: {
      'First Name': PROFILE.first_name,
      'Last Name': PROFILE.last_name,
      'Email': PROFILE.email,
      'Phone': PROFILE.phone,
      'City / Location': PROFILE.location,
      'LinkedIn URL': PROFILE.linkedin,
      'GitHub URL': PROFILE.github,
    },
    education: {
      'School': PROFILE.school,
      'Degree': PROFILE.degree,
      'Graduation Year': PROFILE.graduation,
    },
    screening: {
      'Years of experience': PROFILE.years_experience,
      'Authorized to work in US?': PROFILE.quick_answers.authorized_to_work,
      'Require visa sponsorship?': PROFILE.quick_answers.require_sponsorship,
      'Willing to relocate?': PROFILE.quick_answers.willing_to_relocate,
      'Remote / Hybrid preference': PROFILE.quick_answers.remote_preference,
    }
  };

  res.json({
    job,
    ats,
    ats_instructions: instructions,
    cheat_sheet: cheatSheet,
    materials_ready: {
      resume: !!resume,
      cover: !!cover,
      qa: !!(qa && qa.length),
    },
    resume_snippet: resume ? resume.slice(0, 300) + '...' : null,
    cover_snippet: cover ? cover.slice(0, 300) + '...' : null,
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/apply/fetch-questions — scrape real form questions from apply page
// Body: { url, ats }
// Returns: { questions: string[], ats, applyUrl, error? }
// ─────────────────────────────────────────────────────────────────────────────

// Labels we always skip — standard ATS boilerplate fields
const SKIP_LABELS = new Set([
  'first name', 'last name', 'full name', 'name', 'email', 'email address',
  'phone', 'phone number', 'mobile', 'resume', 'resume/cv', 'cv', 'cover letter',
  'linkedin', 'linkedin profile', 'linkedin url', 'github', 'github url',
  'portfolio', 'website', 'personal website', 'location', 'city', 'country',
  'address', 'street address', 'state', 'zip', 'postal code',
  'how did you hear about us', 'how did you hear about this role',
  'gender', 'race', 'ethnicity', 'veteran status', 'disability status',
  'preferred pronouns', 'pronouns',
  'are you authorized to work', 'work authorization', 'authorized to work in the us',
  'do you require sponsorship', 'visa sponsorship', 'require sponsorship',
  'salary expectation', 'desired salary', 'compensation expectations',
  'start date', 'available start date', 'earliest start date',
]);

// Does the label look like a real screening/culture question?
function isRealQuestion(text) {
  const t = text.trim();
  if (t.length < 10 || t.length > 500) return false;
  // Skip anything that looks like a field label (short noun phrase, no verb)
  const lower = t.toLowerCase();
  if (SKIP_LABELS.has(lower)) return false;
  // Skip if it's just a field name followed by nothing (e.g. "LinkedIn Profile")
  if (!t.includes('?') && !t.includes(' ') ) return false;
  // Skip if it's very short and has no question indicator
  if (t.split(' ').length <= 3 && !t.includes('?')) return false;
  return true;
}

// Build the apply URL for each ATS
function buildApplyUrl(url, ats) {
  if (!url) return null;
  try {
    const u = url.trim();
    if (ats === 'lever') {
      // Lever apply pages are at jobs.lever.co/{company}/{id}/apply
      if (!u.endsWith('/apply')) return u.replace(/\/$/, '') + '/apply';
      return u;
    }
    if (ats === 'greenhouse') {
      // Greenhouse job board apply pages accessible directly
      return u;
    }
    if (ats === 'ashby') {
      // Ashby apply pages are directly accessible
      return u;
    }
    return u;
  } catch { return url; }
}

// Extract question text from raw HTML using regex
function extractQuestionsFromHTML(html, ats) {
  const questions = [];

  if (ats === 'lever') {
    // Lever: custom questions are in <div class="application-question">
    // Labels are in <label> or <div class="application-label">
    // Questions are in <h4> within .custom-question or similar
    const labelMatches = html.matchAll(/<(?:label|h3|h4|legend)[^>]*>([\s\S]*?)<\/(?:label|h3|h4|legend)>/gi);
    for (const m of labelMatches) {
      const text = m[1].replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'").replace(/&quot;/g, '"').trim();
      if (isRealQuestion(text)) questions.push(text);
    }

    // Also look for data-qa attributes or placeholder text in textareas
    const placeholders = html.matchAll(/placeholder="([^"]{15,})"/g);
    for (const m of placeholders) {
      const text = decodeURIComponent(m[1]).replace(/\\n/g, ' ').trim();
      if (isRealQuestion(text) && !questions.includes(text)) questions.push(text);
    }
  } else if (ats === 'greenhouse') {
    // Greenhouse: questions in <label> tags inside .field blocks
    const labelMatches = html.matchAll(/<label[^>]*>([\s\S]*?)<\/label>/gi);
    for (const m of labelMatches) {
      const text = m[1].replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"').trim();
      if (isRealQuestion(text)) questions.push(text);
    }
  } else if (ats === 'ashby') {
    // Ashby: questions in <label> or <p> with class question-text
    const labelMatches = html.matchAll(/<(?:label|p|h3|h4)[^>]*>([\s\S]*?)<\/(?:label|p|h3|h4)>/gi);
    for (const m of labelMatches) {
      const text = m[1].replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').trim();
      if (isRealQuestion(text)) questions.push(text);
    }
  } else {
    // Generic: grab all <label> and <legend> text
    const allMatches = html.matchAll(/<(?:label|legend|h3|h4)[^>]*>([\s\S]*?)<\/(?:label|legend|h3|h4)>/gi);
    for (const m of allMatches) {
      const text = m[1].replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&#39;/g, "'").trim();
      if (isRealQuestion(text)) questions.push(text);
    }
  }

  // Deduplicate
  return [...new Set(questions)];
}

router.post('/fetch-questions', async (req, res) => {
  const { url, ats: providedAts } = req.body;
  if (!url) return res.status(400).json({ error: 'url required' });

  const ats = providedAts || detectATS(url);
  const applyUrl = buildApplyUrl(url, ats);

  if (!applyUrl) {
    return res.status(400).json({ error: 'Could not build apply URL', ats });
  }

  // Only public ATS pages work without auth
  const supportedATS = new Set(['lever', 'greenhouse', 'ashby', 'generic']);
  if (!supportedATS.has(ats)) {
    return res.json({
      questions: [],
      ats,
      applyUrl,
      note: `${ats} requires login — use the "Paste questions" option instead`,
    });
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    const response = await fetch(applyUrl, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
      },
    });
    clearTimeout(timeout);

    if (!response.ok) {
      return res.json({
        questions: [],
        ats,
        applyUrl,
        note: `Page returned ${response.status} — some ATS pages require login. Use "Paste questions" instead.`,
      });
    }

    const html = await response.text();
    const questions = extractQuestionsFromHTML(html, ats);

    res.json({
      questions,
      ats,
      applyUrl,
      found: questions.length,
      note: questions.length === 0
        ? 'No questions found — the page may require login or use JavaScript rendering. Try "Paste questions" instead.'
        : null,
    });
  } catch (e) {
    const isTimeout = e.name === 'AbortError';
    res.json({
      questions: [],
      ats,
      applyUrl,
      note: isTimeout
        ? 'Request timed out — try "Paste questions" instead.'
        : `Fetch failed: ${e.message}. Use "Paste questions" instead.`,
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/apply/launch — return apply URL and clipboard payload
// Body: { job, cover }
// ─────────────────────────────────────────────────────────────────────────────
router.post('/launch', (req, res) => {
  const { job, cover } = req.body;
  if (!job) return res.status(400).json({ error: 'job required' });

  const applyUrl = job.applyUrl || job.url;
  const ats = detectATS(applyUrl);

  res.json({
    url: applyUrl,
    ats,
    clipboard: cover || '',
    message: `Opening ${job.title} at ${job.company}. Cover letter copied to clipboard.`,
    next_steps: [
      `Apply for ${job.title} at ${job.company}`,
      'Upload your resume PDF',
      'Paste cover letter (already in your clipboard)',
      'Fill personal info using the cheat sheet',
      'Review and submit manually — then come back and update tracker status',
    ]
  });
});

module.exports = router;
module.exports.PROFILE = PROFILE;
