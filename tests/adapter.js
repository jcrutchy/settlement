// Adapter for the module layout: the player's state lives in the context variable __S and is passed to every engine call.
const { loadNew } = require("./harness");
module.exports = function (files, opts) {
    return async function make(root) {
        const { ctx, clock, run } = await loadNew(root, files, opts);
        const J = JSON.stringify;
        return {
            async newGame(seed, preset) { run(`if (typeof __S === "undefined") __S = startNew(1); __S = startNew(${seed}, __S, GP.newGame.presets.find(p => p.id === "${preset}").values)`); },
            tick(n, auto) { for (let i = 0; i < n; i++) { clock.now += 1000; run(auto ? `advance(__S, ${clock.now}); runAuto(__S);` : `advance(__S, ${clock.now});`); } },
            catchUp(sec) { clock.now += sec * 1000; run(`advance(__S, ${clock.now});`); },
            reload() { run(`__S = JSON.parse(JSON.stringify(__S)); loadState(__S);`); },
            json: () => run("JSON.stringify(__S)"),
            claimable() { return JSON.parse(run(`(() => { for (const t of owned(__S)) for (const [dx, dy] of nb4) { const x = t.x + dx, y = t.y + dy; if (claimable(__S, x, y)) return JSON.stringify([x, y]); } return "[]"; })()`)); },
            act(name, ...a) {
                switch (name) {
                    case "selectBuilt": run(`__sel = Object.keys(__S.own).filter(k => __S.own[k].b && __S.own[k].b !== "center").pop() || null`); break;
                    case "demolish": run(`demolish(__S, __sel)`); break;
                    case "adoptFirstPolicy": run(`(() => { const p = G.policies.find(x => __S.unlocked["pol:" + x.id]); if (p) { __S.res.knowledge = 999; adopt(__S, p.id); } })()`); break;
                    case "tradeSetup": run(`__S.bld.market = 1; __S.unlocked["res:stone"] = __S.unlocked["res:wood"] = true; __S.res.wood = 120; __S.res.stone = 40; rebuildWorld(__S);`); break;
                    case "addRival": run("addRival(__S)"); break;
                    default: run(`${name}(__S${a.length ? ", " : ""}${a.map(J).join(", ")})`);
                }
            }, clock, run, ctx
        };
    };
};
