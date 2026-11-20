"use strict";
const $ = id => document.getElementById(id), DRAFT = "settlement_builder_draft";
const SING = { resources: "resource", jobs: "job", buildings: "building", deposits: "deposit" };
// field: [key, type, optional?, referenced list]
const FIELDS = {
    resources: [["id", "id"], ["name", "text"], ["icon", "text"], ["cap", "num"], ["initial", "num", 1], ["spoil", "num", 1], ["manual", "bool", 1], ["requires", "cond", 1]],
    jobs: [["id", "id"], ["name", "text"], ["outputs", "map", 0, "resources"], ["inputs", "map", 1, "resources"], ["deposit", "ref", 1, "deposits"], ["slots", "slots", 1], ["requires", "cond", 1]],
    buildings: [["id", "id"], ["name", "text"], ["icon", "text"], ["desc", "text", 1], ["cost", "map", 0, "resources"], ["uses", "num"], ["growth", "growth", 1], ["terrain", "csv", 1], ["near", "csv", 1], ["effects", "effects"], ["requires", "cond", 1]],
    deposits: [["id", "id"], ["name", "text"], ["resource", "ref", 0, "resources"], ["terrain", "csv"], ["perTile", "num"], ["variance", "num"], ["regrow", "num"]]
};
const NEW = {
    resources: { name: "New resource", icon: "❔", cap: 100 },
    jobs: { name: "New job", outputs: {} },
    buildings: { name: "New building", cost: {}, uses: 1, effects: [] },
    deposits: { name: "New deposit", resource: "", terrain: ["forest"], perTile: 100, variance: 0.2, regrow: 0 }
};
let D, SEC = "resources", timer; const open = new Set();

// --- tiny DOM helpers ---
function h(tag, p = {}, ...kids) {
    const e = document.createElement(tag);
    for (const k in p) { if (k.startsWith("on") || ["value", "checked", "textContent"].includes(k)) e[k] = p[k]; else e.setAttribute(k, p[k]); }
    e.append(...kids.flat().filter(c => c != null && c !== false));
    return e;
}
const ids = list => (D[list] || []).map(x => x.id);
function sel(opts, value, onch) {
    const o = value === undefined || opts.includes(value) ? opts : [...opts, value];
    const s = h("select", { onchange: e => onch(e.target.value) }, o.map(v => h("option", { value: v, textContent: v === "" ? "(none)" : v })));
    s.value = value === undefined ? "" : value; return s;
}
const numIn = (v, onch) => h("input", { type: "number", step: "any", value: v ?? "", oninput: e => onch(e.target.value === "" ? undefined : parseFloat(e.target.value)) });
const setVal = (o, k, v) => { if (v === undefined || v === "" || v === false) delete o[k]; else o[k] = v; };
const field = (label, w) => h("div", { class: "fld" }, h("span", { class: "lbl", textContent: label }), w);

// --- widgets ---
function mapEd(obj, key, list, opt) { // { resourceId: number }
    const box = h("div"), rows = Object.entries(obj[key] || {});
    const commit = () => { if (rows.length || !opt) obj[key] = Object.fromEntries(rows); else delete obj[key]; changed(); };
    const draw = () => box.replaceChildren(...rows.map((r, i) => h("div", { class: "ed-row" },
        sel(ids(list), r[0], v => { r[0] = v; commit(); }), numIn(r[1], v => { r[1] = v ?? 0; commit(); }),
        h("button", { onclick: () => { rows.splice(i, 1); commit(); draw(); } }, "✕"))),
        h("button", { class: "btn-subtle", onclick: () => { rows.push([ids(list).find(k => !rows.some(r => r[0] === k)) || "", 1]); commit(); draw(); } }, "+ add"));
    draw(); return box;
}

