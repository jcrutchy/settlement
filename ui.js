"use strict";
// Everything that touches the page. S here is the player's settlement; engine calls pass it in.
let S, placing = null, selTile = null, armedBtn = null, armTimer = null, armedCtx = null, ngVals = {}, cam = { x: 0, y: 0 }, zoom = 28;

const $ = id => document.getElementById(id);

const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

const jobText = j => (j.inputs ? ioStr(j.inputs) + " → " : "") + ioStr(j.outputs)
    + (j.slots ? ` · needs ${G.buildings.find(b => b.id === j.slots.building).name} (${j.slots.per} workers each)` : "")
    + (j.deposit && S.dep[j.deposit].cap <= 0 ? ` · you own no ${[].concat(DEP[j.deposit].terrain).join("/")} tiles yet` : "");

function armed(btn, label, fn, ctx) { // two-tap confirm that works on phones (no native dialogs); ctx ties it to what was selected when armed
    if (armedBtn === btn && armedCtx === ctx) { clearTimeout(armTimer); armedBtn = null; btn.textContent = btn.dataset.orig; return fn(); }
    if (armedBtn) armedBtn.textContent = armedBtn.dataset.orig;
    armedBtn = btn; armedCtx = ctx; btn.dataset.orig = btn.dataset.orig || btn.textContent; btn.textContent = label;
    clearTimeout(armTimer); armTimer = setTimeout(() => { armedBtn = null; btn.textContent = btn.dataset.orig; }, 8000);
}

function recenter() { cam = { x: S.center.x + 0.5, y: S.center.y + 0.5 }; }

const clampZoom = z => Math.max(8, Math.min(64, z));

function tapTile(k) { // placing = key of the tile whose building is being moved
    const t = S.own[k];
    if (placing !== null && t && !t.b) {
        const src = S.own[placing], b = bOf(src.b), c = moveCost(S, b);
        if (!allowed(b, t.x, t.y)) { renderMap(); $("tile-info").textContent = `${b.name} can't go on that tile.`; return; }
        if (!afford(S, c)) { placing = null; return renderMap(); }
        moveBuilding(S, placing, k); placing = null; selTile = k; return renderAll();
    }
    placing = null; selTile = selTile === k ? null : k; renderMap(); renderDynamic();
}

function startMove() {
    const t = selTile && S.own[selTile];
    if (!t || !t.b || t.b === "center" || !afford(S, moveCost(S, bOf(t.b)))) return;
    placing = selTile; renderMap();
}

function claimTile() {
    if (!selTile) return;
    const [x, y] = selTile.split(",").map(Number);
    if (claimAt(S, x, y)) { selTile = null; renderAll(); }
}

function renderLogs() { $("log-panel").innerHTML = S.logs.map(l => `<div class="log-entry">${esc(l)}</div>`).join(""); }

