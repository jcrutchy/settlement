const { loadNew } = require("./harness");
(async () => {
    const files = ["kernel.js","rules.js","map.js","sim.js","actions.js","automation.js","world.js","mods/milestones.js"];
    const { clock, run } = await loadNew(require("path").join(__dirname, ".."), files, { ui: false });
    run(`__S = startNew(9)`);
    clock.now += 1000; run(`advance(__S, ${clock.now})`); run(`__S.pop = 120`);
    clock.now += 1000; run(`advance(__S, ${clock.now})`);
    console.log("mod:", run("JSON.stringify(Settlement.mods)"), "| logs:", run("__S.logs.slice(0, 2).map(l => l.replace(/^\\[[^\\]]*\\] /, '')).join(' / ')"));
    clock.now += 60000; run(`__S.pop = 0; advance(__S, ${clock.now})`); console.log("no log while away:", !run("__S.logs[0]").includes("Milestone: 150"));
    // a throwing listener must not break the game
    run(`Settlement.on("tick", () => { throw new Error("bad mod"); })`); clock.now += 1000; run(`advance(__S, ${clock.now})`); console.log("game survives a throwing listener");
})().catch(e => { console.error("ERROR", e.stack || e); process.exit(1); });
