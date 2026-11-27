"use strict";
// Neighbours and trade. Loaded after game.js (see index.html) and sharing its globals.
//
// - The world is one seeded map. Every settlement (yours, then each AI neighbour) keeps its own state object, and WS.owner is a derived
//   index of who holds which tile, so claiming is first come, first served. Nothing in WS is saved; rebuildWorld() recreates it.
// - An AI neighbour is an ordinary settlement state with every automation switched on. The engine runs it through withState() (game.js),
//   headless, on the same clock as yours, so it also keeps playing while you are away. Personalities are just purchase orders and
//   resource focus (gamedata.json, "ai").
// - Trade is barter at a price per resource (resource "value") that rises when a stockpile is low and falls when it is full, with a spread
//   either way. Settlements need a Market to trade.

const RIVAL_COLORS = ["#f87171", "#60a5fa", "#facc15", "#c084fc", "#fb923c", "#2dd4bf", "#f472b6", "#a3e635"];
const AI_DEFAULT = { spacing: 26, max: 8, awayStepSec: 15, awayMaxSec: 1200, names: ["Aldermere", "Brackenfold", "Corvale", "Dunmoor", "Eastwick", "Fenhallow"], tradeEverySec: 90, offerEverySec: 240, offerTtl: 300, start: {},
    personalities: [{ id: "steady", name: "Steady", icon: "🏘️", order: [], focus: {} }] };
const TRADE_DEFAULT = { spread: 0.15, scarce: 1.6, glut: 0.5, keep: 0.25, reserveSec: 600 };
const AIC = () => ({ ...AI_DEFAULT, ...(G.ai || {}) }), TRD = () => ({ ...TRADE_DEFAULT, ...(G.trade || {}) });
const AUTO_ALL = ["idle", "feed", "storage", "research", "production", "housing", "welfare", "policy", "claim"];

// --- WORLD: who holds which tile ---
function rebuildWorld() {
    WS.owner.clear(); S.rivals = S.rivals || [];
    const reg = (st, pid) => { st.pid = pid; for (const k in st.own) WS.owner.set(k, { pid, t: st.own[k] }); };
    reg(S, 0); S.rivals.forEach((r, i) => reg(r.st, i + 1));
}
function loadWorld() { // after a save is loaded: rebuild the ownership index and fill in anything new in gamedata.json for each neighbour
    rebuildWorld(); S.rivals.forEach(r => withState(r.st, ensure));
}
function foreignAt(x, y) { // another settlement's tile, for drawing and the tile info line
    const o = WS.owner.get(K(x, y)); if (!o || !o.pid) return null;
    const r = S.rivals[o.pid - 1]; return r ? { pid: o.pid, name: r.name, color: r.color, icon: r.icon, b: o.t.b } : null;
}

// --- AI NEIGHBOURS ---
function addRival() { // settles a new AI neighbour roughly ai.spacing tiles from your town centre; null if nowhere suitable
    const A = AIC(), idx = S.rivals.length, pid = idx + 1, pers = A.personalities[idx % A.personalities.length];
    if (idx >= A.max) return null;
    const R = G.map.startRadius, centers = [S.center, ...S.rivals.map(r => r.st.center)];
    const clear = (x, y) => { for (let dy = -R - 1; dy <= R + 1; dy++) for (let dx = -R - 1; dx <= R + 1; dx++) if (WS.owner.has(K(x + dx, y + dy))) return false; return true; };
    const ang = (hash(idx, 5, S.seed) + idx * 0.618) * Math.PI * 2;
    let c = null;
    for (let sep = A.spacing; sep >= 6 && !c; sep = Math.floor(sep / 2)) { // if the map is crowded, settle for being closer
        const d = sep * (1 + 0.5 * hash(idx, 6, S.seed));
        c = findStart(Math.round(S.center.x + Math.cos(ang) * d), Math.round(S.center.y + Math.sin(ang) * d), (x, y) => clear(x, y) && centers.every(q => Math.max(Math.abs(q.x - x), Math.abs(q.y - y)) >= sep));
    }
    if (!c) return null;
    const st = newState(S.seed, null, c); st.pid = pid;
    st.auto = {}; AUTO_ALL.forEach(k => st.auto[k] = true);
    st.autoOrder = (pers.order || []).slice(); st.autoFocus = {};
    for (const k in pers.focus || {}) if (RES[k]) st.autoFocus[k] = pers.focus[k];
    const rv = { id: pid, name: A.names[idx % A.names.length] + (idx >= A.names.length ? " " + (Math.floor(idx / A.names.length) + 1) : ""), icon: pers.icon, color: RIVAL_COLORS[idx % RIVAL_COLORS.length], pers: pers.id, persName: pers.name, deals: 0, st };
    S.rivals.push(rv);
    const opts = (GP.newGame && GP.newGame.options) || [], val = o => A.start[o.id] !== undefined ? A.start[o.id] : optDefault(o);
    withState(st, () => { ensure(); seedStart(opts, val, false); checkUnlocks(true); });
    rebuildWorld(); S.rev++;
    log(`${rv.name} (${pers.name}) has settled ${Math.max(Math.abs(c.x - S.center.x), Math.abs(c.y - S.center.y))} tiles away.`);
    return rv;
}

