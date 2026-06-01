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
    voice_note TEXT,
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

  CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_no TEXT NOT NULL UNIQUE,
    cargo TEXT NOT NULL,
    origin TEXT NOT NULL,
    destination TEXT NOT NULL,
    customer TEXT,
    value REAL DEFAULT 0,
    vehicle_id INTEGER,
    plate TEXT,
    driver_name TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TEXT DEFAULT (datetime('now', 'localtime')),
    updated_at TEXT DEFAULT (datetime('now', 'localtime')),
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

// Seed default orders if empty
const orderCount = db.prepare('SELECT COUNT(*) as c FROM orders').get();
if (orderCount.c === 0) {
  const insertOrder = db.prepare(`INSERT INTO orders (order_no, cargo, origin, destination, customer, value, status) VALUES (?, ?, ?, ?, ?, ?, ?)`);
  const orders = [
    ['V2026060101', '电子产品',  '上海', '成都', '华为技术有限公司', 8500,  'pending'],
    ['V2026060102', '日用品',    '广州', '昆明', '京东物流',         3200,  'pending'],
    ['V2026060103', '生鲜食品',  '北京', '沈阳', '盒马鲜生',         5800,  'pending'],
    ['V2026060104', '建材',      '深圳', '厦门', '万科地产',         12000, 'pending'],
    ['V2026060105', '家具',      '杭州', '南京', '宜家家居',         6500,  'pending'],
    ['V2026060106', '汽车配件',  '天津', '郑州', '比亚迪汽车',       15000, 'pending'],
    ['V2026060107', '医疗器械',  '成都', '重庆', '国药集团',         9800,  'pending'],
  ];
  for (const o of orders) {
    insertOrder.run(...o);
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
