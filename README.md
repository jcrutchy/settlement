# Settlement

A small, graphics-free settlement builder that runs in the browser. Gather food and wood, house and assign settlers, claim land, and build up a production chain. Everything is numbers, rates and emoji, so it plays the same on a phone, laptop or desktop.

**Play:** https://jcrutchy.github.io/settlement/

Status: early (v0.6). The engine is stable enough to play, but the balance has had very little testing.

## How to play

- **Gather** food and wood by hand to get started, then build **Timber Huts** to attract settlers.
- Settlers arrive while there is free housing and food. Each one eats food every second, so watch the **Net** rate on each stockpile (P = production, C = consumption).
- Assign idle villagers to **jobs** with the + and - buttons. Some jobs consume one resource to make another.
- **Stockpiles have a capacity.** Build storehouses and granaries to raise it.
- **The map** is endless and generated from the seed: grassland, forests, hills, ore beds, clay banks, rivers, lakes and ocean. Drag to pan; pinch, scroll or use the +/- buttons to zoom. Claim tiles next to your land (the price rises as you grow), then press **Build** on a structure. It goes on the best free tile automatically (depots where they cut hauling loss the most, everything else near the town centre). Select a building's tile to **Move** it (costs 25%) or **Demolish** it (refunds half).
- **Deposits live on tiles.** Forests regrow, hills and clay banks don't. Cutting wood faster than the forest regrows empties it.
- **Fishing:** a Fishing Hut must stand next to water and gives 2 fisher slots. Fish come from water tiles you have claimed (claiming water is allowed, building on it isn't), and they regrow.
- **Hauling matters.** Gatherers deliver less the further their deposit tiles are from a depot (your town centre, or a Storehouse). The Land panel shows the current hauling percentage for each deposit.
- **Research:** a Library (unlocked by the Writing tech) gives scholar slots; scholars make knowledge, and knowledge plus goods buys technologies. Techs unlock new structures and give permanent boosts. Techs show up in the Research panel as their requirements are met.
- **Hunting and weaving:** Hunting Lodges stand in forests and hunters draw on wild game. Flax fields and looms turn flax into cloth, which Townhouses and some techs need.
- **Farms** need plain tiles and give farmer slots (3 per farm). Farmers out-produce foragers, so farms are how food scales.
- **Finite deposits** (stone, clay, iron) give full output until they run out; regrowing ones (forests) yield less as they thin. The Land panel shows which, plus how long a finite one will last.
- **New Run** takes an optional seed from the box in the footer (tap twice to confirm). The same seed gives the same map on every device.

## Cloud sync (optional)

Progress saves in your browser automatically. To play on several devices:

1. Create a **secret gist** on GitHub (any placeholder file is fine) and copy its ID.
2. Create a GitHub token that can read and write gists.
3. Open **Cloud Sync** in the game, paste both, then use **Push** on one device and **Pull** on another.

The token and gist ID are stored only in that browser's local storage. Each save carries a revision counter that goes up with every player action. If the cloud has progress from another device that this one hasn't seen, Push asks before overwriting, and the automatic push when you leave the tab skips instead of overwriting.

## Project layout

| File | Purpose |
| --- | --- |
| `index.html`, `ui.html`, `style.css` | Loader shell, game markup and styling |
| `game.js` | Engine: simulation, rules, UI, saving, sync |
| `gamedata.json` | All content: resources, jobs, buildings, deposits, land, population rules |
| `validate.js`, `validate.html` | Data checker (see below) |
| `builder.html`, `builder.js` | Form-based editor for `gamedata.json` with live validation; exports the file for you to commit |
| `tree.html`, `tree.js` | Read-only tech tree: what unlocks, costs and feeds what |
| `stats.html`, `stats.js` | Live charts of stockpiles, rates, population and deposits (see below) |

## New game options and automation

**New Game…** (footer) opens a panel with presets (Standard, Relaxed, Hard) and every option listed under `newGame` in `gamedata.json`: starting settlers, starting buildings and resources, starting land radius, and rule tweaks such as food eaten per settler, arrival and starvation speed, claim prices, spoilage and hauling loss. Rule options override a number in the game data by dotted path (for example `resources.food.spoil`), and the overrides are saved with the run. To expose another number, add an option with `"kind": "rule"` and its path; the checker verifies that the path exists.

**Automation** (header button) is for casual play and works while the game is open. It can assign idle settlers, keep food supplied, build storehouses and depots, research technologies, build the buildings a production chain needs (a kiln for bricks, a library for knowledge), build housing, and claim land. The panel lists those purchase categories in priority order, with a checkbox and up/down arrows for each: higher ones go first, and a purchase being saved up for is never spent on something lower down. **Resource focus** (Low, Normal, High) steers which jobs idle settlers prefer. Automation keeps a spending reserve, releases workers from exhausted or over-staffed deposits, and stops buying land once it costs more than `automation.claimMaxMult` times the starting price. It doesn't run while the game is closed.

## Display and graphics

The **Display** button in the game header picks the graphics (renderer) and map height, and the choice is saved per browser. `settings.json` holds the defaults and the list of available renderers.

Rendering is pluggable. A renderer is a small script, `render-<id>.js`, that registers an object on `window.SettlementRenderers` with a `draw()` function, an optional `options` list (shown as checkboxes in the Display panel) and an `animated` flag. The game handles panning, zooming and tapping, and hands the renderer a read-only view of the world (terrain, owned tiles, buildings, selection). `render-classic.js` is the reference implementation and documents the contract. `render-painted.js` draws shaded ground, soft shorelines, trees, mountains, ore, fields and buildings procedurally (no image files). To add one, create the file and add it to `available` in `settings.json`.

## Stats

The game records a history of stockpile levels, production and consumption rates, population and deposits, and `stats.html` charts it. Open `stats.html` in a second window or on a second monitor **in the same browser** and it updates live as you play. Ranges run from 10 minutes up to 14 days. Hover or touch a chart to read exact values.

The history is stored per device (it isn't synced through the gist), starts again with each New Run, and also resets if you add or remove resources or deposits in `gamedata.json`. Keep the game tab in a visible window for the smoothest data, because browsers slow down background tabs.

## Checking the game data

Run the checker after editing `gamedata.json` by opening `validate.html` next to the game.

It flags broken references, unknown effect types and bad numbers. It also does a reachability pass over the whole economy, so it catches resources nothing can produce, buildings that can never be afforded, and costs that exceed a stockpile's capacity with nothing to raise it. Dead-end resources and buildings that do nothing show up as warnings.

The engine is data-driven. Adding a resource, job or building is a JSON edit. Buildings declare `effects` (`housing`, `capacity`, `outputMult`), and unlock rules are conditions such as `{ "resource": "stone", "gte": 10 }`, combinable with `all` / `any`.

## Running locally

There is no build step and there are no dependencies. Serve the folder with any static server, because `gamedata.json` is loaded with `fetch` and won't load from a `file://` page:

```
php -S localhost:8000
```

(Any static file server works.) The whole project is plain HTML, CSS and JavaScript, hosted as-is on GitHub Pages.

`index.html` is a tiny loader that fetches `style.css`, `ui.html` (the game markup) and `game.js` with revalidation, so a new version reaches players on their next page load with no cache busting or force-refresh. When offline it falls back to the cached copies.

## License

MIT. See [LICENSE](LICENSE).
