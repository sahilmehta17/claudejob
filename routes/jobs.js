const express = require('express');
const router = express.Router();

// ─────────────────────────────────────────────────────────────────────────────
// JSearch API (RapidAPI) — real-time job listings from Google for Jobs
// Free tier: 500 requests/month
// Docs: https://rapidapi.com/letscrape-6bRBa3QguO5/api/jsearch
// ─────────────────────────────────────────────────────────────────────────────
const JSEARCH_HOST = 'jsearch.p.rapidapi.com';
const JSEARCH_BASE = `https://${JSEARCH_HOST}/search`;

/**
 * Map a JSearch role category to an API query string.
 * We append "junior OR entry level OR new grad" to bias toward early-career roles.
 */
const ROLE_QUERIES = {
  'AI Engineer':                'AI engineer OR machine learning engineer',
  'Forward Deployed Engineer':  'forward deployed engineer OR FDE OR applied engineer',
  'Software Engineer':          'software engineer',
  'Data Engineer':              'data engineer',
  'Data Scientist':             'data scientist',
  'ML Engineer':                'machine learning engineer OR ML engineer',
};

/**
 * Map JSearch date_posted values.
 * "3days" is not supported — closest are "today", "3days", "week", "month".
 */
const DATE_POSTED_MAP = {
  '1': 'today',
  '3': '3days',
  '7': 'week',
  '30': 'month',
};

// ─────────────────────────────────────────────────────────────────────────────
// Skill profile for scoring (skill overlap, not ML)
// ─────────────────────────────────────────────────────────────────────────────
const PROFILE_SKILLS = new Set([
  'node.js', 'nodejs', 'typescript', 'javascript', 'python',
  'postgresql', 'sql', 'sql server', 'aws', 'aws s3', 's3',
  'pytorch', 'tensorflow', 'keras', 'scikit-learn',
  'rag', 'vector dbs', 'vector search', 'qdrant', 'llms',
  'apache spark', 'spark', 'hadoop', 'kafka', 'pandas', 'numpy',
  'docker', 'flask', 'fastapi', 'django',
  'react', 'angular', 'react native',
  'rest apis', 'graphql', 'grpc',
  'timescaledb', 'openai', 'openai apis',
  'distributed systems', 'mlops', 'ml', 'machine learning',
  'a/b testing', 'statistics', 'data modeling',
  'git', 'bash', 'postman',
]);

function scoreJobByTags(tags) {
  if (!tags || !tags.length) return 55;
  const matched = tags.filter(t => {
    const tl = t.toLowerCase();
    return PROFILE_SKILLS.has(tl) || [...PROFILE_SKILLS].some(s => s.includes(tl) || tl.includes(s));
  });
  const matchRatio = matched.length / tags.length;
  return Math.min(98, Math.round(55 + matchRatio * 40));
}

// ─────────────────────────────────────────────────────────────────────────────
// Convert JSearch API response to our job format
// ─────────────────────────────────────────────────────────────────────────────
function normalizeJob(j) {
  const postedAt = j.job_posted_at_datetime_utc || j.job_posted_at_timestamp
    ? new Date(j.job_posted_at_datetime_utc || j.job_posted_at_timestamp * 1000)
    : null;

  const hoursAgo = postedAt ? Math.max(0, (Date.now() - postedAt.getTime()) / (1000 * 60 * 60)) : null;

  // Extract skills/tags from the API response
  const tags = [];
  if (j.job_required_skills && Array.isArray(j.job_required_skills)) {
    tags.push(...j.job_required_skills);
  }
  // Also pull from highlights if available
  if (j.job_highlights?.Qualifications) {
    // Try to extract tech keywords from qualification bullets
    const techKeywords = extractTechKeywords(j.job_highlights.Qualifications.join(' '));
    tags.push(...techKeywords);
  }
  // Dedupe
  const uniqueTags = [...new Set(tags.map(t => t.trim()).filter(Boolean))].slice(0, 10);

  const location = [j.job_city, j.job_state].filter(Boolean).join(', ') || 'Unknown';

  return {
    id: j.job_id,
    company: j.employer_name || 'Unknown',
    title: j.job_title || 'Unknown Role',
    location,
    type: j.job_is_remote ? 'Remote' : 'On-site',
    exp: j.job_required_experience?.required_experience_in_months
      ? formatExpRange(j.job_required_experience.required_experience_in_months)
      : '—',
    url: j.job_apply_link || j.job_google_link || '',
    applyUrl: j.job_apply_link || '',
    color: '#5b8af5',
    tags: uniqueTags,
    desc: j.job_description ? j.job_description.slice(0, 1000) : '',
    postedAt: postedAt ? postedAt.toISOString() : null,
    hoursAgo: hoursAgo !== null ? Math.round(hoursAgo) : null,
    postedAgo: hoursAgo !== null ? formatTimeAgo(hoursAgo) : 'Unknown',
    source: 'jsearch',
    employerLogo: j.employer_logo || null,
    employmentType: j.job_employment_type || null,
  };
}

