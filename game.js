"use strict";
let G, S, RES = {}, quiet = false;
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

// Seeded PRNG (mulberry32): same seed -> same world on every device
function rng(seed) {
    let a = seed >>> 0;
    return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}

// --- STATE ---
function newState(seed, prev) {
    const r = rng(seed);
    const s = { version: 2, seed, rev: prev ? prev.rev + 1 : 0, cloudRev: prev ? prev.cloudRev : 0, lastTick: Date.now(),
        res: {}, unlocked: {}, pop: 0, growth: 0, starve: 0, jobs: {}, bld: {}, land: G.land.start, claims: 0, dep: {},
        logs: [`A clearing in the wilderness (seed ${seed}). Gather wood to build shelter.`] };
    G.deposits.forEach(d => { const k = Math.round(d.capacity * (1 - d.variance + 2 * d.variance * r())); s.dep[d.id] = { cap: k, amt: k }; });
    return s;
}

function ensure() { // fills in anything new in gamedata.json
    G.resources.forEach(r => { if (S.res[r.id] === undefined) S.res[r.id] = r.initial || 0; });
    G.jobs.forEach(j => { if (S.jobs[j.id] === undefined) S.jobs[j.id] = 0; });
    G.buildings.forEach(b => { if (S.bld[b.id] === undefined) S.bld[b.id] = 0; });
    G.deposits.forEach(d => { if (!S.dep[d.id]) S.dep[d.id] = { cap: d.capacity, amt: d.capacity }; });
}

function startNew(seed, prev) { S = newState(seed, prev); ensure(); checkUnlocks(true); }

// --- DATA-DRIVEN RULES ---
function met(c) {
    if (!c) return true;
    if (c.all) return c.all.every(met);
    if (c.any) return c.any.some(met);
    if (c.resource) return S.res[c.resource] >= c.gte;
    if (c.building) return S.bld[c.building] >= c.gte;
    return false;
}

function checkUnlocks(silent) {
    let changed = false;
    [["res", G.resources, "Discovered resource"], ["job", G.jobs, "New role available"], ["bld", G.buildings, "New structure unlocked"]].forEach(([k, list, msg]) => {
        list.forEach(x => {
            const key = k + ":" + x.id;
            if (!S.unlocked[key] && met(x.requires)) { S.unlocked[key] = true; changed = true; if (!silent) log(`${msg}: ${x.name}.`); }
        });
    });
    return changed;
}

function eff(type, key) { // sum of a building effect type across everything built
    let t = 0;
    G.buildings.forEach(b => {
        const n = S.bld[b.id];
        if (n) b.effects.forEach(e => {
            if (e.type === type && (key === undefined || e.resource === key || (type === "capacity" && e.resource === "*"))) t += e.value * n;
        });
    });
    return t;
}

const capOf = id => RES[id].cap + eff("capacity", id);
const housing = () => eff("housing");
const usedPlots = () => G.buildings.reduce((a, b) => a + S.bld[b.id] * b.uses, 0);
const getIdle = () => Math.max(0, S.pop - sum(S.jobs));
const scaled = (cost, g, n) => {
    const m = g.type === "exp" ? Math.pow(g.rate, n) : g.type === "linear" ? 1 + g.rate * n : 1;
    const c = {}; for (const k in cost) c[k] = Math.ceil(cost[k] * m); return c;
};
const costOf = b => scaled(b.cost, b.growth || {}, S.bld[b.id]);
const claimCost = () => scaled(G.land.cost, G.land.growth, S.claims);
const afford = c => Object.entries(c).every(([k, v]) => S.res[k] >= v);
const spend = c => { for (const k in c) S.res[k] -= c[k]; };

// --- SIMULATION ---
function flows(dt) { // production/consumption per second for the next dt seconds
    const R = {}, harvest = {};
    G.resources.forEach(r => R[r.id] = { p: 0, c: 0 });
    for (const k in G.pop.needs) R[k].c += S.pop * G.pop.needs[k];
    G.jobs.forEach(j => {
        const n = S.jobs[j.id]; if (!n) return;
        let e = 1; // efficiency: limited by input stock
        for (const k in j.inputs || {}) { const need = n * j.inputs[k] * dt; if (need > 0) e = Math.min(e, S.res[k] / need); }
        e = Math.min(1, e);
        const d = j.deposit && S.dep[j.deposit];
        for (const k in j.outputs) {
            let o = n * j.outputs[k] * e * (1 + eff("outputMult", k));
            if (d) { o = d.cap > 0 ? Math.min(o * d.amt / d.cap, d.amt / dt) : 0; harvest[j.deposit] = (harvest[j.deposit] || 0) + o; }
            R[k].p += o;
        }
        for (const k in j.inputs || {}) R[k].c += n * j.inputs[k] * e;
    });
    return { R, harvest };
}

function trimJobs() {
    let over = sum(S.jobs) - S.pop;
    for (const k of Object.keys(S.jobs)) while (over > 0 && S.jobs[k] > 0) { S.jobs[k]--; over--; }
}

