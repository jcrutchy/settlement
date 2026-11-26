"use strict";
const $ = id => document.getElementById(id), NS = "http://www.w3.org/2000/svg", DRAFT = "settlement_builder_draft";
const KIND = { resource: ["R:", "#d97706"], job: ["J:", "#60a5fa"], building: ["B:", "#34d399"], deposit: ["D:", "#8b949e"], tech: ["T:", "#a78bfa"] };
const EDGE = { unlock: ["#d97706", "5 4"], cost: ["#f87171", ""], flow: ["#34d399", ""], source: ["#8b949e", "2 3"] };
const W = 140, H = 30, GX = 28, GY = 6;
let G, N, E, els, sel = null;

function s(tag, a = {}, ...kids) {
    const e = document.createElementNS(NS, tag);
    for (const k in a) e.setAttribute(k, a[k]);
    e.append(...kids.filter(Boolean)); return e;
}
const condRefs = (c, o = []) => {
    if (!c) return o;
    (c.all || c.any || []).forEach(x => condRefs(x, o));
    if (c.resource !== undefined) o.push("R:" + c.resource);
    if (c.tech !== undefined) o.push("T:" + c.tech);
    if (c.building !== undefined) o.push("B:" + c.building);
    return o;
};
const condText = c => !c ? "" : c.all ? c.all.map(condText).join(" and ") : c.any ? "(" + c.any.map(condText).join(" or ") + ")" : c.tech !== undefined ? "research " + c.tech : `${c.resource ?? c.building} ≥ ${c.gte}`;
const mapText = m => Object.entries(m || {}).map(([k, v]) => `${v} ${k}`).join(", ");

function build() {
    N = {}; E = [];
    for (const kind in KIND) (G[kind === "resource" ? "resources" : kind + "s"] || []).forEach((x, i) => N[KIND[kind][0] + x.id] = { key: KIND[kind][0] + x.id, kind, item: x, order: i, depth: 0 });
    const edge = (a, b, t) => { if (N[a] && N[b]) E.push({ a, b, t }); };
    Object.values(N).forEach(n => {
        const x = n.item;
        condRefs(x.requires).forEach(r => edge(r, n.key, "unlock"));
        if (n.kind === "building" || n.kind === "tech") Object.keys(x.cost || {}).forEach(k => edge("R:" + k, n.key, "cost"));
        if (n.kind === "job") {
            Object.keys(x.inputs || {}).forEach(k => edge("R:" + k, n.key, "flow"));
            Object.keys(x.outputs || {}).forEach(k => edge(n.key, "R:" + k, "flow"));
            if (x.deposit) edge("D:" + x.deposit, n.key, "source");
            if (x.slots) edge("B:" + x.slots.building, n.key, "unlock");
        }
    });
    // depth = longest path. Loops are normal here (food pays for the hunting tech that unlocks hunters that make food), so find them with a
    // depth-first walk from the deposits and ignore only the back edges when layering; they are still drawn.
    const out = {}, state = {}, back = new Set();
    E.forEach(e => (out[e.a] = out[e.a] || []).push(e));
    const walk = k => { state[k] = 1; (out[k] || []).forEach(e => { if (state[e.b] === 1) back.add(e); else if (!state[e.b]) walk(e.b); }); state[k] = 2; };
    Object.keys(KIND).forEach(kind => Object.values(N).forEach(n => { if (n.kind === kind && !state[n.key]) walk(n.key); }));
    for (let i = 0, ch = true; ch && i <= Object.keys(N).length; i++) {
        ch = false;
        E.forEach(e => { if (!back.has(e) && N[e.a].depth + 1 > N[e.b].depth) { N[e.b].depth = N[e.a].depth + 1; ch = true; } });
    }
}

function describe(n) {
    const x = n.item, p = [`${x.name || x.id} (${n.kind})`];
    if (x.requires) p.push("unlocks when " + condText(x.requires));
    if (n.kind === "building" || n.kind === "tech") { p.push("cost " + mapText(x.cost)); (x.effects || []).forEach(e => p.push(`${e.type} ${e.resource || ""} +${e.value}`.replace("  ", " "))); }
    if (n.kind === "job") p.push((x.inputs ? mapText(x.inputs) + " → " : "") + mapText(x.outputs) + " per second");
    if (n.kind === "resource") { p.push("capacity " + x.cap); if (x.manual) p.push("gatherable by hand"); }
    if (n.kind === "deposit") p.push(`${x.perTile} ${x.resource} per ${x.terrain} tile, ${x.regrow ? "regrows" : "finite"}`);
    return p.join(" · ");
}

function trace(start) { // everything upstream and downstream of a node
    const keep = new Set([start]);
    [["a", "b"], ["b", "a"]].forEach(([from, to]) => {
        const seen = new Set([start]), q = [start];
        while (q.length) { const k = q.pop(); E.forEach(e => { if (e[to] === k && !seen.has(e[from])) { seen.add(e[from]); q.push(e[from]); } }); }
        seen.forEach(k => keep.add(k));
    });
    return keep;
}