function renderAll() {
    renderLogs(); renderMap();
    const rs = G.resources.filter(r => S.unlocked["res:" + r.id]);
    const badge = "font-size:0.65rem;padding:1px 4px;";
    $("resources-list").innerHTML = rs.map(r => `<div class="stat-card"><div class="stat-card-content"><span>${r.icon} ${r.name}</span><strong id="res-val-${r.id}">0</strong><div style="display:flex;gap:4px;flex-wrap:wrap;margin-top:4px;"><span class="rate-badge positive" style="${badge}" id="res-prod-${r.id}"></span><span class="rate-badge negative" style="${badge}" id="res-cons-${r.id}"></span><span class="rate-badge neutral" style="${badge}" id="res-net-${r.id}"></span></div></div></div>`).join("");
    $("manual-actions").innerHTML = rs.filter(r => r.manual).map(r => `<button onclick="UIACT.gather('${r.id}')">+ Gather ${r.name}</button>`).join("");
    $("tiers-list").innerHTML = (G.pop.tiers || []).filter(t => S.unlocked["tier:" + t.id]).map(t => `<div class="row-item"><div class="row-info"><strong>${esc(((t.icon || "") + " " + t.name).trim())}</strong><span id="tier-info-${t.id}"></span></div><span class="badge" id="tier-val-${t.id}">0%</span></div>`).join("");
    $("gauges-list").innerHTML = (G.gauges || []).map(g => `<div class="row-item"><div class="row-info"><strong>${esc(((g.icon || "") + " " + g.name).trim())}</strong><span id="gauge-info-${g.id}"></span></div><span class="badge" id="gauge-val-${g.id}">0%</span></div>`).join("");
    buildBar(); renderPolicies(); buildNeighbours();
    $("deposits-list").innerHTML = G.deposits.map(d => `<div class="row-item"><div class="row-info"><strong>${d.name}</strong><span id="dep-${d.id}"></span></div></div>`).join("");
    $("jobs-list").innerHTML = G.jobs.filter(j => S.unlocked["job:" + j.id]).map(j => `<div class="row-item"><div class="row-info"><strong>${j.name}</strong><span id="job-info-${j.id}"></span></div><div class="button-row" style="align-items:center;"><button onclick="UIACT.adjustJob('${j.id}',-1)">-</button><span class="badge" id="job-val-${j.id}">0</span><button id="job-add-${j.id}" onclick="UIACT.adjustJob('${j.id}',1)">+</button></div></div>`).join("");
    $("buildings-list").innerHTML = G.buildings.filter(b => S.unlocked["bld:" + b.id]).map(b => `<div class="row-item"><div class="row-info"><strong id="bld-name-${b.id}"></strong><span id="bld-desc-${b.id}"></span></div><button id="bld-btn-${b.id}" onclick="UIACT.build('${b.id}')">Build</button></div>`).join("");
    const techs = G.techs.filter(q => S.unlocked["tech:" + q.id] && !S.tech[q.id]);
    $("tech-list").replaceChildren(...(techs.length ? techs.map(q => {
        const d = document.createElement("div"); d.className = "row-item";
        d.innerHTML = `<div class="row-info"><strong>${esc(q.name)}</strong><span>${esc(q.desc || "")} Cost: ${esc(costStr(q.cost))}</span></div><button id="tech-btn-${q.id}" onclick="UIACT.research('${q.id}')">Research</button>`;
        return d;
    }) : [Object.assign(document.createElement("span"), { className: "hint", textContent: "Nothing to research right now. More appears as you build." })]));
    renderDynamic();
}

function renderMap() { // info line and buttons, then the canvas
    const cb = $("claim-tile-btn"), mb = $("move-btn"), db = $("demolish-btn"), mv = placing !== null;
    const xy = selTile ? selTile.split(",").map(Number) : null, t = selTile ? S.own[selTile] : null;
    const canEdit = !mv && t && t.b && t.b !== "center";
    let msg = mv ? `Tap one of your empty tiles to move ${bOf(S.own[placing].b).name} (costs ${costStr(moveCost(S, bOf(S.own[placing].b)))}).` : "Drag to pan, pinch or use +/- to zoom. Tap a tile to inspect it; claim tiles next to your land.";
    if (!mv && xy) {
        const tid = terrainAt(xy[0], xy[1]), ds = G.deposits.filter(q => dterr(q).includes(tid));
        msg = `${tid} (${xy[0]}, ${xy[1]})${ds.map(d => ` · ${tileCap(d, xy[0], xy[1])} ${d.name.toLowerCase()}`).join("")} · ${t ? (t.b ? (t.b === "center" ? "town centre" : bOf(t.b).name) : "yours, empty") : foreignAt(S, xy[0], xy[1]) ? "held by " + foreignAt(S, xy[0], xy[1]).name : claimable(S, xy[0], xy[1]) ? "next to your land" : "out of reach"}`;
    }
    $("tile-info").textContent = msg;
    cb.style.display = !mv && xy && !t && claimable(S, xy[0], xy[1]) ? "" : "none";
    cb.textContent = `Claim (${costStr(claimCost(S))})`;
    mb.style.display = db.style.display = canEdit ? "" : "none";
    if (canEdit) { mb.textContent = `Move (${costStr(moveCost(S, bOf(t.b)))})`; if (!(armedBtn === db && armedCtx === selTile)) { if (armedBtn === db) armedBtn = null; db.textContent = "Demolish"; } } // a pending confirm survives re-renders
    else if (armedBtn === db) { armedBtn = null; db.textContent = "Demolish"; }
    drawMap();
}

const RENDERERS = (window.SettlementRenderers = window.SettlementRenderers || {}), SKEY = "settlement_settings";

let SETTINGS = { available: [["classic", "Classic"]], render: { renderer: "classic", options: {} }, layout: { mapHeightVh: 55, resources: "auto" } }, animOn = false;

