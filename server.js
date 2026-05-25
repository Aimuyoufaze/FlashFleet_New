const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const db = require('./database');

const app = express();
const PORT = process.env.PORT || 3456;

// Health check for Render
app.get('/health', (req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Clean URL routes
app.get('/driver', (req, res) => res.sendFile(path.join(__dirname, 'public', 'driver.html')));
app.get('/dispatcher', (req, res) => res.sendFile(path.join(__dirname, 'public', 'dispatcher.html')));

// File upload config
const storage = multer.diskStorage({
  destination: path.join(__dirname, 'public', 'uploads'),
  filename: (req, file, cb) => {
    cb(null, Date.now() + '-' + Math.round(Math.random() * 1e9) + path.extname(file.originalname));
  }
});
const upload = multer({ storage, limits: { fileSize: 10 * 1024 * 1024 } });

// ─── VEHICLES ───
app.get('/api/vehicles', (req, res) => {
  const { status } = req.query;
  let rows;
  if (status) {
    rows = db.prepare('SELECT * FROM vehicles WHERE status = ? ORDER BY updated_at DESC').all(status);
  } else {
    rows = db.prepare('SELECT * FROM vehicles ORDER BY status, updated_at DESC').all();
  }
  res.json(rows);
});

app.get('/api/vehicles/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM vehicles WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: '未找到车辆' });
  res.json(row);
});

app.put('/api/vehicles/:id', (req, res) => {
  const { status, location, destination, cargo, eta, rest_hours, notes } = req.body;
  db.prepare(`UPDATE vehicles SET status=?, location=?, destination=?, cargo=?, eta=?, rest_hours=?, notes=?, updated_at=datetime('now','localtime') WHERE id=?`)
    .run(status, location, destination, cargo, eta, rest_hours, notes, req.params.id);
  const row = db.prepare('SELECT * FROM vehicles WHERE id = ?').get(req.params.id);
  updateStats();
  res.json(row);
});

// ─── REPAIRS ───
app.get('/api/repairs', (req, res) => {
  const { status } = req.query;
  let rows;
  if (status) {
    rows = db.prepare('SELECT * FROM repairs WHERE status = ? ORDER BY created_at DESC').all(status);
  } else {
    rows = db.prepare('SELECT * FROM repairs ORDER BY created_at DESC').all();
  }
  res.json(rows);
});

app.post('/api/repairs', upload.single('photo'), (req, res) => {
  const { plate, driver_name, issue, location, cost_level, cost_label, voice_note } = req.body;
  const photo_url = req.file ? '/uploads/' + req.file.filename : null;
  const result = db.prepare(`INSERT INTO repairs (plate, driver_name, issue, location, cost_level, cost_label, photo_url, voice_note) VALUES (?,?,?,?,?,?,?,?)`)
    .run(plate, driver_name, issue, location, cost_level, cost_label, photo_url, voice_note || null);

  // Update vehicle status to repair
  db.prepare(`UPDATE vehicles SET status='repair', updated_at=datetime('now','localtime') WHERE plate=? AND status != 'repair'`).run(plate);
  updateStats();

  const row = db.prepare('SELECT * FROM repairs WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json(row);
});

app.put('/api/repairs/:id', (req, res) => {
  const { status, approver, notes } = req.body;
  db.prepare(`UPDATE repairs SET status=?, approver=?, notes=?, updated_at=datetime('now','localtime') WHERE id=?`)
    .run(status, approver, notes, req.params.id);

  // If approved and vehicle still in repair, set back to idle
  if (status === 'approved') {
    const repair = db.prepare('SELECT plate FROM repairs WHERE id = ?').get(req.params.id);
    if (repair) {
      db.prepare(`UPDATE vehicles SET status='idle', updated_at=datetime('now','localtime') WHERE plate=? AND status='repair'`).run(repair.plate);
    }
  }
  updateStats();

  const row = db.prepare('SELECT * FROM repairs WHERE id = ?').get(req.params.id);
  res.json(row);
});

// DELETE repair
app.delete('/api/repairs/:id', (req, res) => {
  db.prepare('DELETE FROM repairs WHERE id = ?').run(req.params.id);
  updateStats();
  res.json({ success: true });
});

// ─── RECEIPTS ───
app.get('/api/receipts', (req, res) => {
  const rows = db.prepare('SELECT * FROM receipts ORDER BY created_at DESC').all();
  res.json(rows);
});

app.post('/api/receipts', upload.single('photo'), (req, res) => {
  const { plate, driver_name, order_no, customer } = req.body;
  const photo_url = req.file ? '/uploads/' + req.file.filename : null;
  const result = db.prepare(`INSERT INTO receipts (plate, driver_name, order_no, customer, photo_url) VALUES (?,?,?,?,?)`)
    .run(plate, driver_name, order_no, customer, photo_url);
  const row = db.prepare('SELECT * FROM receipts WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json(row);
});

// ─── STATS ───
app.get('/api/stats', (req, res) => {
  const today = new Date().toISOString().slice(0, 10);
  let row = db.prepare('SELECT * FROM stats WHERE date = ?').get(today);
  if (!row) {
    row = { date: today, total_vehicles: 0, idle_count: 0, transit_count: 0, repair_count: 0, completed_orders: 0 };
  }
  // Add pending repairs count
  const pendingRepairs = db.prepare("SELECT COUNT(*) as c FROM repairs WHERE status = 'pending'").get();
  row.pending_repairs = pendingRepairs.c;
  res.json(row);
});

function updateStats() {
  const today = new Date().toISOString().slice(0, 10);
  const idle = db.prepare("SELECT COUNT(*) as c FROM vehicles WHERE status='idle'").get();
  const transit = db.prepare("SELECT COUNT(*) as c FROM vehicles WHERE status='transit'").get();
  const repair = db.prepare("SELECT COUNT(*) as c FROM vehicles WHERE status='repair'").get();
  const total = db.prepare("SELECT COUNT(*) as c FROM vehicles").get();
  db.prepare(`INSERT INTO stats (date, total_vehicles, idle_count, transit_count, repair_count)
    VALUES (?,?,?,?,?)
    ON CONFLICT(date) DO UPDATE SET total_vehicles=?, idle_count=?, transit_count=?, repair_count=?`)
    .run(today, total.c, idle.c, transit.c, repair.c, total.c, idle.c, transit.c, repair.c);
}

// ─── START ───
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚛 极速车队 API 运行在端口 ${PORT}`);
});
