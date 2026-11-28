# Parking lot

Ideas that are good but not scheduled. Add them here instead of building them mid-session.

- **Better water:** rivers that flow downhill and reach the sea, bridges, boats and ports.
- **Generated content:** have an LLM propose new resources, jobs and buildings (optionally seeded from reference text such as Wikipedia articles) as `gamedata.json` patches. Every proposal would go through `validate.js` and the builder for review before it is accepted.
- **Smarter hauling:** nearest-depot-per-tile routing, then roads, then carriers as real workers.
- **Builder:** terrain editor, optional "save to GitHub" button.
- **Tiles:** deposits that are consumed or exhausted on the map, not just in the pooled totals.
- **Stats on other devices:** sync the history (or a summary) through the gist so a phone can show charts from the desktop run.
- **More towns:** a second Town Centre as a late-game tech and building (costs settlers and materials). It would be a depot and housing hub, which fits the hauling system: far deposits become efficient once you have a town next to them.
- **Luxuries and happiness:** optional resources villagers consume for faster growth or bonuses, tied to trade.
- **Neighbours, next steps:** war and borders (raiding, defence, tile capture), alliances, AI-to-AI relations, removing a neighbour, picking a personality when adding one, a difficulty setting (AI handicap), a "neighbour news" feed.
- **Custom maps (realistic Earth at several scales):** replace the seeded noise with real terrain: a region, a continent or the whole globe, with hand-made or imported maps as an alternative to the endless generated one. Needs a map source behind `terrainAt(x, y)` (a raster of terrain ids per scale, loaded from a file, with the noise generator as the fallback and for anything off the edge), start-position rules per map, and decisions on what a tile means at each scale (a 1 km tile and a 100 km tile shouldn't build the same things, so buildings, deposits and yields may need per-scale data). Deposits could come from real data (forest cover, ore, fertile soil, rivers, coast). The modular `map` layer is the seam for it.
- **Online players:** a small PHP + SQLite service that arbitrates only shared things (atomic tile claims, public player summaries, trade escrow) while each client keeps simulating its own settlement. The `WS.owner` index and `withState` are the seams for it. The gist can't do atomic claims.
- **Trade, next steps:** trade routes limited by distance or roads, caravans as real workers, prices that drift with the whole map's supply.
