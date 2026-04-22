require('dotenv').config();
const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const path = require('path');
const fs = require('fs');

const aiRoutes = require('./routes/ai');
const jobRoutes = require('./routes/jobs');
const applyRoutes = require('./routes/apply');

const app = express();
const PORT = process.env.PORT || 3000;

// ─── Persistent tracker storage ──────────────────────────────────────────────
const DATA_DIR = path.join(__dirname, 'data');
const TRACKER_FILE = path.join(DATA_DIR, 'tracker.json');

function loadTracker() {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    if (!fs.existsSync(TRACKER_FILE)) return [];
    const raw = fs.readFileSync(TRACKER_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      console.error('Tracker file is not an array, resetting');
      return [];
    }
    return parsed;
  } catch (e) {
    console.error('Tracker load error:', e.message);
    return [];
  }
}

function saveTracker(data) {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    // Write to temp file first, then rename (atomic write)
    const tmpFile = TRACKER_FILE + '.tmp';
    fs.writeFileSync(tmpFile, JSON.stringify(data, null, 2));
    fs.renameSync(tmpFile, TRACKER_FILE);
  } catch (e) {
    console.error('Tracker save error:', e.message);
    throw new Error('Failed to save tracker data');
  }
}

let trackerData = loadTracker();

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json({ limit: '5mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Rate limit AI endpoints — skip SSE streams (they're long-lived)
const aiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  skip: (req) => req.path.includes('pipeline-stream'),
  message: { error: 'Too many requests, slow down.' }
});
app.use('/api/ai', aiLimiter);

// ─── Routes ───────────────────────────────────────────────────────────────────
app.use('/api/ai', aiRoutes);
app.use('/api/jobs', jobRoutes);
app.use('/api/apply', applyRoutes);

// ─── Tracker CRUD ─────────────────────────────────────────────────────────────

// Allowed fields for tracker entries (prevent arbitrary field injection)
const TRACKER_ALLOWED_FIELDS = new Set([
  'id', 'company', 'title', 'location', 'url', 'color', 'score',
  'status', 'notes', 'resume', 'cover', 'appliedAt',
]);
const TRACKER_VALID_STATUSES = new Set([
  'wishlist', 'applied', 'phone', 'technical', 'offer', 'rejected',
]);

function sanitizeTrackerEntry(obj) {
  const clean = {};
  for (const [key, val] of Object.entries(obj)) {
    if (TRACKER_ALLOWED_FIELDS.has(key)) {
      clean[key] = val;
    }
  }
  if (clean.status && !TRACKER_VALID_STATUSES.has(clean.status)) {
    delete clean.status;
  }
  return clean;
}

// GET /api/tracker — load all
app.get('/api/tracker', (req, res) => {
  trackerData = loadTracker();
  res.json({ entries: trackerData });
});

// POST /api/tracker — add new entry
app.post('/api/tracker', (req, res) => {
  const entry = sanitizeTrackerEntry(req.body);
  if (!entry.id || !entry.company) return res.status(400).json({ error: 'id and company required' });

  trackerData = loadTracker();
  const existing = trackerData.findIndex(e => e.id === entry.id);
  if (existing >= 0) {
    trackerData[existing] = { ...trackerData[existing], ...entry, updatedAt: new Date().toISOString() };
  } else {
    trackerData.push({ ...entry, addedAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
  }

  try {
    saveTracker(trackerData);
    res.json({ success: true, entry: trackerData.find(e => e.id === entry.id) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// PATCH /api/tracker/:id — update status/notes (allowlisted fields only)
app.patch('/api/tracker/:id', (req, res) => {
  trackerData = loadTracker();
  const idx = trackerData.findIndex(e => e.id === req.params.id);
  if (idx < 0) return res.status(404).json({ error: 'Not found' });

  const patch = sanitizeTrackerEntry(req.body);
  // Don't allow changing the id via PATCH
  delete patch.id;

  trackerData[idx] = { ...trackerData[idx], ...patch, updatedAt: new Date().toISOString() };

  try {
    saveTracker(trackerData);
    res.json({ success: true, entry: trackerData[idx] });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/tracker/:id
app.delete('/api/tracker/:id', (req, res) => {
  trackerData = loadTracker();
  const before = trackerData.length;
  trackerData = trackerData.filter(e => e.id !== req.params.id);
  if (trackerData.length === before) {
    return res.status(404).json({ error: 'Not found' });
  }

  try {
    saveTracker(trackerData);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Health check ─────────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    key: process.env.ANTHROPIC_API_KEY ? 'set' : 'MISSING',
    tracker_count: loadTracker().length,
    version: '2.1.0'
  });
});

// ─── SPA fallback ─────────────────────────────────────────────────────────────
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// ─── Start ────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\nJobFlow v2.2 running at http://localhost:${PORT}`);
  console.log(`Tracker: ${loadTracker().length} applications loaded`);
  if (!process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY.includes('your_')) {
    console.warn('WARNING: ANTHROPIC_API_KEY not set — AI pipeline will not work');
  } else {
    console.log('Anthropic API: connected');
  }
  if (!process.env.RAPIDAPI_KEY || process.env.RAPIDAPI_KEY.includes('your_')) {
    console.warn('WARNING: RAPIDAPI_KEY not set — live job search will not work');
    console.warn('  Get a free key at: https://rapidapi.com/letscrape-6bRBa3QguO5/api/jsearch');
  } else {
    console.log('JSearch API: connected (live job listings)');
  }
  console.log(`\nFeatures: Live job search | SSE streaming | Kanban tracker | Apply helper (manual)\n`);
});

module.exports = app;
