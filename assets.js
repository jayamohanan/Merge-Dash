// assets.js — WHAT ART THE GAME FETCHES, as plain data.
//
// Two readers, one list:
//   game.js   loads exactly these files in preload
//   build.sh  runs these same functions to write <link rel="preload"> hints
//             into the build's index.html, so the browser starts fetching the
//             opening art the moment the page arrives — while Phaser and
//             game.js are still downloading, instead of after.
//
// That is why this lives outside the game scene: the build has no Phaser and
// no scene, only the config. Keeping ONE copy of the list is the point — a file
// the game draws but this list forgets would load late and never be hinted,
// and nothing would say so.
//
// Loaded after config.js, before game.js.

// Every entry is { type, key, url, frame? }:
//   type  'image' | 'sheet' | 'json'
//   frame { frameWidth, frameHeight } for a sheet
function assetList() {
    const out = new Map();
    const add = (type, key, url, frame) => {
        if (key && url && !out.has(key)) out.set(key, frame ? { type, key, url, frame } : { type, key, url });
    };
    return {
        image: (key, url) => add('image', key, url),
        sheet: (key, url, w, h) => add('sheet', key, url, { frameWidth: w, frameHeight: h }),
        json:  (key, url) => add('json', key, url),
        list:  () => [...out.values()],
    };
}

// ── SHARED ART ───────────────────────────────────────────────────────────────
// Everything the game needs to start. Art needed later can be fetched in the
// background with AssetManager.ensureImage instead of being listed here.
function sharedAssets() {
    const A = assetList();
    // The piece art, item_01 to item_<PIECE_ART>. Levels past the last one
    // start over from item_01 (pieceKey in game.js); the "LV n" label tells
    // them apart. Never more than MAX_LEVEL needs.
    const M = CONFIG.MERGE || {};
    const max = Math.min(M.MAX_LEVEL || 5, M.PIECE_ART || 6);
    for (let lv = 1; lv <= max; lv++) {
        A.image(`piece${lv}`, `graphics/player/item_${String(lv).padStart(2, '0')}.webp`);
    }
    return A.list();
}