function stepRivals(dt, away, floors) { // one game-clock step for every neighbour, called from advance()
    const rs = S.rivals; if (!rs || !rs.length) return;
    S.rclock = (S.rclock || 0) + dt;
    rs.forEach((r, i) => withState(r.st, () => {
        quiet = away; popFloor = (floors && floors[i]) || 0;
        step(dt); runAuto(true); aiMarket(); checkUnlocks(true);
    }));
}
function catchUpRivals(total) { // you were away: neighbours play on in coarse steps, but only for ai.awayMaxSec of it, which keeps coming back quick and means sleeping costs you less land
    const rs = S.rivals; if (!rs || !rs.length) return;
    const A = AIC(), floors = rs.map(r => Math.ceil(r.st.pop * 0.75));
    for (let left = Math.min(total, A.awayMaxSec); left > 0;) { const dt = Math.min(A.awayStepSec, left); stepRivals(dt, true, floors); marketTick(true); left -= dt; }
}
function aiMarket() { // an AI builds its Market as soon as it is unlocked and affordable (automation would not otherwise think to)
    if (!G.trade || S.bld.market || !S.unlocked["bld:market"] || S.time - (S.mktT || -99) < 20) return;
    S.mktT = S.time;
    const b = bOf("market"); if (b && afford1(costOf(b), 1.1) && canPlace(b)) { autoNote = true; build("market"); autoNote = false; }
}

// --- TRADE ---
const canTrade = st => (st.bld.market || 0) > 0;
const tradable = k => !!RES[k] && RES[k].tradable !== false;
const lvlOf = (st, k) => withState(st, () => { const c = capOf(k); return c > 0 ? S.res[k] / c : 1; });
function priceMid(k) { // price level of k for the active settlement: dearer when short, cheaper when the store is full
    const T = TRD(), c = capOf(k), lvl = c > 0 ? clamp01(S.res[k] / c) : 1;
    return (RES[k].value || 1) * (T.scarce + (T.glut - T.scarce) * lvl);
}
function reserveOf(k) { // what a settlement will not sell below
    const T = TRD(); let r = capOf(k) * T.keep;
    if (G.pop.needs[k]) r = Math.max(r, S.pop * G.pop.needs[k] * T.reserveSec);
    return Math.min(r, capOf(k) * 0.9);
}
function tradeQuote(Q, P, give, get, want) { // Q gives up to `want` of `give` to P for `get`: what P can really do, at P's prices
    const none = { qty: 0, recv: 0, rate: 0, max: 0 };
    if (give === get || !tradable(give) || !tradable(get)) return none;
    const T = TRD(), m = withState(P, () => ({ buy: priceMid(give) * (1 - T.spread), sell: priceMid(get) * (1 + T.spread), avail: Math.max(0, P.res[get] - reserveOf(get)), room: Math.max(0, capOf(give) - P.res[give]) }));
    const qroom = withState(Q, () => Math.max(0, capOf(get) - Q.res[get])), rate = m.buy / m.sell;
    const max = Math.floor(Math.min(Q.res[give], m.room, m.avail / rate, qroom / rate));
    if (!(rate > 0) || max < 1) return { ...none, rate };
    const qty = Math.max(0, Math.min(Math.floor(want), max));
    return { qty, recv: qty * rate, rate, max };
}
function tradeExec(Q, P, give, get, want) {
    const t = tradeQuote(Q, P, give, get, want); if (t.qty < 1) return null;
    Q.res[give] = Math.max(0, Q.res[give] - t.qty); P.res[give] += t.qty;
    P.res[get] = Math.max(0, P.res[get] - t.recv); Q.res[get] += t.recv;
    return t;
}
const n1 = v => (+v).toFixed(v >= 10 ? 0 : 1), rname = k => RES[k].name.toLowerCase();

