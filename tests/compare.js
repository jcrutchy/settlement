// node compare.js <files as JSON> <page stubs: true|false> <repo root> <scenarios, comma separated>
// Plays the scenarios in scenarios.js against the module files given and compares state hashes with golden.json.
const { runScenarios } = require("./scenarios"); const golden = require("./golden.json");
const files = JSON.parse(process.argv[2]), ui = process.argv[3] === "true", root = process.argv[4], which = process.argv[5].split(",");
(async () => {
    const make = require("./adapter")(files, { ui }); const A = await make(root);
    const t0 = Date.now(), got = await runScenarios(A, which); let bad = 0;
    for (const k of which) got[k].forEach(([name, h], i) => { const g = golden[k][i]; const ok = g && g[0] === name && g[1] === h; if (!ok) bad++; console.log((ok ? "  ok   " : "  DIFF ") + k + "/" + name + (ok ? "" : `  got ${h} want ${g && g[1]}`)); });
    console.log(bad ? `${bad} MISMATCH(ES)` : "ALL MATCH", `(${Date.now() - t0} ms)`); process.exit(bad ? 1 : 0);
})().catch(e => { console.error("ERROR", e.stack || e); process.exit(2); });