function condEd(obj) { // unlock rule: flat list of conditions joined by all/any; nested rules fall back to JSON
    const c = obj.requires;
    const flat = x => !x || (x.all || x.any || [x]).every(t => t && !t.all && !t.any && (t.resource !== undefined || t.building !== undefined));
    if (!flat(c)) {
        const t = h("textarea", { rows: 3, value: JSON.stringify(c) });
        t.onchange = () => { try { obj.requires = JSON.parse(t.value); t.classList.remove("bad"); changed(); } catch (e) { t.classList.add("bad"); } };
        return h("div", {}, h("span", { class: "hint", textContent: "Nested rule: edit as JSON" }), t);
    }
    const box = h("div"); let mode = c && c.any ? "any" : "all";
    const T = !c ? [] : (c.all || c.any || [c]).map(t => t.resource !== undefined ? { kind: "resource", id: t.resource, gte: t.gte } : { kind: "building", id: t.building, gte: t.gte });
    const listOf = k => ids(k === "resource" ? "resources" : "buildings");
    const commit = () => { const L = T.map(t => ({ [t.kind]: t.id, gte: t.gte ?? 0 })); if (!L.length) delete obj.requires; else obj.requires = L.length === 1 ? L[0] : { [mode]: L }; changed(); };
    const draw = () => box.replaceChildren(...[
        T.length > 1 ? h("div", { class: "ed-row" }, "Unlock when", sel(["all", "any"], mode, v => { mode = v; commit(); }), "of:") : null,
        ...T.map((t, i) => h("div", { class: "ed-row" },
            sel(["resource", "building"], t.kind, v => { t.kind = v; t.id = listOf(v)[0] || ""; commit(); draw(); }),
            sel(listOf(t.kind), t.id, v => { t.id = v; commit(); }), "≥", numIn(t.gte, v => { t.gte = v; commit(); }),
            h("button", { onclick: () => { T.splice(i, 1); commit(); draw(); } }, "✕"))),
        h("button", { class: "btn-subtle", onclick: () => { T.push({ kind: "resource", id: ids("resources")[0] || "", gte: 1 }); commit(); draw(); } }, "+ condition")
    ].filter(Boolean));
    draw(); return box;
}

function growthEd(obj, opt) { // cost growth: flat / linear / exp
    const g = obj.growth ? { ...obj.growth } : { type: "flat" };
    const rate = numIn(g.rate, v => { g.rate = v; commit(); });
    const commit = () => {
        if (g.type === "flat") { if (opt) delete obj.growth; else obj.growth = { type: "flat" }; } else obj.growth = { type: g.type, rate: g.rate ?? 0 };
        rate.style.display = g.type === "flat" ? "none" : ""; changed();
    };
    rate.style.display = g.type === "flat" ? "none" : "";
    return h("div", { class: "ed-row" }, sel(["flat", "linear", "exp"], g.type, v => { g.type = v; commit(); }), rate);
}

function effectsEd(obj) { // housing / capacity / outputMult
    const box = h("div"), arr = obj.effects = obj.effects || [];
    const fix = e => { if (e.type === "housing" || e.type === "depot") delete e.resource; else if (!e.resource) e.resource = e.type === "capacity" ? "*" : ids("resources")[0] || ""; };
    const draw = () => box.replaceChildren(...arr.map((e, i) => h("div", { class: "ed-row" },
        sel(["housing", "capacity", "outputMult", "preserve", "depot"], e.type, v => { e.type = v; fix(e); changed(); draw(); }),
        e.type === "housing" || e.type === "depot" ? null : sel(e.type === "capacity" ? ["*", ...ids("resources")] : ids("resources"), e.resource, v => { e.resource = v; changed(); }),
        numIn(e.value, v => { e.value = v ?? 0; changed(); }),
        h("button", { onclick: () => { arr.splice(i, 1); changed(); draw(); } }, "✕"))),
        h("button", { class: "btn-subtle", onclick: () => { arr.push({ type: "housing", value: 1 }); changed(); draw(); } }, "+ effect"));
    draw(); return box;
}

function slotsEd(obj) { // job needs worker slots provided by a building
    const g = obj.slots ? { ...obj.slots } : { building: ids("buildings")[0] || "", per: 1 }, row = h("div", { class: "ed-row" });
    const commit = () => { obj.slots = { building: g.building, per: g.per }; changed(); };
    const draw = () => row.replaceChildren(...(obj.slots
        ? [sel(ids("buildings"), g.building, v => { g.building = v; commit(); }), "×", numIn(g.per, v => { g.per = v ?? 1; commit(); }), "workers each", h("button", { onclick: () => { delete obj.slots; changed(); draw(); } }, "✕")]
        : [h("button", { class: "btn-subtle", onclick: () => { commit(); draw(); } }, "+ require building slots")]));
    draw(); return row;
}

function widget(sec, obj, [key, type, opt, list]) {
    const upd = v => { setVal(obj, key, v); changed(); };
    switch (type) {
        case "id": return h("input", { type: "text", value: obj[key] ?? "", onchange: e => rename(sec, obj, e.target.value) });
        case "text": return h("input", { type: "text", value: obj[key] ?? "", oninput: e => upd(e.target.value) });
        case "num": return numIn(obj[key], upd);
        case "bool": return h("input", { type: "checkbox", checked: !!obj[key], onchange: e => upd(e.target.checked) });
        case "ref": return sel(["", ...ids(list)], obj[key] || "", upd);
        case "map": return mapEd(obj, key, list, opt);
        case "cond": return condEd(obj);
        case "growth": return growthEd(obj, opt);
        case "slots": return slotsEd(obj);
        case "csv": return h("input", { type: "text", value: [].concat(obj[key] || []).join(", "), oninput: e => { const a = e.target.value.split(",").map(x => x.trim()).filter(Boolean); setVal(obj, key, a.length ? a : undefined); changed(); } });
        case "terr": return sel(((D.map && D.map.terrain) || []).map(t => t.id), obj[key] ?? "", upd);
        case "effects": return effectsEd(obj);
    }
}

