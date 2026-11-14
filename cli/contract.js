// fd8090 contract: find business rules in watch data and write proposed behavior contracts.
//
// Deterministic: the same watch data always gives the same contract, so verify results are
// reproducible. Every claim is backed by row ids or request ids in `evidence`, and the
// contract keeps observed facts, inferences, human approvals and unknowns apart.
//
// Rules found today:
//   price-ratio  for some entity column (e.g. account_id), charged unit price is a fixed
//                fraction of list price, and that fraction holds on every operation.

const fs = require("fs");
const path = require("path");

const camel = (s) => s.replace(/_([a-z])/g, (_, ch) => ch.toUpperCase());
const pct = (x) => Math.round(x * 10000) / 100;

function priceColumns(table) {
  const money = table.columns.filter((c) => c.role === "money").map((c) => c.name);
  const list = money.find((c) => /list/i.test(c));
  const unit = money.find((c) => /unit/i.test(c));
  const amount = money.find((c) => /amount|total/i.test(c));
  return list && unit ? { list, unit, amount } : null;
}

// For which entity column is unit/list constant inside every group (and not 1 everywhere)?
function findRatioColumn(table, recs, cols) {
  const entities = table.columns.filter((c) => c.role === "entity").map((c) => c.name);
  for (const col of entities) {
    const groups = new Map();
    for (const r of recs) {
      const k = r.row[col];
      const ratio = r.row[cols.unit] / r.row[cols.list];
      const g = groups.get(k) || { min: Infinity, max: -Infinity, n: 0 };
      g.min = Math.min(g.min, ratio);
      g.max = Math.max(g.max, ratio);
      g.n++;
      groups.set(k, g);
    }
    // Rounding to whole cents can move a ratio by up to 0.5 cent / list price.
    const minList = Math.min(...recs.map((r) => r.row[cols.list]));
    const tolerance = 1 / minList + 1e-9;
    const constant = [...groups.values()].every((g) => g.max - g.min <= tolerance);
    const varies = new Set([...groups.values()].map((g) => pct(g.min))).size > 1;
    if (constant && varies) return { col, groups };
  }
  return null;
}

