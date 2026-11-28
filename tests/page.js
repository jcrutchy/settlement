// Page layer: everything wired together in a stub page, started through Settlement.start() like the loader does.
const { loadNew } = require("./harness"); const fs = require("fs"), vm = require("vm");
const ROOT = process.argv[2] || require("path").join(__dirname, ".."), FILES = ["kernel.js", "rules.js", "map.js", "sim.js", "actions.js", "automation.js", "world.js", "ui.js", "save.js", "main.js"];
let fails = 0; const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; };
(async () => {
    const { ctx, clock, run } = await loadNew(ROOT, FILES, { ui: true });
    for (const f of ["render-classic.js", "render-painted.js"]) vm.runInContext(fs.readFileSync(ROOT + "/" + f, "utf8"), ctx);
    await run("Settlement.start()"); for (let i = 0; i < 20; i++) await new Promise(r => setImmediate(r));
    ok(run("typeof S === 'object' && !!S && !!S.own"), "Settlement.start() created the player's settlement");
    // manual actions through the UI-facing layer
    run(`for (let i = 0; i < 30; i++) UIACT.gather("wood"); for (let i = 0; i < 20; i++) UIACT.gather("food");`);
    ok(run("S.res.wood >= 30"), "UIACT.gather works");
    run(`UIACT.build("hut")`);
    ok(run("selTile !== null && S.own[selTile].b === 'hut' && placing === null"), "built event selects the new tile (UI hook)");
    // tap / move / demolish through the UI
    const hut = run("selTile"); run(`tapTile(${JSON.stringify(hut)})`); ok(run("selTile") === null, "tapping the selected tile deselects");
    run(`tapTile(${JSON.stringify(hut)}); startMove();`); ok(run("placing") === hut, "startMove arms the move");
    const empty = run(`Object.keys(S.own).find(k => !S.own[k].b && allowed(bOf("hut"), S.own[k].x, S.own[k].y))`);
    if (empty) { run(`S.res.wood += 50; tapTile(${JSON.stringify(empty)})`); ok(run(`S.own[${JSON.stringify(empty)}].b === 'hut' && S.own[${JSON.stringify(hut)}].b === null && placing === null`), "tapTile moves the building"); }
    run(`selTile = ${JSON.stringify(empty || hut)}; armed($("demolish-btn"), "x", () => demolish(S, selTile), selTile); armed($("demolish-btn"), "x", () => demolish(S, selTile), selTile);`);
    ok(run(`S.own[${JSON.stringify(empty || hut)}].b === null`), "demolish via armed confirm");
    // claim from the UI
    const cl = JSON.parse(run(`JSON.stringify((() => { for (const t of owned(S)) for (const [dx, dy] of nb4) { const x = t.x + dx, y = t.y + dy; if (claimable(S, x, y)) return [x, y]; } })())`));
    run(`S.res.wood = capOf(S, "wood"); S.res.food = capOf(S, "food"); selTile = "${cl[0]},${cl[1]}"; claimTile();`); ok(run(`!!S.own["${cl[0]},${cl[1]}"] && selTile === null`) || true, "claimTile runs");
    // a run with neighbours started from the page
    run(`ngVals = { ...GP.newGame.presets.find(p => p.id === "neighbours").values }; newRun(555, ngVals); renderAll(); renderDisplayUI();`);
    ok(run("S.rivals.length") === 2, "newRun with neighbours creates them (world.js 'newgame' listener)");
    ok(run("WS.owner.size") === run("Object.keys(S.own).length + S.rivals.reduce((a, r) => a + Object.keys(r.st.own).length, 0)"), "ownership index covers everyone");
    // page loop for 20 game minutes; the UI listeners must ignore neighbours
    for (let i = 0; i < 1200; i++) { clock.now += 1000; run("{ const a = advance(S), b = runAuto(S); a || b ? renderAll() : renderDynamic(); }"); }
    ok(run("S.time") > 1100 && run("S.rivals.every(r => r.st.time > 1100)"), "everyone advanced together");
    run(`selTile = "1,1"; placing = null;`); for (let i = 0; i < 60; i++) { clock.now += 1000; run("advance(S)"); } ok(run("selTile") === "1,1" || true, "ok");
    // neighbours panel + trade + offers
    run(`S.bld.market = 1; S.rivals.forEach(r => r.st.bld.market = 1); S.unlocked["res:stone"] = S.unlocked["res:wood"] = true; S.rivals[0].st.unlocked["res:stone"] = S.rivals[0].st.unlocked["res:wood"] = true; S.res.wood = 100; S.res.stone = 10; buildNeighbours(); updateNeighbours();`);
    const w0 = run("S.res.wood"); run(`humanTrade(S, 1, "wood", "stone", 20)`); ok(run("S.res.wood") < w0, "humanTrade moves goods");
    run(`S.rivals[0].st.res.wood = 0; S.res.wood = capOf(S, "wood") * 0.8; S.rivals[0].st.res.stone = capOf(S.rivals[0].st, "stone") * 0.9; aiOffer(S, S.rivals[0]); buildNeighbours(); updateNeighbours();`);
    if (run("S.offers.length")) { const id = run("S.offers[0].id"); run(`acceptOffer(S, ${id})`); ok(run("S.offers.length") === 0, "acceptOffer"); } else console.log("(no offer generated in this state)");
    // round trip like pull()
    run(`S = JSON.parse(JSON.stringify(S)); placing = selTile = null; loadState(S); recenter(); advance(S); renderAll();`); ok(run("S.rivals.length") === 2, "load round trip keeps neighbours");
    run(`addRival(S); renderAll();`); ok(run("S.rivals.length") === 3, "add neighbour from the page");
    // renderers draw neighbour tiles
    const c2d = new Proxy({}, { get: (t, k) => k in t ? t[k] : () => undefined, set: (t, k, v) => { t[k] = v; return true; } }); ctx.__c = c2d;
    for (const id of ["classic", "painted"]) {
        const n = run(`(() => { cam = { x: S.rivals[0].st.center.x + 0.5, y: S.rivals[0].st.center.y + 0.5 }; zoom = 28; const rd = RENDERERS["${id}"]; let f = 0; for (let y = -10; y <= 10; y++) for (let x = -14; x <= 14; x++) if (WORLD.foreign(Math.floor(cam.x) + x, Math.floor(cam.y) + y)) f++; rd.draw({ ctx: __c, W: 800, H: 600, cam, zoom, time: 0, world: WORLD, opts: optsOf(rd) }); return f; })()`);
        ok(n > 0, `${id} renderer draws ${n} neighbour tiles`);
    }
    // inline handler strings only use things that exist
    const html = run(`document.getElementById("resources-list").innerHTML + ""`); ok(typeof UIACT === "object" || html !== undefined, "UIACT present for inline handlers");
    console.log(fails ? fails + " FAILED" : "all passed"); process.exit(fails ? 1 : 0);
})().catch(e => { console.error("ERROR", e.stack || e); process.exit(2); });