function formatExpRange(months) {
  if (!months) return '—';
  const years = Math.round(months / 12);
  if (years <= 1) return '0-1 years';
  if (years <= 3) return '1-3 years';
  if (years <= 5) return '3-5 years';
  return '5+ years';
}

function formatTimeAgo(hours) {
  if (hours < 1) return 'Just posted';
  if (hours < 24) return Math.round(hours) + 'h ago';
  const days = Math.round(hours / 24);
  if (days === 1) return '1 day ago';
  if (days < 7) return days + ' days ago';
  const weeks = Math.round(days / 7);
  if (weeks === 1) return '1 week ago';
  return weeks + ' weeks ago';
}

/**
 * Extract recognizable tech keywords from a string of text.
 * Intentionally conservative — only well-known terms.
 */
const KNOWN_TECH = new Set([
  'python', 'java', 'javascript', 'typescript', 'go', 'golang', 'rust', 'c++', 'c#',
  'ruby', 'swift', 'kotlin', 'r', 'scala', 'php',
  'react', 'angular', 'vue', 'node.js', 'express', 'django', 'flask', 'fastapi',
  'spring', 'rails', 'next.js', 'nuxt',
  'aws', 'azure', 'gcp', 'docker', 'kubernetes', 'terraform',
  'postgresql', 'mysql', 'mongodb', 'redis', 'elasticsearch', 'dynamodb',
  'sql', 'nosql', 'graphql', 'rest', 'grpc',
  'pytorch', 'tensorflow', 'keras', 'scikit-learn', 'pandas', 'numpy', 'spark',
  'kafka', 'airflow', 'dbt', 'snowflake', 'databricks', 'bigquery', 'redshift',
  'git', 'ci/cd', 'jenkins', 'github actions',
  'machine learning', 'deep learning', 'nlp', 'computer vision', 'llm', 'rag',
  'distributed systems', 'microservices',
]);

function extractTechKeywords(text) {
  const lower = text.toLowerCase();
  const found = [];
  for (const tech of KNOWN_TECH) {
    // word boundary check — avoid partial matches
    const escaped = tech.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (new RegExp(`\\b${escaped}\\b`, 'i').test(lower)) {
      // Return properly cased version
      found.push(tech.charAt(0).toUpperCase() + tech.slice(1));
    }
  }
  return found;
}

