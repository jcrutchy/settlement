// Loads a chosen set of module files into a vm. With ui:false the context has NO page globals at all (no document, localStorage, timers),
// so an engine module that reaches for the page or for a global S fails loudly.
const vm = require("vm"), fs = require("fs"), path = require("path");
function stubEl() {
    const store = { style: {}, dataset: {} }, cl = { toggle() {}, add() {}, remove() {}, contains() { return false; } };
    return new Proxy(function () {}, { get: (t, k) => k === "classList" ? cl : k === "clientWidth" || k === "clientHeight" ? 0 : k in store ? store[k] : k === "value" ? "" : k === Symbol.toPrimitive ? () => "" : () => undefined, set: (t, k, v) => { store[k] = v; return true; }, apply: () => undefined });
}
async function loadNew(root, files, { ui = false } = {}) {
    const clock = { now: 1_700_000_000_000 };
    class FakeDate extends Date { constructor(...a) { a.length ? super(...a) : super(clock.now); } static now() { return clock.now; } }
    const ls = new Map(), els = {};
    const ctx = { console, Math, JSON, Object, Array, Map, Set, WeakMap, Number, String, Boolean, Promise, Infinity, NaN, isFinite, isNaN, parseFloat, parseInt, Date: FakeDate, Error, TypeError, Symbol, RegExp, Uint32Array, Float64Array };
    if (ui) Object.assign(ctx, {
        localStorage: { getItem: k => ls.has(k) ? ls.get(k) : null, setItem: (k, v) => ls.set(k, String(v)), removeItem: k => ls.delete(k) },
        document: { getElementById: id => els[id] || (els[id] = stubEl()), createElement: () => stubEl(), addEventListener() {}, body: stubEl(), head: stubEl(), title: "", hidden: false },
        setInterval() { return 0; }, setTimeout() { return 0; }, clearTimeout() {}, requestAnimationFrame() {}, performance: { now: () => 0 }, confirm: () => true,
        fetch: async u => { const f = path.join(root, u.split("?")[0]); if (!fs.existsSync(f)) return { ok: false, status: 404 }; const t = fs.readFileSync(f, "utf8"); return { ok: true, text: async () => t, json: async () => JSON.parse(t) }; }
    });
    if (ui) { ctx.window = ctx; ctx.devicePixelRatio = 1; ctx.innerWidth = 1200; ctx.addEventListener = () => {}; }
    vm.createContext(ctx);
    const run = code => vm.runInContext(code, ctx);
    for (const f of files) vm.runInContext(fs.readFileSync(path.join(root, f), "utf8"), ctx, { filename: f });
    run(`loadData(${JSON.stringify(fs.readFileSync(path.join(root, "gamedata.json"), "utf8"))})`);
    return { ctx, clock, run };
}
module.exports = { loadNew };
