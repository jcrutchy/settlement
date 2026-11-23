"use strict";
let G, S, RES = {}, DEP = {}, quiet = false, hCache = null, placing = null, selTile = null, popFloor = 0, armedBtn = null, armTimer = null, armedCtx = null, G0 = "", GP = null, autoNote = false, lastAuto = 0, ngVals = {};
const KEY = "settlement_save_v2", CREDS = "settlement_gist_creds", FILE = "settlement_save.json";
const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const sum = o => Object.values(o).reduce((a, b) => a + b, 0);
const creds = () => JSON.parse(localStorage.getItem(CREDS) || "{}");
const randSeed = () => (Math.random() * 2147483647) >>> 0;
const toSeed = t => /^\d+$/.test(t) ? (+t) >>> 0 : [...t].reduce((a, ch) => Math.imul(a ^ ch.charCodeAt(0), 16777619) >>> 0, 2166136261);
const fmt = n => n >= 1e6 ? (n / 1e6).toFixed(2) + "M" : n >= 1e4 ? (n / 1e3).toFixed(1) + "k" : String(Math.floor(n));
const costStr = c => Object.entries(c).map(([k, v]) => `${v} ${k}`).join(", ");
const ioStr = o => Object.entries(o || {}).map(([k, v]) => `${v}/s ${k}`).join(" + ");
const dur = t => t >= 3600 ? (t / 3600).toFixed(1) + "h" : t >= 60 ? Math.round(t / 60) + "m" : Math.round(t) + "s";
const jobText = j => (j.inputs ? ioStr(j.inputs) + " → " : "") + ioStr(j.outputs)
    + (j.slots ? ` · needs ${G.buildings.find(b => b.id === j.slots.building).name} (${j.slots.per} workers each)` : "")
    + (j.deposit && S.dep[j.deposit].cap <= 0 ? ` · you own no ${[].concat(DEP[j.deposit].terrain).join("/")} tiles yet` : "");
function armed(btn, label, fn, ctx) { // two-tap confirm that works on phones (no native dialogs); ctx ties it to what was selected when armed
    if (armedBtn === btn && armedCtx === ctx) { clearTimeout(armTimer); armedBtn = null; btn.textContent = btn.dataset.orig; return fn(); }
    if (armedBtn) armedBtn.textContent = armedBtn.dataset.orig;
    armedBtn = btn; armedCtx = ctx; btn.dataset.orig = btn.dataset.orig || btn.textContent; btn.textContent = label;
    clearTimeout(armTimer); armTimer = setTimeout(() => { armedBtn = null; btn.textContent = btn.dataset.orig; }, 8000);
}

// Seeded PRNG (mulberry32): same seed -> same world on every device
function rng(seed) {
    let a = seed >>> 0;
    return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}

// --- STATE ---
function newState(seed, prev) {
    setWorld(seed);
    const c = findStart(), own = {}, R = G.map.startRadius;
    for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) own[K(c.x + dx, c.y + dy)] = { x: c.x + dx, y: c.y + dy, b: null };
    own[K(c.x, c.y)].b = "center";
    const s = { version: 4, seed, rev: prev ? prev.rev + 1 : 0, cloudRev: prev ? prev.cloudRev : 0, lastTick: Date.now(),
        res: {}, unlocked: {}, tech: {}, pop: 0, growth: 0, starve: 0, jobs: {}, bld: {}, claims: 0, center: c, own, dep: {},
        logs: [`You arrive at a quiet clearing (seed ${seed}). Gather wood to build shelter.`] };
    G.deposits.forEach(d => { const k = poolCap(s, d); s.dep[d.id] = { cap: k, amt: k }; });
    return s;
}

function ensure() { // fills in anything new in gamedata.json, and repairs NaN left by older versions
    setWorld(S.seed); S.tech = S.tech || {}; S.auto = S.auto || {}; S.rules = S.rules || {};
    G.resources.forEach(r => { if (S.res[r.id] !== undefined && !Number.isFinite(S.res[r.id])) S.res[r.id] = r.initial || 0; });
    G.deposits.forEach(d => { const p = S.dep[d.id]; if (p && !(Number.isFinite(p.amt) && Number.isFinite(p.cap))) { const k = poolCap(S, d); S.dep[d.id] = { cap: k, amt: k }; } });
    G.resources.forEach(r => { if (S.res[r.id] === undefined) S.res[r.id] = r.initial || 0; });
    G.jobs.forEach(j => { if (S.jobs[j.id] === undefined) S.jobs[j.id] = 0; });
    G.buildings.forEach(b => { if (S.bld[b.id] === undefined) S.bld[b.id] = 0; });
    G.deposits.forEach(d => { if (!S.dep[d.id]) { const k = poolCap(S, d); S.dep[d.id] = { cap: k, amt: k }; } });
}

// startNew is defined with the new-game options below

// --- DATA-DRIVEN RULES ---
function met(c) {
    if (!c) return true;
    if (c.all) return c.all.every(met);
    if (c.any) return c.any.some(met);
    if (c.tech !== undefined) return !!S.tech[c.tech];
    if (c.resource) return S.res[c.resource] >= c.gte;
    if (c.building) return S.bld[c.building] >= c.gte;
    return false;
}

function checkUnlocks(silent) {
    let changed = false;
    [["res", G.resources, "Discovered resource"], ["job", G.jobs, "New role available"], ["bld", G.buildings, "New structure unlocked"], ["tech", G.techs, "Technology available"]].forEach(([k, list, msg]) => {
        list.forEach(x => {
            const key = k + ":" + x.id;
            if (!S.unlocked[key] && met(x.requires)) { S.unlocked[key] = true; changed = true; if (!silent) log(`${msg}: ${x.name}.`); }
        });
    });
    return changed;
}

function eff(type, key) { // sum of an effect type across everything built and every researched tech
    let t = 0;
    const add = (list, n) => list.forEach(e => { if (e.type === type && (key === undefined || e.resource === key || (type === "capacity" && e.resource === "*"))) t += e.value * n; });
    G.buildings.forEach(b => { if (S.bld[b.id]) add(b.effects, S.bld[b.id]); });
    G.techs.forEach(q => { if (S.tech[q.id]) add(q.effects || [], 1); });
    return t;
}

const capOf = id => RES[id].cap + eff("capacity", id);
const housing = () => eff("housing");
const getIdle = () => Math.max(0, S.pop - sum(S.jobs));
const slotCap = j => j.slots ? S.bld[j.slots.building] * j.slots.per : Infinity;
const have = c => c.resource !== undefined ? S.res[c.resource] : S.bld[c.building];
const prog = c => !c ? 1 : c.all ? Math.min(...c.all.map(prog)) : c.any ? Math.max(...c.any.map(prog)) : c.tech !== undefined ? (S.tech[c.tech] ? 1 : 0) : Math.min(1, have(c) / c.gte);
const needText = c => c.all ? c.all.map(needText).join(", ") : c.any ? c.any.map(needText).join(" or ") : c.tech !== undefined ? "research " + (G.techs.find(q => q.id === c.tech) || { name: c.tech }).name : `${c.resource ?? c.building} ${fmt(have(c))}/${c.gte}`;
const scaled = (cost, g, n) => {
    const m = g.type === "exp" ? Math.pow(g.rate, n) : g.type === "linear" ? 1 + g.rate * n : 1;
    const c = {}; for (const k in cost) c[k] = Math.ceil(cost[k] * m); return c;
};
const costOf = b => scaled(b.cost, b.growth || {}, S.bld[b.id]);
const claimCost = () => scaled(G.land.cost, G.land.growth, S.claims);
const afford = c => Object.entries(c).every(([k, v]) => S.res[k] >= v);
const spend = c => { for (const k in c) S.res[k] -= c[k]; };

