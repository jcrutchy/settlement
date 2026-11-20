"use strict";
// Live charts from the history the game records in localStorage (same browser only). No dependencies.
const HKEY = "settlement_history_v1";
const RANGES = [["10 min", 6e5], ["1 h", 36e5], ["6 h", 216e5], ["24 h", 864e5], ["14 d", 12096e5], ["All", Infinity]];
const COVER = [3.6e6, 8.64e7, 1.2096e9]; // how far back each history tier reaches
const MODES = [["levels", "Levels"], ["net", "Net rate"], ["flows", "Production vs consumption"]];
let G = { resources: [], deposits: [] }, H = null, raw = null, range = 1, mode = "levels";
const $ = id => document.getElementById(id);

function h(tag, p = {}, ...kids) {
    const e = document.createElement(tag);
    for (const k in p) { if (k.startsWith("on") || ["textContent", "className"].includes(k)) e[k] = p[k]; else e.setAttribute(k, p[k]); }
    e.append(...kids.flat().filter(c => c != null && c !== false));
    return e;
}
const fmt = x => !isFinite(x) ? "-" : Math.abs(x) >= 1e4 ? (x / 1e3).toFixed(1) + "k" : Math.abs(x) >= 100 ? x.toFixed(0) : Math.abs(x) >= 10 ? x.toFixed(1) : x.toFixed(2);
const fmtT = (t, long) => { const d = new Date(t); return long ? d.toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }); };

// --- data ---
function load() {
    const s = localStorage.getItem(HKEY);
    if (s === raw) return false;
    raw = s; try { H = JSON.parse(s); } catch (e) { H = null; }
    return true;
}
function view() { // rows for the chosen range, from the finest tier that covers it
    if (!H) return null;
    const want = RANGES[range][1];
    let ti = COVER.findIndex(c => c >= want); if (ti < 0) ti = 2;
    while (ti > 0 && H.tiers[ti].length < 24) ti--; // too few points: use a finer tier
    const end = (H.tiers[0].length ? H.tiers[0][H.tiers[0].length - 1] : H.tiers[ti][H.tiers[ti].length - 1] || [Date.now()])[0];
    const rows = H.tiers[ti].filter(r => want === Infinity || r[0] >= end - want), ix = {};
    H.keys.forEach((k, i) => ix[k] = i + 1);
    return { rows, t: rows.map(r => r[0]), has: k => k in ix, col: k => rows.map(r => r[ix[k]]) };
}

