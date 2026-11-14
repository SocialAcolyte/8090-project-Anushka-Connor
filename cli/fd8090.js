#!/usr/bin/env node
// Forward Deployed 8090 CLI: watch -> contract -> (annotate, verify).
process.removeAllListeners("warning"); // hide node:sqlite's experimental notice

const commands = {
  watch: () => require("./watch"),
  contract: () => require("./contract"),
};

const [cmd, ...rest] = process.argv.slice(2);
if (!commands[cmd]) {
  console.log(`usage: fd8090 <command> [options]

  watch <data-dir>        read a legacy system's database and request log, without touching its code
      --db <file>           SQLite database (default <data-dir>/plant.db)
      --log <file>          JSON-lines request log (default <data-dir>/access.log)
      --out <dir>           where to write watch.json (default out)

  contract <watch.json>   find business rules in the watch data and write proposed contracts
      --out <dir>           where to write contracts (default out/contracts)

  every command:  --json  print machine-readable output`);
  process.exit(cmd ? 1 : 0);
}

const args = { _: [] };
for (let i = 0; i < rest.length; i++) {
  const a = rest[i];
  if (a.startsWith("--")) {
    const key = a.slice(2);
    const next = rest[i + 1];
    if (next === undefined || next.startsWith("--")) args[key] = true;
    else args[key] = rest[++i];
  } else args._.push(a);
}

Promise.resolve(commands[cmd]().run(args)).catch((e) => {
  console.error("fd8090 " + cmd + ": " + e.message);
  process.exit(1);
});
