const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3456;

// ─── Database: graceful fallback ───
let db;
try {
  db = require('./database');
  console.log('SQLite database loaded successfully');
} catch (e) {
  console.error('Database load failed, using in-memory fallback:', e.message);
  const Database = require('better-sqlite3');
  db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS vehicles (id INTEGER PRIMARY KEY AUTOINCREMENT, plate TEXT NOT NULL UNIQUE, driver_name TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'idle', location TEXT, destination TEXT, cargo TEXT, eta TEXT, rest_hours REAL DEFAULT 0, notes TEXT, created_at TEXT DEFAULT (datetime('now','localtime')), updated_at TEXT DEFAULT (datetime('now','localtime')));
    CREATE TABLE IF NOT EXISTS repairs (id INTEGER PRIMARY KEY AUTOINCREMENT, vehicle_id INTEGER, plate TEXT NOT NULL, driver_name TEXT NOT NULL, issue TEXT NOT NULL, location TEXT, cost_level TEXT NOT NULL DEFAULT 'medium', cost_label TEXT, photo_url TEXT, voice_note TEXT, status TEXT NOT NULL DEFAULT 'pending', approver TEXT, notes TEXT, created_at TEXT DEFAULT (datetime('now','localtime')), updated_at TEXT DEFAULT (datetime('now','localtime')));
    CREATE TABLE IF NOT EXISTS receipts (id INTEGER PRIMARY KEY AUTOINCREMENT, vehicle_id INTEGER, plate TEXT NOT NULL, driver_name TEXT NOT NULL, order_no TEXT, customer TEXT, photo_url TEXT, status TEXT NOT NULL DEFAULT 'submitted', created_at TEXT DEFAULT (datetime('now','localtime')));
    CREATE TABLE IF NOT EXISTS stats (id INTEGER PRIMARY KEY AUTOINCREMENT, date TEXT NOT NULL UNIQUE, total_vehicles INTEGER DEFAULT 0, idle_count INTEGER DEFAULT 0, transit_count INTEGER DEFAULT 0, repair_count INTEGER DEFAULT 0, completed_orders INTEGER DEFAULT 0, created_at TEXT DEFAULT (datetime('now','localtime')));
  `);
  // Seed
  const insert = db.prepare('INSERT OR IGNORE INTO vehicles (plate, driver_name, status, location, destination, cargo, eta, rest_hours) VALUES (?,?,?,?,?,?,?,?)');
  [['京A12345','赵师傅','idle','深圳',null,null,null,2],['京A12346','王师傅','idle','广州',null,null,null,0.5],['京A12347','刘师傅','idle','杭州',null,null,null,0],['京B23456','李师傅','transit','G15高速','北京','电子产品','04/16 08:00',0],['京B23457','陈师傅','transit','G60高速','广州','家电','04/15 22:00',0],['京B23458','周师傅','transit','G42高速','武汉','日用品','04/15 14:00',0],['京C34567','张师傅','repair','陈厂长修理厂',null,null,'04/15 18:00',0],['京C34568','吴师傅','repair','刘厂长修理厂',null,null,'04/16',0]].forEach(v => insert.run(...v));
}

// Health check for Render
app.get('/health', (req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Clean URL routes
app.get('/driver', (req, res) => res.sendFile(path.join(__dirname, 'public', 'driver.html')));
app.get('/dispatcher', (req, res) => res.sendFile(path.join(__dirname, 'public', 'dispatcher.html')));
app.get('/boss', (req, res) => res.sendFile(path.join(__dirname, 'public', 'boss.html')));

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

  // Auto-log to finances
  const costMap = { low: 300, medium: 1250, high: 5000, emergency: 8000 };
  const estAmount = costMap[cost_level] || 1250;
  db.prepare(`INSERT INTO finances (type, amount, plate, driver_name, description, category, related_id) VALUES ('repair', ?, ?, ?, ?, '维修费用', ?)`)
    .run(estAmount, plate, driver_name, issue + ' · ' + (cost_label || ''), result.lastInsertRowid);

  res.status(201).json(row);
});

app.put('/api/repairs/:id', (req, res) => {
  const { status, approver, notes } = req.body;
  db.prepare(`UPDATE repairs SET status=?, approver=?, notes=?, updated_at=datetime('now','localtime') WHERE id=?`)
    .run(status, approver, notes, req.params.id);

  // If approved and vehicle still in repair, set back to idle
  if (status === 'approved') {
    const repair = db.prepare('SELECT * FROM repairs WHERE id = ?').get(req.params.id);
    if (repair) {
      db.prepare(`UPDATE vehicles SET status='idle', updated_at=datetime('now','localtime') WHERE plate=? AND status='repair'`).run(repair.plate);
      // Update finance record to confirmed
      db.prepare(`UPDATE finances SET status = 'confirmed' WHERE related_id = ? AND type = 'repair'`).run(req.params.id);
    }
  }
  if (status === 'rejected') {
    db.prepare(`UPDATE finances SET status = 'cancelled' WHERE related_id = ? AND type = 'repair'`).run(req.params.id);
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

// ─── ORDERS ───
app.get('/api/orders', (req, res) => {
  const { status } = req.query;
  let rows;
  if (status) {
    rows = db.prepare('SELECT * FROM orders WHERE status = ? ORDER BY created_at DESC').all(status);
  } else {
    rows = db.prepare('SELECT * FROM orders ORDER BY created_at DESC').all();
  }
  res.json(rows);
});

app.post('/api/orders/:id/assign', (req, res) => {
  const { plate, driver_name } = req.body;
  // Assign order to vehicle
  db.prepare(`UPDATE orders SET vehicle_id = (SELECT id FROM vehicles WHERE plate = ?), plate = ?, driver_name = ?, status = 'assigned', updated_at = datetime('now','localtime') WHERE id = ?`)
    .run(plate, plate, driver_name, req.params.id);
  // Update vehicle status to transit
  db.prepare(`UPDATE vehicles SET status = 'transit', destination = (SELECT destination FROM orders WHERE id = ?), cargo = (SELECT cargo FROM orders WHERE id = ?), updated_at = datetime('now','localtime') WHERE plate = ?`)
    .run(req.params.id, req.params.id, plate);
  updateStats();
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
  res.json(order);
});

app.put('/api/orders/:id', (req, res) => {
  const { status } = req.body;
  db.prepare(`UPDATE orders SET status = ?, updated_at = datetime('now','localtime') WHERE id = ?`)
    .run(status, req.params.id);
  if (status === 'completed') {
    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
    if (order && order.plate) {
      db.prepare(`UPDATE vehicles SET status = 'idle', destination = NULL, cargo = NULL, updated_at = datetime('now','localtime') WHERE plate = ?`).run(order.plate);
    }
    // Log order revenue to finances
    if (order) {
      db.prepare(`INSERT INTO finances (type, amount, plate, driver_name, description, category, related_id, status) VALUES ('order', ?, ?, ?, ?, '运费收入', ?, 'confirmed')`)
        .run(order.value || 0, order.plate, order.driver_name, order.cargo + ' · ' + order.origin + '→' + order.destination, order.id);
    }
    // Increment completed orders in stats
    const today = new Date().toISOString().slice(0, 10);
    db.prepare(`UPDATE stats SET completed_orders = completed_orders + 1 WHERE date = ?`).run(today);
  }
  updateStats();
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
  res.json(order);
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

// ─── FINANCES ───
app.get('/api/finances', (req, res) => {
  const { type, month } = req.query;
  let sql = 'SELECT * FROM finances WHERE 1=1';
  const params = [];
  if (type) { sql += ' AND type = ?'; params.push(type); }
  if (month) { sql += " AND strftime('%Y-%m', created_at) = ?"; params.push(month); }
  sql += ' ORDER BY created_at DESC';
  const rows = db.prepare(sql).all(...params);
  res.json(rows);
});

app.get('/api/finances/summary', (req, res) => {
  const repair = db.prepare("SELECT COALESCE(SUM(amount), 0) as total, COUNT(*) as count FROM finances WHERE type = 'repair' AND status != 'cancelled'").get();
  const order = db.prepare("SELECT COALESCE(SUM(amount), 0) as total, COUNT(*) as count FROM finances WHERE type = 'order' AND status = 'confirmed'").get();
  const pendingRepair = db.prepare("SELECT COALESCE(SUM(amount), 0) as total, COUNT(*) as count FROM finances WHERE type = 'repair' AND status = 'recorded'").get();
  // Monthly breakdown
  const monthly = db.prepare("SELECT strftime('%Y-%m', created_at) as month, type, COALESCE(SUM(amount), 0) as total FROM finances WHERE status != 'cancelled' GROUP BY month, type ORDER BY month DESC LIMIT 12").all();
  res.json({
    totalRepairCost: repair.total,
    totalRepairCount: repair.count,
    totalOrderRevenue: order.total,
    totalOrderCount: order.count,
    pendingRepairCost: pendingRepair.total,
    pendingRepairCount: pendingRepair.count,
    netProfit: order.total - repair.total,
    monthly
  });
});

// ─── START ───
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚛 极速车队 API 运行在端口 ${PORT}`);
});
