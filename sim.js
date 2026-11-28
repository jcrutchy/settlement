"use strict";
// Settlement state and the simulation: gauges, effects, flows, one step, events, catching up with real time.

function newState(seed, prev, at) { // at: a start tile chosen by the caller (AI neighbours); the player's start comes from findStart()
    setWorld(seed);
    const c = at || findStart(), own = {}, R = G.map.startRadius;
    for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) own[K(c.x + dx, c.y + dy)] = { x: c.x + dx, y: c.y + dy, b: null };
    own[K(c.x, c.y)].b = "center";
    const s = { version: 4, seed, rev: prev ? prev.rev + 1 : 0, cloudRev: prev ? prev.cloudRev : 0, lastTick: Date.now(),
        res: {}, unlocked: {}, tech: {}, pop: 0, growth: 0, starve: 0, jobs: {}, bld: {}, claims: 0, cond: {}, gauge: {}, pol: {}, mods: [], evCool: {}, time: 0, center: c, own, dep: {},
        logs: [`You arrive at a quiet clearing (seed ${seed}). Gather wood to build shelter.`] };
    G.deposits.forEach(d => { const k = poolCap(s, d); s.dep[d.id] = { cap: k, amt: k }; });
    return s;
}

function ensure(S) { // fills in anything new in gamedata.json, and repairs NaN left by older versions
    setWorld(S.seed); S.tech = S.tech || {}; S.auto = S.auto || {}; S.rules = S.rules || {}; S.autoOrder = S.autoOrder || []; S.autoFocus = S.autoFocus || {}; S.cond = S.cond || {};
    G.resources.forEach(r => { if (S.res[r.id] !== undefined && !Number.isFinite(S.res[r.id])) S.res[r.id] = r.initial || 0; });
    G.deposits.forEach(d => { const p = S.dep[d.id]; if (p && !(Number.isFinite(p.amt) && Number.isFinite(p.cap))) { const k = poolCap(S, d); S.dep[d.id] = { cap: k, amt: k }; } });
    G.resources.forEach(r => { if (S.res[r.id] === undefined) S.res[r.id] = r.initial || 0; });
    G.jobs.forEach(j => { if (S.jobs[j.id] === undefined) S.jobs[j.id] = 0; });
    G.buildings.forEach(b => { if (S.bld[b.id] === undefined) S.bld[b.id] = 0; });
    G.deposits.forEach(d => { if (!S.dep[d.id]) { const k = poolCap(S, d); S.dep[d.id] = { cap: k, amt: k }; } });
    S.gauge = S.gauge || {}; (G.gauges || []).forEach(g => { if (!Number.isFinite(S.gauge[g.id])) S.gauge[g.id] = g.start ?? 0.6; });
    S.pol = S.pol || {}; S.mods = S.mods || []; S.evCool = S.evCool || {}; S.time = S.time || 0;
    if (S.nextEvent === undefined) S.nextEvent = S.time + ((G.eventTiming || {}).grace || 600);
    if (S.rng === undefined) S.rng = ((S.seed >>> 0) ^ 0x9e3779b9 ^ Math.imul(S.pid || 0, 0x85ebca6b)) >>> 0; // each settlement rolls its own events
    if (!S.pid) { S.rivals = S.rivals || []; S.offers = S.offers || []; }
}

function checkUnlocks(S, silent) {
    let changed = false;
    [["res", G.resources, "Discovered resource"], ["job", G.jobs, "New role available"], ["bld", G.buildings, "New structure unlocked"], ["tech", G.techs, "Technology available"], ["tier", G.pop.tiers || [], "New need"], ["pol", G.policies || [], "Policy available"]].forEach(([k, list, msg]) => {
        list.forEach(x => {
            const key = k + ":" + x.id;
            if (!S.unlocked[key] && met(S, x.requires)) { S.unlocked[key] = true; changed = true; if (!silent) log(S, `${msg}: ${x.name}.`); }
        });
    });
    return changed;
}

function strength(S, id) { // 1 when maintained, falling to upkeep.floor as a building decays; housing is exempt (see eff)
    const c = S.cond[id], f = G.upkeep ? G.upkeep.floor : 0.5;
    return c === undefined ? 1 : 1 - (1 - f) * (1 - c);
}