const WORLD = { // the read-only view of the game that renderers draw from
    terrainAt: (x, y) => terrainAt(x, y), terrain: id => TD[id], fallbackTerrain: () => G.map.terrain[G.map.terrain.length - 1].id,
    tile: (x, y) => S.own[K(x, y)] || null, key: K, claimable: (x, y) => claimable(S, x, y), allowed: (b, x, y) => allowed(b, x, y),
    building: id => bOf(id), centerIcon: () => G.map.centerIcon, selected: () => selTile, moving: () => placing !== null ? bOf(S.own[placing].b) : null,
    foreign: (x, y) => foreignAt(S, x, y), // another settlement's tile: { name, color, icon, b } or null (renderers may ignore it)
    owned: () => owned(S), isDepot: id => isDepot(id), deposits: () => G.deposits, depositsAt: (x, y) => G.deposits.filter(d => dterr(d).includes(terrainAt(x, y)))
};

const curRenderer = () => RENDERERS[SETTINGS.render.renderer];

const optsOf = rd => Object.fromEntries((rd.options || []).map(o => [o.id, ((SETTINGS.render.options[SETTINGS.render.renderer] || {})[o.id]) ?? o.default]));

const saveSettings = () => { try { localStorage.setItem(SKEY, JSON.stringify({ render: SETTINGS.render, layout: SETTINGS.layout })); } catch (e) { /* ignore */ } };

const applyLayout = () => { // resources: "bar" is the compact Civ-style top bar, "boxes" the stockpile cards, "auto" picks the bar on narrow screens
    $("map").style.height = SETTINGS.layout.mapHeightVh + "vh"; const m = SETTINGS.layout.resources;
    document.body.classList.toggle("resbar", m === "bar" || (m === "auto" && window.innerWidth < 900));
};

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
    const resPick = mk("select", { onchange: e => { SETTINGS.layout.resources = e.target.value; applyLayout(); saveSettings(); } }, ...[["auto", "Auto (bar on narrow screens)"], ["bar", "Compact top bar"], ["boxes", "Boxes"]].map(([id, name]) => mk("option", { value: id, textContent: name })));
    resPick.value = SETTINGS.layout.resources;
    box.replaceChildren(row("Graphics", pick), ...opts, row("Map height", height), row("Resources", resPick));
    renderAutoUI();
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
        list.forEach(x => { if (!S.unlocked[k + ":" + x.id]) need.push({ x, label, p: prog(S, x.requires) }); }));
    need.sort((a, b) => b.p - a.p);
    $("goals").replaceChildren(...(need.length ? need.slice(0, 4).map(n => {
        const d = document.createElement("div"); d.className = "row-item";
        d.innerHTML = `<div class="row-info"><strong>${esc(((n.x.icon || "") + " " + n.x.name).trim())}</strong><span>${n.label} · needs ${esc(needText(S, n.x.requires))}</span></div><span class="badge">${Math.round(n.p * 100)}%</span>`;
        return d;
    }) : [Object.assign(document.createElement("span"), { className: "hint", textContent: "Everything is unlocked." })]));
}

const fxBits = o => { const pc = v => (v > 0 ? "+" : "") + Math.round(v * 100) + "%"; return [o.growth ? `${pc(o.growth)} arrivals` : "", o.output ? `${pc(o.output)} output` : ""].filter(Boolean).join(", "); };

const tierFx = t => { // short text for the Population panel: what a tier pays out when supplied, and costs when short
    const pc = v => (v > 0 ? "+" : "") + Math.round(v * 100) + "%", bit = o => [o.growth ? `${pc(o.growth)} arrivals` : "", o.output ? `${pc(o.output)} output` : ""].filter(Boolean).join(", ");
    return [bit(t.effects || {}) && `supplied: ${bit(t.effects)}`, bit(t.lack || {}) && `short: ${bit(t.lack)}`].filter(Boolean).join(" · ") || "no effect";
};

function effText(list) { // short readable form of an effect list
    const pc = v => (v > 0 ? "+" : "") + Math.round(v * 100) + "%", nm = k => (RES[k] ? RES[k].name.toLowerCase() : k);
    return list.map(e => e.type === "output" ? `${pc(e.value)} output` : e.type === "growth" ? `${pc(e.value)} arrivals` : e.type === "outputMult" ? `${pc(e.value)} ${nm(e.resource)}`
        : e.type === "gauge" ? `${pc(e.value)} ${((G.gauges || []).find(g => g.id === e.resource) || { name: e.resource }).name.toLowerCase()}` : e.type === "capacity" ? `+${e.value} ${e.resource === "*" ? "storage" : nm(e.resource) + " storage"}`
        : e.type === "preserve" ? `slower ${nm(e.resource)} spoilage` : e.type).join(", ");
}

