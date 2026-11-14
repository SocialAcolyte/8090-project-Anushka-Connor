// SYNTHETIC legacy plant maintenance-ordering system — demo fixture for Forward Deployed 8090.
// Not real software and not from any real facility. It exists so the pipeline has a legacy
// target whose hidden business rules WE control.
//
// The business meaning that must survive a rebuild:
//   1. NEGOTIATED RATE  — an enterprise account pays listPrice * (1 - negotiatedRatePct/100).
//                         This must apply on BOTH the single-order flow AND the month-end
//                         bulk-approval flow. The bulk flow is the rare one a short recording
//                         misses, which is why the long-term watcher matters.
//   2. RETRY SAFETY     — a POST carrying the same Idempotency-Key never creates a second order
//                         or a second charge. (Approved policy, not inferred from video.)
//
// The in-app WATCHER is probe(): every business operation and state change is appended to the
// event log. That structured log — not raw video — is what the pipeline reasons over across
// days or weeks. Zero dependencies: `node server.js`.

const http = require("http");
const fs = require("fs");
const path = require("path");

const DIR = __dirname;
const PORT = process.env.PORT || 7090;
const WATCH_LOG = process.env.WATCH_LOG || path.join(DIR, "watch-log.jsonl");

const seed = JSON.parse(fs.readFileSync(path.join(DIR, "seed.json"), "utf8"));
const accounts = new Map(seed.accounts.map((a) => [a.id, a]));
const parts = new Map(seed.parts.map((p) => [p.id, p]));

const db = { orders: [], charges: [], idempotency: new Map() };
let seq = 1000;

// --- the in-app watcher -----------------------------------------------------
function probe(operation, data) {
  const event = { ts: new Date().toISOString(), operation, ...data };
  try {
    fs.appendFileSync(WATCH_LOG, JSON.stringify(event) + "\n");
  } catch (_) {}
  return event;
}

// --- the business rule (the thing a rebuild must not silently drop) ---------
function priceFor(account, part) {
  const pct = account.negotiatedRatePct || 0;
  return Math.round(part.listPriceCents * (1 - pct / 100));
}

function placeOrder({ accountId, partId, qty, approvedBy }) {
  const account = accounts.get(accountId);
  const part = parts.get(partId);
  if (!account || !part) throw new Error("unknown account or part");
  const unit = priceFor(account, part);
  const amountCents = unit * (qty || 1);
  const order = {
    id: "WO-" + ++seq,
    accountId,
    partId,
    qty: qty || 1,
    unitPriceCents: unit,
    listPriceCents: part.listPriceCents,
    amountCents,
    approvedBy: approvedBy || null,
    createdAt: new Date().toISOString(),
  };
  db.orders.push(order);
  db.charges.push({ orderId: order.id, accountId, amountCents });
  probe("order.created", {
    orderId: order.id,
    accountId,
    partId,
    listPriceCents: part.listPriceCents,
    unitPriceCents: unit,
    amountCents,
    negotiatedRateApplied: unit !== part.listPriceCents,
  });
  return order;
}

// --- tiny HTTP plumbing -----------------------------------------------------
function send(res, code, body, type = "application/json") {
  const payload = type === "application/json" ? JSON.stringify(body) : body;
  res.writeHead(code, { "Content-Type": type });
  res.end(payload);
}

function readBody(req) {
  return new Promise((resolve) => {
    let b = "";
    req.on("data", (c) => (b += c));
    req.on("end", () => {
      try {
        resolve(b ? JSON.parse(b) : {});
      } catch {
        resolve({});
      }
    });
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  const route = req.method + " " + url.pathname;

  if (route === "GET /") {
    return send(res, 200, fs.readFileSync(path.join(DIR, "public", "index.html"), "utf8"), "text/html");
  }
  if (route === "GET /api/state") {
    return send(res, 200, { accounts: [...accounts.values()], parts: [...parts.values()] });
  }
  if (route === "GET /api/orders") return send(res, 200, db.orders);
  if (route === "GET /api/events") {
    const log = fs.existsSync(WATCH_LOG) ? fs.readFileSync(WATCH_LOG, "utf8").trim() : "";
    return send(res, 200, log ? log.split("\n").map((l) => JSON.parse(l)) : []);
  }

  // Single work-order purchase — the COMMON flow.
  if (route === "POST /api/order") {
    const key = req.headers["idempotency-key"];
    if (key && db.idempotency.has(key)) {
      probe("order.retry.deduped", { idempotencyKey: key, orderId: db.idempotency.get(key).id });
      return send(res, 200, db.idempotency.get(key)); // retry safety: no second order/charge
    }
    const body = await readBody(req);
    try {
      const order = placeOrder(body);
      if (key) db.idempotency.set(key, order);
      return send(res, 201, order);
    } catch (e) {
      return send(res, 400, { error: e.message });
    }
  }

  // Month-end bulk approval — the RARE flow a short recording never captures.
  // The negotiated rate MUST apply here too.
  if (route === "POST /api/bulk-approve") {
    const body = await readBody(req);
    const orders = [];
    probe("bulk.approve.started", { accountId: body.accountId, count: (body.partIds || []).length });
    try {
      for (const partId of body.partIds || []) {
        orders.push(placeOrder({ accountId: body.accountId, partId, qty: 1, approvedBy: body.approvedBy }));
      }
    } catch (e) {
      return send(res, 400, { error: e.message });
    }
    probe("bulk.approve.completed", {
      accountId: body.accountId,
      orderIds: orders.map((o) => o.id),
      totalCents: orders.reduce((s, o) => s + o.amountCents, 0),
    });
    return send(res, 201, orders);
  }

  send(res, 404, { error: "not found" });
});

server.listen(PORT, () => console.log(`legacy-plant listening on http://localhost:${PORT}`));