function gaugeSignals(S, fl) { // what the gauges feed on, each from 0 (bad) to 1 (good); fl is a flows() result
    let food = 1; // only shortage counts: low stock (under 10 s of use) that is also falling
    if (S.pop > 0) for (const k in G.pop.needs) { const cover = clamp01(S.res[k] / (S.pop * G.pop.needs[k] * 10)); if (fl.R[k].p - fl.R[k].c < 0) food = Math.min(food, cover); }
    const hs = housing(S), f = G.upkeep ? G.upkeep.floor : 0.5;
    let cnt = 0, str = 0; G.buildings.forEach(b => { if (b.upkeep && S.bld[b.id]) { cnt += S.bld[b.id]; str += S.bld[b.id] * strength(S, b.id); } });
    return { food, housing: S.pop > hs && S.pop > 0 ? hs / S.pop : 1, tiers: fl.mood, wear: cnt && f < 1 ? clamp01((str / cnt - f) / (1 - f)) : 1 };
}

function gaugeTarget(S, g, sig) { let t = g.base || 0; for (const k in g.terms || {}) t += g.terms[k] * (sig[k] ?? 0); return clamp01(t + eff(S, "gauge", g.id)); }

function gaugeFx(S, g) { // change in settler arrivals and output from a gauge at its present value
    const v = S.gauge && S.gauge[g.id], r = { growth: 0, output: 0 };
    if (!Number.isFinite(v)) return r;
    if (g.low && v < g.low.at) { const f = (g.low.at - v) / g.low.at; r.growth += (g.low.growth || 0) * f; r.output += (g.low.output || 0) * f; }
    if (g.high && v > g.high.at) { const f = (v - g.high.at) / (1 - g.high.at); r.growth += (g.high.growth || 0) * f; r.output += (g.high.output || 0) * f; }
    return r;
}

function eff(S, type, key) { // sum of an effect type across everything built and every researched tech
    let t = 0;
    const add = (list, n) => list.forEach(e => { if (e.type === type && (key === undefined || e.resource === key || (type === "capacity" && e.resource === "*"))) t += e.value * n; });
    G.buildings.forEach(b => { if (S.bld[b.id]) add(b.effects, S.bld[b.id] * (type === "housing" ? 1 : strength(S, b.id))); });
    G.techs.forEach(q => { if (S.tech[q.id]) add(q.effects || [], 1); });
    (G.policies || []).forEach(p => { if (S.pol[p.id]) add(p.effects || [], S.pol[p.id].str); }); // a policy fades while its upkeep goes unpaid
    S.mods.forEach(m => add(m.effects, 1)); // timed conditions from events
    return t;
}

const capOf = (S, id) => RES[id].cap + eff(S, "capacity", id);

const housing = (S) => eff(S, "housing");

const getIdle = (S) => Math.max(0, S.pop - sum(S.jobs));

const slotCap = (S, j) => j.slots ? S.bld[j.slots.building] * j.slots.per : Infinity;

function tierFloor(S) { // what the next buildings and technologies still need of each resource: tiers only eat the surplus above it, so a hungry village can't stop you saving up
    const m = {}, add = c => { for (const k in c) m[k] = Math.max(m[k] || 0, c[k]); };
    G.buildings.forEach(b => { if (S.unlocked["bld:" + b.id]) add(costOf(S, b)); });
    G.techs.forEach(q => { if (S.unlocked["tech:" + q.id] && !S.tech[q.id]) add(q.cost); });
    for (const k in m) m[k] = Math.min(m[k] * 1.15, capOf(S, k) * 0.3); // 15%: automation wants a 10% cushion before it spends
    return m;
}