const upkeepStr = o => Object.entries(o || {}).map(([k, v]) => `${+(S.pop * v * 60).toFixed(1)}/min ${RES[k].name.toLowerCase()}`).join(" + ");

function renderPolicies() {
    const list = (G.policies || []).filter(p => S.unlocked["pol:" + p.id]);
    $("policy-panel").classList.toggle("hidden", !list.length);
    $("policy-list").innerHTML = (G.policyGroups || []).map(g => {
        const ps = list.filter(p => p.group === g.id); if (!ps.length) return "";
        return `<h3 class="muted" style="margin:10px 0 4px;">${esc(g.name)}</h3>` + ps.map(p => `<div class="row-item"><div class="row-info"><strong>${esc(p.icon + " " + p.name)}</strong><span id="pol-desc-${p.id}"></span></div><button id="pol-btn-${p.id}" onclick="UIACT.togglePolicy('${p.id}')">Adopt</button></div>`).join("");
    }).join("");
}

function updatePolicies() {
    (G.policies || []).forEach(p => {
        const d = $("pol-desc-" + p.id); if (!d) return;
        const on = S.pol[p.id], other = (G.policies || []).some(o => o.group === p.group && o.id !== p.id && S.pol[o.id]);
        d.textContent = `${p.desc} (${effText(p.effects)}) · Cost: ${costStr(p.cost)}${p.upkeep ? " · Upkeep: " + upkeepStr(p.upkeep) : ""}${on && on.str < 0.99 ? " · LAPSING " + Math.round(on.str * 100) + "%: upkeep unpaid" : ""}`;
        const b = $("pol-btn-" + p.id); b.textContent = on ? "Revoke" : other ? "Replace" : "Adopt"; b.disabled = !on && !afford(S, p.cost);
        b.className = on ? "btn-primary" : "";
    });
}

let lastConds = "";

function renderConds() { // timed conditions from events, shown at the top of the Population panel
    const h = S.mods.map(m => `<div class="row-item"><div class="row-info"><strong>${esc((m.icon + " " + m.name).trim())}</strong><span>${esc(effText(m.effects))} · ${dur(m.left)} left</span></div></div>`).join("");
    if (h !== lastConds) { lastConds = h; $("conds-list").innerHTML = h; }
}

let selBar = null;

function buildBar() {
    const rs = G.resources.filter(r => S.unlocked["res:" + r.id]);
    $("resbar-items").innerHTML = `<span class="ri" data-k="pop">👥<b id="rb-pop"></b></span>` + (G.gauges || []).map(g => `<span class="ri" data-k="g:${g.id}">${g.icon || ""}<b id="rb-g-${g.id}"></b></span>`).join("")
        + rs.map(r => `<span class="ri" data-k="r:${r.id}">${r.icon}<b id="rb-v-${r.id}"></b><small id="rb-n-${r.id}"></small></span>`).join("");
    $("resbar-items").onclick = e => { const t = e.target.closest(".ri"); if (t) { selBar = selBar === t.dataset.k ? null : t.dataset.k; renderDynamic(); } };
}

