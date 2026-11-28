// Golden-master scenarios. Written against a small adapter so the same script runs on the old and the new code layout.
// adapter: { load(root), newGame(seed, presetId, over), S(), tick(n, auto), act(name, ...args), catchUp(sec), reload(), json() }
const crypto = require("crypto");
const hash = s => crypto.createHash("sha256").update(s).digest("hex").slice(0, 16);
const strip = o => JSON.stringify(o, (k, v) => (k === "logs" ? v && v.map(l => l.replace(/^\[[^\]]*\]/, "")) : v)); // log lines carry a locale time stamp
async function runScenarios(A, which) {
    const out = {};
    const scen = {
        // engine only: no automation, manual actions
        async manual() {
            await A.newGame(101, "standard"); const cp = [];
            for (let i = 0; i < 60; i++) A.act("gather", "wood"); for (let i = 0; i < 40; i++) A.act("gather", "food");
            A.act("build", "hut"); A.tick(30); A.act("build", "hut"); A.tick(60); A.act("adjustJob", "forager", 1); A.act("adjustJob", "woodcutter", 1);
            cp.push(["t90", hash(strip(A.json()))]);
            for (let i = 0; i < 40; i++) { A.act("gather", "wood"); A.tick(5); } A.act("claimAt", ...A.claimable());
            A.tick(240); cp.push(["t540", hash(strip(A.json()))]);
            A.act("selectBuilt"); A.act("demolish"); A.tick(120); A.act("research", "writing"); A.act("research", "hunting"); A.tick(600);
            cp.push(["t1260", hash(strip(A.json()))]); A.tick(1800); cp.push(["t3060", hash(strip(A.json()))]);
            return cp;
        },
        // engine + automation, single player
        async solo() {
            await A.newGame(202, "relaxed"); const cp = [];
            for (let i = 1; i <= 3600; i++) { A.tick(1, true); if (i % 600 === 0) cp.push(["t" + i, hash(strip(A.json()))]); }
            A.act("adoptFirstPolicy"); A.tick(300, true); cp.push(["pol", hash(strip(A.json()))]);
            A.reload(); A.tick(300, true); cp.push(["reload", hash(strip(A.json()))]);
            A.catchUp(6 * 3600); cp.push(["away6h", hash(strip(A.json()))]);
            return cp;
        },
        // neighbours: shared map, AI, trade, catch-up, reload, add mid-game
        async neighbours() {
            await A.newGame(303, "neighbours"); const cp = [];
            for (let i = 1; i <= 3000; i++) { A.tick(1, true); if (i % 750 === 0) cp.push(["t" + i, hash(strip(A.json()))]); }
            A.act("tradeSetup"); A.act("humanTrade", 1, "wood", "stone", 20); A.act("humanTrade", 2, "stone", "wood", 10); cp.push(["trade", hash(strip(A.json()))]);
            A.tick(120, true); A.act("addRival"); A.tick(600, true); cp.push(["addRival", hash(strip(A.json()))]);
            A.reload(); A.tick(200, true); cp.push(["reload", hash(strip(A.json()))]);
            A.catchUp(8 * 3600); cp.push(["away8h", hash(strip(A.json()))]);
            A.tick(300, true); cp.push(["after", hash(strip(A.json()))]);
            return cp;
        }
    };
    for (const k of which || Object.keys(scen)) out[k] = await scen[k]();
    return out;
}
module.exports = { runScenarios };