function select(k) {
    sel = sel === k ? null : k;
    const keep = sel ? trace(sel) : null;
    Object.keys(N).forEach(key => els.n[key].setAttribute("opacity", !keep || keep.has(key) ? 1 : 0.15));
    E.forEach((e, i) => els.e[i].setAttribute("opacity", !keep || (keep.has(e.a) && keep.has(e.b)) ? 0.9 : 0.06));
    $("info").textContent = sel ? describe(N[sel]) : "";
}

function render() {
    build();
    const lanes = ["deposit", "resource", "job", "building", "tech"], LW = W + GX, TOP = 34;
    const maxDepth = Math.max(0, ...Object.values(N).map(n => n.depth)), STEP = H + GY;
    const biggest = Math.max(...lanes.map(k => Object.values(N).filter(n => n.kind === k).length));
    const K = Math.max(STEP / 2, biggest * STEP / (maxDepth + 1)); // vertical room per tier, so the fullest lane is about as tall as the tree
    let y = TOP;
    lanes.forEach(k => { // pack each lane on its own, in tier order, so empty tiers leave no gaps
        let ly = TOP;
        Object.values(N).filter(n => n.kind === k).sort((p, q) => p.depth - q.depth || p.order - q.order).forEach(n => {
            ly = Math.max(ly, TOP + Math.round(n.depth * K)); n.x = 10 + lanes.indexOf(k) * LW + GX / 2; n.y = ly; ly += STEP;
        });
        y = Math.max(y, ly);
    });
    const width = lanes.length * LW + 20, height = y + 12;
    els = { n: {}, e: [] };
    const svg = s("svg", { width, height, viewBox: `0 0 ${width} ${height}` });
    svg.onclick = ev => { if (ev.target === svg && sel) select(sel); };
    lanes.forEach((k, i) => {
        svg.append(s("rect", { x: 10 + i * LW, y: 0, width: LW, height, fill: i % 2 ? "#0b0d10" : "#10131a" }),
            Object.assign(s("text", { x: 10 + i * LW + LW / 2, y: 20, "text-anchor": "middle", fill: KIND[k][1], style: "font:600 11px ui-monospace,monospace;letter-spacing:.1em" }), { textContent: k.toUpperCase() + "S" }));
    });
    const path = e => {
        const a = N[e.a], b = N[e.b];
        if (b.y > a.y + H / 2) { // normal case: flows down a tier
            const x1 = a.x + W / 2, y1 = a.y + H, x2 = b.x + W / 2, y2 = b.y, dy = Math.max(24, (y2 - y1) / 2);
            return `M${x1},${y1} C${x1},${y1 + dy} ${x2},${y2 - dy} ${x2},${y2}`;
        }
        const r = b.x >= a.x, x1 = r ? a.x + W : a.x, x2 = r ? b.x : b.x + W, y1 = a.y + H / 2, y2 = b.y + H / 2, dx = r ? 40 : -40;
        return `M${x1},${y1} C${x1 + dx},${y1} ${x2 - dx},${y2} ${x2},${y2}`;
    };
    E.forEach(e => {
        const p = s("path", { d: path(e), fill: "none", stroke: EDGE[e.t][0], "stroke-width": 1.5, "stroke-dasharray": EDGE[e.t][1], opacity: 0.9 });
        els.e.push(p); svg.append(p);
    });
    Object.values(N).forEach(n => {
        const label = ((n.item.icon || "") + " " + (n.item.name || n.item.id)).trim();
        const g = s("g", { class: "nd", transform: `translate(${n.x},${n.y})` },
            s("rect", { width: W, height: H, rx: 5, fill: "#181b22", stroke: KIND[n.kind][1], "stroke-width": 1.5 }),
            Object.assign(s("text", { x: 8, y: H / 2 + 4 }), { textContent: label.length > 19 ? label.slice(0, 18) + "…" : label }));
        g.onclick = () => select(n.key); els.n[n.key] = g; svg.append(g);
    });
    $("wrap").replaceChildren(svg); sel = null; $("info").textContent = "";
}

async function init() {
    const draft = localStorage.getItem(DRAFT);
    const repo = async () => { G = await (await fetch("gamedata.json", { cache: "no-cache" })).json(); $("src").textContent = "Showing gamedata.json"; render(); };
    if (draft) {
        $("draft-btn").hidden = false;
        let showDraft = false;
        $("draft-btn").onclick = async () => { showDraft = !showDraft; $("draft-btn").textContent = showDraft ? "Show repo version" : "Show builder draft"; if (showDraft) { G = JSON.parse(draft); $("src").textContent = "Showing builder draft (unsaved)"; render(); } else await repo(); };
        $("draft-btn").textContent = "Show builder draft";
    }
    try { await repo(); } catch (e) { $("info").textContent = "Could not load gamedata.json: " + e.message; }
}
init();
