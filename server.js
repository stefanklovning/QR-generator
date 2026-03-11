const express = require('express');
const path = require('path');
const crypto = require('crypto');
const Database = require('better-sqlite3');
const QRCode = require('qrcode');
const { nanoid } = require('nanoid');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin';

// --- Database setup ---
const dbDir = process.env.DB_PATH || __dirname;
if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });
const db = new Database(path.join(dbDir, 'qrcodes.db'));
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS qrcodes (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    destination_url TEXT NOT NULL,
    scans INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  )
`);

// --- Rate limiting ---
const rateLimits = new Map();

function rateLimit(windowMs, maxRequests) {
  return (req, res, next) => {
    const ip = req.ip || req.connection.remoteAddress;
    const now = Date.now();
    const key = `${ip}:${req.route?.path || req.path}`;

    if (!rateLimits.has(key)) {
      rateLimits.set(key, []);
    }

    const timestamps = rateLimits.get(key).filter(t => now - t < windowMs);
    timestamps.push(now);
    rateLimits.set(key, timestamps);

    res.setHeader('X-RateLimit-Limit', maxRequests);
    res.setHeader('X-RateLimit-Remaining', Math.max(0, maxRequests - timestamps.length));

    if (timestamps.length > maxRequests) {
      return res.status(429).json({ error: 'Too many requests. Please try again later.' });
    }

    next();
  };
}

// Clean up old rate limit entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, timestamps] of rateLimits.entries()) {
    const filtered = timestamps.filter(t => now - t < 900000);
    if (filtered.length === 0) rateLimits.delete(key);
    else rateLimits.set(key, filtered);
  }
}, 300000);

// --- Admin auth middleware ---
function requireAdmin(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Basic ')) {
    res.setHeader('WWW-Authenticate', 'Basic realm="Admin"');
    return res.status(401).json({ error: 'Authentication required' });
  }

  const credentials = Buffer.from(authHeader.split(' ')[1], 'base64').toString();
  const [username, password] = credentials.split(':');

  if (username === 'admin' && crypto.timingSafeEqual(
    Buffer.from(password),
    Buffer.from(ADMIN_PASSWORD)
  )) {
    return next();
  }

  res.setHeader('WWW-Authenticate', 'Basic realm="Admin"');
  return res.status(401).json({ error: 'Invalid credentials' });
}

// --- Middleware ---
app.use(express.json());
app.set('trust proxy', true);

// Serve admin page at /admin
app.get('/admin', requireAdmin, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// Serve public page
app.use(express.static(path.join(__dirname, 'public')));

// --- Redirect route (this is what the QR codes point to) ---
app.get('/r/:id', rateLimit(60000, 60), (req, res) => {
  const row = db.prepare('SELECT destination_url FROM qrcodes WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).send('QR code not found');

  db.prepare('UPDATE qrcodes SET scans = scans + 1 WHERE id = ?').run(req.params.id);
  res.redirect(302, row.destination_url);
});

// --- Public API (only create, with strict rate limit) ---
app.post('/api/qrcodes', rateLimit(3600000, 10), async (req, res) => {
  const { name, destination_url } = req.body;
  if (!name || !destination_url) {
    return res.status(400).json({ error: 'name and destination_url are required' });
  }

  try {
    new URL(destination_url);
  } catch {
    return res.status(400).json({ error: 'Invalid URL' });
  }

  const id = nanoid(8);
  db.prepare('INSERT INTO qrcodes (id, name, destination_url) VALUES (?, ?, ?)').run(id, name, destination_url);

  const redirectUrl = `${BASE_URL}/r/${id}`;
  const qrDataUrl = await QRCode.toDataURL(redirectUrl, { width: 400, margin: 2 });

  res.status(201).json({ id, name, destination_url, redirect_url: redirectUrl, qr_data_url: qrDataUrl });
});

// --- Admin API (full CRUD, requires auth) ---

// List all QR codes
app.get('/api/admin/qrcodes', requireAdmin, (req, res) => {
  const rows = db.prepare('SELECT * FROM qrcodes ORDER BY created_at DESC').all();
  res.json(rows);
});

// Get QR code image
app.get('/api/admin/qrcodes/:id/image', requireAdmin, async (req, res) => {
  const row = db.prepare('SELECT id FROM qrcodes WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });

  const redirectUrl = `${BASE_URL}/r/${row.id}`;
  const qrDataUrl = await QRCode.toDataURL(redirectUrl, { width: 400, margin: 2 });
  res.json({ qr_data_url: qrDataUrl });
});

// Update destination URL
app.put('/api/admin/qrcodes/:id', requireAdmin, rateLimit(60000, 30), (req, res) => {
  const { name, destination_url } = req.body;
  const row = db.prepare('SELECT * FROM qrcodes WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });

  if (destination_url) {
    try { new URL(destination_url); } catch { return res.status(400).json({ error: 'Invalid URL' }); }
  }

  db.prepare(`UPDATE qrcodes SET name = ?, destination_url = ?, updated_at = datetime('now') WHERE id = ?`)
    .run(name || row.name, destination_url || row.destination_url, req.params.id);

  res.json({ success: true });
});

// Delete a QR code
app.delete('/api/admin/qrcodes/:id', requireAdmin, rateLimit(60000, 20), (req, res) => {
  const result = db.prepare('DELETE FROM qrcodes WHERE id = ?').run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Not found' });
  res.json({ success: true });
});

// --- Start server ---
app.listen(PORT, () => {
  console.log(`QR Generator running at ${BASE_URL}`);
  console.log(`Admin panel: ${BASE_URL}/admin`);
});