function flows(S, dt) { // production/consumption per second for the next dt seconds
    const R = {}, harvest = {}, paid = {}, T = {};
    let gMult = 0, oMult = 0, satSum = 0, satN = 0;
    G.resources.forEach(r => R[r.id] = { p: 0, c: 0 });
    for (const k in G.pop.needs) R[k].c += S.pop * G.pop.needs[k];
    const flo = (G.pop.tiers || []).some(t => S.unlocked["tier:" + t.id]) ? tierFloor(S) : {};
    (G.pop.tiers || []).forEach(t => { // wants beyond bare survival: an unlocked tier eats goods and pays out in proportion to how well they are supplied
        if (!S.unlocked["tier:" + t.id]) return;
        let e = 1;
        for (const k in t.needs) { const need = S.pop * t.needs[k] * dt; if (need > 0) e = Math.min(e, Math.max(0, S.res[k] - (flo[k] || 0)) / need); }
        e = Math.max(0, Math.min(1, e)); T[t.id] = e; satSum += e; satN++;
        for (const k in t.needs) R[k].c += S.pop * t.needs[k] * e;
        const fx = t.effects || {}, lack = t.lack || {};
        gMult += (fx.growth || 0) * e + (lack.growth || 0) * (1 - e);
        oMult += (fx.output || 0) * e + (lack.output || 0) * (1 - e);
    });
    (G.gauges || []).forEach(g => { const x = gaugeFx(S, g); gMult += x.growth; oMult += x.output; });
    gMult += eff(S, "growth"); oMult += eff(S, "output"); // policies and conditions
    const om = Math.max(0.2, 1 + oMult);
    G.resources.forEach(r => { if (r.spoil) R[r.id].c += S.res[r.id] * r.spoil / (1 + eff(S, "preserve", r.id)); }); // stock rots; preserve effects slow it
    G.buildings.forEach(b => { // upkeep: unpaid maintenance wears the building down (see step)
        const cnt = S.bld[b.id]; if (!cnt || !b.upkeep) return;
        let e = 1;
        for (const k in b.upkeep) { const need = cnt * b.upkeep[k] * dt; if (need > 0) e = Math.min(e, S.res[k] / need); }
        e = Math.min(1, e); paid[b.id] = e;
        for (const k in b.upkeep) R[k].c += cnt * b.upkeep[k] * e;
    });
    const paidP = {};
    (G.policies || []).forEach(p => { // upkeep is per settler: a policy costs more to run in a bigger settlement
        if (!S.pol[p.id] || !p.upkeep) return;
        let e = 1;
        for (const k in p.upkeep) { const need = S.pop * p.upkeep[k] * dt; if (need > 0) e = Math.min(e, S.res[k] / need); }
        e = Math.min(1, e); paidP[p.id] = e;
        for (const k in p.upkeep) R[k].c += S.pop * p.upkeep[k] * e;
    });
    G.jobs.forEach(j => {
        const n = S.jobs[j.id]; if (!n) return;
        let e = 1; // efficiency: limited by input stock
        for (const k in j.inputs || {}) { const need = n * j.inputs[k] * dt; if (need > 0) e = Math.min(e, S.res[k] / need); }
        e = Math.min(1, e);
        const d = j.deposit && S.dep[j.deposit], wear = j.slots ? strength(S, j.slots.building) : 1;
        for (const k in j.outputs) {
            let o = n * j.outputs[k] * e * (1 + eff(S, "outputMult", k)) * om * wear;
            let kept = 1;
            if (d) { const dens = DEP[j.deposit].regrow ? (d.cap > 0 ? d.amt / d.cap : 0) : (d.amt > 0 ? 1 : 0); o = d.cap > 0 ? Math.min(o * dens, d.amt / dt) : 0; harvest[j.deposit] = (harvest[j.deposit] || 0) + o; kept = haul(S, j.deposit).eff; }
            R[k].p += o * kept;
        }
        for (const k in j.inputs || {}) R[k].c += n * j.inputs[k] * e;
    });
    return { R, harvest, paid, paidP, T, gMult, oMult, mood: satN ? satSum / satN : 1 };
}

function trimJobs(S) {
    for (let over = sum(S.jobs) - S.pop; over > 0; over--) {
        const k = Object.keys(S.jobs).reduce((a, b) => S.jobs[b] > S.jobs[a] ? b : a);
        if (!S.jobs[k]) break;
        S.jobs[k]--;
    }
}

