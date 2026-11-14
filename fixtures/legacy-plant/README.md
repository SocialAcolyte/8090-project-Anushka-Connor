# Legacy Plant — demo fixture

A **synthetic** plant maintenance-ordering system, styled as 1990s industrial software. It is not real and is not taken from any real facility. It exists so the Forward Deployed 8090 pipeline has a legacy target whose hidden business rules we control, so the regression in the demo is real and reproducible.

Zero dependencies. `node server.js`, then open http://localhost:7090.

## The business rules a rebuild must preserve

1. **Negotiated rate.** An enterprise account pays `listPrice * (1 - negotiatedRatePct/100)`. In the seed data Fermi Station gets 10% off and Hansen Plant 15%. This rule must hold on **both** the single-order flow and the month-end bulk-approval flow.
2. **Retry safety.** A `POST /api/order` carrying a repeated `Idempotency-Key` returns the original order instead of creating a second order and a second charge. This is an approved policy, not something inferred from a recording.

## Why there are two flows

- **Single work order** is the common flow — hundreds of times across a watch period.
- **Month-end bulk approval** is the rare flow — a couple of times a month.

A short screen recording captures the common flow and misses the rare one. The in-app **watcher** (`probe()` in `server.js`, logging to `watch-log.jsonl`) captures both, over as long as you run it. The rebuilt app in the demo preserves the negotiated rate on single orders but silently drops it on the bulk path — the flow only the long-term watcher saw.

## Files

| File | What it is |
| --- | --- |
| `server.js` | The legacy app. Business logic, the two flows, and the `probe()` watcher. |
| `public/index.html` | Green-screen work-order terminal UI. |
| `seed.json` | Synthetic accounts (with negotiated rates) and parts. |
| `simulate.js` | Generates weeks of synthetic usage so the watch log has the common flow often and the rare flow rarely. |

## Endpoints

- `GET /api/state` — accounts and parts
- `POST /api/order` — single order; honours `Idempotency-Key`
- `POST /api/bulk-approve` — month-end bulk approval
- `GET /api/orders` — orders placed
- `GET /api/events` — the watcher's event log