function humanTrade(pid, give, get, want) {
    const r = S.rivals[pid - 1]; if (!r || !canTrade(S)) return;
    const t = tradeExec(S, r.st, give, get, want);
    if (!t) return log(`${r.name} can't make that trade right now.`);
    r.deals++; S.rev++; log(`Traded ${t.qty} ${rname(give)} to ${r.name} for ${n1(t.recv)} ${rname(get)}.`);
    checkUnlocks(); renderAll();
}
function aiDeal(a, b) { // a buys what it is short of from b, paying with what it has plenty of
    const A = a.st, B = b.st, ks = G.resources.map(r => r.id).filter(k => tradable(k) && A.unlocked["res:" + k] && B.unlocked["res:" + k]);
    const short = ks.filter(k => lvlOf(A, k) < 0.3).sort((x, y) => lvlOf(A, x) - lvlOf(A, y)), rich = ks.filter(k => lvlOf(A, k) > 0.6).sort((x, y) => lvlOf(A, y) - lvlOf(A, x));
    for (const get of short) for (const give of rich) {
        const spare = withState(A, () => Math.max(0, A.res[give] - reserveOf(give))), want = Math.floor(spare * 0.5);
        if (tradeQuote(A, B, give, get, want).qty >= 3 && tradeExec(A, B, give, get, want)) { a.deals++; b.deals++; return true; }
    }
    return false;
}
function aiOffer(r) { // an AI short of something you have plenty of proposes a swap, paying with its surplus
    const A = r.st, ks = G.resources.map(x => x.id).filter(k => tradable(k) && S.unlocked["res:" + k] && A.unlocked["res:" + k]);
    const need = ks.filter(k => lvlOf(A, k) < 0.3 && S.res[k] > capOf(k) * 0.4).sort((x, y) => lvlOf(A, x) - lvlOf(A, y)), rich = ks.filter(k => lvlOf(A, k) > 0.6).sort((x, y) => lvlOf(A, y) - lvlOf(A, x));
    for (const w of need) for (const g of rich) {
        const t = tradeQuote(S, A, w, g, Math.min(S.res[w] * 0.3, 50));
        if (t.qty >= 5 && t.recv >= 3) { S.offers.push({ id: S.offerN = (S.offerN || 0) + 1, pid: r.id, give: w, get: g, qty: t.qty, recv: t.recv, until: S.time + AIC().offerTtl }); return true; }
    }
    return false;
}
function acceptOffer(id) {
    const o = S.offers.find(x => x.id === id); if (!o) return;
    S.offers = S.offers.filter(x => x !== o);
    const r = S.rivals[o.pid - 1], t = r && canTrade(S) ? tradeExec(S, r.st, o.give, o.get, o.qty) : null;
    if (!t) { log(`${r ? r.name : "That neighbour"}'s offer is no longer possible.`); return renderAll(); }
    r.deals++; S.rev++; log(`Accepted ${r.name}'s offer: ${t.qty} ${rname(o.give)} for ${n1(t.recv)} ${rname(o.get)}.`);
    checkUnlocks(); renderAll();
}
function declineOffer(id) { S.offers = S.offers.filter(x => x.id !== id); renderAll(); }

function marketTick(away) { // neighbours trade with each other, and now and then propose a swap to you; paced by your game clock
    const rs = S.rivals; if (!rs || !rs.length || !G.trade) return;
    const A = AIC(), sec = Math.floor(S.rclock || 0), now = S.rclock || 0; // paced by the neighbours' own clock, which is what advances while you are away
    if (S.nextTrade === undefined) S.nextTrade = now + A.tradeEverySec;
    if (now >= S.nextTrade) {
        S.nextTrade = now + A.tradeEverySec * (0.75 + 0.5 * hash(sec, 31, S.seed));
        const tr = rs.filter(r => canTrade(r.st));
        if (tr.length >= 2) { const i = Math.floor(hash(sec, 32, S.seed) * tr.length), j = (i + 1 + Math.floor(hash(sec, 33, S.seed) * (tr.length - 1))) % tr.length; aiDeal(tr[i], tr[j]); }
    }
    if (away) return;
    if (S.offers.length) S.offers = S.offers.filter(o => o.until > S.time);
    if (S.nextOffer === undefined) S.nextOffer = now + A.offerEverySec;
    if (now >= S.nextOffer) {
        S.nextOffer = now + A.offerEverySec * (0.75 + 0.5 * hash(sec, 34, S.seed));
        const tr = rs.filter(r => canTrade(r.st));
        if (canTrade(S) && tr.length && S.offers.length < 3) { const r = tr[Math.floor(hash(sec, 35, S.seed) * tr.length)]; if (aiOffer(r)) { log(`${r.name} has sent you a trade offer.`); renderAll(); } }
    }
}

// --- NEIGHBOURS PANEL ---
const NBUI = { sig: "", pid: 1, give: "", get: "", qty: 10, offerSig: "" };
function buildNeighbours() { // the structure of the panel; rebuilt only when neighbours, Market or the resource list change, so a dropdown is not reset under your finger
    const box = $("nb-body"); if (!box) return;
    const add = $("nb-add"); if (!add.onclick) add.onclick = () => { if (!addRival()) log("There's no room to settle another neighbour."); renderAll(); };
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
            mk("div", { className: "button-row" }, mk("button", { id: "nb-trade-btn", className: "btn-primary", textContent: "Trade", onclick: () => humanTrade(NBUI.pid, NBUI.give, NBUI.get, NBUI.qty) })),
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
                mk("div", { className: "button-row" }, mk("button", { textContent: "Accept", className: "btn-primary", onclick: () => acceptOffer(o.id) }), mk("button", { textContent: "Decline", onclick: () => declineOffer(o.id) })));
        }));
    }
}
