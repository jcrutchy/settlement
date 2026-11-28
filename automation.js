"use strict";
// Automation: the planners a player can switch on, and what AI neighbours run all the time.
let lastAuto = 0; // wall-clock pacing for the player's own automation

function autoPolicy(S, R, rs) { // fill an empty policy group with the best-ranked policy that is affordable and sustainable; never replaces one you chose
    const taken = new Set(Object.keys(S.pol).map(id => polOf(id).group));
    const cands = (G.policies || []).filter(p => S.unlocked["pol:" + p.id] && !S.pol[p.id] && !taken.has(p.group) && (p.rank || 0) > 0).sort((a, b) => b.rank - a.rank);
    for (const p of cands) {
        const ok = Object.keys(p.upkeep || {}).every(k => S.res[k] >= S.pop * p.upkeep[k] * 600 || netOf(R, k) > S.pop * p.upkeep[k]); // ten minutes of upkeep in hand, or income that covers it
        if (ok && afford1(S, p.cost, 1.1) && keeps(S, p.cost, rs)) { RUN(S).autoNote = true; adopt(S, p.id); RUN(S).autoNote = false; return !!S.pol[p.id]; }
    }
    return false;
}

// Automation: for casual play. Runs on live ticks only (not while the game is closed). Assignment is checked every tick;
// building and claiming do at most one thing every 3 seconds and keep a spending reserve.
const autoCount = (S) => Object.values(S.bld).reduce((a, b) => a + b, 0) + S.claims;

const autoDo = (S, fn) => { const n = autoCount(S); RUN(S).autoNote = true; fn(); RUN(S).autoNote = false; return autoCount(S) > n; };

const yieldOf = (S, j) => { if (!j.deposit) return 1; const d = S.dep[j.deposit]; return DEP[j.deposit].regrow ? (d.cap > 0 ? d.amt / d.cap : 0) : (d.amt > 0 ? 1 : 0); };

const workersOn = (S, d) => G.jobs.reduce((w, j) => w + (j.deposit === d.id ? S.jobs[j.id] : 0), 0);

const sustain = (S, d) => { // workers a regrowing deposit can feed without being stripped bare: harvest at half density equals peak regrowth
    if (!d.regrow) return Infinity;
    const cap = S.dep[d.id].cap, j = G.jobs.find(x => x.deposit === d.id), rate = (j && j.outputs[d.resource]) || 1;
    return cap > 0 ? Math.max(1, Math.floor(d.regrow * cap / (2 * rate))) : 0;
};

function autoTrim(S) { // release a worker from an input-starved job or an over-staffed deposit so it can be reassigned elsewhere
    for (const d of G.deposits) { // finite deposit used up: its workers produce nothing
        if (d.regrow || S.dep[d.id].amt >= 1) continue;
        const j = G.jobs.find(x => x.deposit === d.id && S.jobs[x.id] > 0);
        if (j) { const n = Math.ceil(S.jobs[j.id] / 3); S.jobs[j.id] -= n; S.rev++; RUN(S).autoNote = true; log(S, `released ${n} ${j.name}${n > 1 ? "s" : ""}: ${d.name} is exhausted.`); RUN(S).autoNote = false; return true; }
    }
    const R = flows(S, 1).R;
    for (const j of G.jobs) { // everything this job makes is full and in surplus: let some workers go so they can be reassigned
        const ks = Object.keys(j.outputs);
        if (S.jobs[j.id] > 1 && ks.every(k => S.res[k] >= capOf(S, k) * 0.98 && netOf(R, k) > 0.15 * R[k].c + 0.5)) { const n = Math.ceil(S.jobs[j.id] / 5); S.jobs[j.id] -= n; S.rev++; RUN(S).autoNote = true; log(S, `released ${n} ${j.name}${n > 1 ? "s" : ""}: ${ks.map(k => RES[k].name).join("/")} is full.`); RUN(S).autoNote = false; return true; }
    }
    for (const j of G.jobs) {
        if (S.jobs[j.id] > 0 && Object.keys(j.inputs || {}).some(k => S.res[k] < 1 && netOf(R, k) <= 0)) { // starved of an input: release a third at once (min 1), not one per tick
            const n = Math.max(1, Math.ceil(S.jobs[j.id] / 3)); S.jobs[j.id] -= n; S.rev++; RUN(S).autoNote = true;
            log(S, `released ${n > 1 ? n : "a"} ${j.name}${n > 1 ? "s" : ""}: out of ${Object.keys(j.inputs).filter(k => S.res[k] < 1 && netOf(R, k) <= 0).map(k => RES[k].name).join("/")}.`); RUN(S).autoNote = false; return true;
        }
    }
    for (const d of G.deposits) {
        const n = workersOn(S, d); if (!d.regrow || n < 2) continue;
        const s0 = S.dep[d.id], thin = s0.cap > 0 && s0.amt / s0.cap < 0.25;
        if (n <= sustain(S, d) + 1 && !thin) continue;
        const j = G.jobs.filter(x => x.deposit === d.id && S.jobs[x.id] > 0).sort((a, b) => S.jobs[b.id] - S.jobs[a.id])[0];
        S.jobs[j.id]--; S.rev++; RUN(S).autoNote = true; log(S, `released a ${j.name}: ${d.name} is running thin.`); RUN(S).autoNote = false; return true;
    }
    return false;
}