function renderBar(R) {
    const set = (id, t) => { const e = $(id); if (e && e.textContent !== t) e.textContent = t; }, nf = v => (Math.abs(v) >= 100 ? fmt(Math.abs(v)) : Math.abs(v).toFixed(1));
    set("rb-pop", `${S.pop}/${housing(S)}`);
    (G.gauges || []).forEach(g => set("rb-g-" + g.id, Math.round(S.gauge[g.id] * 100) + "%"));
    G.resources.forEach(r => {
        const b = $("rb-v-" + r.id); if (!b) return;
        const x = R[r.id], net = x.p - x.c, cap = capOf(S, r.id);
        set("rb-v-" + r.id, fmt(S.res[r.id])); set("rb-n-" + r.id, Math.abs(net) < 0.05 ? "" : (net > 0 ? "+" : "−") + nf(net));
        b.className = S.res[r.id] >= cap - 0.01 && net >= 0 ? "full" : S.res[r.id] < 1 && net < 0 ? "low" : "";
        $("rb-n-" + r.id).className = net > 0.05 ? "pos" : net < -0.05 ? "neg" : "";
    });
    let d = "";
    if (selBar === "pop") d = `Population ${S.pop} of ${housing(S)} housing · ${getIdle(S)} idle`;
    else if (selBar && selBar.startsWith("g:")) { const g = G.gauges.find(x => "g:" + x.id === selBar); d = `${g.name} ${Math.round(S.gauge[g.id] * 100)}% · below ${Math.round(g.low.at * 100)}%: ${fxBits(g.low)}${g.high ? " · above " + Math.round(g.high.at * 100) + "%: " + fxBits(g.high) : ""}`; }
    else if (selBar && selBar.startsWith("r:")) { const r = RES[selBar.slice(2)], x = R[r.id], net = x.p - x.c, cap = capOf(S, r.id); d = `${r.icon} ${r.name} ${fmt(S.res[r.id])} / ${fmt(cap)} · made ${x.p.toFixed(1)}/s · used ${x.c.toFixed(1)}/s · net ${net > 0 ? "+" : ""}${net.toFixed(1)}/s${net > 0 && S.res[r.id] < cap ? " · full in " + dur((cap - S.res[r.id]) / net) : net < 0 && S.res[r.id] > 0 ? " · empty in " + dur(S.res[r.id] / -net) : ""}`; }
    else { const act = [...Object.keys(S.pol).map(id => polOf(id).name), ...S.mods.map(m => `${m.name} (${dur(m.left)})`)]; d = act.length ? "Active: " + act.join(" · ") : "Tap a resource for details"; }
    set("resbar-detail", d);
}

function renderDynamic() {
    const { R, harvest, T, mood } = flows(S, 1), set = (id, t) => { const e = $(id); if (e) e.textContent = t; };
    G.resources.forEach(r => {
        const x = R[r.id], net = x.p - x.c;
        set("res-val-" + r.id, fmt(S.res[r.id]) + " / " + fmt(capOf(S, r.id)));
        set("res-prod-" + r.id, "P: +" + x.p.toFixed(1));
        set("res-cons-" + r.id, "C: -" + x.c.toFixed(1));
        const n = $("res-net-" + r.id);
        if (n) { const full = net > 0 && S.res[r.id] >= capOf(S, r.id) - 0.01; n.textContent = full ? "FULL, wasting" : "Net: " + (net > 0 ? "+" : "") + net.toFixed(1); n.className = "rate-badge " + (net > 0 ? "positive" : net < 0 ? "negative" : "neutral"); }
    });
    renderBar(R); renderConds(); updatePolicies(); updateNeighbours();
    G.deposits.forEach(d => {
        const s = S.dep[d.id], hl = haul(S, d.id), rate = harvest[d.id] || 0;
        const y = d.regrow ? `yield ${s.cap > 0 ? Math.round(100 * s.amt / s.cap) : 0}% (regrows)` : rate > 0 ? `lasts ${dur(s.amt / rate)} at this rate` : s.amt > 0 ? "finite, untouched" : "exhausted";
        set("dep-" + d.id, `${Math.floor(s.amt)} / ${s.cap} ${d.resource} · ${y} · hauling ${Math.round(hl.eff * 100)}%, avg ${hl.avg.toFixed(1)} tiles`);
    });
    renderAlert(R); renderGoals();
    set("tech-count", `${Object.keys(S.tech).length} / ${G.techs.length} known`);
    G.techs.forEach(q => { const b = $("tech-btn-" + q.id); if (b) b.disabled = !afford(S, q.cost); });
    const free = freeTiles(S);
    set("land-counter", `${ownedCount(S)} tiles owned · ${free} free`);
    set("seed-hint", `World seed ${S.seed}. Claim tiles next to your land (pricier as you grow) and build on them. Structures are placed automatically; select one on the map to move or demolish it. Depots near deposits cut hauling loss.`);
    $("claim-tile-btn").disabled = selTile === null || !afford(S, claimCost(S));
    set("pop-counter", `${S.pop} / ${housing(S)}`);
    set("idle-pop", getIdle(S));
    set("needs-hint", `(each villager consumes ${ioStr(G.pop.needs)})`);
    const gsig = gaugeSignals(S, { R, mood });
    (G.gauges || []).forEach(g => {
        const v = S.gauge[g.id], tg = gaugeTarget(S, g, gsig), now = fxBits(gaugeFx(S, g)), arrow = tg > v + 0.005 ? "▲" : tg < v - 0.005 ? "▼" : "•";
        set("gauge-val-" + g.id, Math.round(v * 100) + "%");
        set("gauge-info-" + g.id, `${arrow} heading to ${Math.round(tg * 100)}%${now ? " · now " + now : ""} · below ${Math.round(g.low.at * 100)}%: ${fxBits(g.low)}${g.high ? " · above " + Math.round(g.high.at * 100) + "%: " + fxBits(g.high) : ""}`);
    });
    (G.pop.tiers || []).forEach(t => { if (T[t.id] === undefined) return; set("tier-val-" + t.id, Math.round(T[t.id] * 100) + "%"); set("tier-info-" + t.id, `each villager uses ${ioStr(t.needs)} · ${tierFx(t)}`); });
    G.jobs.forEach(j => { set("job-val-" + j.id, j.slots ? `${S.jobs[j.id]}/${slotCap(S, j)}` : S.jobs[j.id]); set("job-info-" + j.id, jobText(j)); const a = $("job-add-" + j.id); if (a) a.disabled = getIdle(S) < 1 || S.jobs[j.id] >= slotCap(S, j); });
    G.buildings.forEach(b => {
        const c = costOf(S, b);
        set("bld-name-" + b.id, `${b.name} (${S.bld[b.id]})`);
        set("bld-desc-" + b.id, `${b.desc} • Cost: ${costStr(c)}${b.upkeep ? " • Upkeep: " + upStr(b.upkeep) + (S.bld[b.id] && S.cond[b.id] !== undefined && S.cond[b.id] < 0.995 ? " • Condition " + Math.round(S.cond[b.id] * 100) + "%" : "") : ""}${b.terrain ? " • On: " + b.terrain.join("/") : ""}${b.near ? " • Next to: " + b.near.join("/") : ""}${canPlace(S, b) ? "" : " • no free tile suits it: claim more land"}`);
        const btn = $("bld-btn-" + b.id); if (btn) btn.disabled = !(afford(S, c) && canPlace(S, b));
    });
}

