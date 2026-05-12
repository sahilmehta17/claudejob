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
// Expanded to include AI-engineer-relevant terms so JDs that mention modern
// LLM/agent stacks actually score above the floor.
// ─────────────────────────────────────────────────────────────────────────────
const PROFILE_SKILLS = new Set([
  // Languages
  'node.js', 'nodejs', 'typescript', 'javascript', 'python', 'java',
  // Backend / web
  'docker', 'flask', 'fastapi', 'django', 'express',
  'react', 'next.js', 'nextjs', 'angular', 'react native',
  'rest apis', 'rest', 'graphql', 'grpc',
  // Databases
  'postgresql', 'postgres', 'sql', 'sql server', 'mysql',
  'timescaledb', 'mongodb', 'redis',
  // Cloud
  'aws', 'aws s3', 's3', 'gcp', 'azure',
  // AI / LLM (the bulk of relevance for AI engineer roles)
  'ai', 'artificial intelligence', 'ml', 'machine learning', 'deep learning',
  'llm', 'llms', 'large language model', 'large language models',
  'claude', 'anthropic', 'openai', 'openai apis', 'gpt', 'gpt-4',
  'rag', 'retrieval augmented generation', 'retrieval-augmented generation',
  'agent', 'agents', 'agentic', 'agentic workflow', 'agent orchestration',
  'tool calling', 'function calling', 'function-calling',
  'prompt engineering', 'eval', 'evals', 'evaluation',
  'vector', 'vector search', 'vector db', 'vector database', 'vector dbs',
  'qdrant', 'pinecone', 'weaviate', 'chroma', 'pgvector',
  'pydantic', 'langchain', 'llamaindex',
  'pytorch', 'tensorflow', 'keras', 'scikit-learn',
  // Data / infra
  'apache spark', 'spark', 'hadoop', 'kafka', 'pandas', 'numpy',
  'mlops', 'data pipeline', 'streaming', 'sse',
  // Ops
  'git', 'bash', 'postman', 'ci/cd', 'kubernetes', 'k8s',
  // Soft / methodology (low signal but realistic)
  'agile', 'scrum',
]);

/**
 * Score a job by skill overlap against the candidate's profile.
 * Returns 30-98 depending on match quality. When tags are empty (JSearch
 * didn't return skills, no keywords found), returns a low-floor score derived
 * from the title — varies per job so the UI doesn't show identical numbers.
 */
function scoreJobByTags(tags, titleFallback) {
  if (!tags || !tags.length) {
    // No tags extracted — fall back to a title-based heuristic.
    // Returns 30-50 range so the UI signals "low confidence" rather than "55% match".
    if (titleFallback) {
      const tl = titleFallback.toLowerCase();
      let titleScore = 30;
      // Word-boundary matching so "ai" doesn't false-positive on "captain",
      // and explicit longer phrases for "artificial intelligence" / "machine learning".
      if (/\b(ai|ml|llm|agent|rag)\b/.test(tl)) titleScore += 15;
      if (/(artificial intelligence|machine learning|deep learning|generative ai|agentic)/.test(tl)) titleScore += 15;
      if (SENIOR_TITLE.test(tl)) titleScore -= 5;
      if (/\b(junior|new grad|entry|associate|early career)\b/.test(tl)) titleScore += 5;
      // Add a small deterministic spread (0-5) based on title hash so identical
      // role types still get distinguishable scores instead of all clustering.
      const hash = [...titleFallback].reduce((a, c) => a + c.charCodeAt(0), 0);
      return Math.min(54, Math.max(28, titleScore + (hash % 6)));
    }
    return 35;
  }
  const matched = tags.filter(t => {
    const tl = t.toLowerCase();
    return PROFILE_SKILLS.has(tl) || [...PROFILE_SKILLS].some(s => s.includes(tl) || tl.includes(s));
  });
  const matchRatio = matched.length / tags.length;
  // Score range: 45-98 when we have tags. More matches = higher score.
  return Math.min(98, Math.round(45 + matchRatio * 53));
}