function autoAssign(S) { // put idle settlers where something is actually needed: low food first, then whatever the next purchases lack
    let did = false, idle = getIdle(S);
    while (idle > 0) { // each pass re-plans, then moves a batch (a twelfth of the idle) so thousands of idle settlers cost a dozen passes, not thousands
        const R = flows(S, 1).R, want = wants(S); let best = null, top = 0, bestNeed = Infinity;
        G.jobs.forEach(j => {
            if (!S.unlocked["job:" + j.id] || S.jobs[j.id] >= slotCap(S, j)) return;
            if (j.deposit && !(S.dep[j.deposit].cap > 0 && S.dep[j.deposit].amt > 1)) return;
            if (j.deposit && DEP[j.deposit].regrow && workersOn(S, DEP[j.deposit]) >= sustain(S, DEP[j.deposit])) return; // more hands would only strip the deposit
            if (Object.keys(j.inputs || {}).some(k => S.res[k] < 5 || (netOf(R, k) < 0 && S.res[k] < 0.5 * capOf(S, k) && S.res[k] < 300 * j.inputs[k] * (S.jobs[j.id] + 1)))) return; // would stand idle, or deepen a shortage of its input (a stock that covers five minutes of work is fine)
            let score = 0, need = Infinity;
            Object.keys(j.outputs).forEach(k => {
                let w, nd = Infinity;
                if (G.pop.needs[k]) { const lvl = Math.min(1, S.res[k] / capOf(S, k)); w = ((1 - lvl) + (netOf(R, k) < 0 ? 0.5 : 0)) * 3; if (lvl >= 0.98) w = 0; }
                else {
                    const goal = (want[k] || 0) * 1.5, gap = goal - S.res[k] - 15 * netOf(R, k); // what is still missing 15 s from now at the present rate
                    w = goal > 0 ? Math.max(0, gap / goal) : 0.05; if (S.res[k] >= capOf(S, k) * 0.98) w = 0;
                    if (goal > 0) nd = Math.ceil(Math.max(0, gap) / (15 * j.outputs[k] * Math.max(0.05, yieldOf(S, j))));
                }
                const sc = w * fmul(S, k) * (1 + 0.5 * j.outputs[k] * yieldOf(S, j) * (j.deposit ? haul(S, j.deposit).eff : 1));
                if (sc > score) { score = sc; need = nd; }
            });
            if (score > top) { top = score; best = j; bestNeed = need; }
        });
        if (!best) break;
        let room = slotCap(S, best) - S.jobs[best.id];
        if (best.deposit && DEP[best.deposit].regrow) room = Math.min(room, sustain(S, DEP[best.deposit]) - workersOn(S, DEP[best.deposit]));
        for (const k in best.inputs || {}) room = Math.min(room, Math.max(1, Math.floor(S.res[k] / (300 * best.inputs[k])) - S.jobs[best.id])); // inputs that cover five minutes of work
        const k = Math.max(1, Math.min(idle, room, bestNeed, Math.ceil(idle / 12))); // never more hands than the shortfall needs
        S.jobs[best.id] += k; idle -= k; did = true;
    }
    if (did) S.rev++;
    return did;
}

const netOf = (R, k) => R[k].p - R[k].c;

