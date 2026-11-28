"use strict";
// Example mod. It logs a line each time the population passes a multiple of 50.
// To switch it on, add "mods/milestones.js" to the "mods" list in modules.json. Mods load after the core modules, share their global scope
// (so engine functions like log(S, msg) are available) and talk to the game through Settlement.on(...); see the header of kernel.js for the events.
// A mod may keep its own fields on the state (S.milestone below): they are saved and synced with everything else.
Settlement.mod({ name: "Milestones", description: "Logs population milestones." });
Settlement.on("tick", (S, dt, away) => {
    if (away) return; // not while catching up after being away
    const step = 50, tier = Math.floor(S.pop / step);
    if (S.milestone === undefined) S.milestone = tier;
    if (tier > S.milestone) { S.milestone = tier; log(S, `Milestone: ${tier * step} settlers.`); }
});