// Three tiers: 10 s samples for 1 h, then 5 min averages for 24 h, then hourly averages for 14 days.
const HKEY = "settlement_history_v1", HEVERY = [30, 12], HCAP = [360, 288, 336], HSTEP = 10000;

let H = null, lastSample = 0;

const histKeys = () => ["pop", "house", "idle", "owned"].concat(G.resources.flatMap(r => [r.id + ":l", r.id + ":p", r.id + ":c"]), G.deposits.map(d => "dep:" + d.id), (G.gauges || []).map(g => "gauge:" + g.id));

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
    const { R } = flows(S, 1), r2 = x => Math.round(x * 100) / 100;
    pushTier(0, [now, S.pop, housing(S), getIdle(S), ownedCount(S)]
        .concat(G.resources.flatMap(r => [r2(S.res[r.id]), r2(R[r.id].p), r2(R[r.id].c)]), G.deposits.map(d => r2(S.dep[d.id].amt)), (G.gauges || []).map(g => r2(S.gauge[g.id]))));
    try { localStorage.setItem(HKEY, JSON.stringify(H)); } catch (e) { /* storage full: stats stop persisting, the game is unaffected */ }
}

// gamedata.json "newGame" lists presets and options. "rule" options override any number in the data by dotted path
// (arrays of objects are searched by id, e.g. resources.food.spoil); the overrides are saved with the run.
const mk = (tag, p = {}, ...kids) => { const e = document.createElement(tag); Object.assign(e, p); e.append(...kids); return e; };

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

