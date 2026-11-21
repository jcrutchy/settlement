"use strict";
// Classic renderer: flat terrain colours with emoji icons.
// A renderer is an object registered on window.SettlementRenderers. The game calls draw() whenever the map needs repainting
// (or every animation frame if animated is true). Tile (x, y) occupies the square whose top-left corner is at
//   px = (x - cam.x) * zoom + W / 2,  py = (y - cam.y) * zoom + H / 2,  size zoom x zoom
// so clicks, panning and zooming (handled by the game) always line up with whatever a renderer draws.
(window.SettlementRenderers = window.SettlementRenderers || {}).classic = {
    name: "Classic",
    animated: false,
    options: [
        { id: "icons", label: "Terrain icons", type: "bool", default: true },
        { id: "outlines", label: "Outline owned tiles", type: "bool", default: true }
    ],
    // v = { ctx, W, H, cam, zoom, time, world, opts }; world is the game's read-only view of the map (see game.js, WORLD)
    draw({ ctx: c, W, H, cam, zoom: z, world, opts }) {
        c.fillStyle = "#0b0d10"; c.fillRect(0, 0, W, H);
        const x0 = Math.floor(cam.x - W / 2 / z), x1 = Math.ceil(cam.x + W / 2 / z), y0 = Math.floor(cam.y - H / 2 / z), y1 = Math.ceil(cam.y + H / 2 / z);
        const moving = world.moving(), sel = world.selected(), plain = world.fallbackTerrain();
        c.textAlign = "center"; c.textBaseline = "middle";
        for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
            const tid = world.terrainAt(x, y), td = world.terrain(tid), o = world.tile(x, y), px = (x - cam.x) * z + W / 2, py = (y - cam.y) * z + H / 2;
            c.globalAlpha = o ? 1 : 0.5; c.fillStyle = td.color; c.fillRect(px, py, z + 0.5, z + 0.5); c.globalAlpha = 1;
            if (opts.outlines && o && z >= 12) { c.strokeStyle = "#cbd5e1"; c.globalAlpha = 0.35; c.lineWidth = 1; c.strokeRect(px + 0.5, py + 0.5, z - 1, z - 1); c.globalAlpha = 1; }
            if (z >= 20) {
                if (o && o.b) {
                    c.font = Math.floor(z * 0.62) + "px sans-serif"; c.fillText(o.b === "center" ? world.centerIcon() : world.building(o.b).icon || "🏗️", px + z / 2, py + z / 2 + 1);
                    if (opts.icons && z >= 30) { c.font = Math.floor(z * 0.3) + "px sans-serif"; c.fillText(td.icon, px + z * 0.2, py + z * 0.2); }
                } else if (opts.icons && tid !== plain) { c.font = Math.floor(z * 0.5) + "px sans-serif"; c.globalAlpha = o ? 1 : 0.8; c.fillText(td.icon, px + z / 2, py + z / 2 + 1); c.globalAlpha = 1; }
            }
            if (!o && world.claimable(x, y)) { c.setLineDash([3, 3]); c.strokeStyle = "#d97706"; c.lineWidth = 1.5; c.strokeRect(px + 1, py + 1, z - 2, z - 2); c.setLineDash([]); }
            if (moving && o && !o.b && world.allowed(moving, x, y)) { c.strokeStyle = "#34d399"; c.lineWidth = 2; c.strokeRect(px + 1, py + 1, z - 2, z - 2); }
            if (sel === world.key(x, y)) { c.strokeStyle = "#e2e8f0"; c.lineWidth = 2; c.strokeRect(px + 1, py + 1, z - 2, z - 2); }
        }
    }
};
