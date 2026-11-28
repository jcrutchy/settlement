// node tests/run.js   Runs every layer on its own, then everything together. No dependencies; needs only Node.
// engine      kernel + rules + map + sim + actions, in a context with NO page globals (so any use of the page, or of a global S, fails)
// automation  + automation.js          world: + world.js (AI neighbours, trade, catch-up, save/load)
// page        all modules in a stub page, started through Settlement.start()   loader: the real index.html loader   mod: the example mod
const { spawnSync } = require("child_process"), path = require("path");
const ENGINE = ["kernel.js", "rules.js", "map.js", "sim.js", "actions.js"], AUTO = [...ENGINE, "automation.js"], WORLD = [...AUTO, "world.js"];
const root = path.join(__dirname, ".."), J = JSON.stringify;
const steps = [
    ["engine (alone)", "compare.js", [J(ENGINE), "false", root, "manual"]],
    ["engine + automation", "compare.js", [J(AUTO), "false", root, "manual,solo"]],
    ["engine + automation + world", "compare.js", [J(WORLD), "false", root, "manual,solo,neighbours"]],
    ["page layer", "page.js", [root]], ["real index.html loader", "loader.js", [root]], ["example mod", "mod.js", []]
];
let bad = 0;
for (const [name, script, args] of steps) { process.stdout.write(name.padEnd(30)); const r = spawnSync(process.execPath, [path.join(__dirname, script), ...args], { encoding: "utf8" }); const ok = r.status === 0; if (!ok) { bad++; console.log("FAIL\n" + (r.stdout + r.stderr).split("\n").filter(l => /DIFF|FAIL|ERROR|MISMATCH/.test(l)).slice(0, 8).join("\n")); } else console.log("ok"); }
process.exit(bad ? 1 : 0);