function renderAutoUI() { // the Automation panel: idle assignment, purchase priorities and resource focus
    const box = $("auto-body"); if (!box || !S) return;
    const opts = {}; ((GP.newGame && GP.newGame.options) || []).filter(o => o.kind === "auto").forEach(o => opts[o.auto] = o);
    const set = (k, v) => { S.auto = S.auto || {}; S.auto[k] = v; S.rev++; saveLocal(); };
    const cb = key => mk("label", { className: "hint", style: "display:flex;gap:8px;align-items:center;margin:4px 0;" }, mk("input", { type: "checkbox", checked: !!(S.auto || {})[key], onchange: e => set(key, e.target.checked) }), (opts[key] || { label: key }).label);
    const order = autoOrder(S), move = (i, d) => { const o = order.slice(); [o[i], o[i + d]] = [o[i + d], o[i]]; S.autoOrder = o; S.rev++; saveLocal(); renderAutoUI(); };
    const rows = order.map((cat, i) => mk("div", { className: "ng-row" }, cb(AUTO_KEYS[cat]), mk("span", {}, mk("button", { textContent: "▲", disabled: i === 0, onclick: () => move(i, -1) }), " ", mk("button", { textContent: "▼", disabled: i === order.length - 1, onclick: () => move(i, 1) }))));
    const focus = G.resources.filter(r => S.unlocked["res:" + r.id]).map(r => {
        const sel = mk("select", { onchange: e => { S.autoFocus = S.autoFocus || {}; S.autoFocus[r.id] = +e.target.value; S.rev++; saveLocal(); } }, ...["Low", "Normal", "High"].map((n, v) => mk("option", { value: String(v), textContent: n })));
        sel.value = String((S.autoFocus || {})[r.id] ?? 1);
        return mk("div", { className: "ng-row" }, mk("span", { textContent: `${r.icon || ""} ${r.name}` }), sel);
    });
    box.replaceChildren(cb("idle"), mk("h3", { textContent: "Purchase priorities (top is first)" }), ...rows,
        mk("p", { className: "hint", textContent: "A purchase being saved up for is not spent on anything below it." }),
        mk("h3", { textContent: "Resource focus (which jobs idle settlers prefer)" }), ...focus);
}

const UIACT = { gather: id => gather(S, id), research: id => research(S, id), togglePolicy: id => togglePolicy(S, id), build: id => build(S, id), adjustJob: (id, d) => adjustJob(S, id, d) }; // what the inline onclick handlers in the generated markup call
function newRun(seed, vals) { // a fresh run replaces the current one; the stats history starts again
    H = null; localStorage.removeItem(HKEY); placing = selTile = null;
    S = startNew(seed, S, vals); recenter();
}
Settlement.on("log", st => { if (st === S) renderLogs(); });
Settlement.on("changed", st => { if (st === S) renderAll(); });
Settlement.on("dirty", st => { if (st === S) renderDynamic(); });
Settlement.on("built", (st, t) => { if (st === S) { selTile = K(t.x, t.y); placing = null; } });
Settlement.on("demolished", st => { if (st === S) placing = null; });