// --- renaming keeps every reference in sync ---
function rename(sec, obj, v) {
    const old = obj.id; v = v.trim();
    if (!v || v === old) return;
    if (D[sec].some(x => x !== obj && x.id === v)) { alert(`"${v}" already exists.`); return render(); }
    const renKeys = m => { if (!m || typeof m !== "object" || !(old in m)) return; const e = Object.entries(m); for (const k in m) delete m[k]; e.forEach(([k, x]) => m[k === old ? v : k] = x); };
    const walk = o => {
        if (!o || typeof o !== "object") return;
        if (Array.isArray(o)) return o.forEach(walk);
        if (sec === "resources") { if (o.resource === old) o.resource = v; ["inputs", "outputs", "cost", "needs"].forEach(k => renKeys(o[k])); }
        if (sec === "buildings" && o.building === old) o.building = v;
        if (sec === "deposits") { if (o.deposit === old) o.deposit = v; renKeys(o.grants); }
        Object.values(o).forEach(walk);
    };
    walk(D); obj.id = v; changed(); render();
}

// --- rendering ---
function card(sec, item, i) {
    const list = D[sec], key = sec + ":" + item.id;
    const d = h("details", { class: "panel ed" }, h("summary", {}, `${item.icon || ""} ${item.name || "(unnamed)"}`, h("span", { class: "muted", textContent: item.id || "" }), h("span", { class: "rate-badge neutral", "data-where": `${SING[sec]} "${item.id}"` })));
    d.open = open.has(key); d.ontoggle = () => d.open ? open.add(key) : open.delete(key);
    FIELDS[sec].forEach(f => d.append(field(f[0], widget(sec, item, f))));
    const mv = dx => { const j = i + dx; if (j < 0 || j >= list.length) return; [list[i], list[j]] = [list[j], list[i]]; changed(); render(); };
    d.append(h("div", { class: "button-row" },
        h("button", { onclick: () => mv(-1) }, "▲"), h("button", { onclick: () => mv(1) }, "▼"),
        h("button", { onclick: () => { const c = JSON.parse(JSON.stringify(item)); c.id = uniqueId(sec, item.id + "_copy"); list.splice(i + 1, 0, c); changed(); render(); } }, "Duplicate"),
        h("button", { class: "btn-danger", onclick: () => { if (confirm(`Delete ${item.id}? Anything referencing it will be flagged.`)) { list.splice(i, 1); changed(); render(); } } }, "Delete")));
    return d;
}

function settings() {
    D.meta ??= {}; D.pop ??= {}; D.pop.needs ??= {}; D.land ??= {}; D.land.cost ??= {}; D.map ??= {}; D.land.growth ??= { type: "flat" };
    const txt = (o, k) => field(k, h("input", { type: "text", value: o[k] ?? "", oninput: e => { o[k] = e.target.value; changed(); } }));
    const num = (o, k) => field(k, numIn(o[k], v => { if (v !== undefined) { o[k] = v; changed(); } }));
    return h("div", {},
        h("section", { class: "panel ed" }, h("h2", { textContent: "Game" }), txt(D.meta, "title"), ["liveStepSec", "offlineStepSec", "maxOfflineSec", "autoSaveMs"].map(k => num(D.meta, k))),
        h("section", { class: "panel ed" }, h("h2", { textContent: "Population" }), field("needs (per villager per second)", mapEd(D.pop, "needs", "resources", 0)), ["growthRate", "growthFoodMin", "starveRate"].map(k => num(D.pop, k))),
        h("section", { class: "panel ed" }, h("h2", { textContent: "Land (per tile claimed)" }),
            field("cost of the first claim", mapEd(D.land, "cost", "resources", 0)), field("cost growth per claim", growthEd(D.land, 0))),
        h("section", { class: "panel ed" }, h("h2", { textContent: "Map" }), ["startRadius", "freeRadius", "distancePenalty", "minEfficiency"].map(k => num(D.map, k)),
            h("p", { class: "hint", textContent: "Terrain types, generation rules and the start-location rules are edited in gamedata.json for now." })));
}

function render() {
    document.querySelectorAll("#tabs button").forEach(b => b.className = b.dataset.sec === SEC ? "btn-primary" : "");
    $("editor").replaceChildren(...(SEC === "settings" ? [settings()] : [...D[SEC].map((x, i) => card(SEC, x, i)), h("button", { onclick: addItem }, "+ Add " + SING[SEC])]));
    validate();
}

