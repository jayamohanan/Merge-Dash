# Merge Dash

A casual game (landscape and portrait) for web portals (Poki). Phaser 3 (custom build), plain JS, no bundler.

The loading bar, Poki wrapper, adaptive stage, save skeleton and build pipeline are in place; the game itself is still to be written.

## Working with the user

- **Do only what is asked.** Minimal change, no unrequested refactors or redesigns. Suggest bigger cleanups separately.
- **Simple features:** make the edit, run `node --check game.js config.js`, and stop. The user tests manually.
- **Browser tests:** only when behaviour is genuinely uncertain (motion, timing). They play in real time and cost minutes.
- **Explain before changing** when the user asks "what do you think", "first check" or "no code change".
- **Don't commit** unless asked.
- **`changes.md`** is only added to when explicitly asked.
- Keep replies short. The user's connection is metered.

## Files

| File | What it is |
|---|---|
| `index.html` | Page with an HTML loading bar. Loads the scripts in order. |
| `game.js` | Everything runtime: `GameScene`, boot, Poki, save. |
| `config.js` | One big `CONFIG` object. All tunables live here; read in code with defaults. |
| `assets.js` | Asset list shared by `game.js` and `build.sh` (`sharedAssets()`). |
| `build.sh` | Builds `build/`: copies files, adds preload hints, strips comments with esbuild, joins `config.js`, `assets.js`, `game.js` into one `game.js` (so no two files may declare the same top-level name). |
| `build.command` | Double-click: runs `build.sh` to make `build/`. |
| `tools/phaser-custom/` | The custom Phaser build's source config. |

The scripts share globals. The custom Phaser build has no `this.add.circle` / shapes and no `Phaser.Math.Easing`; use graphics and ease strings.

**Run locally:** a static server, e.g. `python3 -m http.server`, or VS Code Live Server. Add `?newgame` to the URL for a fresh run. Saving is off (`CONFIG.SAVE.ENABLED: false`). On localhost the Poki SDK adds about 6 s to loading (its init times out), and `showRewardedAd` shows a mock ad.

## The shell (game.js)

- **Stage:** landscape or portrait (`STAGE.PORTRAIT`). Long side fixed at `STAGE.W` (1920); short side from the window's aspect, clamped (`MIN_RATIO`/`MAX_RATIO`). Phaser `FIT` scales it. In portrait the arena is `WORLD_H` x `WORLD_W` (`this.world`); a turn mid-level calls `_rotateField`.
- **Layout:** `calculateLayout()` fills `this.layoutConfig` (`W`, `H`, `cx`, `cy`). `layout()` builds the view; `_teardown()` destroys it. On a big reshape (`RESHAPE_TOLERANCE`), `_pollStage` → `_relayout` waits for `_unsettledBy()` to return null, then tears down and rebuilds in place. Anything placed vertically must read `H` from `layoutConfig`.
- **Loading:** `preload` drives the HTML bar; `create` ends with `finishLoadingScreen()` (sends `gameLoadingFinished`).
- **Poki:** all calls via `pokiCall`. `gameplayStart` only after the first input (`pokiFirstInput`). Rewarded ads: `showRewardedAd(onReward, onFail)` pauses (`_setPaused`) and stops gameplay around the ad.
- **Save:** `_collectSave` / `_applySave` / `readSave`. Bump `SAVE_VERSION` on incompatible changes.

## Style

Comments explain why, and often open with an ALL-CAPS lead. Match the surrounding density and idiom. Config entries carry a comment saying what they do and their unit.
