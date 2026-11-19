# Settlement

A small, graphics-free settlement builder that runs in the browser. Gather food and wood, house and assign settlers, claim land, and build up a production chain. Everything is numbers, rates and emoji, so it plays the same on a phone, laptop or desktop.

**Play:** https://jcrutchy.github.io/settlement/

Status: early (v0.4). The engine is stable enough to play, but the balance has had very little testing.

## How to play

- **Gather** food and wood by hand to get started, then build **Timber Huts** to attract settlers.
- Settlers arrive while there is free housing and food. Each one eats food every second, so watch the **Net** rate on each stockpile (P = production, C = consumption).
- Assign idle villagers to **jobs** with the + and - buttons. Some jobs consume one resource to make another.
- **Stockpiles have a capacity.** Build storehouses and granaries to raise it.
- **The map** is a grid of terrain tiles. Claim tiles next to your land (the price rises as you grow), then press **Build** on a structure. It goes on the best free tile automatically (depots where they cut hauling loss the most, everything else near the town centre). Select a building's tile to **Move** it (costs 25%) or **Demolish** it (refunds half).
- **Deposits live on tiles.** Forests regrow, hills and clay banks don't. Cutting wood faster than the forest regrows empties it.
- **Hauling matters.** Gatherers deliver less the further their deposit tiles are from a depot (your town centre, or a Storehouse). The Land panel shows the current hauling percentage for each deposit.
- **New Run** lets you enter a seed. The same seed gives the same map on every device.

## Cloud sync (optional)

Progress saves in your browser automatically. To play on several devices:

1. Create a **secret gist** on GitHub (any placeholder file is fine) and copy its ID.
2. Create a GitHub token that can read and write gists.
3. Open **Cloud Sync** in the game, paste both, then use **Push** on one device and **Pull** on another.

The token and gist ID are stored only in that browser's local storage. Each save carries a revision counter that goes up with every player action. If the cloud has progress from another device that this one hasn't seen, Push asks before overwriting, and the automatic push when you leave the tab skips instead of overwriting.

## Project layout

| File | Purpose |
| --- | --- |
| `index.html`, `style.css` | Page and styling |
| `game.js` | Engine: simulation, rules, UI, saving, sync |
| `gamedata.json` | All content: resources, jobs, buildings, deposits, land, population rules |
| `validate.js`, `validate.html` | Data checker (see below) |
| `builder.html`, `builder.js` | Form-based editor for `gamedata.json` with live validation; exports the file for you to commit |
| `tree.html`, `tree.js` | Read-only tech tree: what unlocks, costs and feeds what |

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

Bump the `?v=` on the CSS and JS tags in `index.html` after changing those files so browsers don't serve stale copies.

## License

MIT. See [LICENSE](LICENSE).