// affordable with a spending cushion of f times the price, but never asking for more than the stockpile can hold
const afford1 = (S, c, f) => Object.entries(c).every(([k, v]) => S.res[k] >= v && S.res[k] >= Math.min(v * f, capOf(S, k) * 0.98));

const keeps = (S, c, reserve) => Object.entries(c).every(([k, v]) => S.res[k] - v >= (reserve[k] || 0));

function addReserve(S, reserve, c, R) { // earmark a pending purchase, unless it is out of reach (then don't stall everything else)
    if (!Object.keys(c).every(k => S.res[k] >= c[k] * 0.3 || netOf(R, k) > 0.01)) return;
    for (const k in c) reserve[k] = Math.max(reserve[k] || 0, c[k]);
}

function autoFeed(S, R) { // an essential need is draining: move a worker from the biggest unrelated job to a job that makes it
    for (const k of Object.keys(G.pop.needs)) {
        if (netOf(R, k) >= 0 || S.res[k] > 0.3 * capOf(S, k)) continue;
        const gain = j => j.outputs[k] * (j.deposit ? haul(S, j.deposit).eff : 1);
        const makers = G.jobs.filter(j => j.outputs[k] && S.unlocked["job:" + j.id] && S.jobs[j.id] < slotCap(S, j) && (!j.deposit || (S.dep[j.deposit].cap > 0 && S.dep[j.deposit].amt > 1))).sort((a, b) => gain(b) - gain(a));
        const from = G.jobs.filter(j => !j.outputs[k] && S.jobs[j.id] > 0).sort((a, b) => S.jobs[b.id] - S.jobs[a.id])[0];
        if (!makers.length || !from) continue;
        S.jobs[from.id]--; S.jobs[makers[0].id]++; S.rev++;
        RUN(S).autoNote = true; log(S, `moved a ${from.name} to ${makers[0].name}: ${RES[k].name} is running low.`); RUN(S).autoNote = false; return true;
    }
    return false;
}

function foodPlan(S, R) { // food is draining and no job has a free slot: the cheapest building that adds slots for a job making it
    for (const k of Object.keys(G.pop.needs)) {
        if (netOf(R, k) >= 0 || S.res[k] > 0.3 * capOf(S, k)) continue;
        const slotted = G.jobs.filter(j => j.slots && j.outputs[k]);
        if (slotted.some(j => S.unlocked["job:" + j.id] && S.jobs[j.id] < slotCap(S, j))) continue;
        const cand = G.buildings.filter(b => S.unlocked["bld:" + b.id] && canPlace(S, b) && slotted.some(j => j.slots.building === b.id && (!j.deposit || S.dep[j.deposit].cap > 0))).sort((x, y) => sum(costOf(S, x)) - sum(costOf(S, y)));
        if (cand[0]) return { b: cand[0], cost: costOf(S, cand[0]) };
    }
    return null;
}

function claimOk(S) { // automation buys land while the price is cheap, and past that only while the economy could pay it off within claimPayMin minutes
    const c = claimCost(S);
    if (sum(c) <= sum(G.land.cost) * ((G.automation && G.automation.claimMaxMult) || 12)) return true;
    const R = flows(S, 1).R, secs = ((G.automation && G.automation.claimPayMin) || 10) * 60, idle = getIdle(S);
    const potential = k => G.jobs.reduce((m, j) => { // what idle settlers could add: the best job making k, limited by its free slots and what its deposit sustains
        if (!j.outputs[k] || !S.unlocked["job:" + j.id] || j.inputs) return m;
        const room = Math.min(idle, slotCap(S, j) - S.jobs[j.id], j.deposit && DEP[j.deposit].regrow ? sustain(S, DEP[j.deposit]) : Infinity);
        return Math.max(m, Math.max(0, room) * j.outputs[k]);
    }, 0);
    return Object.keys(c).every(k => S.res[k] >= c[k] || (netOf(R, k) + potential(k)) * secs >= c[k] - S.res[k]);
}

const fmul = (S, k) => [0.25, 1, 3][(S.autoFocus || {})[k] ?? 1]; // player's resource focus: low / normal / high

