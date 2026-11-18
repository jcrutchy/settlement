"use strict";
// Validates gamedata.json: schema, references, economy graph, reachability.
// Browser only, no dependencies: exposes window.validateGameData(G). Used by validate.html.
(function (root) {
    function validateGameData(G) {
        const out = [];
        const err = (where, msg) => out.push({ level: "error", where, msg });
        const warn = (where, msg) => out.push({ level: "warn", where, msg });
        const isNum = (v, min) => typeof v === "number" && isFinite(v) && v >= (min === undefined ? 0 : min);
        const list = k => Array.isArray(G[k]) ? G[k] : (err("data", `"${k}" must be an array`), []);
        const resources = list("resources"), jobs = list("jobs"), buildings = list("buildings"), deposits = list("deposits");

        // ids: present and unique
        const ids = {};
        [["resources", resources], ["jobs", jobs], ["buildings", buildings], ["deposits", deposits]].forEach(([k, arr]) => {
            ids[k] = new Set();
            arr.forEach((x, i) => {
                if (!x.id || typeof x.id !== "string") return err(`${k}[${i}]`, "missing string id");
                if (ids[k].has(x.id)) err(`${k} "${x.id}"`, "duplicate id");
                ids[k].add(x.id);
                if (!x.name) warn(`${k} "${x.id}"`, "missing name");
            });
        });
        const RES = {}; resources.forEach(r => RES[r.id] = r);
        const hasRes = id => ids.resources.has(id);

        // conditions (requires): shape + references
        const refB = new Set();
        const walk = (c, where) => {
            if (c === undefined) return;
            if (!c || typeof c !== "object") return err(where, "requires must be an object");
            if (c.all || c.any) { const a = c.all || c.any; Array.isArray(a) ? a.forEach(x => walk(x, where)) : err(where, "all/any must be an array"); }
            else if (c.resource !== undefined) { if (!hasRes(c.resource)) err(where, `requires unknown resource "${c.resource}"`); if (!isNum(c.gte)) err(where, "requires needs a numeric gte"); }
            else if (c.building !== undefined) { if (!ids.buildings.has(c.building)) err(where, `requires unknown building "${c.building}"`); else refB.add(c.building); if (!isNum(c.gte)) err(where, "requires needs a numeric gte"); }
            else err(where, "unknown requires shape (use resource/building + gte, or all/any)");
        };
        const checkMap = (m, where, what) => {
            if (!m || typeof m !== "object") return err(where, `${what} must be an object`);
            for (const k in m) { if (!hasRes(k)) err(where, `${what} references unknown resource "${k}"`); else if (!isNum(m[k], 1e-12)) err(where, `${what} "${k}" must be a positive number`); }
        };
        const checkGrowth = (g, where) => {
            if (g === undefined) return;
            if (!g || !["flat", "linear", "exp"].includes(g.type)) return err(where, 'growth.type must be "flat", "linear" or "exp"');
            if (g.type !== "flat" && !isNum(g.rate)) err(where, "growth.rate must be a number");
        };

        // resources
        resources.forEach(r => {
            const w = `resource "${r.id}"`;
            if (!isNum(r.cap, 1)) err(w, "cap must be a number >= 1");
            if (!r.icon) warn(w, "missing icon");
            if (r.initial !== undefined && !isNum(r.initial)) err(w, "initial must be a number");
            walk(r.requires, w);
        });

        // deposits
        deposits.forEach(d => {
            const w = `deposit "${d.id}"`;
            if (!hasRes(d.resource)) err(w, `unknown resource "${d.resource}"`);
            if (!isNum(d.perTile, 1)) err(w, "perTile must be a number >= 1");
            if (!(G.map && Array.isArray(G.map.terrain) && G.map.terrain.some(t => t.id === d.terrain))) err(w, `terrain "${d.terrain}" is not defined in map.terrain`);
            if (!isNum(d.variance) || d.variance > 1) err(w, "variance must be between 0 and 1");
            if (!isNum(d.regrow)) err(w, "regrow must be a number >= 0");
            if (!jobs.some(j => j.deposit === d.id)) warn(w, "no job harvests this deposit");
        });

        // jobs
        jobs.forEach(j => {
            const w = `job "${j.id}"`;
            checkMap(j.outputs, w, "outputs");
            if (j.inputs !== undefined) checkMap(j.inputs, w, "inputs");
            if (j.deposit !== undefined) {
                if (!ids.deposits.has(j.deposit)) err(w, `unknown deposit "${j.deposit}"`);
                else if (!(G.deposits.find(d => d.id === j.deposit).resource in (j.outputs || {}))) warn(w, "deposit resource is not one of its outputs");
            }
            walk(j.requires, w);
        });

        // buildings
        const capGivers = {}; // resource -> [building ids]; "*" = all
        buildings.forEach(b => {
            const w = `building "${b.id}"`;
            checkMap(b.cost, w, "cost");
            if (!b.icon) warn(w, "missing icon (shown on the map)");
            if (!isNum(b.uses, 1)) err(w, "uses (plots) must be a number >= 1");
            checkGrowth(b.growth, w);
            walk(b.requires, w);
            if (!Array.isArray(b.effects)) return err(w, "effects must be an array (use [] for none)");
            b.effects.forEach(e => {
                if (!isNum(e.value, 1e-12)) err(w, "effect value must be a positive number");
                if (e.type === "housing" || e.type === "depot") return;
                if (e.type === "capacity" || e.type === "outputMult") {
                    if (e.type === "capacity" && e.resource === "*") { (capGivers["*"] = capGivers["*"] || []).push(b.id); return; }
                    if (!hasRes(e.resource)) err(w, `${e.type} effect references unknown resource "${e.resource}"`);
                    else if (e.type === "capacity") (capGivers[e.resource] = capGivers[e.resource] || []).push(b.id);
                } else err(w, `unknown effect type "${e.type}" (housing, capacity, outputMult, depot)`);
            });
        });

        // population + land
        if (!G.pop || !G.pop.needs) err("pop", "missing pop.needs"); else checkMap(G.pop.needs, "pop", "needs");
        if (G.pop) ["growthRate", "growthFoodMin", "starveRate"].forEach(k => { if (!isNum(G.pop[k])) err("pop", `${k} must be a number`); });
        const L = G.land;
        if (!L) err("land", "missing land block"); else {
            checkMap(L.cost, "land", "cost"); checkGrowth(L.growth, "land");
        }
        const M = G.map;
        if (!M) err("map", "missing map block"); else {
            if (!Number.isInteger(M.size) || M.size < 5 || M.size > 40) err("map", "size must be an integer from 5 to 40");
            ["freeRadius", "distancePenalty", "startRadius"].forEach(k => { if (!isNum(M[k])) err("map", `${k} must be a number >= 0`); });
            if (!isNum(M.minEfficiency) || M.minEfficiency > 1) err("map", "minEfficiency must be between 0 and 1");
            if (!Array.isArray(M.terrain) || !M.terrain.length) err("map", "terrain must be a non-empty array");
            else M.terrain.forEach(t => { if (!t.id || !t.icon || !isNum(t.weight, 1e-9)) err(`terrain "${t.id}"`, "needs id, icon and a positive weight"); });
            if (!buildings.some(b => (b.effects || []).some(e => e.type === "depot"))) warn("map", "no building has a depot effect, so hauling distance can never be reduced");
        }
        if (!G.meta) err("meta", "missing meta block");

        // reachability: what can a player ever obtain, starting from nothing?
        const resOk = new Set(), jobOk = new Set(), bldOk = new Set();
        const ok = c => !c || (c.all ? c.all.every(ok) : c.any ? c.any.some(ok) : c.resource !== undefined ? resOk.has(c.resource) : c.building !== undefined ? bldOk.has(c.building) : false);
        for (let ch = true; ch;) {
            ch = false;
            jobs.forEach(j => { if (!jobOk.has(j.id) && ok(j.requires) && Object.keys(j.inputs || {}).every(k => resOk.has(k))) { jobOk.add(j.id); ch = true; } });
            resources.forEach(r => { if (!resOk.has(r.id) && ok(r.requires) && (r.manual || jobs.some(j => jobOk.has(j.id) && r.id in (j.outputs || {})))) { resOk.add(r.id); ch = true; } });
            buildings.forEach(b => { if (!bldOk.has(b.id) && ok(b.requires) && Object.keys(b.cost || {}).every(k => resOk.has(k))) { bldOk.add(b.id); ch = true; } });
        }
        resources.forEach(r => { if (!resOk.has(r.id)) err(`resource "${r.id}"`, "unreachable: nothing can ever produce it or its unlock is unmet"); });
        jobs.forEach(j => { if (!jobOk.has(j.id)) err(`job "${j.id}"`, "unreachable: its unlock or inputs can never be met"); });
        buildings.forEach(b => { if (!bldOk.has(b.id)) err(`building "${b.id}"`, "unreachable: its unlock or cost can never be met"); });
        if (!buildings.some(b => bldOk.has(b.id) && (b.effects || []).some(e => e.type === "housing"))) err("data", "no reachable building provides housing, so population can never grow");

        // sinks and purpose
        const used = new Set(Object.keys((G.pop && G.pop.needs) || {}).concat(Object.keys((L && L.cost) || {})));
        jobs.forEach(j => Object.keys(j.inputs || {}).forEach(k => used.add(k)));
        buildings.forEach(b => Object.keys(b.cost || {}).forEach(k => used.add(k)));
        resources.forEach(r => { if (!used.has(r.id)) warn(`resource "${r.id}"`, "dead end: nothing consumes it (no job input, building cost, land cost or population need)"); });
        buildings.forEach(b => { if (!(b.effects || []).length && !refB.has(b.id)) warn(`building "${b.id}"`, "does nothing: no effects and nothing requires it"); });

        // capacity: a cost above a resource's base cap needs something that raises that cap
        const checkCost = (cost, where, selfIds) => {
            for (const k in cost || {}) {
                if (!RES[k] || !(cost[k] > RES[k].cap)) continue;
                const givers = (capGivers[k] || []).concat(capGivers["*"] || []).filter(id => bldOk.has(id));
                if (!givers.length) err(where, `costs ${cost[k]} ${k} but its capacity is ${RES[k].cap} and no reachable building raises it`);
                else if (selfIds && givers.every(id => selfIds.includes(id))) err(where, `costs ${cost[k]} ${k} but capacity is ${RES[k].cap}; it is the only thing that raises that cap`);
            }
        };
        buildings.forEach(b => checkCost(b.cost, `building "${b.id}"`, [b.id]));
        if (L) checkCost(L.cost, "land", null);

        out.push({ level: "info", where: "summary", msg: `${resources.length} resources, ${jobs.length} jobs, ${buildings.length} buildings, ${deposits.length} deposits.` });
        return out;
    }

    root.validateGameData = validateGameData;
})(window);