// --- chart drawing ---
function draw(cv, o, cur) {
    const dpr = window.devicePixelRatio || 1, W = cv.clientWidth, Ht = cv.clientHeight;
    if (cv.width !== Math.round(W * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(Ht * dpr); }
    const c = cv.getContext("2d"); c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, W, Ht);
    const PL = 46, PR = 8, PT = 8, PB = 18, pw = W - PL - PR, ph = Ht - PT - PB, n = o.t.length;
    const vals = o.lines.flatMap(l => l.v.filter(Number.isFinite));
    if (!vals.length || n < 2) return;
    let lo = Math.min(...vals, o.zero ? 0 : Infinity), hi = Math.max(...vals, o.zero ? 0 : -Infinity);
    if (hi - lo < 1e-9) hi = lo + 1;
    const pad = (hi - lo) * 0.06; hi += pad; if (lo < 0 || !o.zero) lo = o.nonneg ? Math.max(0, lo - pad) : lo - pad;
    const t0 = o.t[0], t1 = o.t[n - 1], X = t => PL + (t - t0) / (t1 - t0 || 1) * pw, Y = v => PT + (hi - v) / (hi - lo) * ph;
    c.font = "10px ui-monospace, monospace"; c.lineWidth = 1;
    [hi, (hi + lo) / 2, lo].forEach(v => {
        c.strokeStyle = "#232832"; c.beginPath(); c.moveTo(PL, Y(v)); c.lineTo(W - PR, Y(v)); c.stroke();
        c.fillStyle = "#8b949e"; c.textAlign = "right"; c.fillText(fmt(v), PL - 5, Y(v) + 3);
    });
    if (lo < 0 && hi > 0) { c.strokeStyle = "#4b5563"; c.beginPath(); c.moveTo(PL, Y(0)); c.lineTo(W - PR, Y(0)); c.stroke(); }
    const long = t1 - t0 > 864e5;
    c.fillStyle = "#8b949e"; c.textAlign = "left"; c.fillText(fmtT(t0, long), PL, Ht - 4); c.textAlign = "right"; c.fillText(fmtT(t1, long), W - PR, Ht - 4);
    const gap = Math.max((t1 - t0) / (n - 1) * 4, 30000), base = Y(Math.max(lo, Math.min(hi, 0)));
    o.lines.forEach(l => {
        const runs = []; let run = [];
        l.v.forEach((v, i) => { if (!Number.isFinite(v)) return; if (run.length && o.t[i] - o.t[run[run.length - 1]] > gap) { runs.push(run); run = []; } run.push(i); });
        if (run.length) runs.push(run);
        runs.forEach(r => {
            c.beginPath(); r.forEach((i, k) => k ? c.lineTo(X(o.t[i]), Y(l.v[i])) : c.moveTo(X(o.t[i]), Y(l.v[i])));
            c.strokeStyle = l.color; c.lineWidth = 1.5; c.stroke();
            if (l.fill && r.length > 1) { c.lineTo(X(o.t[r[r.length - 1]]), base); c.lineTo(X(o.t[r[0]]), base); c.closePath(); c.globalAlpha = 0.15; c.fillStyle = l.color; c.fill(); c.globalAlpha = 1; }
        });
    });
    if (cur != null) {
        c.strokeStyle = "#e2e8f0"; c.lineWidth = 1; c.beginPath(); c.moveTo(X(o.t[cur]), PT); c.lineTo(X(o.t[cur]), PT + ph); c.stroke();
        o.lines.forEach(l => { if (Number.isFinite(l.v[cur])) { c.fillStyle = l.color; c.beginPath(); c.arc(X(o.t[cur]), Y(l.v[cur]), 3, 0, 7); c.fill(); } });
    }
    cv._geom = { PL, pw, t0, t1 };
}

function card(title, o, text) { // text(i) -> readout for sample i
    const cv = h("canvas", { class: "cv" }), val = h("span", { class: "muted" });
    const last = o.t.length - 1, show = i => { val.textContent = text(i); };
    show(last);
    const move = e => {
        const g = cv._geom; if (!g) return;
        const t = g.t0 + (e.offsetX - g.PL) / g.pw * (g.t1 - g.t0);
        let best = 0; o.t.forEach((x, i) => { if (Math.abs(x - t) < Math.abs(o.t[best] - t)) best = i; });
        draw(cv, o, best); val.textContent = fmtT(o.t[best], true) + "  " + text(best);
    };
    cv.onpointermove = move; cv.onpointerdown = move;
    cv.onpointerleave = () => { draw(cv, o); show(last); };
    const el = h("div", { class: "panel" }, h("div", { class: "section-header" }, h("strong", { textContent: title }), val), cv);
    el.draw = () => draw(cv, o);
    return el;
}

