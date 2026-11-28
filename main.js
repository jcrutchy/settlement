"use strict";
// Startup: wiring and the one-second loop. Settlement.start() is called by the loader once every module (and mod) is in.

function bindEvents() {
    $("toggle-sync-btn").onclick = () => $("sync-panel").classList.toggle("hidden");
    $("toggle-display-btn").onclick = () => $("display-panel").classList.toggle("hidden");
    $("toggle-auto-btn").onclick = () => { $("auto-panel").classList.toggle("hidden"); renderAutoUI(); };
    $("gist-token").oninput = $("gist-id").oninput = saveCreds;
    $("push-gist-btn").onclick = () => push(false);
    $("pull-gist-btn").onclick = pull;
    $("claim-tile-btn").onclick = claimTile;
    $("move-btn").onclick = startMove; bindMap();
    $("demolish-btn").onclick = () => armed($("demolish-btn"), "Tap again: demolish", () => demolish(S, selTile), selTile);
    $("local-save-btn").onclick = () => { saveLocal(); log(S, "Game saved locally."); };
    $("hard-reset-btn").onclick = openNewGame;
    $("ng-cancel").onclick = () => $("newgame-panel").classList.add("hidden");
    $("ng-start").onclick = () => {
        const t = $("seed-in").value.trim();
        newRun(t ? toSeed(t) : randSeed(), ngVals); saveLocal(); $("newgame-panel").classList.add("hidden"); $("seed-in").value = "";
        renderAll(); renderDisplayUI(); log(S, `New run started (seed ${S.seed}).`);
    };
    window.addEventListener("pagehide", saveLocal);
    document.addEventListener("visibilitychange", () => {
        if (document.hidden) { saveLocal(); sampleHist(true); push(true); }
        else advance(S) ? renderAll() : renderDynamic();
    });
}

async function fetchFresh(u) { // revalidate with the server; use the cached copy when offline
    try { const r = await fetch(u, { cache: "no-cache" }); if (r.ok) return r; } catch (e) { /* offline */ }
    return fetch(u, { cache: "force-cache" });
}

async function init() {
    loadData(await (await fetchFresh("gamedata.json")).text());
    document.title = G.meta.title; $("game-h1").textContent = G.meta.title;
    S = loadLocal();
    if (S) { loadState(S); recenter(); } else newRun(randSeed());
    await loadSettings(); applyLayout(); window.addEventListener("resize", applyLayout); await useRenderer(); renderDisplayUI();
    loadCredsUI(); syncUI(); bindEvents();
    advance(S); checkUnlocks(S); renderAll();
    setInterval(() => { const a = advance(S), b = runAuto(S); a || b ? renderAll() : renderDynamic(); sampleHist(); }, 1000);
    setInterval(saveLocal, G.meta.autoSaveMs);
}
Settlement.start = init;