function step(S, dt) {
    const { R, harvest, paid, paidP, gMult, mood } = flows(S, dt);
    G.resources.forEach(r => { const x = R[r.id]; S.res[r.id] = Math.max(0, Math.min(S.res[r.id] + (x.p - x.c) * dt, capOf(S, r.id))); });
    const U = G.upkeep || { decay: 0.002, repair: 0.01 };
    G.buildings.forEach(b => { // unpaid upkeep wears a building type down; paid upkeep repairs it
        if (!b.upkeep) return;
        if (!S.bld[b.id]) { delete S.cond[b.id]; return; }
        const c = S.cond[b.id] === undefined ? 1 : S.cond[b.id], e = paid[b.id] === undefined ? 1 : paid[b.id];
        const n = Math.max(0, Math.min(1, e < 0.999 ? c - U.decay * (1 - e) * dt : c + U.repair * dt));
        if (c >= 0.7 && n < 0.7) log(S, `${b.name} is falling into disrepair: it needs ${Object.keys(b.upkeep).map(k => RES[k].name.toLowerCase()).join(" / ")}.`, true);
        S.cond[b.id] = n;
    });
    const sig = gaugeSignals(S, { R, mood });
    (G.gauges || []).forEach(g => { const v = S.gauge[g.id], sp = (g.speed || 0.004) * dt; S.gauge[g.id] = clamp01(v + Math.max(-sp, Math.min(sp, gaugeTarget(S, g, sig) - v))); });
    S.time += dt;
    (G.policies || []).forEach(p => { const st = S.pol[p.id]; if (!st) return; const e = paidP[p.id] === undefined ? 1 : paidP[p.id]; st.str = Math.max(0, Math.min(1, e < 0.999 ? st.str - 0.02 * dt * (1 - e) : st.str + 0.05 * dt)); });
    if (S.mods.length) { S.mods.forEach(m => { m.left -= dt; }); S.mods.filter(m => m.left <= 0).forEach(m => { if (!RUN(S).quiet) log(S, `${m.icon} ${m.name} has passed.`); }); S.mods = S.mods.filter(m => m.left > 0); }
    if (!RUN(S).quiet && G.events && S.time >= S.nextEvent) { if (S.pop >= ((G.eventTiming || {}).minPop || 15)) rollEvent(S); const t = G.eventTiming || { min: 180, max: 480 }; S.nextEvent = S.time + t.min + rnd(S) * (t.max - t.min); }
    G.deposits.forEach(d => { // logistic regrowth; tiny floor so a depleted deposit can recover
        const s = S.dep[d.id], seed = Math.max(s.amt, 0.02 * s.cap);
        s.amt = Math.max(0, Math.min(s.cap, s.amt - (harvest[d.id] || 0) * dt + (s.cap > 0 ? d.regrow * seed * (1 - s.amt / s.cap) * dt : 0)));
    });
    if (S.pop > housing(S)) { // settlers without a roof drift away (demolishing homes has a cost)
        S.crowd = (S.crowd || 0) + (G.pop.overcrowdRate ?? 0.02) * dt;
        if (S.crowd >= 1) { S.crowd -= 1; if (S.pop > RUN(S).popFloor) { S.pop--; trimJobs(S); log(S, "A settler left: not enough housing.", true); } }
    } else S.crowd = 0;
    if (S.res.food <= 0 && S.pop > 0) { // deterministic: progress accumulates, no dice
        S.starve += G.pop.starveRate * dt;
        if (S.starve >= 1) { S.starve -= 1; if (S.pop > RUN(S).popFloor) { S.pop--; trimJobs(S); log(S, "Starvation! A settler has left the camp.", true); } }
    } else {
        S.starve = 0;
        if (S.pop < housing(S) && S.res.food >= G.pop.growthFoodMin) {
            S.growth += G.pop.growthRate * dt * Math.max(0, 1 + gMult);
            if (S.growth >= 1) { S.growth -= 1; S.pop++; log(S, "A new settler arrived at your camp.", true); }
        }
    }
}