function uniqueId(sec, base) { let id = base, n = 2; while (D[sec].some(x => x.id === id)) id = base + "_" + n++; return id; }
function addItem() {
    const o = JSON.parse(JSON.stringify(NEW[SEC])); o.id = uniqueId(SEC, "new_" + SING[SEC]);
    if (SEC === "deposits") o.resource = ids("resources")[0] || "";
    D[SEC].push(o); open.add(SEC + ":" + o.id); changed(); render();
}

// --- validation, drafts, export ---
function validate() {
    let res; try { res = validateGameData(D); } catch (e) { res = [{ level: "error", where: "validator", msg: e.message }]; }
    const rank = { error: 0, warn: 1, info: 2 }; res.sort((a, b) => rank[a.level] - rank[b.level]);
    const shown = res.filter(r => r.level !== "info"), e = shown.filter(r => r.level === "error").length;
    $("summary").textContent = `${e} errors, ${shown.length - e} warnings`;
    $("issues").replaceChildren(...(shown.length ? shown.map(r => h("div", { class: "row-item" },
        h("span", { class: "rate-badge " + (r.level === "error" ? "negative" : "neutral"), textContent: r.level }),
        h("div", { class: "row-info" }, h("strong", { textContent: r.where }), h("span", { textContent: r.msg })))) : [h("span", { class: "hint", textContent: "No problems found." })]));
    document.querySelectorAll("[data-where]").forEach(b => {
        const n = shown.filter(r => r.where === b.dataset.where);
        b.textContent = n.length ? String(n.length) : "✓";
        b.className = "rate-badge " + (n.some(r => r.level === "error") ? "negative" : n.length ? "neutral" : "positive");
    });
    return e;
}
function changed() {
    localStorage.setItem(DRAFT, JSON.stringify(D));
    $("draft-note").textContent = "Draft saved in this browser. Export and commit gamedata.json to publish it.";
    clearTimeout(timer); timer = setTimeout(validate, 150);
}

function ser(v, ind, depth) { // pretty-printer that keeps small objects on one line, like the hand-written file
    const inl = x => Array.isArray(x) ? (x.length ? "[ " + x.map(inl).join(", ") + " ]" : "[]")
        : x && typeof x === "object" ? (Object.keys(x).length ? "{ " + Object.entries(x).map(([k, y]) => JSON.stringify(k) + ": " + inl(y)).join(", ") + " }" : "{}") : JSON.stringify(x);
    const one = inl(v), table = depth === 1 && Array.isArray(v) && v.some(x => x && typeof x === "object");
    if (!v || typeof v !== "object" || (depth >= 1 && !table && one.length <= 140)) return one;
    const pad = " ".repeat(ind + 2), end = " ".repeat(ind);
    if (Array.isArray(v)) return v.length ? "[\n" + v.map(x => pad + ser(x, ind + 2, depth + 1)).join(",\n") + "\n" + end + "]" : "[]";
    return "{\n" + Object.entries(v).map(([k, x]) => pad + JSON.stringify(k) + ": " + ser(x, ind + 2, depth + 1)).join(",\n") + "\n" + end + "}";
}
const exportText = () => ser(D, 0, 0) + "\n";

function load(data) {
    D = data; ["resources", "jobs", "buildings", "deposits"].forEach(k => D[k] ??= []);
    D.buildings.forEach(b => b.effects ??= []); render();
}

async function repoVersion() { return (await fetch("gamedata.json", { cache: "no-cache" })).json(); }

async function init() {
    document.querySelectorAll("#tabs button").forEach(b => b.onclick = () => { SEC = b.dataset.sec; render(); });
    $("export-btn").onclick = () => {
        if (validate() && !confirm("There are still errors. Export anyway?")) return;
        const a = h("a", { href: URL.createObjectURL(new Blob([exportText()], { type: "application/json" })), download: "gamedata.json" });
        a.click(); URL.revokeObjectURL(a.href);
    };
    $("copy-btn").onclick = async () => { await navigator.clipboard.writeText(exportText()); $("draft-note").textContent = "JSON copied to clipboard."; };
    $("load-btn").onclick = () => $("file-in").click();
    $("file-in").onchange = e => {
        const f = e.target.files[0]; if (!f) return;
        const r = new FileReader();
        r.onload = () => { try { load(JSON.parse(r.result)); changed(); } catch (err) { alert("Not valid JSON: " + err.message); } };
        r.readAsText(f); e.target.value = "";
    };
    $("revert-btn").onclick = async () => {
        if (!confirm("Discard your draft and reload the version in the repo?")) return;
        localStorage.removeItem(DRAFT); load(await repoVersion()); $("draft-note").textContent = "Loaded the repo version.";
    };
    let draft = null; try { draft = JSON.parse(localStorage.getItem(DRAFT)); } catch (e) { /* ignore bad draft */ }
    if (draft) { load(draft); $("draft-note").textContent = "Editing your saved draft. Revert to start again from the repo version."; }
    else load(await repoVersion());
}
init();
