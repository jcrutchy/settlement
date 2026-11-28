"use strict";
// Rules and rule-derived values: data access, requirements, costs. Engine layer: no DOM, no UI state.
let G, RES = {}, DEP = {}, G0 = "", GP = null; // G: the rules in force (gamedata.json plus any rule overrides); RES/DEP: id lookups into G

const sum = o => Object.values(o).reduce((a, b) => a + b, 0);

const randSeed = () => (Math.random() * 2147483647) >>> 0;

const toSeed = t => /^\d+$/.test(t) ? (+t) >>> 0 : [...t].reduce((a, ch) => Math.imul(a ^ ch.charCodeAt(0), 16777619) >>> 0, 2166136261);

const fmt = n => n >= 1e6 ? (n / 1e6).toFixed(2) + "M" : n >= 1e4 ? (n / 1e3).toFixed(1) + "k" : String(Math.floor(n));

const costStr = c => Object.entries(c).map(([k, v]) => `${v} ${k}`).join(", ");

const upStr = o => Object.entries(o || {}).map(([k, v]) => `${+(v * 3600).toFixed(1)}/hr ${k}`).join(" + "); // upkeep is tiny per second, so show it per hour

const ioStr = o => Object.entries(o || {}).map(([k, v]) => `${v}/s ${k}`).join(" + ");

const dur = t => t >= 3600 ? (t / 3600).toFixed(1) + "h" : t >= 60 ? Math.round(t / 60) + "m" : Math.round(t) + "s";

// Seeded PRNG (mulberry32): same seed -> same world on every device
function rng(seed) {
    let a = seed >>> 0;
    return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}

// startNew is defined with the new-game options below

function met(S, c) {
    if (!c) return true;
    if (c.all) return c.all.every(x => met(S, x));
    if (c.any) return c.any.some(x => met(S, x));
    if (c.tech !== undefined) return !!S.tech[c.tech];
    if (c.resource) return S.res[c.resource] >= c.gte;
    if (c.building) return S.bld[c.building] >= c.gte;
    return false;
}

const clamp01 = v => Math.max(0, Math.min(1, v));

const have = (S, c) => c.resource !== undefined ? S.res[c.resource] : S.bld[c.building];

const prog = (S, c) => !c ? 1 : c.all ? Math.min(...c.all.map(x => prog(S, x))) : c.any ? Math.max(...c.any.map(x => prog(S, x))) : c.tech !== undefined ? (S.tech[c.tech] ? 1 : 0) : Math.min(1, have(S, c) / c.gte);

const needText = (S, c) => c.all ? c.all.map(x => needText(S, x)).join(", ") : c.any ? c.any.map(x => needText(S, x)).join(" or ") : c.tech !== undefined ? "research " + (G.techs.find(q => q.id === c.tech) || { name: c.tech }).name : `${c.resource ?? c.building} ${fmt(have(S, c))}/${c.gte}`;

const scaled = (cost, g, n) => {
    const m = g.type === "exp" ? Math.pow(g.rate, n) : g.type === "linear" ? 1 + g.rate * n : 1;
    const c = {}; for (const k in cost) c[k] = Math.ceil(cost[k] * m); return c;
};

const costOf = (S, b) => scaled(b.cost, b.growth || {}, S.bld[b.id]);

const claimCost = (S) => scaled(G.land.cost, G.land.growth, S.claims);

const afford = (S, c) => Object.entries(c).every(([k, v]) => S.res[k] >= v);

const spend = (S, c) => { for (const k in c) S.res[k] -= c[k]; };

const K = (x, y) => x + "," + y, bOf = id => G.buildings.find(x => x.id === id);

const nb4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];

const polOf = id => (G.policies || []).find(p => p.id === id);

const frac = (c, f, up) => { const o = {}; for (const k in c) o[k] = up ? Math.ceil(c[k] * f) : Math.floor(c[k] * f); return o; };

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

function loadData(text) { // the rules file, as text; GP keeps the pristine parse so a new run can start from it
    G0 = text; GP = JSON.parse(text); applyRules({});
}
