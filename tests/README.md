# Tests (optional, Node only, no dependencies)

`node tests/run.js` plays scripted runs and compares them with recorded results, each layer of the game on its own and then together.

- `scenarios.js`: three runs (manual play; automation; neighbours with trade, catch-up and save/load). A state hash is taken at checkpoints.
- `golden.json`: the hashes, recorded from the single-file version of the game before it was split into modules, so a pass means the split changed nothing about how a run plays out.
- `harness.js`, `adapter.js`: load module files into a Node `vm` with a fake clock; with no page stubs for the engine layers.
- `page.js`, `loader.js`, `mod.js`: the page layer, the real `index.html` loader, and the example mod.

If you change rules or balance on purpose, the hashes will differ; run `node tests/record.js` to take new ones. Delete this folder any time; nothing else uses it.
