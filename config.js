// Helper: convert CSS hex color string to Phaser hex number
function hexColor(cssColor) {
    if (typeof cssColor === 'string' && cssColor.startsWith('#')) {
        return parseInt(cssColor.substring(1), 16);
    }
    return cssColor;
}

var CONFIG = {
    // Quotes are LOAD-BEARING. Phaser passes this straight into a canvas font
    // string, and a family with a space and a digit in it fails to parse
    // unquoted — silently, falling back to the system default with no error.
    FONT_FAMILY: '"Baloo 2", sans-serif',
    FONT_WEIGHT: '600',     // the ONE weight shipped in fonts/. Every label asks
                            // for this rather than 'bold', because 'bold' means
                            // 700 — which is not in the file, so the browser
                            // SYNTHESISES it by smearing the 600 sideways. Ship
                            // an 800 file and set this to '800' for more weight.
    TEXT_COLOR: '#1A237E',

    // The canvas's clear colour. Keep it the same as the page background in
    // index.html so the letterbox bars cannot be told apart from the game.
    BACKGROUND_COLOR: '#20232b',

    DEBUG_LAYOUT: false,     // log the canvas size once at startup: [buffer]
    DEBUG_STAGE: false,      // [stage] logs: the frame size and stage chosen at
                             // boot, each reshape noticed, what holds a relayout
                             // back, and the stage it picks

    // ── The stage ─────────────────────────────────────────────────────────────
    // LANDSCAPE OR PORTRAIT, whichever way the window is. The long side is
    // fixed at W, the short side follows the window's shape; in portrait the
    // arena stands on end (WORLD_H x WORLD_W) and a turn mid-level rotates the
    // field rather than restarting it (see _rotateField in game.js).
    STAGE: {
        PORTRAIT: true,      // false: landscape only, a tall window gets bars
        // ONLY THE LONG SIDE IS FIXED. The other is taken from the window's own aspect,
        // so the stage matches the screen and there are no bars to begin with —
        // a fixed 16:9 stage letterboxes on nearly every real screen.
        //
        // The clamps stop a freak window from producing an absurd stage — a very
        // wide-and-short desktop window, or a phone held upright. Beyond them you
        // get bars again, which is the correct outcome.
        W: 1920, H: 1080, MIN_RATIO: 0.45, MAX_RATIO: 0.80,
        // false pins the stage to the H above, ignoring the window's shape.
        DERIVE_HEIGHT: true,
        // FIT      letterboxes: the whole game always visible, bars on a
        //          mismatched aspect, nothing ever cut off.
        // ENVELOP  fills the window and crops the overflow.
        MODE: 'FIT',
        // A RESHAPE — a frame whose shape would give a stage height more than
        // this share away from the current one — re-lays the game out in place
        // once the size has held still for RESHAPE_DEBOUNCE_MS (see _relayout in
        // game.js). Under it (a phone's toolbar sliding), FIT just scales.
        // -1 turns reshapes off.
        RESHAPE_TOLERANCE:   0.05,
        RESHAPE_DEBOUNCE_MS: 250,
        // While a relayout waits for whatever is mid-animation to land, time runs
        // this many times faster, so the wait is a few frames rather than a second
        // or two of the old layout on the new screen. 1 waits at normal speed.
        RELAYOUT_FAST_FORWARD: 25,
    },

    // [timing] lines in the console: how long each stage before play took, and
    // the slowest downloads. For finding where the loading time goes; turn off
    // before release.
    DEBUG_LOAD_TIMING: false,

    // ── SAVING ──────────────────────────────────────────────────────────────
    // The run is kept in the browser (localStorage) so a refresh does not lose
    // it. Written every EVERY_MS and when the page is hidden or closed.
    //   LOAD false  — ignore any save at boot (always start fresh), still write
    //   ENABLED false — no saving or loading at all
    //   Add ?newgame to the page's address to wipe the save and start over.
    SAVE: {
        ENABLED:  false,   // OFF FOR NOW: every load starts fresh, nothing is saved
        LOAD:     true,
        KEY:      'mergeDash.save',
        EVERY_MS: 2000,
    },

    LOADING: {
        // The backstop that lifts the loading screen anyway, so a stalled
        // download cannot lock the player out. ms
        SCREEN_TIMEOUT_MS: 20000,
    },

    // The stand-in rewarded ad shown on localhost, where the Poki SDK is absent.
    AD: {
        DURATION: 15,  // Duration of mock ad in seconds (countdown timer)
        OVERLAY_COLOR: "#000000",
        OVERLAY_ALPHA: 1.0,  // Fully opaque - blocks game view completely
        TIMER_TEXT_SIZE: '120px',
        TIMER_TEXT_COLOR: '#FFFFFF',
        // ABOVE THE COUNTDOWN — a bare number said "waiting" without saying
        // what for.
        REWARD_TEXT:       'Reward in progress',
        REWARD_TEXT_SIZE:  '40px',
        REWARD_TEXT_COLOR: '#FFFFFF',
        REWARD_TEXT_GAP:   20,   // clearance above the countdown number, px
    },

    // ── THE MERGE GAME ──────────────────────────────────────────────────────
    // The player is one merge piece. A tap sends it in a straight line towards
    // the tap: a piece of the SAME level merges into the next level and the run
    // stops there; any OTHER level destroys it (game over); nothing in the way
    // and it slides on until the wall stops it. Merge everything into MAX_LEVEL.
    MERGE: {
        // The walled arena, px. ALL ON ONE SCREEN: the width is the stage's,
        // and the height the shortest stage allowed (STAGE.W * MIN_RATIO), so
        // it always fits; a taller screen just shows more wall above and below.
        WORLD_W: 1920, WORLD_H: 864,
        WALL: 40,                       // wall thickness, px
        WALL_FACE: 30,                  // the top wall's front face, px — a hint of height
        TILE: 96,                       // floor checker size, px
        FLOOR_COLORS: ['#3d4558', '#454e63'],
        WALL_COLOR: '#15171d',
        WALL_FACE_COLOR: '#272c38',

        PLAYER_LEVEL: 1,                // the level the player starts as
        ITEMS: [1, 2, 3, 4],            // the other pieces on the field, by level
        MAX_LEVEL: 5,                   // reaching this with the field empty wins
        // Each level has its own art (graphics/player/item_0N.webp), and each
        // piece also carries an "LV n" label.
        SCALE: 0.15,                    // piece art scale (art is about 230 x 505)
        GROW: 0.06,                     // extra scale per level above 1
        PULSE: 1.12,                    // the player's breathing: peak scale, x its own
        PULSE_MS: 450,                  // half a breath (grow, then shrink back), ms
        IDLE_HOP_EVERY_MS: 1500,        // standing still this long, the player hops once, ms
        IDLE_HOP_MS: 180,               // the way up (and the same down), ms
        IDLE_HOP_HEIGHT: 22,            // how high, px
        POINTER_SIZE: 30,               // the down-arrow over the player: width, px
        POINTER_GAP: 12,                // its clearance above the head (at full pulse), px
        POINTER_COLOR: '#ffe066',
        HIT_RADIUS: 28,                 // contact radius at the feet, px
        LOSE_BLINK_MS: 1500,            // on a loss, the player blinks red this long
                                        // before the game-over pane, ms
        LOSE_BLINKS: 6,                 // how many red flashes in that time
        LOSE_BLINK_COLOR: '#ff2a2a',
        SPEED: 400,                     // travel speed, px/s
        STOP_AT_TAP: false,             // true: stop at the tapped point instead
                                        // of sliding on to the wall
        OBSTACLES: 9,                   // spike balls on the field; touching one kills
        OBSTACLE_RADIUS: 32,            // their contact radius, px
        // ON THE ROUTE: this share of them sits along the merge route (player
        // -> LV 1 -> LV 2 ...), so the straight line is blocked and you have to
        // steer round. The rest are scattered.
        OBSTACLE_ON_PATH: 0.7,          // 0-1
        OBSTACLE_SPREAD: 110,           // how far off the route line they may sit, px
        OBSTACLE_GAP: 150,              // min distance between two of them, px — room to slip between
        OBSTACLE_CLEAR: 100,            // min distance from any piece, px
        OBSTACLE_MOVERS: 3,             // how many of them sweep to and fro
        OBSTACLE_SWEEP: 130,            // a sweep's reach each side of home, px
        OBSTACLE_SWEEP_MS: 1300,        // one way across, ms
        SPAWN_DELAY_MS: 1000,           // the player stands alone this long before
                                        // the NPCs and spikes pop in, ms — so it is
                                        // plain which piece is yours
        SPAWN_POP_MS: 300,              // their pop-in, ms
        SPAWN_MARGIN: 110,              // pieces spawn at least this far from walls, px
        MIN_GAP: 260,                   // and this far from each other, px

        LABEL_SIZE: '26px',
        LABEL_GAP: 4,                   // label's clearance below the feet, px
        HUD_SIZE: '40px',
        MSG_SIZE: '110px',
    },
};