function buildPriceRatioContract(watch, table) {
  const cols = priceColumns(table);
  if (!cols) return null;
  const recs = watch.records.filter((r) => r.table === table.name && r.requestId);
  const found = findRatioColumn(table, recs, cols);
  if (!found) return null;

  const reqById = new Map(watch.requests.map((r) => [r.id, r]));
  const opOf = (rec) => reqById.get(rec.requestId).operation;
  const opsInfo = new Map(watch.operations.map((o) => [o.operation, o]));
  const entityCol = found.col;
  const entityKey = camel(entityCol);
  const partCol = table.columns.find((c) => c.role === "entity" && c.name !== entityCol)?.name;
  const qtyCol = table.columns.find((c) => c.role === "quantity")?.name;

  // Rate per entity value.
  const rates = {};
  for (const [value, g] of found.groups) rates[value] = { ratePct: Math.round((1 - g.min) * 1000) / 10 };
  const entities = Object.keys(rates).sort();

  // Workflows: every operation that wrote rows to this table.
  const ops = [...new Set(recs.map(opOf))].sort((a, b) => opsInfo.get(b).requests - opsInfo.get(a).requests);
  const slug = (op) => op.replace(/^[A-Z]+ \/(api\/)?/, "").replace(/[^a-z0-9]+/gi, "-").toLowerCase();
  const workflows = ops.map((op) => {
    const o = opsInfo.get(op);
    return { id: slug(op), operation: op, observed: o.requests, firstSeen: o.first, lastSeen: o.last, frequency: o.frequency };
  });

  const expectRow = (entity, row) => {
    const unit = Math.round(row[cols.list] * (1 - rates[entity].ratePct / 100));
    const qty = qtyCol ? row[qtyCol] : 1;
    const out = { listPriceCents: row[cols.list], unitPriceCents: unit, amountCents: unit * qty };
    if (partCol) out[camel(partCol)] = row[partCol];
    return out;
  };

  // Scenarios: for each entity and workflow, replay the most recent real request.
  const scenarios = [];
  for (const op of ops) {
    for (const entity of entities) {
      const mine = recs.filter((r) => opOf(r) === op && r.row[entityCol] === entity);
      if (!mine.length) continue;
      const latestReqId = Math.max(...mine.map((r) => r.requestId));
      const req = reqById.get(latestReqId);
      const rows = mine.filter((r) => r.requestId === latestReqId).map((r) => r.row);
      const id = `${entity.toLowerCase()}-${slug(op)}`;
      if (rows.length === 1) {
        const e = expectRow(entity, rows[0]);
        delete e[camel(partCol || "")];
        scenarios.push({ id, workflow: slug(op), operation: op, input: req.body, expect: e });
      } else {
        const records = rows.map((row) => expectRow(entity, row));
        scenarios.push({
          id,
          workflow: slug(op),
          operation: op,
          input: req.body,
          expect: { count: records.length, totalCents: records.reduce((s, r) => s + r.amountCents, 0), records },
        });
      }
    }
  }

  // Evidence and provenance.
  const observed = [];
  const evidence = [];
  for (const entity of entities) {
    const mine = recs.filter((r) => r.row[entityCol] === entity);
    const perOp = ops
      .map((op) => [op, mine.filter((r) => opOf(r) === op).length])
      .filter(([, n]) => n)
      .map(([op, n]) => `${op} (${n})`)
      .join(" and ");
    observed.push(`${entity}: all ${mine.length} orders charged ${100 - rates[entity].ratePct}% of list price, on ${perOp}.`);
    evidence.push({
      kind: "db-rows",
      source: table.name,
      summary: `${entity} orders: ${cols.unit} = ${100 - rates[entity].ratePct}% of ${cols.list} in every row.`,
      refs: mine.slice(-5).map((r) => r.row.id),
    });
  }
  const rare = workflows.filter((w) => w.frequency === "rare");
  for (const w of rare) {
    const reqs = watch.requests.filter((r) => r.operation === w.operation);
    evidence.push({
      kind: "request-log",
      source: path.basename(watch.target.log),
      summary: `${w.operation} is rare: ${w.observed} requests, all on ${[...new Set(reqs.map((r) => r.ts.slice(0, 10)))].join(", ")}. The rate holds there too.`,
      refs: reqs.map((r) => r.id),
    });
  }

  const unknown = [];
  const retried = watch.requests.length !== new Set(watch.requests.map((r) => JSON.stringify([r.operation, r.body, r.ts]))).size;
  if (!retried) unknown.push("Retry behaviour: no repeated requests appear in the history, so idempotency cannot be observed. Needs a human decision.");
  unknown.push("Whether an account's rate changes when its agreement renews: only one rate per account was seen.");
  if (rare.length) unknown.push(`${rare.map((w) => w.operation).join(", ")} was seen only ${rare.map((w) => w.observed).join("/")} time(s); confirm the rate must apply there.`);

  const summaryRates = entities.map((e) => `${e} ${100 - rates[e].ratePct}%`).join(", ");
  return {
    id: `${entityCol.replace(/_id$/, "")}-rate`.replace(/_/g, "-"),
    version: 1,
    title: `Per-${entityCol.replace(/_id$/, "").replace(/_/g, " ")} rate on list price`,
    statement: `Each ${entityCol.replace(/_id$/, "").replace(/_/g, " ")} pays a fixed share of list price on every order (${summaryRates}), on ${ops.join(" and ")}.`,
    status: "proposed",
    approvedBy: null,
    approvedAt: null,
    workflows,
    rule: {
      kind: "price-ratio",
      expression: `unitPriceCents = round(listPriceCents * (1 - ratePct / 100)); amountCents = unitPriceCents * qty`,
      parameters: Object.fromEntries(entities.map((e) => [e, rates[e]])),
    },
    scenarios,
    evidence,
    provenance: {
      observed,
      inferred: [`The discount depends only on ${entityCol}, not on the part or the operation: the share is constant within each ${entityKey} across ${recs.length} orders.`],
      approved: [],
      unknown,
    },
  };
}

function checkRequired(contract, schema) {
  const missing = schema.required.filter((k) => !(k in contract));
  if (missing.length) throw new Error(`contract ${contract.id} is missing ${missing.join(", ")}`);
}

function run(args) {
  const watchFile = args._[0] || "out/watch.json";
  const outDir = args.out || path.join("out", "contracts");
  const watch = JSON.parse(fs.readFileSync(watchFile, "utf8"));
  const schema = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "contracts", "schema.json"), "utf8"));

  const contracts = [];
  for (const table of watch.tables.filter((t) => t.fact)) {
    const c = buildPriceRatioContract(watch, table);
    if (c) contracts.push(c);
  }

  fs.mkdirSync(outDir, { recursive: true });
  const files = contracts.map((c) => {
    checkRequired(c, schema);
    const f = path.join(outDir, `${c.id}.json`);
    fs.writeFileSync(f, JSON.stringify(c, null, 2));
    return f;
  });

  if (args.json) {
    console.log(JSON.stringify({ contracts: contracts.map((c, i) => ({ id: c.id, file: files[i], status: c.status, workflows: c.workflows.length, scenarios: c.scenarios.length })) }));
    return;
  }
  if (!contracts.length) return console.log("contract: no rules found");
  for (const [i, c] of contracts.entries()) {
    console.log(`contract: ${c.id}  (${c.status})`);
    console.log(`  ${c.statement}`);
    console.log("  workflows");
    for (const w of c.workflows) console.log(`    ${w.operation.padEnd(24)} seen ${String(w.observed).padStart(4)}x  ${w.frequency}`);
    console.log(`  scenarios  ${c.scenarios.length} (${c.scenarios.map((s) => s.id).join(", ")})`);
    console.log("  observed");
    for (const o of c.provenance.observed) console.log(`    - ${o}`);
    console.log("  unknown (needs a human)");
    for (const u of c.provenance.unknown) console.log(`    - ${u}`);
    console.log(`  wrote ${files[i]}`);
  }
}

module.exports = { run };
