// SYNTHETIC legacy plant maintenance-ordering system: data and business logic.
// Not real software and not from any real facility.
//
// Like a real legacy system, it keeps its state in a database (SQLite) and writes a request
// log. There is no special instrumentation: `watch` reads what the system already records.
//
// The business meaning a rebuild must preserve:
//   1. NEGOTIATED RATE  an enterprise account pays listPrice * (1 - rate/100), on BOTH the
//                       single-order flow and the month-end bulk-approval flow.
//   2. RETRY SAFETY     a repeated Idempotency-Key never creates a second order or charge.

const fs = require("fs");
const path = require("path");
const { DatabaseSync } = require("node:sqlite");

const DATA_DIR = process.env.PLANT_DATA || path.join(__dirname, "data");

function open() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const db = new DatabaseSync(path.join(DATA_DIR, "plant.db"));
  db.exec(`
    CREATE TABLE IF NOT EXISTS accounts (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, negotiated_rate_pct REAL NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS parts (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, list_price_cents INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id TEXT NOT NULL REFERENCES accounts(id),
      part_id TEXT NOT NULL REFERENCES parts(id),
      qty INTEGER NOT NULL,
      list_price_cents INTEGER NOT NULL,
      unit_price_cents INTEGER NOT NULL,
      amount_cents INTEGER NOT NULL,
      batch_id TEXT,
      approved_by TEXT,
      created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS idempotency_keys (
      key TEXT PRIMARY KEY, order_id INTEGER NOT NULL);
  `);
  const count = db.prepare("SELECT COUNT(*) AS n FROM accounts").get().n;
  if (count === 0) {
    const seed = JSON.parse(fs.readFileSync(path.join(__dirname, "seed.json"), "utf8"));
    const a = db.prepare("INSERT INTO accounts (id, name, negotiated_rate_pct) VALUES (?, ?, ?)");
    for (const x of seed.accounts) a.run(x.id, x.name, x.negotiatedRatePct);
    const p = db.prepare("INSERT INTO parts (id, name, list_price_cents) VALUES (?, ?, ?)");
    for (const x of seed.parts) p.run(x.id, x.name, x.listPriceCents);
    // Order numbers start at WO-1001, as they did when the system went live.
    db.exec("INSERT INTO sqlite_sequence (name, seq) VALUES ('orders', 1000)");
  }
  return db;
}

const db = open();

function logRequest(entry) {
  fs.appendFileSync(path.join(DATA_DIR, "access.log"), JSON.stringify(entry) + "\n");
}

const toOrder = (r) =>
  r && {
    id: "WO-" + r.id,
    accountId: r.account_id,
    partId: r.part_id,
    qty: r.qty,
    listPriceCents: r.list_price_cents,
    unitPriceCents: r.unit_price_cents,
    amountCents: r.amount_cents,
    batchId: r.batch_id,
    approvedBy: r.approved_by,
    createdAt: r.created_at,
  };

function state() {
  return {
    accounts: db.prepare("SELECT id, name, negotiated_rate_pct AS negotiatedRatePct FROM accounts ORDER BY id").all(),
    parts: db.prepare("SELECT id, name, list_price_cents AS listPriceCents FROM parts ORDER BY id").all(),
  };
}

function orders() {
  return db.prepare("SELECT * FROM orders ORDER BY id").all().map(toOrder);
}

// The business rule.
function priceFor(account, part) {
  return Math.round(part.list_price_cents * (1 - account.negotiated_rate_pct / 100));
}

function placeOrder({ accountId, partId, qty = 1, batchId = null, approvedBy = null, now = new Date() }) {
  const account = db.prepare("SELECT * FROM accounts WHERE id = ?").get(accountId);
  const part = db.prepare("SELECT * FROM parts WHERE id = ?").get(partId);
  if (!account || !part) throw new Error("unknown account or part");
  qty = Math.max(1, Math.floor(qty));
  const unit = priceFor(account, part);
  const info = db
    .prepare(
      `INSERT INTO orders (account_id, part_id, qty, list_price_cents, unit_price_cents, amount_cents, batch_id, approved_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(accountId, partId, qty, part.list_price_cents, unit, unit * qty, batchId, approvedBy, now.toISOString());
  return toOrder(db.prepare("SELECT * FROM orders WHERE id = ?").get(info.lastInsertRowid));
}

function placeOrderOnce(key, body, now) {
  if (key) {
    const hit = db.prepare("SELECT order_id FROM idempotency_keys WHERE key = ?").get(key);
    if (hit) return { order: toOrder(db.prepare("SELECT * FROM orders WHERE id = ?").get(hit.order_id)), replayed: true };
  }
  const order = placeOrder({ ...body, now });
  if (key) db.prepare("INSERT INTO idempotency_keys (key, order_id) VALUES (?, ?)").run(key, Number(order.id.slice(3)));
  return { order, replayed: false };
}

// Month-end: one approved order per part, all sharing a batch id.
function bulkApprove({ accountId, partIds = [], approvedBy = "OPERATOR", now = new Date() }) {
  const batchId = "ME-" + now.toISOString().slice(0, 10) + "-" + accountId;
  return partIds.map((partId) => placeOrder({ accountId, partId, qty: 1, batchId, approvedBy, now }));
}

module.exports = { db, DATA_DIR, logRequest, state, orders, placeOrderOnce, bulkApprove };
