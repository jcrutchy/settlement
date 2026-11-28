// Runs the REAL index.html loader against the repo files in a stub page: fetch modules.json, inject each script, call Settlement.start().
const vm = require("vm"), fs = require("fs"), path = require("path");
const ROOT = process.argv[2] || require("path").join(__dirname, ".."), mods = process.argv[3] ? JSON.parse(process.argv[3]) : null;
const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8"), loader = html.match(/<script>([\s\S]*?)<\/script>/)[1];
function stubEl(tag) { const store = { style: {}, dataset: {}, tagName: tag || "div" }, cl = { toggle() {}, add() {}, remove() {}, contains() { return false; } };
    return new Proxy(function () {}, { get: (t, k) => k === "classList" ? cl : k === "clientWidth" || k === "clientHeight" ? 0 : k in store ? store[k] : k === "value" ? "" : k === Symbol.toPrimitive ? () => "" : () => undefined, set: (t, k, v) => { store[k] = v; return true; }, apply: () => undefined }); }
(async () => {
    const clock = { now: 1_700_000_000_000 }; class FD extends Date { constructor(...a) { a.length ? super(...a) : super(clock.now); } static now() { return clock.now; } }
    const ls = new Map(), els = {}, ran = [];
    const ctx = { console, Math, JSON, Object, Array, Map, Set, WeakMap, Number, String, Boolean, Promise, Infinity, NaN, isFinite, isNaN, parseFloat, parseInt, Date: FD, Error, TypeError, Symbol, RegExp, Uint32Array, Float64Array,
        localStorage: { getItem: k => ls.has(k) ? ls.get(k) : null, setItem: (k, v) => ls.set(k, String(v)), removeItem: k => ls.delete(k) },
        setInterval() { return 0; }, setTimeout() { return 0; }, clearTimeout() {}, requestAnimationFrame() {}, performance: { now: () => 0 }, confirm: () => true,
        fetch: async (u) => { let f = path.join(ROOT, u.split("?")[0]); if (mods && u === "modules.json") return { ok: true, text: async () => JSON.stringify(mods) }; if (!fs.existsSync(f)) return { ok: false, status: 404 }; const t = fs.readFileSync(f, "utf8"); return { ok: true, text: async () => t, json: async () => JSON.parse(t) }; } };
    ctx.window = ctx; ctx.devicePixelRatio = 1; ctx.innerWidth = 1200; ctx.addEventListener = () => {};
    const body = stubEl("body"); body.append = el => { if (el && el.tagName === "script") { ran.push((el.textContent.match(/sourceURL=(\S+)/) || [])[1]); vm.runInContext(el.textContent, ctx); } };
    ctx.document = { getElementById: id => id === "app" ? (els.app || (els.app = stubEl())) : els[id] || (els[id] = stubEl()), createElement: t => stubEl(t), addEventListener() {}, body, head: stubEl("head"), title: "", hidden: false };
    vm.createContext(ctx);
    vm.runInContext(loader, ctx);
    for (let i = 0; i < 200; i++) await new Promise(r => setImmediate(r));
    console.log("scripts run in order:", ran.join(", "));
    const up = vm.runInContext("typeof S === 'object' && !!S && S.pop !== undefined && typeof Settlement.start === 'function'", ctx);
    console.log(up ? "PASS loader booted the game" : "FAIL game did not boot"); 
    if (mods) { vm.runInContext("S.pop = 120; for (let i = 0; i < 3; i++) { advance(S, Date.now() + 1000 * (i+1)); }", ctx); console.log("mods registered:", vm.runInContext("JSON.stringify(Settlement.mods)", ctx), "| log:", vm.runInContext("S.logs.slice(0,2).join(' / ')", ctx)); }
    process.exit(up ? 0 : 1);
})().catch(e => { console.error("ERROR", e.stack || e); process.exit(2); });