function wants(S) { // the biggest single purchase of each resource that is currently on offer
    const m = {}, add = c => { for (const k in c) m[k] = Math.max(m[k] || 0, c[k]); };
    if (claimOk(S)) add(claimCost(S)); G.buildings.forEach(b => { if (S.unlocked["bld:" + b.id]) add(costOf(S, b)); });
    G.techs.forEach(q => { if (S.unlocked["tech:" + q.id] && !S.tech[q.id]) add(q.cost); });
    const req = c => { if (!c) return; (c.all || c.any || []).forEach(req); if (c.resource !== undefined) m[c.resource] = Math.max(m[c.resource] || 0, c.gte); };
    G.buildings.forEach(b => { if (!S.unlocked["bld:" + b.id]) req(b.requires); }); // e.g. stone for a storehouse that is still locked
    return m;
}

function storageNeeds(S, R) { // stockpiles that are full and wasting while still small next to what is being bought, or too small for the next claim
    const w = wants(S), need = new Set();
    G.resources.forEach(r => { const k = r.id; if (S.unlocked["res:" + k] && w[k] && capOf(S, k) < ((G.automation && G.automation.storageWantMult) || 3) * w[k] && S.res[k] >= capOf(S, k) * 0.97 && netOf(R, k) > 0.01) need.add(k); });
    if ((S.auto || {}).claim && claimOk(S)) { const cc = claimCost(S); for (const k in cc) if (cc[k] > capOf(S, k)) need.add(k); }
    return need;
}

function depotPlan(S) { // workers are hauling over long distances: a depot building that clearly improves it
    const workers = d => G.jobs.reduce((w, j) => w + (j.deposit === d.id ? S.jobs[j.id] : 0), 0);
    if (!G.deposits.some(d => workers(d) > 0 && haul(S, d.id).eff < 0.75)) return null;
    const score = () => G.deposits.reduce((a, d) => a + haul(S, d.id).eff * (1 + workers(d)), 0);
    let best = null, topGain = 0.05;
    G.buildings.filter(b => S.unlocked["bld:" + b.id] && b.effects.some(e => e.type === "depot")).forEach(b => {
        const t = bestTile(S, b.id); if (!t) return;
        const before = score(); t.b = b.id; RUN(S).hc = null; const gain = score() - before; t.b = null; RUN(S).hc = null;
        if (gain > topGain) { topGain = gain; best = b; }
    });
    return best;
}

function storagePlan(S, R) { // capacity for full stockpiles first, then a depot if hauling is poor
    return capacityPlan(S, R) || depotPlan(S);
}

function capacityPlan(S, R) { // the best capacity building for the stockpiles that need it
    const need = storageNeeds(S, R); if (!need.size) return null;
    let best = null, top = 0;
    G.buildings.forEach(b => {
        if (!S.unlocked["bld:" + b.id]) return;
        const val = b.effects.filter(e => e.type === "capacity" && (e.resource === "*" || need.has(e.resource))).reduce((a, e) => a + e.value * (e.resource === "*" ? need.size : 1), 0);
        if (!val) return;
        const sc = val / (1 + sum(costOf(S, b)) / 100); if (sc > top) { top = sc; best = b; }
    });
    return best;
}

function autoHousing(S, reserve) { // build the best affordable housing when the village is full and food can support growth
    if (S.pop < housing(S) || S.res.food < G.pop.growthFoodMin) return false;
    const f = flows(S, 1).R.food; if (f.p - f.c < 0 && S.res.food < 40) return false;
    const gain = b => b.effects.filter(e => e.type === "housing").reduce((a, e) => a + e.value, 0);
    let best = null, top = 0;
    G.buildings.forEach(b => {
        if (!S.unlocked["bld:" + b.id] || !gain(b) || !canPlace(S, b)) return;
        const c = costOf(S, b); if (!afford1(S, c, 1.1) || !keeps(S, c, reserve)) return;
        const sc = gain(b) / (1 + sum(c) / 100); if (sc > top) { top = sc; best = b; }
    });
    return best ? autoDo(S, () => build(S, best.id)) : false;
}

