"use strict";
// The map (endless, generated from the seed; only owned tiles are stored), who holds which tile, hauling and placement.
let TD = {}, TCACHE = new Map(), WSEED = null;
const WS = { owner: new Map() }; // tile key -> { pid, t } for every settlement on the map (derived from each state's own tiles; see rebuildWorld)

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

function findStart(ox = 0, oy = 0, ok = null) { // nearest spot (spiralling out from ox,oy) meeting the start rules, and ok(x,y) if given; relaxes the later rules if needed
    const st = G.map.start, has = (x, y, ids, r, n) => { let c = 0; for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (ids.includes(terrainAt(x + dx, y + dy)) && ++c >= n) return true; return false; };
    for (let k = st.need.length; k >= 2; k--) {
        const needs = st.need.slice(0, k);
        for (let r = 0; r <= 60; r++) {
            const m = r * 3;
            for (let i = -m; i <= m; i += 3) for (const [dx, dy] of r ? [[i, -m], [i, m], [-m, i], [m, i]] : [[0, 0]]) {
                const x = ox + dx, y = oy + dy;
                if (terrainAt(x, y) === st.center && (!ok || ok(x, y)) && needs.every(n => has(x, y, n.terrain, n.radius, n.count || 1))) return { x, y };
            }
        }
    }
    return ok ? null : { x: 0, y: 0 };
}

const dterr = d => [].concat(d.terrain);

const hk = (x, y) => hash(x, y, WSEED ^ 0x9999);

const tileCap = (d, x, y) => Math.round(d.perTile * (1 - d.variance + 2 * d.variance * hk(x, y)));

const owned = (S) => Object.values(S.own), ownedCount = (S) => Object.keys(S.own).length;

const poolCap = (st, d) => Object.values(st.own).reduce((a, t) => a + (dterr(d).includes(terrainAt(t.x, t.y)) ? tileCap(d, t.x, t.y) : 0), 0);

const dist = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);

const isDepot = bid => bid === "center" || (!!bid && bOf(bid).effects.some(e => e.type === "depot"));

const freeTiles = (S) => owned(S).filter(t => !t.b).length;

const allowed = (b, x, y) => { // terrain and "next to water"-style placement rules
    const t = terrainAt(x, y);
    if (b.terrain ? !b.terrain.includes(t) : TD[t].buildable === false) return false;
    return !b.near || nb4.some(([dx, dy]) => b.near.includes(terrainAt(x + dx, y + dy)));
};

const canPlace = (S, b) => owned(S).some(t => !t.b && allowed(b, t.x, t.y));

const claimable = (S, x, y) => !S.own[K(x, y)] && !WS.owner.has(K(x, y)) && nb4.some(([dx, dy]) => S.own[K(x + dx, y + dy)]);

function haul(S, id) { // delivery efficiency: mean distance from owned deposit tiles to the nearest depot
    if (!RUN(S).hc) {
        RUN(S).hc = {};
        const ts = owned(S), depots = ts.filter(t => isDepot(t.b)), M = G.map;
        G.deposits.forEach(d => {
            const mine = ts.filter(t => dterr(d).includes(terrainAt(t.x, t.y)));
            const avg = mine.length ? mine.reduce((a, t) => a + Math.min(...depots.map(p => dist(t, p))), 0) / mine.length : 0;
            RUN(S).hc[d.id] = { avg, eff: Math.max(M.minEfficiency, 1 - M.distancePenalty * Math.max(0, avg - M.freeRadius)) };
        });
    }
    return RUN(S).hc[id];
}

function bestTile(S, bid) { // depots go where hauling improves most; everything else hugs the town centre
    const b = bOf(bid), cand = owned(S).filter(t => !t.b && allowed(b, t.x, t.y));
    if (!cand.length) return null;
    const depot = b.effects.some(e => e.type === "depot");
    if (!depot) return cand.reduce((best, t) => (dist(t, S.center) < dist(best, S.center) ? t : best), cand[0]);
    // a depot: work out how much each candidate would shorten every deposit's mean haul. The distance of every deposit tile to its nearest
    // depot is computed once; a candidate only has to compare against that, instead of re-running haul() for each tile.
    const ts = owned(S), depots = ts.filter(t => isDepot(t.b)), M = G.map;
    const workers = d => G.jobs.reduce((w, j) => w + (j.deposit === d.id ? S.jobs[j.id] : 0), 0);
    const info = G.deposits.map(d => {
        const mine = ts.filter(t => dterr(d).includes(terrainAt(t.x, t.y)));
        return { w: 1 + workers(d), mine, m0: mine.map(t => { let m = Infinity; for (const p of depots) m = Math.min(m, dist(t, p)); return m; }) };
    });
    const effOf = avg => Math.max(M.minEfficiency, 1 - M.distancePenalty * Math.max(0, avg - M.freeRadius));
    const score = t => info.reduce((a, o) => {
        if (!o.mine.length) return a + o.w;
        let sum = 0; for (let i = 0; i < o.mine.length; i++) sum += Math.min(o.m0[i], dist(o.mine[i], t));
        return a + effOf(sum / o.mine.length) * o.w;
    }, 0) - dist(t, S.center) * 1e-3;
    let best = cand[0], top = -Infinity;
    cand.forEach(t => { const v = score(t); if (v > top) { top = v; best = t; } });
    return best;
}

function rebuildWorld(S) {
    WS.owner.clear(); S.rivals = S.rivals || [];
    const reg = (st, pid) => { st.pid = pid; for (const k in st.own) WS.owner.set(k, { pid, t: st.own[k] }); };
    reg(S, 0); S.rivals.forEach((r, i) => reg(r.st, i + 1));
}

function foreignAt(S, x, y) { // another settlement's tile, for drawing and the tile info line
    const o = WS.owner.get(K(x, y)); if (!o || !o.pid) return null;
    const r = S.rivals[o.pid - 1]; return r ? { pid: o.pid, name: r.name, color: r.color, icon: r.icon, b: o.t.b } : null;
}
