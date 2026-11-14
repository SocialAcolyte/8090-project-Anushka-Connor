// Generate weeks of synthetic usage against a running legacy-plant server, so the watcher's
// event log contains the COMMON flow hundreds of times and the RARE month-end bulk flow only
// a couple of times. That spread is the whole point: a single screen recording would never
// capture the month-end flow — the long-term watcher does.
//
//   node server.js            # in one terminal
//   node simulate.js          # in another
//
// Then GET /api/events to see what the pipeline clusters over.

const BASE = process.env.BASE || "http://localhost:7090";
const DAYS = +(process.env.DAYS || 21);

async function post(pathname, body) {
  const r = await fetch(BASE + pathname, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return r.json();
}

async function main() {
  const state = await (await fetch(BASE + "/api/state")).json();
  const accounts = state.accounts.map((a) => a.id);
  const parts = state.parts.map((p) => p.id);
  let single = 0,
    bulk = 0;

  for (let day = 1; day <= DAYS; day++) {
    // common flow: a handful of single orders every day
    const n = 6 + Math.floor(Math.random() * 6);
    for (let i = 0; i < n; i++) {
      await post("/api/order", {
        accountId: accounts[Math.floor(Math.random() * accounts.length)],
        partId: parts[Math.floor(Math.random() * parts.length)],
        qty: 1 + Math.floor(Math.random() * 3),
      });
      single++;
    }
    // rare flow: month-end bulk approval only on the last day of each month (~day 21)
    if (day === DAYS) {
      for (const acct of accounts) {
        await post("/api/bulk-approve", { accountId: acct, partIds: parts, approvedBy: "operator" });
        bulk++;
      }
    }
  }
  console.log(`simulated ${DAYS} days: ${single} single orders, ${bulk} month-end bulk approvals`);
}

main();
