// Give the synthetic legacy system a past: 30 days of orders and request-log lines, written
// with their original timestamps, as if the plant had been running it all along.
//
//   node seed-history.js          # add history to the existing database
//   node seed-history.js --reset  # start from an empty database first
//
// Single work orders happen every working day. Month-end bulk approval happened once, on
// Fri Oct 30, once per account. That rare flow is already sitting in the data on day one, which
// is what `watch` backfills from. Random choices use a fixed seed, so every run is identical.

const fs = require("fs");
const path = require("path");

const DATA_DIR = process.env.PLANT_DATA || path.join(__dirname, "data");
if (process.argv.includes("--reset")) {
  for (const f of ["plant.db", "access.log"]) fs.rmSync(path.join(DATA_DIR, f), { force: true });
}

const plant = require("./plant");

let s = 8090;
const rand = () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648);
const pick = (xs) => xs[Math.floor(rand() * xs.length)];

const { accounts, parts } = plant.state();
const log = (ts, p, body, status) =>
  plant.logRequest({ ts: ts.toISOString(), method: "POST", path: p, status, ms: 20 + Math.floor(rand() * 60), body });

const DAYS = 30; // Oct 14 through Nov 12, local calendar days
let single = 0;
let bulk = 0;

for (let d = 0; d < DAYS; d++) {
  const day = new Date(2026, 9, 14 + d); // local midnight, safe across the Nov 1 clock change
  const weekday = day.getDay();
  if (weekday === 0 || weekday === 6) continue; // the plant office doesn't order on weekends

  const n = 5 + Math.floor(rand() * 7);
  for (let i = 0; i < n; i++) {
    const at = new Date(day.getTime() + (8 + rand() * 9) * 3600000);
    const body = { accountId: pick(accounts).id, partId: pick(parts).id, qty: 1 + Math.floor(rand() * 3) };
    plant.placeOrderOnce(null, body, at);
    log(at, "/api/order", body, 201);
    single++;
  }

  // Month-end close: Friday Oct 30, the last working day of October.
  if (day.getMonth() === 9 && day.getDate() === 30) {
    for (const a of accounts) {
      const at = new Date(day.getTime() + 16.5 * 3600000);
      const body = { accountId: a.id, partIds: parts.map((p) => p.id), approvedBy: "OPERATOR" };
      plant.bulkApprove({ ...body, now: at });
      log(at, "/api/bulk-approve", body, 201);
      bulk++;
    }
  }
}

console.log(`seeded ${single} single orders and ${bulk} month-end bulk approvals into ${DATA_DIR}`);
