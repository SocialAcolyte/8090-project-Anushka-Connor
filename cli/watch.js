// fd8090 watch: learn how a legacy system is used from what it already records.
//
// Reads the system's database and request log from the outside. No code changes, no agent
// installed in the app. On day one it backfills from existing history, so rare flows that
// happened weeks ago (month-end close) are already visible.
//
// Steps:
//   1. Discover tables and give columns roles: time, money, entity (foreign id), group (batch).
//   2. Read the request log.
//   3. Link each fact row to the request that created it (same moment, matching ids).
//   4. Summarise operations: how often, when, how many rows each produced.

const fs = require("fs");
const path = require("path");
const { DatabaseSync } = require("node:sqlite");

const ROLE_RULES = [
  ["time", (c) => /(_at|_time|timestamp|^ts)$/i.test(c)],
  ["money", (c) => /(_cents|price|amount|total)/i.test(c)],
  ["group", (c) => /(batch|group|run)_?id$/i.test(c)],
  ["entity", (c) => /_id$/i.test(c)],
  ["quantity", (c) => /^(qty|quantity|count)$/i.test(c)],
];

function roleOf(col, pk) {
  if (pk) return "key";
  for (const [role, test] of ROLE_RULES) if (test(col)) return role;
  return "attribute";
}

function readTables(db) {
  const names = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all()
    .map((r) => r.name);
  return names.map((name) => {
    const cols = db.prepare(`PRAGMA table_info("${name}")`).all();
    const columns = cols.map((c) => ({ name: c.name, type: c.type, role: roleOf(c.name, c.pk === 1) }));
    const rows = db.prepare(`SELECT COUNT(*) AS n FROM "${name}"`).get().n;
    const has = (role) => columns.some((c) => c.role === role);
    return { name, rows, columns, fact: has("time") && has("money") };
  });
}

function readLog(file) {
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line, i) => {
      const e = JSON.parse(line);
      return { id: i + 1, ts: e.ts, operation: `${e.method} ${e.path}`, status: e.status, body: e.body || {} };
    });
}

// A request created a row if it happened within `windowMs` of the row and every id the row
// carries that also appears in the request body matches.
function linkRowsToRequests(table, rows, requests, windowMs = 2000) {
  const timeCol = table.columns.find((c) => c.role === "time").name;
  const entityCols = table.columns.filter((c) => c.role === "entity").map((c) => c.name);
  const camel = (s) => s.replace(/_([a-z])/g, (_, ch) => ch.toUpperCase());
  const sorted = [...requests].sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));

  return rows.map((row) => {
    const t = Date.parse(row[timeCol]);
    let best = null;
    for (const r of sorted) {
      const dt = Math.abs(Date.parse(r.ts) - t);
      if (dt > windowMs) continue;
      const consistent = entityCols.every((col) => {
        const v = r.body[camel(col)];
        if (v === undefined) {
          const list = r.body[camel(col).replace(/Id$/, "Ids")];
          return list === undefined || (Array.isArray(list) && list.includes(row[col]));
        }
        return v === row[col];
      });
      if (consistent && (!best || dt < best.dt)) best = { id: r.id, dt };
    }
    return best ? best.id : null;
  });
}

function run(args) {
  const dir = args._[0] || ".";
  const dbFile = args.db || path.join(dir, "plant.db");
  const logFile = args.log || path.join(dir, "access.log");
  const outDir = args.out || "out";
  if (!fs.existsSync(dbFile)) throw new Error(`no database at ${dbFile}`);

  const db = new DatabaseSync(dbFile, { readOnly: true });
  const tables = readTables(db);
  const requests = readLog(logFile);

  const records = [];
  for (const table of tables.filter((t) => t.fact)) {
    const rows = db.prepare(`SELECT * FROM "${table.name}" ORDER BY rowid`).all();
    const links = linkRowsToRequests(table, rows, requests);
    rows.forEach((row, i) => records.push({ table: table.name, requestId: links[i], row: { ...row } }));
  }

  const byId = new Map(requests.map((r) => [r.id, r]));
  const ops = new Map();
  for (const r of requests) {
    const o = ops.get(r.operation) || { operation: r.operation, requests: 0, rows: 0, days: new Set(), first: r.ts, last: r.ts };
    o.requests++;
    o.days.add(r.ts.slice(0, 10));
    if (r.ts < o.first) o.first = r.ts;
    if (r.ts > o.last) o.last = r.ts;
    ops.set(r.operation, o);
  }
  for (const rec of records) {
    const req = rec.requestId && byId.get(rec.requestId);
    if (req) ops.get(req.operation).rows++;
  }

  const times = requests.map((r) => r.ts).sort();
  const totalRequests = requests.length || 1;
  const operations = [...ops.values()]
    .map((o) => ({
      operation: o.operation,
      requests: o.requests,
      rows: o.rows,
      activeDays: o.days.size,
      first: o.first,
      last: o.last,
      frequency: o.requests / totalRequests < 0.05 ? "rare" : "common",
    }))
    .sort((a, b) => b.requests - a.requests);

  const watch = {
    kind: "fd8090.watch",
    generatedAt: new Date().toISOString(),
    target: { db: path.resolve(dbFile), log: path.resolve(logFile) },
    method: "boundary backfill: database rows + request log, no changes to the legacy code",
    window: { from: times[0] || null, to: times[times.length - 1] || null },
    tables: tables.map(({ name, rows, columns, fact }) => ({ name, rows, fact, columns })),
    operations,
    requests,
    records,
    unlinkedRows: records.filter((r) => !r.requestId).length,
  };

  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, "watch.json");
  fs.writeFileSync(outFile, JSON.stringify(watch, null, 2));

  if (args.json) {
    console.log(JSON.stringify({ out: outFile, window: watch.window, operations, records: records.length, unlinkedRows: watch.unlinkedRows }));
    return;
  }
  const day = (s) => (s ? s.slice(0, 10) : "-");
  console.log(`watch: ${path.resolve(dbFile)}`);
  console.log(`  window   ${day(watch.window.from)} to ${day(watch.window.to)}`);
  console.log(`  tables   ${tables.map((t) => `${t.name}(${t.rows}${t.fact ? ", facts" : ""})`).join("  ")}`);
  console.log(`  records  ${records.length} fact rows, ${records.length - watch.unlinkedRows} linked to the request that created them`);
  console.log("  operations");
  for (const o of operations) {
    console.log(
      `    ${o.operation.padEnd(24)} ${String(o.requests).padStart(4)} requests  ${String(o.rows).padStart(4)} rows  ${String(o.activeDays).padStart(3)} days  ${o.frequency}`
    );
  }
  console.log(`  wrote ${outFile}`);
}

module.exports = { run };
