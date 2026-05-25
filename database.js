const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, 'fleet.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS vehicles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    plate TEXT NOT NULL UNIQUE,
    driver_name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'idle',
    location TEXT,
    destination TEXT,
    cargo TEXT,
    eta TEXT,
    rest_hours REAL DEFAULT 0,
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now', 'localtime')),
    updated_at TEXT DEFAULT (datetime('now', 'localtime'))
  );

  CREATE TABLE IF NOT EXISTS repairs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    vehicle_id INTEGER,
    plate TEXT NOT NULL,
    driver_name TEXT NOT NULL,
    issue TEXT NOT NULL,
    location TEXT,
    cost_level TEXT NOT NULL DEFAULT 'medium',
    cost_label TEXT,
    photo_url TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    approver TEXT,
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now', 'localtime')),
    updated_at TEXT DEFAULT (datetime('now', 'localtime')),
    FOREIGN KEY (vehicle_id) REFERENCES vehicles(id)
  );

  CREATE TABLE IF NOT EXISTS receipts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    vehicle_id INTEGER,
    plate TEXT NOT NULL,
    driver_name TEXT NOT NULL,
    order_no TEXT,
    customer TEXT,
    photo_url TEXT,
    status TEXT NOT NULL DEFAULT 'submitted',
    created_at TEXT DEFAULT (datetime('now', 'localtime')),
    FOREIGN KEY (vehicle_id) REFERENCES vehicles(id)
  );

  CREATE TABLE IF NOT EXISTS stats (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL UNIQUE,
    total_vehicles INTEGER DEFAULT 0,
    idle_count INTEGER DEFAULT 0,
    transit_count INTEGER DEFAULT 0,
    repair_count INTEGER DEFAULT 0,
    completed_orders INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now', 'localtime'))
  );
`);

// Seed default vehicles if empty
const count = db.prepare('SELECT COUNT(*) as c FROM vehicles').get();
if (count.c === 0) {
  const insert = db.prepare(`INSERT INTO vehicles (plate, driver_name, status, location, destination, cargo, eta, rest_hours) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
  const vehicles = [
    ['京A12345', '赵师傅', 'idle',     '深圳', null,   null,       null, 2.0],
    ['京A12346', '王师傅', 'idle',     '广州', null,   null,       null, 0.5],
    ['京A12347', '刘师傅', 'idle',     '杭州', null,   null,       null, 0],
    ['京B23456', '李师傅', 'transit',  'G15高速', '北京', '电子产品', '04/16 08:00', 0],
    ['京B23457', '陈师傅', 'transit',  'G60高速', '广州', '家电',     '04/15 22:00', 0],
    ['京B23458', '周师傅', 'transit',  'G42高速', '武汉', '日用品',   '04/15 14:00', 0],
    ['京C34567', '张师傅', 'repair',   '陈厂长修理厂', null, null,   '04/15 18:00', 0],
    ['京C34568', '吴师傅', 'repair',   '刘厂长修理厂', null, null,   '04/16', 0],
  ];
  for (const v of vehicles) {
    insert.run(...v);
  }
}

// Seed today's stats if not present
const today = new Date().toISOString().slice(0, 10);
const statCount = db.prepare('SELECT COUNT(*) as c FROM stats WHERE date = ?').get(today);
if (statCount.c === 0) {
  db.prepare(`INSERT INTO stats (date, total_vehicles, idle_count, transit_count, repair_count, completed_orders)
    VALUES (?, 8, 3, 3, 2, 12)`).run(today);
}

module.exports = db;