// ─────────────────────────────────────────────────────────────────────────────
// Convert JSearch API response to our job format
// ─────────────────────────────────────────────────────────────────────────────
function normalizeJob(j) {
  const postedAt = j.job_posted_at_datetime_utc || j.job_posted_at_timestamp
    ? new Date(j.job_posted_at_datetime_utc || j.job_posted_at_timestamp * 1000)
    : null;

  const hoursAgo = postedAt ? Math.max(0, (Date.now() - postedAt.getTime()) / (1000 * 60 * 60)) : null;

  // Extract skills/tags from the API response.
  // JSearch is inconsistent with job_required_skills, so we always supplement
  // by extracting tech keywords from the full description + qualifications.
  const tags = [];
  if (j.job_required_skills && Array.isArray(j.job_required_skills)) {
    tags.push(...j.job_required_skills);
  }
  // Pull from qualifications + full description — descriptions are where most
  // JDs actually mention LLMs, agents, RAG, etc. Highlights alone miss them.
  const corpusParts = [];
  if (j.job_highlights?.Qualifications) corpusParts.push(j.job_highlights.Qualifications.join(' '));
  if (j.job_highlights?.Responsibilities) corpusParts.push(j.job_highlights.Responsibilities.join(' '));
  if (j.job_description) corpusParts.push(j.job_description);
  if (corpusParts.length) {
    tags.push(...extractTechKeywords(corpusParts.join(' ')));
  }
  // Dedupe (case-insensitive) and cap to 10.
  const seen = new Set();
  const uniqueTags = tags
    .map(t => t.trim())
    .filter(t => {
      if (!t) return false;
      const k = t.toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .slice(0, 10);

  const location = [j.job_city, j.job_state].filter(Boolean).join(', ') || 'Unknown';

  // Normalize salary to annual USD for filtering. JSearch returns:
  //   job_min_salary, job_max_salary, job_salary_period (HOUR/MONTH/YEAR)
  // Some listings have nothing — those return null and are kept by default
  // (better to show a pay-unlisted job than exclude based on missing data).
  const minSalary = j.job_min_salary;
  const maxSalary = j.job_max_salary;
  const period = j.job_salary_period;
  const salaryAnnual = (() => {
    if (typeof maxSalary !== 'number' && typeof minSalary !== 'number') return null;
    const top = typeof maxSalary === 'number' ? maxSalary : minSalary;
    const bot = typeof minSalary === 'number' ? minSalary : maxSalary;
    const factor = period === 'HOUR' ? 2080 : period === 'MONTH' ? 12 : 1; // YEAR or unknown → 1
    return { min: bot * factor, max: top * factor, period: 'YEAR', original: period };
  })();

  const expMonths = j.job_required_experience?.required_experience_in_months ?? null;

  return {
    id: j.job_id,
    company: j.employer_name || 'Unknown',
    title: j.job_title || 'Unknown Role',
    location,
    type: j.job_is_remote ? 'Remote' : 'On-site',
    exp: expMonths != null ? formatExpRange(expMonths) : '—',
    expMonths,
    salary: salaryAnnual,
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

// Conservative senior-title regex. Catches the unambiguous keywords without
// false-positive on mid-level titles. Lowercase compare via the /i flag.
// Used by the post-filter to exclude senior-titled jobs when the user selects
// a junior/mid experience cap — JSearch's expMonths field is null on most
// senior listings, so title detection is the reliable signal.
const SENIOR_TITLE = /\b(senior|sr\.?|staff|principal|lead|distinguished|director|head\s+of|vp|chief)\b/i;

/**
 * Extract recognizable tech keywords from a string of text.
 * Intentionally conservative — only well-known terms.
 */
const KNOWN_TECH = new Set([
  // Languages
  'python', 'java', 'javascript', 'typescript', 'go', 'golang', 'rust', 'c++', 'c#',
  'ruby', 'swift', 'kotlin', 'r', 'scala', 'php',
  // Frontend / backend
  'react', 'angular', 'vue', 'node.js', 'express', 'django', 'flask', 'fastapi',
  'spring', 'rails', 'next.js', 'nuxt', 'svelte',
  // Cloud / infra
  'aws', 'azure', 'gcp', 'docker', 'kubernetes', 'terraform',
  // DBs
  'postgresql', 'mysql', 'mongodb', 'redis', 'elasticsearch', 'dynamodb',
  'sql', 'nosql', 'graphql', 'rest', 'grpc',
  // Classic ML / data
  'pytorch', 'tensorflow', 'keras', 'scikit-learn', 'pandas', 'numpy', 'spark',
  'kafka', 'airflow', 'dbt', 'snowflake', 'databricks', 'bigquery', 'redshift',
  // Ops
  'git', 'ci/cd', 'jenkins', 'github actions',
  // AI / LLM (the bulk of relevance — what was missing before)
  'machine learning', 'deep learning', 'nlp', 'computer vision',
  'ai', 'artificial intelligence', 'ml',
  'llm', 'llms', 'large language model', 'large language models',
  'rag', 'retrieval augmented generation', 'retrieval-augmented generation',
  'agent', 'agents', 'agentic', 'agent orchestration',
  'tool calling', 'function calling', 'function-calling', 'tool use',
  'prompt engineering', 'evals', 'evaluation framework',
  'vector', 'vector search', 'vector database', 'vector db',
  'qdrant', 'pinecone', 'weaviate', 'chroma', 'pgvector', 'milvus',
  'openai', 'anthropic', 'claude', 'gpt', 'gpt-4', 'gpt-4o',
  'pydantic', 'langchain', 'llamaindex',
  'streaming', 'sse',
  // Architecture
  'distributed systems', 'microservices', 'serverless', 'event-driven',
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
async function fetchFromJSearch(query, location, datePeriod, remoteOnly, opts = {}, page = 1) {
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

  // Experience filter — JSearch supports server-side filtering via job_requirements.
  // Valid values: under_3_years_experience, more_than_3_years_experience,
  // no_experience, no_degree. Multiple comma-separated.
  // We map the UI options to the closest server-side filter, then post-filter
  // for tighter control (the JSearch buckets are coarse).
  if (opts.expLevel === 'junior_only') {
    params.set('job_requirements', 'no_experience,under_3_years_experience');
  } else if (opts.expLevel === 'under_3') {
    params.set('job_requirements', 'no_experience,under_3_years_experience');
  } else if (opts.expLevel === 'under_5') {
    // Under 5 has no direct bucket — request under_3 + accept post-filter top-up
    params.set('job_requirements', 'no_experience,under_3_years_experience');
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

    // ── Post-filter ───────────────────────────────────────────────────────
    // (1) Experience cap — JSearch's server-side buckets are coarse, so we
    //     enforce the actual ceiling here using normalized expMonths.
    //     Listings with expMonths == null are kept (no signal != fail).
    let filtered = jobs;
    const expCapMonths = (() => {
      if (opts.expLevel === 'junior_only') return 24;  // 0-2 yrs
      if (opts.expLevel === 'under_3')     return 36;  // 0-3 yrs
      if (opts.expLevel === 'under_5')     return 60;  // 0-5 yrs
      return null;
    })();
    if (expCapMonths != null) {
      filtered = filtered.filter(j => {
        if (SENIOR_TITLE.test(j.title)) return false;
        return j.expMonths == null || j.expMonths <= expCapMonths;
      });
    }

    // (2) Min salary — drop listings whose MAX salary (annualized) is below
    //     the user's floor. Listings with no salary data are kept by default.
    if (typeof opts.minSalaryUsd === 'number' && opts.minSalaryUsd > 0) {
      filtered = filtered.filter(j => {
        if (!j.salary || typeof j.salary.max !== 'number') return true; // unlisted: keep
        return j.salary.max >= opts.minSalaryUsd;
      });
    }

    // Score and sort
    const scored = filtered.map(j => ({ ...j, score: scoreJobByTags(j.tags, j.title) }));
    scored.sort((a, b) => b.score - a.score);

    return { jobs: scored, error: null, filteredCount: jobs.length - filtered.length };
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
  const { role, location, maxAge = '7', remote, expLevel, minSalary } = req.query;

  const query = ROLE_QUERIES[role] || role || 'software engineer';
  const remoteOnly = remote === 'true';

  // Parse filter opts. expLevel: 'any' | 'junior_only' | 'under_3' | 'under_5'.
  // minSalary: numeric USD floor (e.g. 100000); 0 or missing = no filter.
  const opts = {
    expLevel: expLevel && expLevel !== 'any' ? expLevel : null,
    minSalaryUsd: minSalary ? parseInt(minSalary, 10) || 0 : 0,
  };

  const { jobs, error, filteredCount } = await fetchFromJSearch(query, location, maxAge, remoteOnly, opts);

  if (error && jobs.length === 0) {
    // Return error to frontend so it can display it
    return res.json({ jobs: [], total: 0, error, source: 'none' });
  }

  res.json({
    jobs,
    total: jobs.length,
    filteredOut: filteredCount || 0,
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
    job.score = scoreJobByTags(job.tags, job.title);
    res.json(job);
  } catch (e) {
    console.error('Job detail fetch failed:', e.message);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
module.exports.ROLE_QUERIES = ROLE_QUERIES;
module.exports.scoreJobByTags = scoreJobByTags;