function rnd(S) { // small seeded generator (mulberry32) kept in the save, so a run's events are reproducible
    S.rng = (S.rng + 0x6D2B79F5) >>> 0; let t = S.rng;
    t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

function addMod(S, id, m) { S.mods = S.mods.filter(x => x.id !== id); S.mods.push({ id, name: m.name, icon: m.icon || "", left: m.duration, effects: m.effects || [] }); }

function eventWeight(S, ev) { // base weight, raised by a poor gauge, lowered by the techs, buildings and policies that guard against it
    let w = ev.weight ?? 1;
    (ev.risk || []).forEach(r => { const v = S.gauge[r.gauge]; w *= 1 + r.k * (1 - (Number.isFinite(v) ? v : 1)); });
    (ev.shield || []).forEach(sh => {
        if (sh.tech) { if (S.tech[sh.tech]) w *= sh.factor; }
        else if (sh.policy) { if (S.pol[sh.policy]) w *= sh.factor; }
        else if (sh.building) w *= 1 - Math.min(sh.max ?? 0.8, sh.per * (S.bld[sh.building] || 0));
    });
    return Math.max(0, w);
}

function rollEvent(S) {
    const c = G.events.filter(ev => (S.evCool[ev.id] || 0) <= S.time && met(S, ev.requires) && S.pop >= (ev.minPop || 0)).map(ev => ({ ev, w: eventWeight(S, ev) })).filter(x => x.w > 0);
    const tot = c.reduce((a, x) => a + x.w, 0); if (!tot) return;
    let r = rnd(S) * tot; for (const x of c) { r -= x.w; if (r <= 0) return fireEvent(S, x.ev); }
    fireEvent(S, c[c.length - 1].ev);
}

function fireEvent(S, ev) {
    const per = Math.max(1, S.pop / 100), bits = [];
    if (ev.pop) { // fraction of the population; arrivals only fill free housing
        const d = ev.pop < 0 ? -Math.min(S.pop - 1, Math.round(S.pop * -ev.pop)) : Math.max(0, Math.min(Math.round(S.pop * ev.pop), housing(S) - S.pop));
        if (d) { S.pop += d; bits.push((d > 0 ? "+" : "") + d + " settlers"); if (d < 0) trimJobs(S); }
    }
    for (const k in ev.lose || {}) { const l = S.res[k] * ev.lose[k]; if (l >= 1) { S.res[k] -= l; bits.push("-" + fmt(l) + " " + RES[k].name.toLowerCase()); } }
    for (const k in ev.gain || {}) { const g = Math.min(capOf(S, k) - S.res[k], ev.gain[k] * per); if (g >= 1) { S.res[k] += g; bits.push("+" + fmt(g) + " " + RES[k].name.toLowerCase()); } }
    if (ev.wear) G.buildings.forEach(b => { if (b.upkeep && S.bld[b.id]) S.cond[b.id] = Math.max(0, (S.cond[b.id] === undefined ? 1 : S.cond[b.id]) - ev.wear); });
    if (ev.mod) addMod(S, ev.id, { icon: ev.icon, ...ev.mod });
    S.evCool[ev.id] = S.time + (ev.cooldown || 600); S.rev++;
    log(S, `${ev.icon} ${ev.name}: ${ev.text}${bits.length ? " (" + bits.join(", ") + ")" : ""}${ev.mod ? " " + ev.mod.name + " for " + dur(ev.mod.duration) + "." : ""}`);
}

function advance(S, now = Date.now()) { // simulate real elapsed time since lastTick, in chunks
    const total = Math.min((now - S.lastTick) / 1000, G.meta.maxOfflineSec);
    S.lastTick = now;
    if (total <= 0) return false;
    const away = total > 10, st = away ? G.meta.offlineStepSec : G.meta.liveStepSec, p0 = S.pop;
    let left = total;
    RUN(S).quiet = away; RUN(S).popFloor = away ? Math.ceil(S.pop * 0.75) : 0; // away: at most a quarter can starve
    while (left > 0) { const dt = Math.min(st, left); step(S, dt); Settlement.emit("tick", S, dt, away); left -= dt; }
    if (away) { S.nextEvent = Math.max(S.nextEvent, S.time + 60); Settlement.emit("away", S, total); } // no event the moment you come back
    RUN(S).quiet = false;
    if (away) log(S, `Welcome back. Simulated ${Math.round(total / 60)} min away; population ${S.pop >= p0 ? "+" : ""}${S.pop - p0}.`);
    return checkUnlocks(S);
}

function log(S, msg, spam) {
    if (spam && RUN(S).quiet) return;
    if (RUN(S).autoNote) msg = "Auto: " + msg;
    S.logs.unshift(`[${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}] ${msg}`);
    S.logs.length = Math.min(S.logs.length, 20);
    if (!RUN(S).quiet) Settlement.emit("log", S);
}

const RUNS = new WeakMap(); // per-settlement scratch that is never saved: cached hauling, and flags that shape how one step logs and starves
function RUN(st) { let r = RUNS.get(st); if (!r) RUNS.set(st, r = { quiet: false, popFloor: 0, hc: null, autoNote: false }); return r; }
