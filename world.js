"use strict";
// Neighbours and trade. Needs the engine and automation modules.
//
// - The world is one seeded map. Every settlement (yours, then each AI neighbour) is its own state object, and WS.owner (map.js) is a derived
//   index of who holds which tile, so claiming is first come, first served. Nothing in WS is saved; rebuildWorld(S) recreates it.
// - An AI neighbour is an ordinary settlement state with every automation switched on, stepped on the same clock as yours (the "tick" and
//   "away" events). Personalities are just purchase orders and resource focus (gamedata.json, "ai").
// - Trade is barter at a price per resource (resource "value") that rises when a stockpile is low and falls when it is full, with a spread
//   either way. Settlements need a Market to trade.
// Functions here take the player's state first (S); a neighbour's state is r.st, and the pure helpers (priceMid, tradeQuote...) take the
// settlement they are about explicitly.

const RIVAL_COLORS = ["#f87171", "#60a5fa", "#facc15", "#c084fc", "#fb923c", "#2dd4bf", "#f472b6", "#a3e635"];
const AI_DEFAULT = { spacing: 26, max: 8, awayStepSec: 15, awayMaxSec: 1200, names: ["Aldermere", "Brackenfold", "Corvale", "Dunmoor", "Eastwick", "Fenhallow"], tradeEverySec: 90, offerEverySec: 240, offerTtl: 300, start: {},
    personalities: [{ id: "steady", name: "Steady", icon: "🏘️", order: [], focus: {} }] };
const TRADE_DEFAULT = { spread: 0.15, scarce: 1.6, glut: 0.5, keep: 0.25, reserveSec: 600 };
const AIC = () => ({ ...AI_DEFAULT, ...(G.ai || {}) }), TRD = () => ({ ...TRADE_DEFAULT, ...(G.trade || {}) });
const AUTO_ALL = ["idle", "feed", "storage", "research", "production", "housing", "welfare", "policy", "claim"];

Settlement.on("tick", (S, dt, away) => { if (!away) { stepRivals(S, dt, false); marketTick(S, false); } }); // neighbours play in step with you...
Settlement.on("away", (S, total) => catchUpRivals(S, total)); // ...or catch up in coarse steps, for a limited time (see ai.awayMaxSec)
Settlement.on("newgame", (S, opts, val) => { const n = opts.filter(o => o.kind === "rivals").reduce((a, o) => a + (+val(o) || 0), 0); for (let i = 0; i < n; i++) addRival(S); });
Settlement.on("load", S => S.rivals.forEach(r => ensure(r.st))); // fill in anything new in gamedata.json for each neighbour

// --- AI NEIGHBOURS ---
function addRival(S) { // settles a new AI neighbour roughly ai.spacing tiles from your town centre; null if nowhere suitable
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
    ensure(st); seedStart(st, opts, val, false); checkUnlocks(st, true);
    rebuildWorld(S); S.rev++;
    log(S, `${rv.name} (${pers.name}) has settled ${Math.max(Math.abs(c.x - S.center.x), Math.abs(c.y - S.center.y))} tiles away.`);
    return rv;
}

function stepRivals(S, dt, away, floors) { // one game-clock step for every neighbour
    const rs = S.rivals; if (!rs || !rs.length) return;
    S.rclock = (S.rclock || 0) + dt;
    rs.forEach((r, i) => {
        const st = r.st, run = RUN(st);
        run.quiet = away; run.popFloor = (floors && floors[i]) || 0;
        step(st, dt); runAuto(st, true); aiMarket(st); checkUnlocks(st, true);
    });
}
function catchUpRivals(S, total) { // you were away: neighbours play on in coarse steps, but only for ai.awayMaxSec of it, which keeps coming back quick and means sleeping costs you less land
    const rs = S.rivals; if (!rs || !rs.length) return;
    const A = AIC(), floors = rs.map(r => Math.ceil(r.st.pop * 0.75));
    for (let left = Math.min(total, A.awayMaxSec); left > 0;) { const dt = Math.min(A.awayStepSec, left); stepRivals(S, dt, true, floors); marketTick(S, true); left -= dt; }
}
function aiMarket(st) { // an AI builds its Market as soon as it is unlocked and affordable (automation would not otherwise think to)
    if (!G.trade || st.bld.market || !st.unlocked["bld:market"] || st.time - (st.mktT || -99) < 20) return;
    st.mktT = st.time;
    const b = bOf("market"); if (b && afford1(st, costOf(st, b), 1.1) && canPlace(st, b)) { RUN(st).autoNote = true; build(st, "market"); RUN(st).autoNote = false; }
}

