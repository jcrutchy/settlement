// node tests/record.js   rewrites golden.json from the current code. Do this only after a change that is MEANT to alter how a run plays out
// (new rules, balance changes); otherwise a mismatch from compare.js is a regression.
const path = require("path"), fs = require("fs"), { runScenarios } = require("./scenarios");
const FILES = ["kernel.js", "rules.js", "map.js", "sim.js", "actions.js", "automation.js", "world.js"];
(async () => { const A = await require("./adapter")(FILES, { ui: false })(path.join(__dirname, "..")); const r = await runScenarios(A); fs.writeFileSync(path.join(__dirname, "golden.json"), JSON.stringify(r, null, 1)); console.log("golden.json rewritten"); })();