// --- page ---
function render() {
    const v = view(), grid = $("grid"); if (!grid) return;
    if (!v || v.rows.length < 2) { grid.replaceChildren(h("p", { class: "hint", textContent: "No history yet. Play for a minute with the game open in this browser; samples are taken every 10 seconds." })); return; }
    const cards = [];
    cards.push(card("👥 Population", { t: v.t, lines: [{ v: v.col("pop"), color: "#d97706", fill: true }, { v: v.col("house"), color: "#8b949e" }, { v: v.col("idle"), color: "#60a5fa" }], nonneg: true },
        i => `pop ${v.col("pop")[i]} / housing ${v.col("house")[i]} · idle ${v.col("idle")[i]}`));
    G.resources.forEach(r => {
        if (!v.has(r.id + ":l")) return;
        const L = v.col(r.id + ":l"), P = v.col(r.id + ":p"), C = v.col(r.id + ":c");
        if (![...L, ...P, ...C].some(x => x)) return; // never used in this range
        const N = P.map((p, i) => Math.round((p - C[i]) * 100) / 100), title = `${r.icon || ""} ${r.name}`;
        if (mode === "levels") cards.push(card(title, { t: v.t, lines: [{ v: L, color: "#d97706", fill: true }], nonneg: true }, i => `${fmt(L[i])} / ${r.cap}+ · net ${N[i] > 0 ? "+" : ""}${fmt(N[i])}/s`));
        else if (mode === "net") cards.push(card(title, { t: v.t, lines: [{ v: N, color: "#34d399", fill: true }], zero: true }, i => `net ${N[i] > 0 ? "+" : ""}${fmt(N[i])}/s`));
        else cards.push(card(title, { t: v.t, lines: [{ v: P, color: "#34d399" }, { v: C, color: "#f87171" }], zero: true, nonneg: true }, i => `+${fmt(P[i])}/s produced · -${fmt(C[i])}/s used`));
    });
    const deps = G.deposits.filter(d => v.has("dep:" + d.id));
    if (deps.length) {
        const pal = ["#34d399", "#60a5fa", "#f59e0b", "#f87171", "#a78bfa"];
        cards.push(card("⛏️ Deposits", { t: v.t, lines: deps.map((d, k) => ({ v: v.col("dep:" + d.id), color: pal[k % pal.length] })), nonneg: true },
            i => deps.map(d => `${d.name} ${fmt(v.col("dep:" + d.id)[i])}`).join(" · ")));
    }
    grid.replaceChildren(...cards); cards.forEach(c => c.draw());
}

function status() {
    const el = $("status"); if (!el) return;
    const last = H && H.tiers[0].length ? H.tiers[0][H.tiers[0].length - 1][0] : 0;
    el.textContent = !last ? "waiting for the game" : (Date.now() - last < 45000 ? "live" : "paused") + " · last sample " + Math.round((Date.now() - last) / 1000) + "s ago";
}

async function fetchFresh(u) {
    try { const r = await fetch(u, { cache: "no-cache" }); if (r.ok) return r; } catch (e) { /* offline */ }
    return fetch(u, { cache: "force-cache" });
}

async function init() {
    const st = document.createElement("style");
    st.textContent = "body{max-width:1400px}#grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:14px}#grid .panel{margin:0}.cv{width:100%;height:130px;display:block;margin-top:8px;touch-action:pan-y}.muted{color:var(--muted);font:0.8rem var(--font-mono)}.seg{display:flex;gap:6px;flex-wrap:wrap}";
    document.head.append(st);
    const seg = (items, get, set) => h("div", { class: "seg" }, items.map(([k, label], i) => h("button", { class: get(i, k) ? "btn-primary" : "", textContent: label, onclick: () => { set(i, k); controls(); render(); } })));
    const controls = () => $("controls").replaceChildren(
        seg(RANGES, i => i === range, i => range = i), seg(MODES, (i, k) => k === mode, (i, k) => mode = k));
    $("app").replaceChildren(
        h("header", {}, h("div", { class: "title-bar" }, h("h1", { textContent: "STATS" }), h("span", {}, h("a", { href: "index.html", class: "muted", textContent: "game" }), " · ", h("a", { href: "tree.html", class: "muted", textContent: "tech tree" }))),
            h("div", { id: "controls", class: "button-row", style: "gap:14px;" }), h("p", { class: "hint", id: "status", style: "margin-top:8px;" })),
        h("main", {}, h("div", { id: "grid" })));
    controls();
    try { G = await (await fetchFresh("gamedata.json")).json(); } catch (e) { /* charts fall back to raw ids */ }
    load(); render(); status();
    window.addEventListener("storage", e => { if (e.key === HKEY && load()) { render(); status(); } }); // fires when the game tab writes
    setInterval(() => { if (load()) render(); }, 5000);
    setInterval(status, 1000);
    let rt; window.addEventListener("resize", () => { clearTimeout(rt); rt = setTimeout(render, 150); });
}
init();
