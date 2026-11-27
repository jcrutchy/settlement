"use strict";
// Painted renderer: procedurally drawn terrain, soft shorelines, trees, mountains, ore, fields and buildings. No image files.
// It knows this game's terrain ids (forest, hills, orebed, claybank) and any terrain flagged "water" in gamedata.json;
// anything else falls back to a shaded colour fill. See render-classic.js for the renderer contract.
(window.SettlementRenderers = window.SettlementRenderers || {}).painted = (() => {
    const hash = (x, y, s) => { let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(s, 1274126177); h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
    const rgb = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
    const shade = (hex, f) => { const k = v => Math.max(0, Math.min(255, Math.round(v * f))); const [r, g, b] = rgb(hex); return `rgb(${k(r)},${k(g)},${k(b)})`; };
    const ROOF = { hut: "#b4553a", storehouse: "#3b6fb5", granary: "#c9a14a", cabin: "#9c4a2f", kiln: "#d9622b", foundry: "#555d6b", stonehouse: "#8a8f98",
        townhouse: "#a8453a", library: "#7b5ea7", loom_house: "#3aa39a", hunting_lodge: "#6b4a2f", fishing_hut: "#2f7f9f" };
    const FIELD = { farm: ["#cdae4f", "#b3943a"], flax_field: ["#7fa3d6", "#5f86bd"] };
    const roofOf = id => ROOF[id] || `hsl(${Math.floor(hash(id.length, id.charCodeAt(0), 9) * 360)},45%,45%)`;

    function draw({ ctx: c, W, H, cam, zoom: z, world, opts }) {
        const x0 = Math.floor(cam.x - W / 2 / z) - 1, x1 = Math.ceil(cam.x + W / 2 / z) + 1, y0 = Math.floor(cam.y - H / 2 / z) - 1, y1 = Math.ceil(cam.y + H / 2 / z) + 1;
        const w = x1 - x0 + 1, h = y1 - y0 + 1, T = new Array(w * h), O = new Array(w * h), F = new Array(w * h), TD = {}; // F: tiles held by another settlement
        for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { const i = (y - y0) * w + (x - x0); T[i] = world.terrainAt(x, y); O[i] = world.tile(x, y); F[i] = O[i] || !world.foreign ? null : world.foreign(x, y); if (!TD[T[i]]) TD[T[i]] = world.terrain(T[i]); }
        const inR = (x, y) => x >= x0 && x <= x1 && y >= y0 && y <= y1;
        const tid = (x, y) => { if (inR(x, y)) return T[(y - y0) * w + (x - x0)]; const t = world.terrainAt(x, y); if (!TD[t]) TD[t] = world.terrain(t); return t; };
        const own = (x, y) => !!(inR(x, y) ? O[(y - y0) * w + (x - x0)] : world.tile(x, y));
        const isWater = (x, y) => !!TD[tid(x, y)].water;
        const PX = x => (x - cam.x) * z + W / 2, PY = y => (y - cam.y) * z + H / 2;
        const detail = z >= 10, objs = [];
        const rpath = (x, y, s, [a, b, d, e]) => { c.beginPath(); c.moveTo(x + a, y); c.arcTo(x + s, y, x + s, y + s, b); c.arcTo(x + s, y + s, x, y + s, d); c.arcTo(x, y + s, x, y, e); c.arcTo(x, y, x + s, y, a); c.closePath(); };
        const ell = (x, y, rx, ry, fill) => { c.fillStyle = fill; c.beginPath(); c.ellipse(x, y, rx, ry, 0, 0, 7); c.fill(); };

        c.fillStyle = "#0b0d10"; c.fillRect(0, 0, W, H);

        // 1) ground: shaded colour per tile, soft patches, clay banks, fields
        for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
            const t = tid(x, y), td = TD[t], px = PX(x), py = PY(y), o = O[(y - y0) * w + (x - x0)] || F[(y - y0) * w + (x - x0)];
            c.fillStyle = shade(td.color, opts.texture ? 0.94 + hash(x, y, 1) * 0.12 : 1); c.fillRect(px, py, z + 0.6, z + 0.6);
            if (td.water) continue;
            if (opts.texture && z >= 14 && hash(x, y, 2) < 0.55) ell(px + z * (0.2 + 0.6 * hash(x, y, 3)), py + z * (0.2 + 0.6 * hash(x, y, 4)), z * 0.3, z * 0.2, hash(x, y, 5) < 0.5 ? "rgba(255,255,255,.05)" : "rgba(0,0,0,.07)");
            if (t === "claybank" && detail) {
                ell(px + z * 0.5, py + z * 0.55, z * 0.42, z * 0.28, shade("#a0623a", 0.85)); ell(px + z * 0.45, py + z * 0.5, z * 0.3, z * 0.18, shade("#b8764a", 1));
                if (z >= 18) { c.strokeStyle = "rgba(60,30,10,.35)"; c.lineWidth = 1; c.beginPath(); c.moveTo(px + z * 0.3, py + z * 0.45); c.lineTo(px + z * 0.5, py + z * 0.55); c.lineTo(px + z * 0.62, py + z * 0.5); c.stroke(); }
            }
            if (o && o.b && FIELD[o.b]) { // plowed rows
                c.fillStyle = FIELD[o.b][0]; c.fillRect(px + z * 0.06, py + z * 0.06, z * 0.88, z * 0.88);
                c.strokeStyle = FIELD[o.b][1]; c.lineWidth = Math.max(1, z * 0.06); c.beginPath();
                for (let k = 1; k < 5; k++) { c.moveTo(px + z * 0.08, py + z * (0.06 + 0.176 * k)); c.lineTo(px + z * 0.92, py + z * (0.06 + 0.176 * k)); }
                c.stroke();
            }
        }

        // 2) water: sandy shore band first, then rounded water shapes, so coastlines read as smooth curves
        const wt = []; for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (isWater(x, y)) wt.push([x, y]);
        const radii = (x, y, R) => { const N = isWater(x, y - 1), E = isWater(x + 1, y), S = isWater(x, y + 1), Wt = isWater(x - 1, y); return [!N && !Wt ? R : 0, !N && !E ? R : 0, !S && !E ? R : 0, !S && !Wt ? R : 0]; };
        const R = z * 0.5, pad = z * 0.14;
        c.globalAlpha = 0.9; c.fillStyle = "#d8cb9f";
        wt.forEach(([x, y]) => { rpath(PX(x) - pad, PY(y) - pad, z + 2 * pad, radii(x, y, R).map(r => r ? r + pad : 0)); c.fill(); });
        c.globalAlpha = 1;
        wt.forEach(([x, y]) => {
            const px = PX(x), py = PY(y), inner = isWater(x, y - 1) && isWater(x + 1, y) && isWater(x, y + 1) && isWater(x - 1, y);
            c.fillStyle = shade(TD[tid(x, y)].color, inner ? 0.88 : 1.12); rpath(px - 0.3, py - 0.3, z + 0.6, radii(x, y, R)); c.fill();
            if (z >= 16 && hash(x, y, 6) < 0.3) { c.strokeStyle = "rgba(255,255,255,.2)"; c.lineWidth = 1; c.beginPath(); c.arc(px + z * (0.3 + 0.4 * hash(x, y, 7)), py + z * (0.3 + 0.4 * hash(x, y, 8)), z * 0.12, Math.PI * 1.1, Math.PI * 1.9); c.stroke(); }
        });

        // 3) standing things, collected and sorted by baseline so nearer ones overlap farther ones
        const shadow = (cx, by, s) => { if (opts.shadows) ell(cx + s * 0.1, by, s * 0.32, s * 0.1, "rgba(0,0,0,.22)"); };
        const pine = (cx, by, s, f) => {
            shadow(cx, by, s); c.fillStyle = "#5a3c24"; c.fillRect(cx - s * 0.04, by - s * 0.16, s * 0.08, s * 0.16);
            for (let k = 0; k < 3; k++) {
                const ty = by - s * 0.1 - k * s * 0.22, tw = s * (0.42 - k * 0.08), th = s * 0.36;
                c.fillStyle = shade("#2f6f3a", f * (0.82 + k * 0.14)); c.beginPath(); c.moveTo(cx, ty - th); c.lineTo(cx + tw, ty); c.lineTo(cx - tw, ty); c.closePath(); c.fill();
                c.fillStyle = "rgba(255,255,255,.09)"; c.beginPath(); c.moveTo(cx, ty - th); c.lineTo(cx, ty); c.lineTo(cx - tw, ty); c.closePath(); c.fill();
            }
        };
        const peak = (cx, by, s, snow) => {
            shadow(cx, by, s * 1.2); const ax = cx, ay = by - s * 0.9;
            c.fillStyle = "#8f97a3"; c.beginPath(); c.moveTo(ax, ay); c.lineTo(cx - s * 0.5, by); c.lineTo(cx + s * 0.06, by); c.closePath(); c.fill();
            c.fillStyle = "#666e7b"; c.beginPath(); c.moveTo(ax, ay); c.lineTo(cx + s * 0.06, by); c.lineTo(cx + s * 0.5, by); c.closePath(); c.fill();
            if (snow) { c.fillStyle = "rgba(255,255,255,.88)"; c.beginPath(); c.moveTo(ax, ay); c.lineTo(ax - s * 0.13, ay + s * 0.23); c.lineTo(ax - s * 0.03, ay + s * 0.19); c.lineTo(ax + s * 0.05, ay + s * 0.26); c.lineTo(ax + s * 0.13, ay + s * 0.22); c.closePath(); c.fill(); }
        };
        const nugget = (cx, by, r) => { ell(cx, by, r, r * 0.75, "#c2703a"); ell(cx - r * 0.3, by - r * 0.25, r * 0.4, r * 0.28, "#e7a66a"); };
        const building = (cx, by, s, id) => {
            shadow(cx, by, s * 1.1);
            if (id === "center") { // town centre: striped tent with a flag
                c.fillStyle = "#efe6cf"; c.beginPath(); c.moveTo(cx, by - s * 0.95); c.lineTo(cx + s * 0.55, by); c.lineTo(cx - s * 0.55, by); c.closePath(); c.fill();
                c.fillStyle = "#b9412f"; c.beginPath(); c.moveTo(cx, by - s * 0.95); c.lineTo(cx + s * 0.18, by); c.lineTo(cx - s * 0.18, by); c.closePath(); c.fill();
                c.strokeStyle = "#4a3426"; c.lineWidth = Math.max(1, s * 0.04); c.beginPath(); c.moveTo(cx, by - s * 0.95); c.lineTo(cx, by - s * 1.2); c.stroke();
                c.fillStyle = "#d9a21a"; c.fillRect(cx, by - s * 1.2, s * 0.22, s * 0.13); return;
            }
            c.fillStyle = "#e3d4b0"; c.fillRect(cx - s * 0.36, by - s * 0.42, s * 0.72, s * 0.42);
            c.fillStyle = "rgba(0,0,0,.14)"; c.fillRect(cx, by - s * 0.42, s * 0.36, s * 0.42);
            c.fillStyle = roofOf(id); c.beginPath(); c.moveTo(cx - s * 0.5, by - s * 0.4); c.lineTo(cx, by - s * 0.9); c.lineTo(cx + s * 0.5, by - s * 0.4); c.closePath(); c.fill();
            c.fillStyle = "rgba(255,255,255,.12)"; c.beginPath(); c.moveTo(cx - s * 0.5, by - s * 0.4); c.lineTo(cx, by - s * 0.9); c.lineTo(cx, by - s * 0.4); c.closePath(); c.fill();
            c.fillStyle = "#4a3426"; c.fillRect(cx - s * 0.07, by - s * 0.22, s * 0.14, s * 0.22);
        };
        for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
            const t = tid(x, y), px = PX(x), py = PY(y), o = O[(y - y0) * w + (x - x0)] || F[(y - y0) * w + (x - x0)];
            if (o && o.b && !FIELD[o.b]) { const id = o.b, s = z * 0.82, cx = px + z * 0.5, by = py + z * 0.88; objs.push([by, () => { if (detail && z >= 14) building(cx, by, s, id); else { c.fillStyle = id === "center" ? "#efe6cf" : roofOf(id); c.fillRect(px + z * 0.2, py + z * 0.2, z * 0.6, z * 0.6); } }]); }
            if (!detail || !opts.scenery) continue;
            const free = !(o && o.b);
            if (t === "forest") { const n = (hash(x, y, 10) > 0.55 ? 3 : 2) - (free ? 0 : 1); for (let k = 0; k < n; k++) { const cx = px + z * (0.2 + 0.6 * hash(x, y, 20 + k)), by = py + z * (0.45 + 0.5 * hash(x, y, 30 + k)), s = z * (0.85 + 0.3 * hash(x, y, 40 + k)), f = 0.9 + 0.2 * hash(x, y, 50 + k); objs.push([by, () => pine(cx, by, s, f)]); } }
            else if (t === "hills" || t === "orebed") {
                const n = t === "orebed" ? 1 : (hash(x, y, 11) > 0.6 ? 2 : 1), k0 = t === "orebed" ? 0.75 : 1;
                for (let k = 0; k < n; k++) { const cx = px + z * (n === 1 ? 0.5 : 0.3 + 0.4 * k), by = py + z * (0.62 + 0.3 * hash(x, y, 60 + k)), s = z * k0 * (0.95 + 0.35 * hash(x, y, 70 + k)); objs.push([by, () => peak(cx, by, s, s > z * 1.15)]); }
                if (t === "orebed") for (let k = 0; k < 3; k++) { const cx = px + z * (0.2 + 0.6 * hash(x, y, 80 + k)), by = py + z * (0.75 + 0.2 * hash(x, y, 90 + k)); objs.push([by, () => nugget(cx, by, z * 0.07)]); }
            }
        }
        objs.sort((a, b) => a[0] - b[0]); objs.forEach(o => o[1]());

        // 4) territory: dim what you don't own, glow along the border of what you do
        c.fillStyle = "rgba(8,12,20,.36)";
        for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (!O[(y - y0) * w + (x - x0)] && !F[(y - y0) * w + (x - x0)]) c.fillRect(PX(x), PY(y), z + 0.6, z + 0.6);
        // neighbours: a wash of their colour, and a border where their land ends
        const fp = (x, y) => { const f = inR(x, y) ? F[(y - y0) * w + (x - x0)] : (world.foreign ? world.foreign(x, y) : null); return f ? f.pid : 0; };
        for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
            const f = F[(y - y0) * w + (x - x0)]; if (!f) continue; const px = PX(x), py = PY(y);
            c.fillStyle = `rgba(${rgb(f.color).join(",")},.24)`; c.fillRect(px, py, z + 0.6, z + 0.6);
            c.beginPath();
            if (fp(x, y - 1) !== f.pid) { c.moveTo(px, py); c.lineTo(px + z, py); } if (fp(x, y + 1) !== f.pid) { c.moveTo(px, py + z); c.lineTo(px + z, py + z); }
            if (fp(x - 1, y) !== f.pid) { c.moveTo(px, py); c.lineTo(px, py + z); } if (fp(x + 1, y) !== f.pid) { c.moveTo(px + z, py); c.lineTo(px + z, py + z); }
            c.strokeStyle = f.color; c.lineWidth = 2; c.stroke();
        }
        if (opts.territory) {
            c.beginPath();
            for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
                if (!own(x, y)) continue; const px = PX(x), py = PY(y);
                if (!own(x, y - 1)) { c.moveTo(px, py); c.lineTo(px + z, py); } if (!own(x, y + 1)) { c.moveTo(px, py + z); c.lineTo(px + z, py + z); }
                if (!own(x - 1, y)) { c.moveTo(px, py); c.lineTo(px, py + z); } if (!own(x + 1, y)) { c.moveTo(px + z, py); c.lineTo(px + z, py + z); }
            }
            c.lineCap = "round"; c.strokeStyle = "rgba(134,239,172,.28)"; c.lineWidth = 6; c.stroke(); c.strokeStyle = "#bbf7d0"; c.lineWidth = 2; c.stroke(); c.lineCap = "butt";
        }

        // 5) interaction highlights
        const moving = world.moving(), sel = world.selected();
        for (let y = y0 + 1; y < y1; y++) for (let x = x0 + 1; x < x1; x++) {
            const px = PX(x), py = PY(y), o = O[(y - y0) * w + (x - x0)];
            if (!o && world.claimable(x, y)) { c.setLineDash([3, 3]); c.strokeStyle = "#f59e0b"; c.lineWidth = 1.5; c.strokeRect(px + 1, py + 1, z - 2, z - 2); c.setLineDash([]); }
            if (moving && o && !o.b && world.allowed(moving, x, y)) { c.strokeStyle = "#34d399"; c.lineWidth = 2; c.strokeRect(px + 1, py + 1, z - 2, z - 2); }
            if (sel === world.key(x, y)) { c.strokeStyle = "#f8fafc"; c.lineWidth = 2; c.strokeRect(px + 1, py + 1, z - 2, z - 2); }
        }
    }

    return {
        name: "Painted", animated: false,
        options: [
            { id: "scenery", label: "Trees, mountains and ore", type: "bool", default: true },
            { id: "shadows", label: "Soft shadows", type: "bool", default: true },
            { id: "texture", label: "Ground variation", type: "bool", default: true },
            { id: "territory", label: "Territory outline", type: "bool", default: true }
        ],
        draw
    };
})();