function step(dt) {
    const { R, harvest } = flows(dt);
    G.resources.forEach(r => { const x = R[r.id]; S.res[r.id] = Math.max(0, Math.min(S.res[r.id] + (x.p - x.c) * dt, capOf(r.id))); });
    G.deposits.forEach(d => { // logistic regrowth; tiny floor so a depleted deposit can recover
        const s = S.dep[d.id], seed = Math.max(s.amt, 0.02 * s.cap);
        s.amt = Math.max(0, Math.min(s.cap, s.amt - (harvest[d.id] || 0) * dt + d.regrow * seed * (1 - s.amt / s.cap) * dt));
    });
    if (S.res.food <= 0 && S.pop > 0) { // deterministic: progress accumulates, no dice
        S.starve += G.pop.starveRate * dt;
        if (S.starve >= 1) { S.starve -= 1; S.pop--; trimJobs(); log("Starvation! A settler has left the camp.", true); }
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
    quiet = away;
    while (left > 0) { const dt = Math.min(st, left); step(dt); left -= dt; }
    quiet = false;
    if (away) log(`Welcome back. Simulated ${Math.round(total / 60)} min away; population ${S.pop >= p0 ? "+" : ""}${S.pop - p0}.`);
    return checkUnlocks();
}

// --- PLAYER ACTIONS (each bumps rev, which drives sync conflict detection) ---
function gather(id) {
    const d = G.deposits.find(x => x.resource === id);
    if ((d && S.dep[d.id].amt < 1) || S.res[id] >= capOf(id)) return;
    S.res[id]++; if (d) S.dep[d.id].amt--;
    S.rev++; checkUnlocks(); renderDynamic();
}
function adjustJob(id, delta) {
    if (delta > 0 && getIdle() > 0) S.jobs[id]++; else if (delta < 0 && S.jobs[id] > 0) S.jobs[id]--; else return;
    S.rev++; renderDynamic();
}
function build(id) {
    const b = G.buildings.find(x => x.id === id), c = costOf(b);
    if (!afford(c) || usedPlots() + b.uses > S.land) return;
    spend(c); S.bld[id]++; S.rev++;
    log(`Built ${b.name} (${S.bld[id]}).`); checkUnlocks(); renderAll();
}
function claimLand() {
    const c = claimCost(); if (!afford(c)) return;
    spend(c); S.claims++; S.land += G.land.plotsPerClaim; S.rev++;
    for (const k in G.land.grants) { S.dep[k].cap += G.land.grants[k]; S.dep[k].amt += G.land.grants[k]; }
    log(`Claimed ${G.land.plotsPerClaim} more plots of land.`); renderAll();
}

// --- UI ---
function log(msg, spam) {
    if (spam && quiet) return;
    S.logs.unshift(`[${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}] ${msg}`);
    S.logs.length = Math.min(S.logs.length, 20);
    if (!quiet) renderLogs();
}
function renderLogs() { $("log-panel").innerHTML = S.logs.map(l => `<div class="log-entry">${esc(l)}</div>`).join(""); }

function renderAll() {
    renderLogs();
    const rs = G.resources.filter(r => S.unlocked["res:" + r.id]);
    const badge = "font-size:0.65rem;padding:1px 4px;";
    $("resources-list").innerHTML = rs.map(r => `<div class="stat-card"><div class="stat-card-content"><span>${r.icon} ${r.name}</span><strong id="res-val-${r.id}">0</strong><div style="display:flex;gap:4px;flex-wrap:wrap;margin-top:4px;"><span class="rate-badge positive" style="${badge}" id="res-prod-${r.id}"></span><span class="rate-badge negative" style="${badge}" id="res-cons-${r.id}"></span><span class="rate-badge neutral" style="${badge}" id="res-net-${r.id}"></span></div></div></div>`).join("");
    $("manual-actions").innerHTML = rs.filter(r => r.manual).map(r => `<button onclick="gather('${r.id}')">+ Gather ${r.name}</button>`).join("");
    $("deposits-list").innerHTML = G.deposits.map(d => `<div class="row-item"><div class="row-info"><strong>${d.name}</strong><span id="dep-${d.id}"></span></div></div>`).join("");
    $("jobs-list").innerHTML = G.jobs.filter(j => S.unlocked["job:" + j.id]).map(j => `<div class="row-item"><div class="row-info"><strong>${j.name}</strong><span>${j.inputs ? ioStr(j.inputs) + " → " : ""}${ioStr(j.outputs)}</span></div><div class="button-row" style="align-items:center;"><button onclick="adjustJob('${j.id}',-1)">-</button><span class="badge" id="job-val-${j.id}">0</span><button id="job-add-${j.id}" onclick="adjustJob('${j.id}',1)">+</button></div></div>`).join("");
    $("buildings-list").innerHTML = G.buildings.filter(b => S.unlocked["bld:" + b.id]).map(b => `<div class="row-item"><div class="row-info"><strong id="bld-name-${b.id}"></strong><span id="bld-desc-${b.id}"></span></div><button id="bld-btn-${b.id}" onclick="build('${b.id}')">Build</button></div>`).join("");
    renderDynamic();
}

function renderDynamic() {
    const { R } = flows(1), set = (id, t) => { const e = $(id); if (e) e.textContent = t; };
    G.resources.forEach(r => {
        const x = R[r.id], net = x.p - x.c;
        set("res-val-" + r.id, fmt(S.res[r.id]) + " / " + fmt(capOf(r.id)));
        set("res-prod-" + r.id, "P: +" + x.p.toFixed(1));
        set("res-cons-" + r.id, "C: -" + x.c.toFixed(1));
        const n = $("res-net-" + r.id);
        if (n) { n.textContent = "Net: " + (net > 0 ? "+" : "") + net.toFixed(1); n.className = "rate-badge " + (net > 0 ? "positive" : net < 0 ? "negative" : "neutral"); }
    });
    G.deposits.forEach(d => { const s = S.dep[d.id]; set("dep-" + d.id, `${Math.floor(s.amt)} / ${s.cap} ${d.resource} (${d.regrow ? "regrows" : "finite"})`); });
    const free = S.land - usedPlots(), cc = claimCost(), cb = $("claim-land-btn");
    set("land-counter", `${usedPlots()} / ${S.land} plots`);
    set("seed-hint", `World seed ${S.seed}. Buildings need a free plot; claiming more land gets pricier the more you hold.`);
    cb.textContent = `Claim ${G.land.plotsPerClaim} plots (${costStr(cc)})`; cb.disabled = !afford(cc);
    set("pop-counter", `${S.pop} / ${housing()}`);
    set("idle-pop", getIdle());
    set("needs-hint", `(each villager consumes ${ioStr(G.pop.needs)})`);
    G.jobs.forEach(j => { set("job-val-" + j.id, S.jobs[j.id]); const a = $("job-add-" + j.id); if (a) a.disabled = getIdle() < 1; });
    G.buildings.forEach(b => {
        const c = costOf(b);
        set("bld-name-" + b.id, `${b.name} (${S.bld[b.id]})`);
        set("bld-desc-" + b.id, `${b.desc} • Cost: ${costStr(c)} • Plots: ${b.uses}`);
        const btn = $("bld-btn-" + b.id); if (btn) btn.disabled = !afford(c) || free < b.uses;
    });
}

// --- PERSISTENCE & SECRET GIST SYNC ---
function saveLocal() { localStorage.setItem(KEY, JSON.stringify(S)); }
function loadLocal() {
    try { const p = JSON.parse(localStorage.getItem(KEY)); if (p && p.version === 2) return p; } catch (e) { console.error(e); }
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
        if (cloud && cloud.version === 2 && cloud.rev > S.cloudRev) {
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
        if (!cloud || cloud.version !== 2) throw new Error("No v0.4 save in the gist yet. Push one first.");
        if (S.rev > S.cloudRev && !confirm("This device has progress that hasn't been pushed. Replace it with the cloud save?")) return setStatus("Pull cancelled.");
        S = cloud; S.cloudRev = S.rev; ensure(); advance(); saveLocal(); renderAll();
        setStatus("Loaded cloud save.");
    } catch (e) { setStatus("Pull failed: " + e.message, true); }
}

function bindEvents() {
    $("toggle-sync-btn").onclick = () => $("sync-panel").classList.toggle("hidden");
    $("gist-token").oninput = $("gist-id").oninput = saveCreds;
    $("push-gist-btn").onclick = () => push(false);
    $("pull-gist-btn").onclick = pull;
    $("claim-land-btn").onclick = claimLand;
    $("local-save-btn").onclick = () => { saveLocal(); log("Game saved locally."); };
    $("hard-reset-btn").onclick = () => {
        if (!confirm("Start a new run? This replaces the current save.")) return;
        const t = prompt("World seed (blank for random):", "");
        if (t === null) return;
        startNew(t.trim() ? toSeed(t.trim()) : randSeed(), S); saveLocal(); renderAll();
    };
    window.addEventListener("pagehide", saveLocal);
    document.addEventListener("visibilitychange", () => {
        if (document.hidden) { saveLocal(); push(true); }
        else advance() ? renderAll() : renderDynamic();
    });
}

async function init() {
    G = await (await fetch("gamedata.json", { cache: "no-cache" })).json();
    G.resources.forEach(r => RES[r.id] = r);
    document.title = G.meta.title; $("game-h1").textContent = G.meta.title;
    S = loadLocal();
    if (S) ensure(); else startNew(randSeed());
    loadCredsUI(); syncUI(); bindEvents();
    advance(); checkUnlocks(); renderAll();
    setInterval(() => { advance() ? renderAll() : renderDynamic(); }, 1000);
    setInterval(saveLocal, G.meta.autoSaveMs);
}
init();