// --- TRADE ---
const canTrade = st => (st.bld.market || 0) > 0;
const tradable = k => !!RES[k] && RES[k].tradable !== false;
const lvlOf = (st, k) => { const c = capOf(st, k); return c > 0 ? st.res[k] / c : 1; };
function priceMid(st, k) { // price level of k for settlement st: dearer when short, cheaper when the store is full
    const T = TRD(), c = capOf(st, k), lvl = c > 0 ? clamp01(st.res[k] / c) : 1;
    return (RES[k].value || 1) * (T.scarce + (T.glut - T.scarce) * lvl);
}
function reserveOf(st, k) { // what a settlement will not sell below
    const T = TRD(); let r = capOf(st, k) * T.keep;
    if (G.pop.needs[k]) r = Math.max(r, st.pop * G.pop.needs[k] * T.reserveSec);
    return Math.min(r, capOf(st, k) * 0.9);
}
function tradeQuote(Q, P, give, get, want) { // Q gives up to `want` of `give` to P for `get`: what P can really do, at P's prices
    const none = { qty: 0, recv: 0, rate: 0, max: 0 };
    if (give === get || !tradable(give) || !tradable(get)) return none;
    const T = TRD(), m = { buy: priceMid(P, give) * (1 - T.spread), sell: priceMid(P, get) * (1 + T.spread), avail: Math.max(0, P.res[get] - reserveOf(P, get)), room: Math.max(0, capOf(P, give) - P.res[give]) };
    const qroom = Math.max(0, capOf(Q, get) - Q.res[get]), rate = m.buy / m.sell;
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

function humanTrade(S, pid, give, get, want) {
    const r = S.rivals[pid - 1]; if (!r || !canTrade(S)) return;
    const t = tradeExec(S, r.st, give, get, want);
    if (!t) return log(S, `${r.name} can't make that trade right now.`);
    r.deals++; S.rev++; log(S, `Traded ${t.qty} ${rname(give)} to ${r.name} for ${n1(t.recv)} ${rname(get)}.`);
    checkUnlocks(S); Settlement.emit("changed", S);
}
function aiDeal(a, b) { // a buys what it is short of from b, paying with what it has plenty of
    const A = a.st, B = b.st, ks = G.resources.map(r => r.id).filter(k => tradable(k) && A.unlocked["res:" + k] && B.unlocked["res:" + k]);
    const short = ks.filter(k => lvlOf(A, k) < 0.3).sort((x, y) => lvlOf(A, x) - lvlOf(A, y)), rich = ks.filter(k => lvlOf(A, k) > 0.6).sort((x, y) => lvlOf(A, y) - lvlOf(A, x));
    for (const get of short) for (const give of rich) {
        const spare = Math.max(0, A.res[give] - reserveOf(A, give)), want = Math.floor(spare * 0.5);
        if (tradeQuote(A, B, give, get, want).qty >= 3 && tradeExec(A, B, give, get, want)) { a.deals++; b.deals++; return true; }
    }
    return false;
}
function aiOffer(S, r) { // an AI short of something you have plenty of proposes a swap, paying with its surplus
    const A = r.st, ks = G.resources.map(x => x.id).filter(k => tradable(k) && S.unlocked["res:" + k] && A.unlocked["res:" + k]);
    const need = ks.filter(k => lvlOf(A, k) < 0.3 && S.res[k] > capOf(S, k) * 0.4).sort((x, y) => lvlOf(A, x) - lvlOf(A, y)), rich = ks.filter(k => lvlOf(A, k) > 0.6).sort((x, y) => lvlOf(A, y) - lvlOf(A, x));
    for (const w of need) for (const g of rich) {
        const t = tradeQuote(S, A, w, g, Math.min(S.res[w] * 0.3, 50));
        if (t.qty >= 5 && t.recv >= 3) { S.offers.push({ id: S.offerN = (S.offerN || 0) + 1, pid: r.id, give: w, get: g, qty: t.qty, recv: t.recv, until: S.time + AIC().offerTtl }); return true; }
    }
    return false;
}
function acceptOffer(S, id) {
    const o = S.offers.find(x => x.id === id); if (!o) return;
    S.offers = S.offers.filter(x => x !== o);
    const r = S.rivals[o.pid - 1], t = r && canTrade(S) ? tradeExec(S, r.st, o.give, o.get, o.qty) : null;
    if (!t) { log(S, `${r ? r.name : "That neighbour"}'s offer is no longer possible.`); return Settlement.emit("changed", S); }
    r.deals++; S.rev++; log(S, `Accepted ${r.name}'s offer: ${t.qty} ${rname(o.give)} for ${n1(t.recv)} ${rname(o.get)}.`);
    checkUnlocks(S); Settlement.emit("changed", S);
}
function declineOffer(S, id) { S.offers = S.offers.filter(x => x.id !== id); Settlement.emit("changed", S); }

function marketTick(S, away) { // neighbours trade with each other, and now and then propose a swap to you; paced by the neighbours' own clock, which is what advances while you are away
    const rs = S.rivals; if (!rs || !rs.length || !G.trade) return;
    const A = AIC(), sec = Math.floor(S.rclock || 0), now = S.rclock || 0;
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
        if (canTrade(S) && tr.length && S.offers.length < 3) { const r = tr[Math.floor(hash(sec, 35, S.seed) * tr.length)]; if (aiOffer(S, r)) { log(S, `${r.name} has sent you a trade offer.`); Settlement.emit("changed", S); } }
    }
}
