# EMBERLINE

[![make.fun · best-game-01](https://make.fun/badge/best-game-01.svg)](https://make.fun/bounty/best-game-01?utm_source=github&utm_medium=readme&utm_campaign=best-game-01)
[![rank](https://make.fun/badge/best-game-01/mihawnk-nft/best-game-emberline/rank.svg)](https://make.fun/bounty/best-game-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=best-game-01)
[![reward](https://make.fun/badge/best-game-01/mihawnk-nft/best-game-emberline/reward.svg)](https://make.fun/bounty/best-game-01?utm_source=github&utm_medium=readme&utm_campaign=best-game-01)

A tactical strike on Foundry Yard — a first-person 5v5 bomb-defusal shooter
built for the make.fun **best-game-01** bounty ("Make the best game"):
https://make.fun/bounty/best-game-01

You are **SABLE-1**, the spike carrier, with three bot allies (VEX, ROOK,
HAVOC) against four EMBER defenders (ASH, CINDER, FLINT, SOOT). Plant the
spike at site A or B — or eliminate the whole EMBER team. First to 5 rounds
takes the match (9 rounds max).

## How to play

Open `game/index.html` in a desktop browser (or run `node serve.ts` and open
`http://localhost:8321/`). Click **Deploy** to start.

- **WASD** move, **mouse** look, **left click** fire, **right click** aim
  (scope on the LW-50 Longshot), **R** reload, **Space** jump, **C** crouch
- **1–5** switch weapon, **B** open the buy menu (buy phase only)
- **E (hold)** plant the spike inside a site, or defuse the planted spike
- **G** throw HE grenade, **F** throw flashbang
- **Esc** pause

## The game

- **Economy:** $800 start; kills pay $300, round wins $3,250, losses $1,900
  plus a loss-streak bonus. Five weapons (P9 sidearm, VK-9 SMG, AR-77 rifle,
  M12 scattergun, LW-50 sniper), Kevlar vest, HE and flash grenades.
- **Bots:** waypoint-graph pathfinding (BFS), line-of-sight vision, reaction
  delays and aim error that shrinks with exposure. Attackers pick a site and
  plant; defenders hold, retake, and intercept the carrier. The spike drops
  when its carrier dies and can be picked up again.
- **Combat:** hitscan with headshot ×4, leg penalty, distance falloff,
  armor that absorbs half of every hit; tracers, impact flashes, explosions.
- **Map:** Foundry Yard — an original two-site industrial yard with three
  lanes (west, mid, east), a connector between the sites, and cover crates
  and containers. All textures are procedural (seeded canvas paint); all
  sounds are synthesized WebAudio. No network requests, no assets to download.

## Files

- `game/index.html` — page shell, HUD, overlays, buy menu
- `game/src/main.js` — wiring: renderer, player, shooting, spike, rounds
- `game/src/world.js` — the map, colliders, waypoint graph, lighting
- `game/src/bots.js` — bot AI (state machine + BFS pathfinding)
- `game/src/combat.js` — hitscan, damage, grenades
- `game/src/weapons.js` — the arsenal and view models
- `game/src/mover.js` — shared movement physics
- `game/src/match.js` — rounds, timer, spike state
- `game/src/economy.js` — money, buy menu items
- `game/src/hud.js` — DOM HUD, minimap, kill feed
- `game/src/audio.js` — synthesized sound effects
- `game/src/input.js` — keyboard, mouse, pointer lock
- `game/src/palette.js` — the colour plan
- `game/src/textures.js` — procedural canvas textures
- `game/vendor/three/` — three.js 0.187.0 (vendored, MIT)

## Screenshots

`screenshots/` holds four real renders taken in headless Chromium from this
game: the title screen, the buy phase, live gameplay with the HUD, and the
match-results screen.

## License

MIT — see `LICENSE`.