// --- NEIGHBOURS PANEL (the logic is in world.js) ---
const NBUI = { sig: "", pid: 1, give: "", get: "", qty: 10, offerSig: "" };
function buildNeighbours() { // the structure of the panel; rebuilt only when neighbours, Market or the resource list change, so a dropdown is not reset under your finger
    const box = $("nb-body"); if (!box) return;
    const add = $("nb-add"); if (!add.onclick) add.onclick = () => { if (!addRival(S)) log(S, "There's no room to settle another neighbour."); renderAll(); };
    const rs = S.rivals, mkt = canTrade(S), rl = G.resources.filter(r => tradable(r.id) && S.unlocked["res:" + r.id]).map(r => r.id);
    const sig = rs.map(r => r.name).join() + "|" + mkt + "|" + rl.join();
    add.style.display = rs.length >= AIC().max ? "none" : "";
    $("nb-count").textContent = rs.length;
    if (sig === NBUI.sig) return; NBUI.sig = sig; NBUI.offerSig = "";
    if (!rl.includes(NBUI.give)) NBUI.give = rl[0] || ""; if (!rl.includes(NBUI.get) || NBUI.get === NBUI.give) NBUI.get = rl.find(k => k !== NBUI.give) || "";
    if (!rs[NBUI.pid - 1]) NBUI.pid = 1;
    const kids = rs.map(r => mk("div", { className: "row-item" },
        mk("div", { className: "row-info" }, mk("strong", { textContent: `${r.icon} ${r.name}` }), mk("span", { id: "nb-info-" + r.id })),
        mk("div", { className: "button-row", style: "align-items:center;" }, mk("span", { className: "badge", id: "nb-deals-" + r.id, title: "trades made" }), mk("button", { textContent: "📍", title: "Show on the map", onclick: () => { cam = { x: r.st.center.x + 0.5, y: r.st.center.y + 0.5 }; drawMap(); } }))));
    if (!rs.length) kids.push(mk("span", { className: "hint", textContent: "No neighbours yet. Add an AI settlement on this map; it plays by the same rules, competes for land and, once it has a Market, trades." }));
    else if (!mkt) kids.push(mk("span", { className: "hint", textContent: "Build a Market (unlocked by Bartering) to trade with your neighbours." }));
    else {
        const sel = (items, cur, fn) => { const s = mk("select", { onchange: e => fn(e.target.value) }, ...items.map(([v, t]) => mk("option", { value: String(v), textContent: t }))); s.value = String(cur); return s; };
        const rn = k => `${RES[k].icon || ""} ${RES[k].name}`.trim();
        kids.push(mk("h3", { textContent: "Trade" }),
            mk("div", { className: "ng-row" }, mk("span", { textContent: "With" }), sel(rs.map(r => [r.id, r.name]), NBUI.pid, v => { NBUI.pid = +v; updateNeighbours(); })),
            mk("div", { className: "ng-row" }, mk("span", { textContent: "You give" }), sel(rl.map(k => [k, rn(k)]), NBUI.give, v => { NBUI.give = v; updateNeighbours(); })),
            mk("div", { className: "ng-row" }, mk("span", { textContent: "You get" }), sel(rl.map(k => [k, rn(k)]), NBUI.get, v => { NBUI.get = v; updateNeighbours(); })),
            mk("div", { className: "ng-row" }, mk("span", { textContent: "Amount to give" }), mk("input", { type: "number", min: 1, step: 1, value: NBUI.qty, onchange: e => { NBUI.qty = Math.max(1, Math.floor(+e.target.value) || 1); e.target.value = NBUI.qty; updateNeighbours(); } })),
            mk("p", { className: "hint", id: "nb-quote" }),
            mk("div", { className: "button-row" }, mk("button", { id: "nb-trade-btn", className: "btn-primary", textContent: "Trade", onclick: () => humanTrade(S, NBUI.pid, NBUI.give, NBUI.get, NBUI.qty) })),
            mk("div", { id: "nb-offers", className: "stack-list" }));
    }
    box.replaceChildren(...kids); updateNeighbours();
}
function updateNeighbours() { // the numbers, refreshed every tick without touching the controls
    const set = (id, t) => { const e = $(id); if (e && e.textContent !== t) e.textContent = t; };
    S.rivals.forEach(r => {
        const st = r.st;
        set("nb-info-" + r.id, `${r.persName} · pop ${st.pop} · ${Object.keys(st.own).length} tiles · ${Object.keys(st.tech).length} techs · ${sum(st.bld)} structures${canTrade(st) ? " · 🏪 market" : ""}`);
        set("nb-deals-" + r.id, String(r.deals || 0));
    });
    const q = $("nb-quote"), btn = $("nb-trade-btn"), r = S.rivals[NBUI.pid - 1];
    if (q && r) {
        const t = tradeQuote(S, r.st, NBUI.give, NBUI.get, NBUI.qty);
        q.textContent = t.qty >= 1 ? `${r.name} would take ${t.qty}${t.qty < NBUI.qty ? " (the most they can do)" : ""} ${NBUI.give ? rname(NBUI.give) : ""} for ${n1(t.recv)} ${rname(NBUI.get)} (rate ${t.rate.toFixed(2)}).`
            : t.rate > 0 ? `${r.name} can't do that trade right now: they're short of ${rname(NBUI.get)}, full of ${rname(NBUI.give)}, or you have too little to give or no room to receive.` : "Pick two different goods.";
        btn.disabled = t.qty < 1;
    }
    const box = $("nb-offers"); if (!box) return;
    const os = S.offers.filter(o => o.until > S.time), sig = os.map(o => o.id).join();
    if (sig !== NBUI.offerSig) {
        NBUI.offerSig = sig;
        box.replaceChildren(...(os.length ? [mk("h3", { textContent: "Offers" })] : []), ...os.map(o => {
            const rv = S.rivals[o.pid - 1];
            return mk("div", { className: "row-item" }, mk("div", { className: "row-info" }, mk("strong", { textContent: rv.name }), mk("span", { textContent: `wants ${o.qty} ${rname(o.give)}, gives ${n1(o.recv)} ${rname(o.get)}` })),
                mk("div", { className: "button-row" }, mk("button", { textContent: "Accept", className: "btn-primary", onclick: () => acceptOffer(S, o.id) }), mk("button", { textContent: "Decline", onclick: () => declineOffer(S, o.id) })));
        }));
    }
}

