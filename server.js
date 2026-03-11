const express = require('express');
const path = require('path');
const Database = require('better-sqlite3');
const QRCode = require('qrcode');
const { nanoid } = require('nanoid');

const app = express();
const PORT = process.env.PORT || 3000;
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;

// --- Database setup ---
const fs = require('fs');
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

// --- Middleware ---
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// --- Redirect route (this is what the QR codes point to) ---
app.get('/r/:id', (req, res) => {
  const row = db.prepare('SELECT destination_url FROM qrcodes WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).send('QR code not found');

  db.prepare('UPDATE qrcodes SET scans = scans + 1 WHERE id = ?').run(req.params.id);
  res.redirect(302, row.destination_url);
});

// --- API routes ---

// List all QR codes
app.get('/api/qrcodes', (req, res) => {
  const rows = db.prepare('SELECT * FROM qrcodes ORDER BY created_at DESC').all();
  res.json(rows);
});

// Create a new QR code
app.post('/api/qrcodes', async (req, res) => {
  const { name, destination_url } = req.body;
  if (!name || !destination_url) {
    return res.status(400).json({ error: 'name and destination_url are required' });
  }

  const id = nanoid(8);
  db.prepare('INSERT INTO qrcodes (id, name, destination_url) VALUES (?, ?, ?)').run(id, name, destination_url);

  const redirectUrl = `${BASE_URL}/r/${id}`;
  const qrDataUrl = await QRCode.toDataURL(redirectUrl, { width: 400, margin: 2 });

  res.status(201).json({ id, name, destination_url, redirect_url: redirectUrl, qr_data_url: qrDataUrl });
});

// Get QR code image
app.get('/api/qrcodes/:id/image', async (req, res) => {
  const row = db.prepare('SELECT id FROM qrcodes WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });

  const redirectUrl = `${BASE_URL}/r/${row.id}`;
  const qrDataUrl = await QRCode.toDataURL(redirectUrl, { width: 400, margin: 2 });
  res.json({ qr_data_url: qrDataUrl });
});

// Update destination URL
app.put('/api/qrcodes/:id', (req, res) => {
  const { name, destination_url } = req.body;
  const row = db.prepare('SELECT * FROM qrcodes WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });

  db.prepare(`UPDATE qrcodes SET name = ?, destination_url = ?, updated_at = datetime('now') WHERE id = ?`)
    .run(name || row.name, destination_url || row.destination_url, req.params.id);

  res.json({ success: true });
});

// Delete a QR code
app.delete('/api/qrcodes/:id', (req, res) => {
  const result = db.prepare('DELETE FROM qrcodes WHERE id = ?').run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Not found' });
  res.json({ success: true });
});

// --- Start server ---
app.listen(PORT, () => {
  console.log(`QR Generator running at ${BASE_URL}`);
});