function autoClaim(S, force, reserve) { // when building space runs out, or a wanted deposit is missing or thin, claim the most useful neighbouring tile
    reserve = reserve || {};
    if (!force && !claimOk(S)) return false;
    const goal = new Set(), wnt = wants(S); // terrains whose deposits we want more of
    G.deposits.forEach(d => {
        const e = S.dep[d.id], w = workersOn(S, d);
        const thin = d.regrow && e.cap > 0 && w >= 2 && (e.amt / e.cap < 0.5 || (w >= sustain(S, d) && S.res[d.resource] < 1.5 * (wnt[d.resource] || 0)));
        const missing = (e.cap === 0 || (!d.regrow && e.amt < 1)) && S.res[d.resource] < 1.5 * (wnt[d.resource] || 0) && G.jobs.some(j => j.deposit === d.id);
        if (thin || missing) dterr(d).forEach(t => goal.add(t));
    });
    if (!force && !goal.size && owned(S).filter(t => !t.b && !TD[terrainAt(t.x, t.y)].water).length >= 2) return false;
    const c = claimCost(S); if (!afford1(S, c, force ? 1 : 1.5) || !keeps(S, c, reserve)) return false;
    const toward = (x, y) => { // how close is the nearest tile of a wanted terrain (0 = this one)
        if (!goal.size) return 99;
        for (let r = 0; r <= 10; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (Math.max(Math.abs(dx), Math.abs(dy)) === r && goal.has(terrainAt(x + dx, y + dy))) return r;
        return 99;
    };
    let best = null, top = -Infinity;
    owned(S).forEach(t => nb4.forEach(([dx, dy]) => {
        const x = t.x + dx, y = t.y + dy; if (!claimable(S, x, y)) return;
        const tid = terrainAt(x, y), td = TD[tid], d0 = toward(x, y);
        const sc = (td.water ? -3 : 1) - dist({ x, y }, S.center) * 0.3 + (G.deposits.some(d => dterr(d).includes(tid) && S.dep[d.id].cap === 0) ? 1.5 : 0) + (d0 === 0 ? 4 : Math.max(0, 3 - 0.4 * d0));
        if (sc > top) { top = sc; best = [x, y]; }
    }));
    return best ? autoDo(S, () => claimAt(S, best[0], best[1])) : false;
}

function autoResearch(S, R, reserve) { // research the affordable technology that unlocks the most, cheapest first
    const refs = id => { // how many still-locked things are waiting on this tech
        let n = 0; const has = c => !!c && (c.tech === id || (c.all || c.any || []).some(has));
        [["bld:", G.buildings], ["job:", G.jobs], ["res:", G.resources], ["tech:", G.techs]].forEach(([p, list]) => list.forEach(x => { if (has(x.requires) && !(p === "tech:" ? S.tech[x.id] : S.unlocked[p + x.id])) n++; }));
        return n;
    };
    const cands = G.techs.filter(q => S.unlocked["tech:" + q.id] && !S.tech[q.id]).map(q => ({ q, sc: (refs(q.id) * 3 + (q.effects || []).length) / (1 + sum(q.cost) / 200) })).sort((a, b) => b.sc - a.sc);
    for (const { q } of cands) { // best first; one that is out of reach (a cost nothing is producing) must not block the cheaper ones behind it
        if (afford1(S, q.cost, 1.1) && keeps(S, q.cost, reserve)) { RUN(S).autoNote = true; research(S, q.id); RUN(S).autoNote = false; return !!S.tech[q.id]; }
        if (Object.keys(q.cost).every(k => S.res[k] >= q.cost[k] * 0.3 || netOf(R, k) > 0.01)) { addReserve(S, reserve, q.cost, R); return false; } // within reach: save up for it
    }
    return false;
}

function producePlan(S, R) { // build what a wanted resource, or a locked technology, is waiting on
    const w = wants(S), keys = Object.keys(w).sort((a, b) => ((S.autoFocus || {})[b] ?? 1) - ((S.autoFocus || {})[a] ?? 1));
    const plan = (k, depth) => { // a building that lets some job make k, or make an input of that job
        if (depth > 4) return null;
        for (const j of G.jobs.filter(x => x.outputs[k])) {
            const bid = j.slots ? j.slots.building : (j.requires && j.requires.building) || null;
            if (bid && S.bld[bid] === 0) { if (S.unlocked["bld:" + bid] && canPlace(S, bOf(bid))) return bOf(bid); continue; }
            for (const ki of Object.keys(j.inputs || {})) if (S.res[ki] < 5 && R[ki].p <= 0.01) { const r = plan(ki, depth + 1); if (r) return r; }
        }
        return null;
    };
    for (const k of keys) { if (!R[k] || S.res[k] >= w[k] || R[k].p > 0.01) continue; const b = plan(k, 0); if (b) return { b }; }
    // technologies still locked behind a building count (e.g. a second farm)
    const terms = c => !c ? [] : c.all || c.any ? (c.all || c.any).flatMap(terms) : c.building !== undefined && S.bld[c.building] < c.gte ? [c.building] : [];
    for (const q of G.techs) { if (S.unlocked["tech:" + q.id]) continue; for (const bid of terms(q.requires)) if (S.unlocked["bld:" + bid] && canPlace(S, bOf(bid))) return { b: bOf(bid) }; }
    return null;
}

function buyBuilding(S, b, reserve, R) { // build it if affordable, otherwise earmark its cost so lower priorities do not spend it
    const c = costOf(S, b);
    if (afford1(S, c, 1.1) && keeps(S, c, reserve)) return autoDo(S, () => build(S, b.id));
    addReserve(S, reserve, c, R); return false;
}

function welfarePlan(S) { // the building that best lifts the gauge whose target is furthest below its warning level
    const sig = gaugeSignals(S, flows(S, 1));
    let gauge = null, worst = 0;
    (G.gauges || []).forEach(g => { const gap = gaugeTarget(S, g, sig) - (g.warn ?? ((g.low || {}).at ?? 0.5) + 0.1); if (gap < worst) { worst = gap; gauge = g; } });
    if (!gauge) return null;
    let best = null, top = 0;
    G.buildings.filter(b => S.unlocked["bld:" + b.id] && canPlace(S, b)).forEach(b => {
        const gain = b.effects.reduce((a, e) => a + (e.type === "gauge" && e.resource === gauge.id ? e.value : 0), 0), sc = gain / (1 + sum(costOf(S, b)) / 200);
        if (sc > top) { top = sc; best = b; }
    });
    return best;
}

const AUTO_KEYS = { food: "feed", storage: "storage", research: "research", production: "production", housing: "housing", welfare: "welfare", policy: "policy", land: "claim" };

const AUTO_STEPS = {
    food: (S, R, rs) => { if (autoFeed(S, R)) return true; const f = foodPlan(S, R); return f ? buyBuilding(S, f.b, rs, R) : false; },
    storage: (S, R, rs, a) => { const b = storagePlan(S, R); if (!b) return false; return canPlace(S, b) ? buyBuilding(S, b, rs, R) : !!a.claim && autoClaim(S, true, rs); },
    research: (S, R, rs) => autoResearch(S, R, rs),
    production: (S, R, rs) => { const p = producePlan(S, R); return p ? buyBuilding(S, p.b, rs, R) : false; },
    housing: (S, R, rs) => autoHousing(S, rs),
    welfare: (S, R, rs) => { const b = welfarePlan(S); return b ? buyBuilding(S, b, rs, R) : false; },
    policy: (S, R, rs) => autoPolicy(S, R, rs),
    land: (S, R, rs) => autoClaim(S, false, rs)
};

function autoOrder(S) { // the player's order first, then any categories they have not placed
    const mine = (S.autoOrder || []).filter(k => AUTO_KEYS[k]), def = (G.automation && G.automation.order) || Object.keys(AUTO_KEYS);
    return [...mine, ...def.filter(k => !mine.includes(k))];
}

function runAuto(S, sim) { // live ticks only. Assignment every tick; purchases at most one every 3 s, in priority order, each keeping what higher ones are saving for.
    // sim: an AI neighbour, paced by its own game clock instead (everything, assignment included, once per 3 s of game time), so it can also play on in coarse steps while you are away
    if (sim) { if (S.time - (S.autoT ?? -99) < 3) return false; S.autoT = S.time; }
    const a = S.auto || {}; let acted = false;
    if (a.idle && getIdle(S) > 0 && autoAssign(S)) acted = true;
    if (!sim) { const now = Date.now(); if (now - lastAuto < 3000) return acted; lastAuto = now; }
    if (a.idle && autoTrim(S)) return true;
    const R = flows(S, 1).R, reserve = {};
    for (const cat of autoOrder(S)) { if (a[AUTO_KEYS[cat]] && AUTO_STEPS[cat](S, R, reserve, a)) return true; }
    return acted;
}
