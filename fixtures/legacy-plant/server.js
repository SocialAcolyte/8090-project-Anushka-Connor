// SYNTHETIC legacy plant maintenance-ordering system: HTTP server. Demo fixture only.
// `node server.js`, then open http://localhost:7090. Business logic lives in plant.js.

const http = require("http");
const fs = require("fs");
const path = require("path");
const plant = require("./plant");

const PORT = process.env.PORT || 7090;

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
  const started = Date.now();
  const url = new URL(req.url, "http://localhost");
  const route = req.method + " " + url.pathname;
  const body = req.method === "POST" ? await readBody(req) : undefined;

  const send = (code, payload, type = "application/json") => {
    res.writeHead(code, { "Content-Type": type });
    res.end(type === "application/json" ? JSON.stringify(payload) : payload);
    if (url.pathname.startsWith("/api/") && req.method === "POST") {
      plant.logRequest({ ts: new Date().toISOString(), method: req.method, path: url.pathname, status: code, ms: Date.now() - started, body });
    }
  };

  try {
    if (route === "GET /") return send(200, fs.readFileSync(path.join(__dirname, "public", "index.html"), "utf8"), "text/html");
    if (route === "GET /api/state") return send(200, plant.state());
    if (route === "GET /api/orders") return send(200, plant.orders());
    if (route === "POST /api/order") {
      const { order, replayed } = plant.placeOrderOnce(req.headers["idempotency-key"], body);
      return send(replayed ? 200 : 201, order);
    }
    if (route === "POST /api/bulk-approve") return send(201, plant.bulkApprove(body));
    send(404, { error: "not found" });
  } catch (e) {
    send(400, { error: e.message });
  }
});

server.listen(PORT, () => console.log(`legacy-plant listening on http://localhost:${PORT} (data: ${plant.DATA_DIR})`));
