# Legacy Plant: demo fixture

A **synthetic** plant maintenance-ordering system, styled as late-90s industrial software. It is not real and is not taken from any real facility. It exists so Forward Deployed 8090 has a legacy target whose business rules we know, so we can measure whether a rebuild keeps them.

Zero dependencies (Node 22.5+ for the built-in SQLite):

```
node seed-history.js --reset   # 30 days of past orders and request-log lines
node server.js                 # http://localhost:7090
```

## What a rebuild must preserve

1. **Negotiated rate.** An enterprise account pays `listPrice * (1 - rate/100)`: Fermi Station 10%, Hansen Plant 15%, Acme Grid none. It must hold on **both** the single-order flow and the month-end bulk-approval flow. The UI never shows the rate.
2. **Retry safety.** A `POST /api/order` with a repeated `Idempotency-Key` returns the original order instead of creating a second order and charge.

## What the system records (what `watch` reads)

There is no special instrumentation. Like a real legacy system, it keeps:

- **`data/plant.db`** (SQLite): `accounts`, `parts`, `orders` and `idempotency_keys`. Each order stores list price, unit price charged and amount. Month-end orders share a `batch_id`.
- **`data/access.log`**: one JSON line per write request (time, method, path, status, body).

`seed-history.js` fills both with 30 days of activity (Oct 14 to Nov 12): single orders every working day (172 of them) and one month-end close on Fri Oct 30 (3 bulk approvals, one per account). The month-end flow is rare, but it's already in the data on day one, which is what `watch` backfills from.

## Files

| File | What it is |
| --- | --- |
| `plant.js` | Database schema and business logic, including the negotiated rate and retry safety |
| `server.js` | HTTP server and request log |
| `public/index.html` | Late-90s work-order entry UI |
| `seed.json` | Synthetic accounts and parts |
| `seed-history.js` | Writes 30 days of backdated history, the same on every run |

## Endpoints

- `GET /api/state`: accounts and parts
- `POST /api/order`: single order; honours `Idempotency-Key`
- `POST /api/bulk-approve`: month-end bulk approval
- `GET /api/orders`: all orders
