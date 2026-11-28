"use strict";
// What a player (or an AI) can do. Each action changes the state, bumps S.rev and tells the UI through events; none touches the screen.

function adopt(S, id) {
    const p = polOf(id);
    if (!p || S.pol[id] || !S.unlocked["pol:" + id] || !afford(S, p.cost)) return false;
    (G.policies || []).forEach(o => { if (o.group === p.group && S.pol[o.id]) { delete S.pol[o.id]; log(S, `Revoked ${o.name}.`); } }); // one per group
    spend(S, p.cost); S.pol[id] = { str: 1 }; S.rev++; log(S, `Adopted policy: ${p.name}.`); Settlement.emit("changed", S); return true;
}

function revoke(S, id) { if (!S.pol[id]) return; delete S.pol[id]; S.rev++; log(S, `Revoked ${polOf(id).name}.`); Settlement.emit("changed", S); }

const togglePolicy = (S, id) => (S.pol[id] ? revoke(S, id) : adopt(S, id));

function gather(S, id) {
    const d = RES[id].manualDeposit && S.dep[RES[id].manualDeposit]; // hand-gathering draws on this deposit, if the resource names one
    if ((d && d.amt < 1) || S.res[id] >= capOf(S, id)) return;
    S.res[id]++; if (d) d.amt--;
    S.rev++; checkUnlocks(S); Settlement.emit("dirty", S);
}

function adjustJob(S, id, delta) {
    const j = G.jobs.find(x => x.id === id);
    if (delta > 0 && getIdle(S) > 0 && S.jobs[id] < slotCap(S, j)) S.jobs[id]++; else if (delta < 0 && S.jobs[id] > 0) S.jobs[id]--; else return;
    S.rev++; Settlement.emit("dirty", S);
}

const moveCost = (S, b) => frac(scaled(b.cost, b.growth || {}, S.bld[b.id] - 1), 0.25, true);

function build(S, id) { // auto-places on the best free tile; returns the tile, or null
    const b = bOf(id), c = costOf(S, b), t = bestTile(S, id);
    if (!t) { log(S, `No free tile suits ${b.name}${b.terrain ? " (needs " + b.terrain.join("/") + ")" : ""}${b.near ? " (must be next to " + b.near.join("/") + ")" : ""}.`); return null; }
    if (!afford(S, c)) return null;
    spend(S, c); t.b = id; S.bld[id]++; S.rev++; RUN(S).hc = null;
    log(S, `Built ${b.name} (${S.bld[id]}) at ${t.x},${t.y}.`); checkUnlocks(S); Settlement.emit("built", S, t, id); Settlement.emit("changed", S); return t;
}

function demolish(S, key) { // removes the building on tile key (never the town centre); returns whether it happened
    const t = key && S.own[key];
    if (!t || !t.b || t.b === "center") return false;
    const b = bOf(t.b), refund = frac(scaled(b.cost, b.growth || {}, S.bld[b.id] - 1), 0.5);
    for (const k in refund) S.res[k] = Math.min(capOf(S, k), S.res[k] + refund[k]);
    t.b = null; S.bld[b.id]--; S.rev++; RUN(S).hc = null;
    G.jobs.forEach(j => { if (S.jobs[j.id] > slotCap(S, j)) S.jobs[j.id] = slotCap(S, j); }); // workers lose their slots
    log(S, `Demolished ${b.name}.`); checkUnlocks(S); Settlement.emit("demolished", S, t); Settlement.emit("changed", S); return true;
}

function research(S, id) {
    const q = G.techs.find(x => x.id === id);
    if (!q || S.tech[id] || !met(S, q.requires) || !afford(S, q.cost)) return;
    spend(S, q.cost); S.tech[id] = true; S.rev++; RUN(S).hc = null;
    log(S, `Researched ${q.name}.`); checkUnlocks(S); Settlement.emit("changed", S);
}

function claimAt(S, x, y) { // pays for and claims one tile; returns whether it happened
    const c = claimCost(S), k = K(x, y);
    if (S.own[k] || !claimable(S, x, y) || !afford(S, c)) return false;
    spend(S, c); S.own[k] = { x, y, b: null }; S.claims++; S.rev++; RUN(S).hc = null; WS.owner.set(k, { pid: S.pid || 0, t: S.own[k] });
    const tid = terrainAt(x, y);
    G.deposits.filter(q => dterr(q).includes(tid)).forEach(d => { const cap = tileCap(d, x, y); S.dep[d.id].cap += cap; S.dep[d.id].amt += cap; });
    log(S, `Claimed a ${tid} tile.`); return true;
}

function startNew(seed, prev, vals) { // a fresh run: returns the new settlement (neighbours are added by world.js through the "newgame" event)
    vals = vals || {};
    const opts = (GP.newGame && GP.newGame.options) || [], val = o => vals[o.id] !== undefined ? vals[o.id] : optDefault(o), rules = {};
    opts.filter(o => o.kind === "rule").forEach(o => { const v = val(o); if (v !== optDefault(o)) rules[o.path] = v; });
    applyRules(rules);
    const S = newState(seed, prev); S.rules = rules; S.auto = {};
    ensure(S); rebuildWorld(S); seedStart(S, opts, val, true);
    checkUnlocks(S, true); Settlement.emit("newgame", S, opts, val);
    return S;
}

function seedStart(S, opts, val, withAuto) { // applies the start options (settlers, buildings, stock) to the active settlement
    opts.forEach(o => {
        const v = val(o);
        if (o.kind === "auto") { if (withAuto) S.auto[o.auto] = !!v; }
        else if (o.kind === "settlers") S.pop = v;
        else if (o.kind === "building") for (let k = 0; k < v; k++) { const t = bestTile(S, o.building); if (!t) break; t.b = o.building; S.bld[o.building]++; }
    });
    RUN(S).hc = null;
    opts.filter(o => o.kind === "resource").forEach(o => { S.res[o.resource] = Math.min(capOf(S, o.resource), val(o)); });
}

function moveBuilding(S, srcKey, dstKey) { // moves the building on one of your tiles to another empty tile and pays for it; the caller has checked it is allowed and affordable
    const src = S.own[srcKey], t = S.own[dstKey], b = bOf(src.b);
    spend(S, moveCost(S, b)); t.b = src.b; src.b = null; S.rev++; RUN(S).hc = null;
    log(S, `Moved ${b.name}.`);
}

function loadState(st) { // a saved settlement just parsed (local save or cloud): bring its shape up to date and register its land
    applyRules(st.rules);
    const S = st; ensure(S); rebuildWorld(S); Settlement.emit("load", S);
    return S;
}
