"use strict";
// Settlement kernel: the one object every module (and every mod) shares.
//
// All scripts are plain classic scripts loaded in the order listed in modules.json and share one global scope, so there is no import
// machinery: a module defines functions, a mod defines more and subscribes to events. Engine functions take the settlement they act on as
// their first argument (S), so any number of settlements can exist at once: yours, AI neighbours, a test fixture.
//
// Events (listeners get the arguments shown; a listener that throws is logged and skipped, it never breaks the game):
//   "tick"      (S, dt, away)       after each simulation step of the player's settlement (away: part of a long catch-up)
//   "away"      (S, totalSec)       after a catch-up of more than 10 s has been simulated
//   "log"       (S)                 a line was added to S.logs
//   "changed"   (S)                 structure changed (built, researched, adopted...): a full redraw is due
//   "dirty"     (S)                 only numbers changed: a light redraw is due
//   "built"     (S, tile, id)       a building was placed
//   "demolished"(S, tile)           a building was removed
//   "newgame"   (S, options, val)   a fresh run was set up (val(option) gives the chosen value)
//   "load"      (S)                 a saved settlement was loaded and brought up to date
// Mods add scripts after the core ones in modules.json ("mods"); a mod typically calls Settlement.mod({...}) and Settlement.on(...).
const Settlement = (() => {
    const hooks = {};
    return {
        hooks,
        on(ev, fn) { (hooks[ev] = hooks[ev] || []).push(fn); return fn; },
        off(ev, fn) { hooks[ev] = (hooks[ev] || []).filter(f => f !== fn); },
        emit(ev, ...args) { for (const fn of (hooks[ev] || []).slice()) { try { fn(...args); } catch (e) { console.error(`Settlement: a "${ev}" listener failed`, e); } } },
        mods: [], // what each loaded mod registered through Settlement.mod
        mod(info) { this.mods.push(info); return info; },
        start: null // set by main.js; the loader calls it once every script and mod is in
    };
})();