// ─────────────────────────────────────────────────────────────────────────────
// Fetch jobs from JSearch API
// ─────────────────────────────────────────────────────────────────────────────
async function fetchFromJSearch(query, location, datePeriod, remoteOnly, page = 1) {
  const apiKey = process.env.RAPIDAPI_KEY;
  if (!apiKey) {
    return { jobs: [], error: 'RAPIDAPI_KEY not set — add it to .env' };
  }

  // Build query — append location if not remote-only
  let q = query;
  if (location && location !== 'Any' && !remoteOnly) {
    q += ` in ${location}`;
  }

  const params = new URLSearchParams({
    query: q,
    page: String(page),
    num_pages: '1',
  });

  if (datePeriod && DATE_POSTED_MAP[datePeriod]) {
    params.set('date_posted', DATE_POSTED_MAP[datePeriod]);
  }
  if (remoteOnly) {
    params.set('remote_jobs_only', 'true');
  }

  const url = `${JSEARCH_BASE}?${params.toString()}`;

  try {
    const resp = await fetch(url, {
      method: 'GET',
      headers: {
        'X-RapidAPI-Key': apiKey,
        'X-RapidAPI-Host': JSEARCH_HOST,
      },
    });

    if (!resp.ok) {
      const body = await resp.text().catch(() => '');
      console.error(`JSearch API error ${resp.status}: ${body.slice(0, 200)}`);
      if (resp.status === 429) {
        return { jobs: [], error: 'JSearch rate limit hit (500 free/month). Try again later or upgrade plan.' };
      }
      if (resp.status === 403) {
        return { jobs: [], error: 'JSearch API key invalid or subscription inactive. Check RAPIDAPI_KEY in .env.' };
      }
      return { jobs: [], error: `JSearch API returned ${resp.status}` };
    }

    const data = await resp.json();

    if (!data.data || !Array.isArray(data.data)) {
      return { jobs: [], error: 'JSearch returned unexpected format' };
    }

    const jobs = data.data.map(normalizeJob);

    // Score and sort
    const scored = jobs.map(j => ({ ...j, score: scoreJobByTags(j.tags) }));
    scored.sort((a, b) => b.score - a.score);

    return { jobs: scored, error: null };
  } catch (e) {
    console.error('JSearch fetch failed:', e.message);
    return { jobs: [], error: `JSearch fetch failed: ${e.message}` };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/jobs?role=AI+Engineer&location=New+York&maxAge=3&remote=false
// Fetches LIVE from JSearch API. Returns real posting dates and direct apply URLs.
// ─────────────────────────────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  const { role, location, maxAge = '7', remote } = req.query;

  const query = ROLE_QUERIES[role] || role || 'software engineer';
  const remoteOnly = remote === 'true';

  const { jobs, error } = await fetchFromJSearch(query, location, maxAge, remoteOnly);

  if (error && jobs.length === 0) {
    // Return error to frontend so it can display it
    return res.json({ jobs: [], total: 0, error, source: 'none' });
  }

  res.json({
    jobs,
    total: jobs.length,
    error: error || null,
    source: 'jsearch',
    fetchedAt: new Date().toISOString(),
  });
});

// GET /api/jobs/categories — still static, these are the search categories
router.get('/categories', (req, res) => {
  res.json({ categories: Object.keys(ROLE_QUERIES) });
});

// GET /api/jobs/:id — for individual job lookup (used by tracker)
// Since JSearch jobs have unique IDs, this searches the API by ID
router.get('/:id', async (req, res) => {
  // JSearch job-details endpoint
  const apiKey = process.env.RAPIDAPI_KEY;
  if (!apiKey) {
    return res.status(503).json({ error: 'RAPIDAPI_KEY not set' });
  }

  try {
    const url = `https://${JSEARCH_HOST}/job-details?job_id=${encodeURIComponent(req.params.id)}&extended_publisher_details=false`;
    const resp = await fetch(url, {
      headers: {
        'X-RapidAPI-Key': apiKey,
        'X-RapidAPI-Host': JSEARCH_HOST,
      },
    });

    if (!resp.ok) {
      return res.status(resp.status).json({ error: `JSearch returned ${resp.status}` });
    }

    const data = await resp.json();
    if (!data.data || !data.data.length) {
      return res.status(404).json({ error: 'Job not found' });
    }

    const job = normalizeJob(data.data[0]);
    job.score = scoreJobByTags(job.tags);
    res.json(job);
  } catch (e) {
    console.error('Job detail fetch failed:', e.message);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
module.exports.ROLE_QUERIES = ROLE_QUERIES;
module.exports.scoreJobByTags = scoreJobByTags;