// --- MAP: endless and generated from the seed; only tiles you own are stored ---
let TD = {}, TCACHE = new Map(), WSEED = null, cam = { x: 0, y: 0 }, zoom = 28;
const K = (x, y) => x + "," + y, bOf = id => G.buildings.find(x => x.id === id);
const nb4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
function setWorld(seed) { if (WSEED !== seed) { WSEED = seed; TCACHE.clear(); } }
function hash(x, y, s) {
    let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(s | 0, 1274126177);
    h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function vnoise(x, y, s) {
    const xi = Math.floor(x), yi = Math.floor(y), fx = (x - xi) ** 2 * (3 - 2 * (x - xi)), fy = (y - yi) ** 2 * (3 - 2 * (y - yi));
    const a = hash(xi, yi, s), b = hash(xi + 1, yi, s), c = hash(xi, yi + 1, s), d = hash(xi + 1, yi + 1, s);
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}
function fbm(x, y, s, oct) { let v = 0, a = 0.5, f = 1, n = 0; for (let i = 0; i < oct; i++) { v += a * vnoise(x * f, y * f, s + i * 101); n += a; a /= 2; f *= 2; } return v / n; }
function genTerrain(x, y, sd) { // first terrain whose gen rules all match wins; the last (no rules) is the fallback
    const e = fbm(x / 22, y / 22, sd ^ 0x1111, 4), m = fbm(x / 16, y / 16, sd ^ 0x4444, 3), cn = fbm(x / 90, y / 90, sd ^ 0x2222, 2);
    const inr = (v, r) => !r || (v >= r[0] && v <= r[1]), T = G.map.terrain;
    for (let i = 0; i < T.length; i++) {
        const g = T[i].gen || {};
        if (!inr(e, g.elev) || !inr(m, g.moist) || !inr(cn, g.cont)) continue;
        if (g.blob && fbm(x / g.blob.scale, y / g.blob.scale, sd ^ (0x7000 + i), 2) < g.blob.min) continue;
        if (g.ridge && Math.abs(fbm(x / g.ridge.scale, y / g.ridge.scale, sd ^ (0x8000 + i), 3) - 0.5) > g.ridge.width) continue;
        return T[i].id;
    }
    return T[T.length - 1].id;
}
function terrainAt(x, y) {
    const k = K(x, y); let t = TCACHE.get(k);
    if (t === undefined) { t = genTerrain(x, y, WSEED); if (TCACHE.size > 80000) TCACHE.clear(); TCACHE.set(k, t); }
    return t;
}
function findStart() { // nearest spot (spiralling out from 0,0) meeting the start rules; relaxes the later rules if needed
    const st = G.map.start, has = (x, y, ids, r, n) => { let c = 0; for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (ids.includes(terrainAt(x + dx, y + dy)) && ++c >= n) return true; return false; };
    for (let k = st.need.length; k >= 2; k--) {
        const needs = st.need.slice(0, k);
        for (let r = 0; r <= 60; r++) {
            const m = r * 3;
            for (let i = -m; i <= m; i += 3) for (const [x, y] of r ? [[i, -m], [i, m], [-m, i], [m, i]] : [[0, 0]]) {
                if (terrainAt(x, y) === st.center && needs.every(n => has(x, y, n.terrain, n.radius, n.count || 1))) return { x, y };
            }
        }
    }
    return { x: 0, y: 0 };
}
const dterr = d => [].concat(d.terrain);
const hk = (x, y) => hash(x, y, WSEED ^ 0x9999);
const tileCap = (d, x, y) => Math.round(d.perTile * (1 - d.variance + 2 * d.variance * hk(x, y)));
const owned = () => Object.values(S.own), ownedCount = () => Object.keys(S.own).length;
const poolCap = (st, d) => Object.values(st.own).reduce((a, t) => a + (dterr(d).includes(terrainAt(t.x, t.y)) ? tileCap(d, t.x, t.y) : 0), 0);
const dist = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
const isDepot = bid => bid === "center" || (!!bid && bOf(bid).effects.some(e => e.type === "depot"));
const freeTiles = () => owned().filter(t => !t.b).length;
const allowed = (b, x, y) => { // terrain and "next to water"-style placement rules
    const t = terrainAt(x, y);
    if (b.terrain ? !b.terrain.includes(t) : TD[t].buildable === false) return false;
    return !b.near || nb4.some(([dx, dy]) => b.near.includes(terrainAt(x + dx, y + dy)));
};
const canPlace = b => owned().some(t => !t.b && allowed(b, t.x, t.y));
const claimable = (x, y) => !S.own[K(x, y)] && nb4.some(([dx, dy]) => S.own[K(x + dx, y + dy)]);
function haul(id) { // delivery efficiency: mean distance from owned deposit tiles to the nearest depot
    if (!hCache) {
        hCache = {};
        const ts = owned(), depots = ts.filter(t => isDepot(t.b)), M = G.map;
        G.deposits.forEach(d => {
            const mine = ts.filter(t => dterr(d).includes(terrainAt(t.x, t.y)));
            const avg = mine.length ? mine.reduce((a, t) => a + Math.min(...depots.map(p => dist(t, p))), 0) / mine.length : 0;
            hCache[d.id] = { avg, eff: Math.max(M.minEfficiency, 1 - M.distancePenalty * Math.max(0, avg - M.freeRadius)) };
        });
    }
    return hCache[id];
}
function recenter() { cam = { x: S.center.x + 0.5, y: S.center.y + 0.5 }; }
const clampZoom = z => Math.max(8, Math.min(64, z));

// --- SIMULATION ---
function flows(dt) { // production/consumption per second for the next dt seconds
    const R = {}, harvest = {};
    G.resources.forEach(r => R[r.id] = { p: 0, c: 0 });
    for (const k in G.pop.needs) R[k].c += S.pop * G.pop.needs[k];
    G.resources.forEach(r => { if (r.spoil) R[r.id].c += S.res[r.id] * r.spoil / (1 + eff("preserve", r.id)); }); // stock rots; preserve effects slow it
    G.jobs.forEach(j => {
        const n = S.jobs[j.id]; if (!n) return;
        let e = 1; // efficiency: limited by input stock
        for (const k in j.inputs || {}) { const need = n * j.inputs[k] * dt; if (need > 0) e = Math.min(e, S.res[k] / need); }
        e = Math.min(1, e);
        const d = j.deposit && S.dep[j.deposit];
        for (const k in j.outputs) {
            let o = n * j.outputs[k] * e * (1 + eff("outputMult", k));
            let kept = 1;
            if (d) { const dens = DEP[j.deposit].regrow ? (d.cap > 0 ? d.amt / d.cap : 0) : (d.amt > 0 ? 1 : 0); o = d.cap > 0 ? Math.min(o * dens, d.amt / dt) : 0; harvest[j.deposit] = (harvest[j.deposit] || 0) + o; kept = haul(j.deposit).eff; }
            R[k].p += o * kept;
        }
        for (const k in j.inputs || {}) R[k].c += n * j.inputs[k] * e;
    });
    return { R, harvest };
}

function trimJobs() {
    for (let over = sum(S.jobs) - S.pop; over > 0; over--) {
        const k = Object.keys(S.jobs).reduce((a, b) => S.jobs[b] > S.jobs[a] ? b : a);
        if (!S.jobs[k]) break;
        S.jobs[k]--;
    }
}

function step(dt) {
    const { R, harvest } = flows(dt);
    G.resources.forEach(r => { const x = R[r.id]; S.res[r.id] = Math.max(0, Math.min(S.res[r.id] + (x.p - x.c) * dt, capOf(r.id))); });
    G.deposits.forEach(d => { // logistic regrowth; tiny floor so a depleted deposit can recover
        const s = S.dep[d.id], seed = Math.max(s.amt, 0.02 * s.cap);
        s.amt = Math.max(0, Math.min(s.cap, s.amt - (harvest[d.id] || 0) * dt + (s.cap > 0 ? d.regrow * seed * (1 - s.amt / s.cap) * dt : 0)));
    });
    if (S.pop > housing()) { // settlers without a roof drift away (demolishing homes has a cost)
        S.crowd = (S.crowd || 0) + (G.pop.overcrowdRate ?? 0.02) * dt;
        if (S.crowd >= 1) { S.crowd -= 1; if (S.pop > popFloor) { S.pop--; trimJobs(); log("A settler left: not enough housing.", true); } }
    } else S.crowd = 0;
    if (S.res.food <= 0 && S.pop > 0) { // deterministic: progress accumulates, no dice
        S.starve += G.pop.starveRate * dt;
        if (S.starve >= 1) { S.starve -= 1; if (S.pop > popFloor) { S.pop--; trimJobs(); log("Starvation! A settler has left the camp.", true); } }
    } else {
        S.starve = 0;
        if (S.pop < housing() && S.res.food >= G.pop.growthFoodMin) {
            S.growth += G.pop.growthRate * dt;
            if (S.growth >= 1) { S.growth -= 1; S.pop++; log("A new settler arrived at your camp.", true); }
        }
    }
}

function advance() { // simulate real elapsed time since lastTick, in chunks
    const now = Date.now(), total = Math.min((now - S.lastTick) / 1000, G.meta.maxOfflineSec);
    S.lastTick = now;
    if (total <= 0) return false;
    const away = total > 10, st = away ? G.meta.offlineStepSec : G.meta.liveStepSec, p0 = S.pop;
    let left = total;
    quiet = away; popFloor = away ? Math.ceil(S.pop * 0.75) : 0; // away: at most a quarter can starve
    while (left > 0) { const dt = Math.min(st, left); step(dt); left -= dt; }
    quiet = false;
    if (away) log(`Welcome back. Simulated ${Math.round(total / 60)} min away; population ${S.pop >= p0 ? "+" : ""}${S.pop - p0}.`);
    return checkUnlocks();
}

// --- PLAYER ACTIONS (each bumps rev, which drives sync conflict detection) ---
function gather(id) {
    const d = RES[id].manualDeposit && S.dep[RES[id].manualDeposit]; // hand-gathering draws on this deposit, if the resource names one
    if ((d && d.amt < 1) || S.res[id] >= capOf(id)) return;
    S.res[id]++; if (d) d.amt--;
    S.rev++; checkUnlocks(); renderDynamic();
}
function adjustJob(id, delta) {
    const j = G.jobs.find(x => x.id === id);
    if (delta > 0 && getIdle() > 0 && S.jobs[id] < slotCap(j)) S.jobs[id]++; else if (delta < 0 && S.jobs[id] > 0) S.jobs[id]--; else return;
    S.rev++; renderDynamic();
}
const frac = (c, f, up) => { const o = {}; for (const k in c) o[k] = up ? Math.ceil(c[k] * f) : Math.floor(c[k] * f); return o; };
const moveCost = b => frac(scaled(b.cost, b.growth || {}, S.bld[b.id] - 1), 0.25, true);

function bestTile(bid) { // depots go where hauling improves most; everything else hugs the town centre
    const b = bOf(bid), cand = owned().filter(t => !t.b && allowed(b, t.x, t.y));
    if (!cand.length) return null;
    const depot = b.effects.some(e => e.type === "depot");
    const workers = d => G.jobs.reduce((w, j) => w + (j.deposit === d.id ? S.jobs[j.id] : 0), 0);
    const score = t => {
        if (!depot) return -dist(t, S.center);
        t.b = bid; hCache = null;
        const v = G.deposits.reduce((a, d) => a + haul(d.id).eff * (1 + workers(d)), 0);
        t.b = null; hCache = null;
        return v - dist(t, S.center) * 1e-3;
    };
    let best = cand[0], top = -Infinity;
    cand.forEach(t => { const v = score(t); if (v > top) { top = v; best = t; } });
    return best;
}

function build(id) { // auto-places on the best free tile
    const b = bOf(id), c = costOf(b), t = bestTile(id);
    if (!t) return log(`No free tile suits ${b.name}${b.terrain ? " (needs " + b.terrain.join("/") + ")" : ""}${b.near ? " (must be next to " + b.near.join("/") + ")" : ""}.`);
    if (!afford(c)) return;
    spend(c); t.b = id; S.bld[id]++; S.rev++; hCache = null; selTile = K(t.x, t.y); placing = null;
    log(`Built ${b.name} (${S.bld[id]}) at ${t.x},${t.y}.`); checkUnlocks(); renderAll();
}
function tapTile(k) { // placing = key of the tile whose building is being moved
    const t = S.own[k];
    if (placing !== null && t && !t.b) {
        const src = S.own[placing], b = bOf(src.b), c = moveCost(b);
        if (!allowed(b, t.x, t.y)) { renderMap(); $("tile-info").textContent = `${b.name} can't go on that tile.`; return; }
        if (!afford(c)) { placing = null; return renderMap(); }
        spend(c); t.b = src.b; src.b = null; S.rev++; hCache = null; placing = null; selTile = k;
        log(`Moved ${b.name}.`); return renderAll();
    }
    placing = null; selTile = selTile === k ? null : k; renderMap(); renderDynamic();
}
function startMove() {
    const t = selTile && S.own[selTile];
    if (!t || !t.b || t.b === "center" || !afford(moveCost(bOf(t.b)))) return;
    placing = selTile; renderMap();
}
function demolish() {
    const t = selTile && S.own[selTile];
    if (!t || !t.b || t.b === "center") return;
    const b = bOf(t.b), refund = frac(scaled(b.cost, b.growth || {}, S.bld[b.id] - 1), 0.5);
    for (const k in refund) S.res[k] = Math.min(capOf(k), S.res[k] + refund[k]);
    t.b = null; S.bld[b.id]--; S.rev++; hCache = null; placing = null;
    G.jobs.forEach(j => { if (S.jobs[j.id] > slotCap(j)) S.jobs[j.id] = slotCap(j); }); // workers lose their slots
    log(`Demolished ${b.name}.`); checkUnlocks(); renderAll();
}
function research(id) {
    const q = G.techs.find(x => x.id === id);
    if (!q || S.tech[id] || !met(q.requires) || !afford(q.cost)) return;
    spend(q.cost); S.tech[id] = true; S.rev++; hCache = null;
    log(`Researched ${q.name}.`); checkUnlocks(); renderAll();
}
function claimAt(x, y) { // pays for and claims one tile; returns whether it happened
    const c = claimCost(), k = K(x, y);
    if (S.own[k] || !claimable(x, y) || !afford(c)) return false;
    spend(c); S.own[k] = { x, y, b: null }; S.claims++; S.rev++; hCache = null;
    const tid = terrainAt(x, y);
    G.deposits.filter(q => dterr(q).includes(tid)).forEach(d => { const cap = tileCap(d, x, y); S.dep[d.id].cap += cap; S.dep[d.id].amt += cap; });
    log(`Claimed a ${tid} tile.`); return true;
}
function claimTile() {
    if (!selTile) return;
    const [x, y] = selTile.split(",").map(Number);
    if (claimAt(x, y)) { selTile = null; renderAll(); }
}

// --- UI ---
function log(msg, spam) {
    if (spam && quiet) return;
    if (autoNote) msg = "Auto: " + msg;
    S.logs.unshift(`[${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}] ${msg}`);
    S.logs.length = Math.min(S.logs.length, 20);
    if (!quiet) renderLogs();
}
function renderLogs() { $("log-panel").innerHTML = S.logs.map(l => `<div class="log-entry">${esc(l)}</div>`).join(""); }

function renderAll() {
    renderLogs(); renderMap();
    const rs = G.resources.filter(r => S.unlocked["res:" + r.id]);
    const badge = "font-size:0.65rem;padding:1px 4px;";
    $("resources-list").innerHTML = rs.map(r => `<div class="stat-card"><div class="stat-card-content"><span>${r.icon} ${r.name}</span><strong id="res-val-${r.id}">0</strong><div style="display:flex;gap:4px;flex-wrap:wrap;margin-top:4px;"><span class="rate-badge positive" style="${badge}" id="res-prod-${r.id}"></span><span class="rate-badge negative" style="${badge}" id="res-cons-${r.id}"></span><span class="rate-badge neutral" style="${badge}" id="res-net-${r.id}"></span></div></div></div>`).join("");
    $("manual-actions").innerHTML = rs.filter(r => r.manual).map(r => `<button onclick="gather('${r.id}')">+ Gather ${r.name}</button>`).join("");
    $("deposits-list").innerHTML = G.deposits.map(d => `<div class="row-item"><div class="row-info"><strong>${d.name}</strong><span id="dep-${d.id}"></span></div></div>`).join("");
    $("jobs-list").innerHTML = G.jobs.filter(j => S.unlocked["job:" + j.id]).map(j => `<div class="row-item"><div class="row-info"><strong>${j.name}</strong><span id="job-info-${j.id}"></span></div><div class="button-row" style="align-items:center;"><button onclick="adjustJob('${j.id}',-1)">-</button><span class="badge" id="job-val-${j.id}">0</span><button id="job-add-${j.id}" onclick="adjustJob('${j.id}',1)">+</button></div></div>`).join("");
    $("buildings-list").innerHTML = G.buildings.filter(b => S.unlocked["bld:" + b.id]).map(b => `<div class="row-item"><div class="row-info"><strong id="bld-name-${b.id}"></strong><span id="bld-desc-${b.id}"></span></div><button id="bld-btn-${b.id}" onclick="build('${b.id}')">Build</button></div>`).join("");
    const techs = G.techs.filter(q => S.unlocked["tech:" + q.id] && !S.tech[q.id]);
    $("tech-list").replaceChildren(...(techs.length ? techs.map(q => {
        const d = document.createElement("div"); d.className = "row-item";
        d.innerHTML = `<div class="row-info"><strong>${esc(q.name)}</strong><span>${esc(q.desc || "")} Cost: ${esc(costStr(q.cost))}</span></div><button id="tech-btn-${q.id}" onclick="research('${q.id}')">Research</button>`;
        return d;
    }) : [Object.assign(document.createElement("span"), { className: "hint", textContent: "Nothing to research right now. More appears as you build." })]));
    renderDynamic();
}

function renderMap() { // info line and buttons, then the canvas
    const cb = $("claim-tile-btn"), mb = $("move-btn"), db = $("demolish-btn"), mv = placing !== null;
    const xy = selTile ? selTile.split(",").map(Number) : null, t = selTile ? S.own[selTile] : null;
    const canEdit = !mv && t && t.b && t.b !== "center";
    let msg = mv ? `Tap one of your empty tiles to move ${bOf(S.own[placing].b).name} (costs ${costStr(moveCost(bOf(S.own[placing].b)))}).` : "Drag to pan, pinch or use +/- to zoom. Tap a tile to inspect it; claim tiles next to your land.";
    if (!mv && xy) {
        const tid = terrainAt(xy[0], xy[1]), ds = G.deposits.filter(q => dterr(q).includes(tid));
        msg = `${tid} (${xy[0]}, ${xy[1]})${ds.map(d => ` · ${tileCap(d, xy[0], xy[1])} ${d.name.toLowerCase()}`).join("")} · ${t ? (t.b ? (t.b === "center" ? "town centre" : bOf(t.b).name) : "yours, empty") : claimable(xy[0], xy[1]) ? "next to your land" : "out of reach"}`;
    }
    $("tile-info").textContent = msg;
    cb.style.display = !mv && xy && !t && claimable(xy[0], xy[1]) ? "" : "none";
    cb.textContent = `Claim (${costStr(claimCost())})`;
    mb.style.display = db.style.display = canEdit ? "" : "none";
    if (canEdit) { mb.textContent = `Move (${costStr(moveCost(bOf(t.b)))})`; if (!(armedBtn === db && armedCtx === selTile)) { if (armedBtn === db) armedBtn = null; db.textContent = "Demolish"; } } // a pending confirm survives re-renders
    else if (armedBtn === db) { armedBtn = null; db.textContent = "Demolish"; }
    drawMap();
}

// --- RENDERERS & DISPLAY SETTINGS (graphics are pluggable; see render-classic.js for the contract) ---
const RENDERERS = (window.SettlementRenderers = window.SettlementRenderers || {}), SKEY = "settlement_settings";
let SETTINGS = { available: [["classic", "Classic"]], render: { renderer: "classic", options: {} }, layout: { mapHeightVh: 55 } }, animOn = false;
const WORLD = { // the read-only view of the game that renderers draw from
    terrainAt: (x, y) => terrainAt(x, y), terrain: id => TD[id], fallbackTerrain: () => G.map.terrain[G.map.terrain.length - 1].id,
    tile: (x, y) => S.own[K(x, y)] || null, key: K, claimable: (x, y) => claimable(x, y), allowed: (b, x, y) => allowed(b, x, y),
    building: id => bOf(id), centerIcon: () => G.map.centerIcon, selected: () => selTile, moving: () => placing !== null ? bOf(S.own[placing].b) : null,
    owned: () => owned(), isDepot: id => isDepot(id), deposits: () => G.deposits, depositsAt: (x, y) => G.deposits.filter(d => dterr(d).includes(terrainAt(x, y)))
};
const curRenderer = () => RENDERERS[SETTINGS.render.renderer];
const optsOf = rd => Object.fromEntries((rd.options || []).map(o => [o.id, ((SETTINGS.render.options[SETTINGS.render.renderer] || {})[o.id]) ?? o.default]));
const saveSettings = () => { try { localStorage.setItem(SKEY, JSON.stringify({ render: SETTINGS.render, layout: SETTINGS.layout })); } catch (e) { /* ignore */ } };
const applyLayout = () => { $("map").style.height = SETTINGS.layout.mapHeightVh + "vh"; };

async function loadSettings() {
    let d = {}; try { const r = await fetchFresh("settings.json"); if (r.ok) d = await r.json(); } catch (e) { /* defaults */ }
    let u = {}; try { u = JSON.parse(localStorage.getItem(SKEY)) || {}; } catch (e) { /* ignore */ }
    const dr = d.render || SETTINGS.render, ur = u.render || {};
    SETTINGS = { available: d.available || SETTINGS.available, render: { renderer: ur.renderer || dr.renderer || "classic", options: { ...(dr.options || {}), ...(ur.options || {}) } }, layout: { ...SETTINGS.layout, ...(d.layout || {}), ...(u.layout || {}) } };
}
async function useRenderer() { // load the selected renderer script on first use; fall back to classic if it can't be loaded
    const id = SETTINGS.render.renderer;
    if (!RENDERERS[id]) {
        try {
            const r = await fetchFresh(`render-${id}.js`);
            if (r.ok) { const sc = document.createElement("script"); sc.textContent = (await r.text()) + `\n//# sourceURL=render-${id}.js`; document.body.append(sc); }
        } catch (e) { /* offline or missing */ }
        if (!RENDERERS[id] && id !== "classic") { SETTINGS.render.renderer = "classic"; return useRenderer(); }
    }
    syncAnim(); drawMap();
}
function syncAnim() { // renderers with animated: true get a repaint every frame while the tab is visible
    const r = curRenderer();
    if (!r || !r.animated || animOn) return;
    animOn = true;
    const tick = () => { const c = curRenderer(); if (!c || !c.animated) { animOn = false; return; } if (!document.hidden) drawMap(); requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
}
function drawMap() {
    const rd = curRenderer(), cv = $("map");
    if (!rd) return;
    const dpr = window.devicePixelRatio || 1, W = cv.clientWidth, Hh = cv.clientHeight;
    if (!W) return;
    const bw = Math.round(W * dpr), bh = Math.round(Hh * dpr);
    if (cv.width !== bw || cv.height !== bh) { cv.width = bw; cv.height = bh; } // keep the bitmap in step with the displayed size, or tiles stretch
    const c = cv.getContext("2d"); c.setTransform(dpr, 0, 0, dpr, 0, 0);
    rd.draw({ ctx: c, W, H: Hh, cam, zoom, time: performance.now() / 1000, world: WORLD, opts: optsOf(rd) });
}
function renderDisplayUI() {
    const box = $("display-body"), rd = curRenderer();
    const mk = (tag, p = {}, ...kids) => { const e = document.createElement(tag); Object.assign(e, p); e.append(...kids); return e; };
    const row = (label, w) => mk("div", { className: "fld", style: "margin:8px 0;" }, mk("span", { className: "hint", textContent: label + " " }), w);
    const pick = mk("select", { onchange: async e => { SETTINGS.render.renderer = e.target.value; await useRenderer(); saveSettings(); renderDisplayUI(); } },
        ...SETTINGS.available.map(([id, name]) => mk("option", { value: id, textContent: name })));
    pick.value = SETTINGS.render.renderer;
    const opts = ((rd && rd.options) || []).map(o => {
        const cur = optsOf(rd)[o.id];
        return mk("label", { className: "hint", style: "display:block;margin:4px 0;" }, mk("input", { type: "checkbox", checked: !!cur, onchange: e => { (SETTINGS.render.options[SETTINGS.render.renderer] = SETTINGS.render.options[SETTINGS.render.renderer] || {})[o.id] = e.target.checked; saveSettings(); drawMap(); } }), " " + o.label);
    });
    const height = mk("input", { type: "range", min: 30, max: 90, value: SETTINGS.layout.mapHeightVh, oninput: e => { SETTINGS.layout.mapHeightVh = +e.target.value; applyLayout(); drawMap(); }, onchange: saveSettings });
    const autos = ((GP.newGame && GP.newGame.options) || []).filter(o => o.kind === "auto").map(o => mk("label", { className: "hint", style: "display:block;margin:4px 0;" },
        mk("input", { type: "checkbox", checked: !!(S.auto || {})[o.auto], onchange: e => { S.auto = S.auto || {}; S.auto[o.auto] = e.target.checked; S.rev++; saveLocal(); } }), " " + o.label));
    box.replaceChildren(row("Graphics", pick), ...opts, row("Map height", height), mk("h3", { textContent: "Automation (saved with this run)" }), ...autos);
}

function bindMap() { // drag to pan, wheel/pinch/buttons to zoom, tap to select
    const cv = $("map"), ptrs = new Map(); let moved = 0, d0 = 0, z0 = 0;
    const pos = e => { const r = cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    const redraw = () => requestAnimationFrame(drawMap);
    cv.onpointerdown = e => {
        cv.setPointerCapture(e.pointerId); ptrs.set(e.pointerId, pos(e)); moved = 0;
        if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; d0 = Math.hypot(a.x - b.x, a.y - b.y) || 1; z0 = zoom; }
    };
    cv.onpointermove = e => {
        if (!ptrs.has(e.pointerId)) return;
        const p = pos(e), q = ptrs.get(e.pointerId);
        if (ptrs.size === 1) { cam.x -= (p.x - q.x) / zoom; cam.y -= (p.y - q.y) / zoom; moved += Math.abs(p.x - q.x) + Math.abs(p.y - q.y); }
        ptrs.set(e.pointerId, p);
        if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; zoom = clampZoom(z0 * Math.hypot(a.x - b.x, a.y - b.y) / d0); moved = 99; }
        redraw();
    };
    const up = e => {
        if (ptrs.size === 1 && moved < 6 && e.type === "pointerup") {
            const p = pos(e); tapTile(K(Math.floor(cam.x + (p.x - cv.clientWidth / 2) / zoom), Math.floor(cam.y + (p.y - cv.clientHeight / 2) / zoom)));
        }
        ptrs.delete(e.pointerId);
    };
    cv.onpointerup = up; cv.onpointercancel = up;
    cv.onwheel = e => { e.preventDefault(); zoom = clampZoom(zoom * (e.deltaY < 0 ? 1.15 : 1 / 1.15)); redraw(); };
    $("zoom-in").onclick = () => { zoom = clampZoom(zoom * 1.3); drawMap(); };
    $("zoom-out").onclick = () => { zoom = clampZoom(zoom / 1.3); drawMap(); };
    $("recenter").onclick = () => { recenter(); drawMap(); };
    window.addEventListener("resize", redraw);
}

function renderAlert(R) { // warn before the village starves
    let msg = "";
    for (const k in G.pop.needs) {
        const net = R[k].p - R[k].c, left = S.res[k];
        if (S.pop > 0 && left <= 0.5 && net <= 0) msg = `⚠ Out of ${RES[k].name}! Settlers will start leaving.`;
        else if (net < 0 && left / -net < 120) msg = `⚠ ${RES[k].name} runs out in ${dur(left / -net)}.`;
    }
    const el = $("alert"); el.textContent = msg; el.style.display = msg ? "" : "none";
}
function renderGoals() { // the locked things closest to unlocking
    const need = [];
    [["res", G.resources, "resource"], ["job", G.jobs, "role"], ["bld", G.buildings, "structure"], ["tech", G.techs, "technology"]].forEach(([k, list, label]) =>
        list.forEach(x => { if (!S.unlocked[k + ":" + x.id]) need.push({ x, label, p: prog(x.requires) }); }));
    need.sort((a, b) => b.p - a.p);
    $("goals").replaceChildren(...(need.length ? need.slice(0, 4).map(n => {
        const d = document.createElement("div"); d.className = "row-item";
        d.innerHTML = `<div class="row-info"><strong>${esc(((n.x.icon || "") + " " + n.x.name).trim())}</strong><span>${n.label} · needs ${esc(needText(n.x.requires))}</span></div><span class="badge">${Math.round(n.p * 100)}%</span>`;
        return d;
    }) : [Object.assign(document.createElement("span"), { className: "hint", textContent: "Everything is unlocked." })]));
}

function renderDynamic() {
    const { R, harvest } = flows(1), set = (id, t) => { const e = $(id); if (e) e.textContent = t; };
    G.resources.forEach(r => {
        const x = R[r.id], net = x.p - x.c;
        set("res-val-" + r.id, fmt(S.res[r.id]) + " / " + fmt(capOf(r.id)));
        set("res-prod-" + r.id, "P: +" + x.p.toFixed(1));
        set("res-cons-" + r.id, "C: -" + x.c.toFixed(1));
        const n = $("res-net-" + r.id);
        if (n) { const full = net > 0 && S.res[r.id] >= capOf(r.id) - 0.01; n.textContent = full ? "FULL, wasting" : "Net: " + (net > 0 ? "+" : "") + net.toFixed(1); n.className = "rate-badge " + (net > 0 ? "positive" : net < 0 ? "negative" : "neutral"); }
    });
    G.deposits.forEach(d => {
        const s = S.dep[d.id], hl = haul(d.id), rate = harvest[d.id] || 0;
        const y = d.regrow ? `yield ${s.cap > 0 ? Math.round(100 * s.amt / s.cap) : 0}% (regrows)` : rate > 0 ? `lasts ${dur(s.amt / rate)} at this rate` : s.amt > 0 ? "finite, untouched" : "exhausted";
        set("dep-" + d.id, `${Math.floor(s.amt)} / ${s.cap} ${d.resource} · ${y} · hauling ${Math.round(hl.eff * 100)}%, avg ${hl.avg.toFixed(1)} tiles`);
    });
    renderAlert(R); renderGoals();
    set("tech-count", `${Object.keys(S.tech).length} / ${G.techs.length} known`);
    G.techs.forEach(q => { const b = $("tech-btn-" + q.id); if (b) b.disabled = !afford(q.cost); });
    const free = freeTiles();
    set("land-counter", `${ownedCount()} tiles owned · ${free} free`);
    set("seed-hint", `World seed ${S.seed}. Claim tiles next to your land (pricier as you grow) and build on them. Structures are placed automatically; select one on the map to move or demolish it. Depots near deposits cut hauling loss.`);
    $("claim-tile-btn").disabled = selTile === null || !afford(claimCost());
    set("pop-counter", `${S.pop} / ${housing()}`);
    set("idle-pop", getIdle());
    set("needs-hint", `(each villager consumes ${ioStr(G.pop.needs)})`);
    G.jobs.forEach(j => { set("job-val-" + j.id, j.slots ? `${S.jobs[j.id]}/${slotCap(j)}` : S.jobs[j.id]); set("job-info-" + j.id, jobText(j)); const a = $("job-add-" + j.id); if (a) a.disabled = getIdle() < 1 || S.jobs[j.id] >= slotCap(j); });
    G.buildings.forEach(b => {
        const c = costOf(b);
        set("bld-name-" + b.id, `${b.name} (${S.bld[b.id]})`);
        set("bld-desc-" + b.id, `${b.desc} • Cost: ${costStr(c)}${b.terrain ? " • On: " + b.terrain.join("/") : ""}${b.near ? " • Next to: " + b.near.join("/") : ""}${canPlace(b) ? "" : " • no free tile suits it: claim more land"}`);
        const btn = $("bld-btn-" + b.id); if (btn) btn.disabled = !(afford(c) && canPlace(b));
    });
}

// --- STATS HISTORY: recorded for stats.html (per device, kept out of the save and the gist) ---
// Three tiers: 10 s samples for 1 h, then 5 min averages for 24 h, then hourly averages for 14 days.
const HKEY = "settlement_history_v1", HEVERY = [30, 12], HCAP = [360, 288, 336], HSTEP = 10000;
let H = null, lastSample = 0;
const histKeys = () => ["pop", "house", "idle", "owned"].concat(G.resources.flatMap(r => [r.id + ":l", r.id + ":p", r.id + ":c"]), G.deposits.map(d => "dep:" + d.id));
function ensureHist() {
    const keys = histKeys(), sig = keys.join();
    if (!H) { try { H = JSON.parse(localStorage.getItem(HKEY)); } catch (e) { H = null; } }
    if (!H || H.seed !== S.seed || H.sig !== sig) H = { seed: S.seed, sig, keys, tiers: [[], [], []], n: [0, 0] };
}
function pushTier(i, row) {
    const T = H.tiers[i]; T.push(row); if (T.length > HCAP[i]) T.shift();
    if (i < 2 && ++H.n[i] % HEVERY[i] === 0) {
        const w = T.slice(-HEVERY[i]);
        pushTier(i + 1, row.map((_, k) => { const v = w.reduce((a, x) => a + x[k], 0) / w.length; return k ? Math.round(v * 100) / 100 : Math.round(v); }));
    }
}
function sampleHist(force) {
    const now = Date.now();
    if (!force && now - lastSample < HSTEP) return;
    lastSample = now; ensureHist();
    const { R } = flows(1), r2 = x => Math.round(x * 100) / 100;
    pushTier(0, [now, S.pop, housing(), getIdle(), ownedCount()]
        .concat(G.resources.flatMap(r => [r2(S.res[r.id]), r2(R[r.id].p), r2(R[r.id].c)]), G.deposits.map(d => r2(S.dep[d.id].amt))));
    try { localStorage.setItem(HKEY, JSON.stringify(H)); } catch (e) { /* storage full: stats stop persisting, the game is unaffected */ }
}

// --- NEW GAME OPTIONS, RULE OVERRIDES AND AUTOMATION ---
// gamedata.json "newGame" lists presets and options. "rule" options override any number in the data by dotted path
// (arrays of objects are searched by id, e.g. resources.food.spoil); the overrides are saved with the run.
const mk = (tag, p = {}, ...kids) => { const e = document.createElement(tag); Object.assign(e, p); e.append(...kids); return e; };
function getPath(o, path) { let cur = o; for (const k of path.split(".")) { cur = Array.isArray(cur) ? cur.find(x => x.id === k) : cur && cur[k]; if (cur === undefined || cur === null) return undefined; } return cur; }
function setPath(o, path, v) { const seg = path.split("."), last = seg.pop(), cur = seg.length ? getPath(o, seg.join(".")) : o; if (!cur || Array.isArray(cur)) return false; cur[last] = v; return true; }
function applyRules(rules) { // working copy of the game data = pristine data plus this run's overrides
    G = JSON.parse(G0); G.techs = G.techs || [];
    for (const p in rules || {}) setPath(G, p, rules[p]);
    [RES, DEP, TD].forEach(m => Object.keys(m).forEach(k => delete m[k]));
    G.resources.forEach(r => RES[r.id] = r); G.deposits.forEach(d => DEP[d.id] = d); G.map.terrain.forEach(t => TD[t.id] = t);
    TCACHE.clear();
}
const optDefault = o => o.default !== undefined ? o.default : o.kind === "rule" ? getPath(GP, o.path) : o.kind === "resource" ? (GP.resources.find(r => r.id === o.resource).initial || 0) : o.type === "bool" ? false : 0;

function startNew(seed, prev, vals) {
    vals = vals || {};
    H = null; try { localStorage.removeItem(HKEY); } catch (e) { /* ignore */ }
    const opts = (GP.newGame && GP.newGame.options) || [], val = o => vals[o.id] !== undefined ? vals[o.id] : optDefault(o), rules = {};
    opts.filter(o => o.kind === "rule").forEach(o => { const v = val(o); if (v !== optDefault(o)) rules[o.path] = v; });
    applyRules(rules);
    S = newState(seed, prev); S.rules = rules; S.auto = {};
    hCache = placing = selTile = null; ensure();
    opts.forEach(o => {
        const v = val(o);
        if (o.kind === "auto") S.auto[o.auto] = !!v;
        else if (o.kind === "settlers") S.pop = v;
        else if (o.kind === "building") for (let k = 0; k < v; k++) { const t = bestTile(o.building); if (!t) break; t.b = o.building; S.bld[o.building]++; }
    });
    hCache = null;
    opts.filter(o => o.kind === "resource").forEach(o => { S.res[o.resource] = Math.min(capOf(o.resource), val(o)); });
    recenter(); checkUnlocks(true);
}

function openNewGame() {
    const ng = GP.newGame || { presets: [], options: [] }, box = $("newgame-body"), vals = ngVals = {};
    const housingOf = id => GP.buildings.find(b => b.id === id).effects.filter(e => e.type === "housing").reduce((a, e) => a + e.value, 0);
    let preset = ng.presets[0] ? ng.presets[0].id : null;
    const fill = () => { const p = ng.presets.find(x => x.id === preset) || { values: {} }; ng.options.forEach(o => { vals[o.id] = p.values[o.id] !== undefined ? p.values[o.id] : optDefault(o); }); };
    const draw = () => {
        const warn = mk("p", { className: "hint", style: "color:#fca5a5;" });
        const upd = () => { const room = ng.options.filter(o => o.kind === "building").reduce((a, o) => a + (+vals[o.id] || 0) * housingOf(o.building), 0), n = +vals.settlers || 0; warn.textContent = n > room ? `${n} settlers but housing for only ${room}: the extra ${n - room} will drift away. Add huts or lower the settlers.` : ""; };
        const pick = mk("select", { onchange: e => { preset = e.target.value; fill(); draw(); } }, ...ng.presets.map(p => mk("option", { value: p.id, textContent: p.name })));
        pick.value = preset;
        const field = o => {
            const input = o.kind === "auto" || o.type === "bool"
                ? mk("input", { type: "checkbox", checked: !!vals[o.id], onchange: e => { vals[o.id] = e.target.checked; } })
                : mk("input", { type: "number", min: o.min, max: o.max, step: o.step || 1, value: vals[o.id], onchange: e => { const n = parseFloat(e.target.value); vals[o.id] = isFinite(n) ? Math.max(o.min, Math.min(o.max, n)) : optDefault(o); e.target.value = vals[o.id]; upd(); } });
            return mk("div", { className: "ng-row" }, mk("span", { textContent: o.label }), input);
        };
        const groups = [...new Set(ng.options.map(o => o.group || "Options"))], p = ng.presets.find(x => x.id === preset);
        box.replaceChildren(mk("div", { className: "ng-row" }, mk("span", { textContent: "Preset" }), pick), mk("p", { className: "hint", textContent: p ? p.desc : "" }),
            ...groups.flatMap(g => [mk("h3", { textContent: g }), ...ng.options.filter(o => (o.group || "Options") === g).map(field)]), warn);
        upd();
    };
    fill(); draw(); $("newgame-panel").classList.remove("hidden"); window.scrollTo(0, 0);
}

// Automation: for casual play. Runs on live ticks only (not while the game is closed). Assignment is checked every tick;
// building and claiming do at most one thing every 3 seconds and keep a spending reserve.
const autoCount = () => Object.values(S.bld).reduce((a, b) => a + b, 0) + S.claims;
const autoDo = fn => { const n = autoCount(); autoNote = true; fn(); autoNote = false; return autoCount() > n; };
function autoAssign() { // put idle settlers where the lowest or draining stockpiles need them
    let did = false;
    for (let n = getIdle(); n > 0; n--) {
        const R = flows(1).R; let best = null, top = 0;
        G.jobs.forEach(j => {
            if (!S.unlocked["job:" + j.id] || S.jobs[j.id] >= slotCap(j)) return;
            if (j.deposit && !(S.dep[j.deposit].cap > 0 && S.dep[j.deposit].amt > 1)) return;
            if (Object.keys(j.inputs || {}).some(k => S.res[k] < 5)) return; // would stand idle without inputs
            let need = 0;
            Object.keys(j.outputs).forEach(k => {
                const lvl = Math.min(1, S.res[k] / capOf(k)); let w = 1 - lvl;
                if (R[k].p - R[k].c < 0) w += 0.5;
                if (G.pop.needs[k]) w *= 3;
                if (lvl >= 0.98) w = 0;
                need = Math.max(need, w);
            });
            if (need > top) { top = need; best = j; }
        });
        if (!best) break;
        S.jobs[best.id]++; did = true;
    }
    if (did) S.rev++;
    return did;
}
function autoFeed() { // if an essential need is draining, move a worker from the biggest unrelated job to a job that makes it
    const R = flows(1).R;
    for (const k of Object.keys(G.pop.needs)) {
        if (R[k].p - R[k].c >= 0 || S.res[k] > 0.3 * capOf(k)) continue;
        const gain = j => j.outputs[k] * (j.deposit ? haul(j.deposit).eff : 1);
        const makers = G.jobs.filter(j => j.outputs[k] && S.unlocked["job:" + j.id] && S.jobs[j.id] < slotCap(j) && (!j.deposit || (S.dep[j.deposit].cap > 0 && S.dep[j.deposit].amt > 1))).sort((a, b) => gain(b) - gain(a));
        const from = G.jobs.filter(j => !j.outputs[k] && S.jobs[j.id] > 0).sort((a, b) => S.jobs[b.id] - S.jobs[a.id])[0];
        if (!makers.length || !from) continue;
        S.jobs[from.id]--; S.jobs[makers[0].id]++; S.rev++;
        autoNote = true; log(`moved a ${from.name} to ${makers[0].name}: ${RES[k].name} is running low.`); autoNote = false; return true;
    }
    return false;
}
function autoHousing() { // build the best affordable housing when the village is full and food can support growth
    if (S.pop < housing() || S.res.food < G.pop.growthFoodMin) return false;
    const f = flows(1).R.food; if (f.p - f.c < 0 && S.res.food < 40) return false;
    const gain = b => b.effects.filter(e => e.type === "housing").reduce((a, e) => a + e.value, 0);
    let best = null, top = 0;
    G.buildings.forEach(b => {
        if (!S.unlocked["bld:" + b.id] || !gain(b) || !canPlace(b)) return;
        const c = costOf(b); if (!Object.entries(c).every(([k, v]) => S.res[k] >= v * 1.1)) return;
        const sc = gain(b) / (1 + sum(c) / 100); if (sc > top) { top = sc; best = b; }
    });
    return best ? autoDo(() => build(best.id)) : false;
}
function autoClaim() { // when fewer than two free building tiles remain, claim the most useful neighbouring tile
    if (owned().filter(t => !t.b && !TD[terrainAt(t.x, t.y)].water).length >= 2) return false;
    const c = claimCost(); if (!Object.entries(c).every(([k, v]) => S.res[k] >= v * 1.5)) return false;
    let best = null, top = -Infinity;
    owned().forEach(t => nb4.forEach(([dx, dy]) => {
        const x = t.x + dx, y = t.y + dy; if (!claimable(x, y)) return;
        const tid = terrainAt(x, y), td = TD[tid];
        const sc = (td.water ? -3 : 1) - dist({ x, y }, S.center) * 0.3 + (G.deposits.some(d => dterr(d).includes(tid) && S.dep[d.id].cap === 0) ? 1.5 : 0);
        if (sc > top) { top = sc; best = [x, y]; }
    }));
    return best ? autoDo(() => claimAt(best[0], best[1])) : false;
}
function runAuto() {
    const a = S.auto || {}; let acted = false;
    if (a.idle && getIdle() > 0 && autoAssign()) acted = true;
    const now = Date.now();
    if (now - lastAuto < 3000) return acted;
    lastAuto = now;
    if (a.feed && autoFeed()) acted = true;
    else if (a.housing && autoHousing()) acted = true;
    else if (a.claim && autoClaim()) acted = true;
    return acted;
}

// --- PERSISTENCE & SECRET GIST SYNC ---
function saveLocal() { localStorage.setItem(KEY, JSON.stringify(S)); }
function loadLocal() {
    try { const p = JSON.parse(localStorage.getItem(KEY)); if (p && p.version === 4) return p; } catch (e) { console.error(e); }
    return null;
}
function setStatus(msg, isErr) { const el = $("sync-status"); el.style.color = isErr ? "var(--danger)" : "var(--accent)"; el.textContent = msg; }
function syncUI() {
    const c = creds(), ok = !!(c.token && c.gistId);
    $("pull-gist-btn").style.display = $("push-gist-btn").style.display = ok ? "inline-block" : "none";
}
function loadCredsUI() { const c = creds(); $("gist-token").value = c.token || ""; $("gist-id").value = c.gistId || ""; }
function saveCreds() {
    localStorage.setItem(CREDS, JSON.stringify({ token: $("gist-token").value.trim(), gistId: $("gist-id").value.trim() }));
    syncUI();
}
const gistHeaders = c => ({ Authorization: `Bearer ${c.token}`, Accept: "application/vnd.github+json" });

async function gistGet(c) {
    const r = await fetch(`https://api.github.com/gists/${c.gistId}`, { headers: gistHeaders(c) });
    if (!r.ok) throw new Error("HTTP " + r.status);
    const f = (await r.json()).files[FILE];
    return f && f.content ? JSON.parse(f.content) : null;
}

// Conflict rule: rev counts player actions. cloudRev = the rev we last pulled/pushed.
// If the cloud's rev is higher than that, another device made progress we haven't seen.
async function push(auto) {
    const c = creds(); if (!c.token || !c.gistId) return;
    if (auto && S.rev <= S.cloudRev) return; // nothing new to send
    try {
        if (!auto) setStatus("Checking cloud save...");
        const cloud = await gistGet(c);
        if (cloud && cloud.version === 4 && cloud.rev > S.cloudRev) {
            if (auto) return setStatus("Auto-sync skipped: cloud has progress from another device.", true);
            if (!confirm(`Cloud save has progress from another device (saved ${new Date(cloud.lastTick).toLocaleString()}). Overwrite it with this device?`)) return setStatus("Push cancelled.");
        }
        advance(); saveLocal();
        const r = await fetch(`https://api.github.com/gists/${c.gistId}`, {
            method: "PATCH", headers: { ...gistHeaders(c), "Content-Type": "application/json" },
            body: JSON.stringify({ files: { [FILE]: { content: JSON.stringify(S) } } })
        });
        if (!r.ok) throw new Error("HTTP " + r.status);
        S.cloudRev = S.rev; saveLocal();
        setStatus(`Synced at ${new Date().toLocaleTimeString()}.`);
    } catch (e) { setStatus("Push failed: " + e.message, true); }
}

async function pull() {
    const c = creds(); if (!c.token || !c.gistId) return setStatus("Enter token and gist ID first.", true);
    try {
        setStatus("Fetching cloud save...");
        const cloud = await gistGet(c);
        if (!cloud || cloud.version !== 4) throw new Error("No v0.4 save in the gist yet. Push one first.");
        if (S.rev > S.cloudRev && !confirm("This device has progress that hasn't been pushed. Replace it with the cloud save?")) return setStatus("Pull cancelled.");
        S = cloud; S.cloudRev = S.rev; hCache = placing = selTile = null; applyRules(S.rules); ensure(); recenter(); advance(); saveLocal(); renderAll(); renderDisplayUI();
        setStatus("Loaded cloud save.");
    } catch (e) { setStatus("Pull failed: " + e.message, true); }
}

function bindEvents() {
    $("toggle-sync-btn").onclick = () => $("sync-panel").classList.toggle("hidden");
    $("toggle-display-btn").onclick = () => $("display-panel").classList.toggle("hidden");
    $("gist-token").oninput = $("gist-id").oninput = saveCreds;
    $("push-gist-btn").onclick = () => push(false);
    $("pull-gist-btn").onclick = pull;
    $("claim-tile-btn").onclick = claimTile;
    $("move-btn").onclick = startMove; bindMap();
    $("demolish-btn").onclick = () => armed($("demolish-btn"), "Tap again: demolish", demolish, selTile);
    $("local-save-btn").onclick = () => { saveLocal(); log("Game saved locally."); };
    $("hard-reset-btn").onclick = openNewGame;
    $("ng-cancel").onclick = () => $("newgame-panel").classList.add("hidden");
    $("ng-start").onclick = () => {
        const t = $("seed-in").value.trim();
        startNew(t ? toSeed(t) : randSeed(), S, ngVals); saveLocal(); $("newgame-panel").classList.add("hidden"); $("seed-in").value = "";
        renderAll(); renderDisplayUI(); log(`New run started (seed ${S.seed}).`);
    };
    window.addEventListener("pagehide", saveLocal);
    document.addEventListener("visibilitychange", () => {
        if (document.hidden) { saveLocal(); sampleHist(true); push(true); }
        else advance() ? renderAll() : renderDynamic();
    });
}

async function fetchFresh(u) { // revalidate with the server; use the cached copy when offline
    try { const r = await fetch(u, { cache: "no-cache" }); if (r.ok) return r; } catch (e) { /* offline */ }
    return fetch(u, { cache: "force-cache" });
}

async function init() {
    G0 = await (await fetchFresh("gamedata.json")).text(); GP = JSON.parse(G0); applyRules({});
    document.title = G.meta.title; $("game-h1").textContent = G.meta.title;
    S = loadLocal();
    if (S) { applyRules(S.rules); ensure(); recenter(); } else startNew(randSeed());
    await loadSettings(); applyLayout(); await useRenderer(); renderDisplayUI();
    loadCredsUI(); syncUI(); bindEvents();
    advance(); checkUnlocks(); renderAll();
    setInterval(() => { const a = advance(), b = runAuto(); a || b ? renderAll() : renderDynamic(); sampleHist(); }, 1000);
    setInterval(saveLocal, G.meta.autoSaveMs);
}
init();
