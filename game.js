// Merge Dash — main game scene

class AssetManager {
    constructor(scene) {
        this.scene = scene;
        this.loading = new Map();
    }

    // AN IMAGE FETCHED AFTER PRELOAD, in the background.
    ensureImage(key, url) {
        if (this.scene.textures.exists(key)) {
            return Promise.resolve();
        }

        if (this.loading.has(key)) {
            return this.loading.get(key);
        }

        // RESOLVES EITHER WAY, and only on ITS OWN file. Listening for the next
        // 'loaderror' from ANY file would let one unrelated failed download fail
        // whichever image happened to be in flight.
        const promise = new Promise((resolve) => {
            const done = () => {
                this.scene.load.off(`filecomplete-image-${key}`, ok);
                this.scene.load.off('loaderror', fail);
                this.loading.delete(key);
                resolve();
            };
            const ok = () => done();
            const fail = (file) => { if (!file || file.key === key) done(); };
            this.scene.load.on(`filecomplete-image-${key}`, ok);
            this.scene.load.on('loaderror', fail);
            this.scene.load.image(key, url);
            this.scene.load.start();
        });

        this.loading.set(key, promise);
        return promise;
    }
}

class GameScene extends Phaser.Scene {
    constructor() { super('GameScene'); }

    // ================================================================
    // INIT
    // ================================================================
    init() {
        this.gamePaused   = false;   // frozen only while an ad plays (_setPaused)
        this.isWatchingAd = false;
    }

    // ================================================================
    // LAYOUT
    // ================================================================
    // THE STAGE'S FIGURES. Width is fixed (STAGE.W); height follows the window's
    // shape, so anything placed against the bottom or the vertical centre must
    // read H from here, never a constant.
    calculateLayout() {
        const M = CONFIG.MERGE;
        const W = this.scale.width;
        const H = this.scale.height;
        const portrait = H > W;
        this.layoutConfig = { W, H, cx: W / 2, cy: H / 2, portrait };
        // THE ARENA STANDS ON END in portrait: the same field, turned.
        this.world = portrait ? { W: M.WORLD_H, H: M.WORLD_W } : { W: M.WORLD_W, H: M.WORLD_H };
    }

    // BUILDS THE VIEW against layoutConfig. Called once from create and again
    // after every relayout, with the old view already torn down (_teardown).
    layout() {
        this.cameras.main.centerOn(this.world.W / 2, this.world.H / 2);   // re-centre after a reshape
        this._buildHud();
    }

    // THE OLD VIEW COMES DOWN before a relayout. Destroy here whatever layout()
    // builds; state that must survive the reshape lives elsewhere.
    _teardown() {
        if (this.hud) { this.hud.destroy(); this.hud = null; }
    }

    // ── RESHAPE ──────────────────────────────────────────────────────────────
    // WATCHED EVERY FRAME, not on resize events. A phone reports its new width
    // and height some time after it says it has changed — later than any fixed
    // wait can be relied on — so a check fired off the event could read the OLD
    // shape and never be asked again. Reading the window each frame cannot miss
    // it. The new shape has to hold for STAGE.RESHAPE_DEBOUNCE_MS first, so a
    // window being dragged relayouts once, when it is let go.
    _pollStage() {
        const S = CONFIG.STAGE || {};
        const w = window.innerWidth, h = window.innerHeight;
        if (!w || !h) return;
        const now = performance.now();
        const want = pickStage();
        const tol = S.RESHAPE_TOLERANCE !== undefined ? S.RESHAPE_TOLERANCE : 0.05;
        const off = (a, b) => Math.abs(a - b) / b > tol;
        const reshape = tol >= 0 && (off(want.height, this.scale.height) || off(want.width, this.scale.width));
        if (!reshape) {
            // Matches — including changed back before a relayout ran.
            this._reshapeSeenAt = 0;
            this._seenW = this._seenH = 0;
            this._relayoutPending = false;
            return;
        }
        if (w !== this._seenW || h !== this._seenH) {
            this._seenW = w; this._seenH = h;
            this._reshapeSeenAt = now;
            stageLog(`reshape seen: frame ${w} x ${h} wants ${want.width} x ${want.height}, ` +
                `game is ${this.scale.width} x ${this.scale.height}`);
            return;
        }
        const wait = S.RESHAPE_DEBOUNCE_MS !== undefined ? S.RESHAPE_DEBOUNCE_MS : 250;
        if (!this._relayoutPending && now - this._reshapeSeenAt >= wait) {
            this._relayoutPending = true;
            stageLog('relayout pending — runs once the field is settled');
        }
    }

    // What is holding the field unsettled, or null. A relayout tears the view
    // down, so it waits for anything in flight to land. Looping tweens never
    // end and are simply rebuilt by layout(), so they do not count. A run in
    // progress does not either: _rotateField turns it with the field.
    _unsettledBy() {
        if (this.isWatchingAd) return 'an ad is playing';
        const t = this.tweens.getTweens().filter((tw) => !tw.isInfinite).length;
        return t ? `${t} tween(s) running` : null;
    }

    // Time sped up while a relayout waits, and put back after.
    _fastForward(on) {
        const S = CONFIG.STAGE || {};
        const k = on ? Math.max(1, S.RELAYOUT_FAST_FORWARD !== undefined ? S.RELAYOUT_FAST_FORWARD : 25) : 1;
        if (this.tweens.timeScale !== k) this.tweens.timeScale = k;
        if (this.time.timeScale   !== k) this.time.timeScale   = k;
    }

    _relayout() {
        this._relayoutPending = false;
        this._waitWhy = undefined;
        const st = pickStage();
        stageLog(`relayout: frame ${window.innerWidth} x ${window.innerHeight} -> stage ${st.width} x ${st.height}`);
        const wasPortrait = this.layoutConfig.portrait;
        this.scale.setGameSize(st.width, st.height);
        this.cameras.main.setSize(st.width, st.height);
        this._teardown();
        this.calculateLayout();
        // TURNED: the field turns the opposite way to the device, so everything
        // stays where it was in the room. The screen's angle says which way it
        // went; without one (a desktop window dragged tall) it turns clockwise.
        const ang = screenAngle();
        if (this.layoutConfig.portrait !== wasPortrait && this.player) {
            const d = ang !== null && this._angle !== null ? ((ang - this._angle) % 360 + 360) % 360 : 90;
            this._rotateField(d !== 270);
        }
        this._angle = ang;
        this.layout();
        // Reshaped again while this ran? _pollStage picks it up next frame.
        this._reshapeSeenAt = 0;
    }

    // ── SAVING ───────────────────────────────────────────────────────────────
    // CONFIG.SAVE. So a refresh by mistake does not cost a player their run:
    // the run is written to localStorage every EVERY_MS and whenever the page
    // is hidden or closed (a reload is a close), and read back at boot.
    //
    // ONLY SETTLED FIGURES, never anything mid-animation.
    _collectSave() {
        return {
            v: SAVE_VERSION,
            t: Date.now(),
        };
    }

    _writeSave() {
        const S = CONFIG.SAVE || {};
        if (S.ENABLED === false || !this._saveReady) return;
        try { localStorage.setItem(saveKey(), JSON.stringify(this._collectSave())); }
        catch (e) { /* incognito / storage full / blocked — play on unsaved */ }
    }

    // Every EVERY_MS on the scene's clock (so not during an ad's freeze), and
    // on the page being hidden or closed — the one that catches a reload.
    _startAutosave() {
        const S = CONFIG.SAVE || {};
        if (S.ENABLED === false) return;
        this._saveReady = true;
        this.time.addEvent({ delay: S.EVERY_MS !== undefined ? S.EVERY_MS : 2000,
            loop: true, callback: () => this._writeSave() });
        if (!this._saveHooked && typeof window !== 'undefined') {
            this._saveHooked = true;
            const now = () => this._writeSave();
            window.addEventListener('pagehide', now);
            document.addEventListener('visibilitychange', () => {
                if (document.visibilityState === 'hidden') now();
            });
        }
    }

    // THE FIGURES FROM A SAVE, before anything is built from them.
    _applySave(sv) {
    }

    // ================================================================
    // PRELOAD
    // ================================================================
    preload() {
        loadMark('Phaser booted — preload starting');
        this._save = readSave();
        // REAL FIGURES FROM HERE. The page's creep stops where it is and this
        // loader's progress carries on from there.
        if (typeof window !== 'undefined' && window.__loading) {
            window.__loading.takeOver();
            loadingShown = window.__loading.value();
        }
        // The loading bar. This preload runs it up to LOAD_PRELOAD_CAP. A later
        // batch restarts the loader's own 0-1, so each takes a share of what is
        // left instead, and the bar only ever moves forward. Whatever the creep
        // reached is the floor, so the hand-over is a jump forward or nothing.
        let barFrom = Math.max(LOAD_BOOT_SHARE, loadingShown), barTo = LOAD_PRELOAD_CAP, batch = 0;
        this.load.on('start', () => {
            if (batch++ === 0) return;
            barFrom = loadingShown;
            barTo   = loadingShown + (0.97 - loadingShown) * 0.6;
        });
        this.load.on('progress', (v) => setLoadingProgress(barFrom + (barTo - barFrom) * v));
        this.load.on('complete', () => {
            if (!loadingScreenDone) loadMark(batch <= 1 ? 'preload files downloaded' : 'more art downloaded');
        });

        // SHARED ART. The list lives in assets.js, which the build also reads to
        // write the page's preload hints, so what is loaded here and what is
        // hinted cannot drift.
        for (const a of sharedAssets()) {
            if (a.type === 'json')  this.load.json(a.key, a.url);
            else if (a.frame)       this.load.spritesheet(a.key, a.url, a.frame);
            else                    this.load.image(a.key, a.url);
        }

        // A file that 404s leaves the cache entry simply absent, and whatever
        // wanted it draws nothing — which looks exactly like art that loaded and
        // was blank. Say so instead.
        this.load.on('loaderror', (file) => {
            console.error(`[load] FAILED "${file.key}" <- ${file.url} ` +
                `(${file.type}). Check the path is relative to index.html and ` +
                `that the file is actually served.`);
        });
    }

    // ================================================================
    // CREATE
    // ================================================================
    create() {
        loadMark('create: building the view');
        // The backstop for a download that never ends.
        setTimeout(finishLoadingScreen, (CONFIG.LOADING || {}).SCREEN_TIMEOUT_MS || 20000);

        if (CONFIG.DEBUG_LAYOUT) {
            const c = this.game.canvas;
            const dpr = window.devicePixelRatio || 1;
            console.log(
              `[buffer] backingStore=${c.width}x${c.height} ` +          // actual render pixels (drawing buffer)
              `cssDisplay=${c.clientWidth}x${c.clientHeight} ` +          // size shown on page (CSS px)
              `DPR=${dpr} ` +
              `physicalScreen=${Math.round(c.clientWidth*dpr)}x${Math.round(c.clientHeight*dpr)}`  // what the screen really has
            );
        }

        this.assets = new AssetManager(this);
        if (this._save) this._applySave(this._save);

        this.calculateLayout();
        this._angle = screenAngle();
        this._buildLevel();
        this.layout();
        this._startAutosave();
        this.input.on('pointerdown', (p) => this._onTap(p));

        // POKI: gameplayStart ON THE PLAYER'S FIRST INPUT — the first tap or
        // click anywhere.
        this.input.once('pointerdown', () => {
            pokiFirstInput = true;
            if (!this.gamePaused && !this.isWatchingAd) pokiGameplay(true);
        });

        // Everything the opening view needs is up.
        finishLoadingScreen();
    }

    // ================================================================
    // PAUSE AND ADS
    // ================================================================
    _setPaused(on) {
        if (this.gamePaused === on) return;
        this.gamePaused = on;
        // Poki's gameplay events are sent by the CALLERS (the ads), in the
        // order each needs them.
        if (on) { this.tweens.pauseAll(); this.anims.pauseAll(); }
        else    { this.tweens.resumeAll(); this.anims.resumeAll(); }
        this.time.paused = on;                 // every timer and delayedCall
    }

    // A REWARDED AD. onReward runs only if it was watched to the end; onFail
    // when there was no ad to show (or it was skipped). On localhost, where
    // the Poki SDK times out, a mock ad stands in.
    showRewardedAd(onReward, onFail) {
        if (this.isWatchingAd) return;  // Prevent multiple ad triggers
        if (pokiReady) {
            this.isWatchingAd = true;
            this._setPaused(true);
            pokiGameplay(false);
            pokiRewardedBreak().then((ok) => {
                this.isWatchingAd = false;
                this._setPaused(false);
                if (pokiFirstInput) pokiGameplay(true);
                if (ok) { if (onReward) onReward(); }
                else if (onFail) onFail();
            });
            return;
        }
        if (isLocalDev()) { this.showMockAd(() => { if (onReward) onReward(); }); return; }
        if (onFail) onFail();
    }

    showMockAd(onComplete) {
        this.isWatchingAd = true;  // Block all interactions during ad
        // THE WORLD STOPS FOR THE AD — tweens mid-flight, every timer — and
        // picks up exactly where it was once the ad is over, the way Poki
        // requires.
        this._setPaused(true);
        pokiGameplay(false);
        const W = this.cameras.main.width;
        const H = this.cameras.main.height;
        const A = CONFIG.AD;

        // Create overlay
        const overlay = this.add.rectangle(W / 2, H / 2, W, H,
            parseInt(A.OVERLAY_COLOR.substring(1), 16), A.OVERLAY_ALPHA)
            .setDepth(10000)
            .setInteractive();  // Block clicks from passing through overlay
        this._shadePage(A.OVERLAY_COLOR, A.OVERLAY_ALPHA, 0);

        // Create countdown timer text in center
        const timerText = this.add.text(W / 2, H / 2, `${A.DURATION}`, {
            fontSize: A.TIMER_TEXT_SIZE,
            fontFamily: CONFIG.FONT_FAMILY,
            color: A.TIMER_TEXT_COLOR,
            fontStyle: CONFIG.FONT_WEIGHT,
        }).setOrigin(0.5).setDepth(10001);

        // "REWARD IN PROGRESS", measured off the number's own TOP edge, not the
        // screen's centre line, so the number cannot run through it.
        const rewardText = this.add.text(W / 2,
                timerText.y - timerText.height / 2
                    - (A.REWARD_TEXT_GAP !== undefined ? A.REWARD_TEXT_GAP : 20),
                A.REWARD_TEXT || 'Reward in progress', {
            fontSize: A.REWARD_TEXT_SIZE || '40px',
            fontFamily: CONFIG.FONT_FAMILY,
            color: A.REWARD_TEXT_COLOR || '#FFFFFF',
            fontStyle: CONFIG.FONT_WEIGHT,
        }).setOrigin(0.5, 1).setDepth(10001);

        // Countdown from AD.DURATION to 0. ON THE BROWSER'S CLOCK, not the
        // scene's: the scene's is the one stopped for the ad, and a countdown
        // on it would never reach zero.
        let timeLeft = A.DURATION;
        const countdown = window.setInterval(() => {
            if (!overlay.scene) { window.clearInterval(countdown); return; }   // scene gone
            timeLeft--;
            if (timeLeft > 0) {
                timerText.setText(`${timeLeft}`);
            } else {
                window.clearInterval(countdown);
                this._shadePage(null);
                overlay.destroy();
                rewardText.destroy();
                timerText.destroy();
                this.isWatchingAd = false;  // Re-enable interactions
                this._setPaused(false);     // the world carries on from where it stopped
                if (pokiFirstInput) pokiGameplay(true);
                onComplete();
            }
        }, 1000);
    }

    // THE PAGE AROUND THE CANVAS takes on a shade too, so the letterbox bars
    // darken with an overlay instead of staying bright around it. null puts
    // the page's own colour back.
    _shadePage(color, alpha, ms) {
        if (typeof document === 'undefined') return;
        const ground = CONFIG.BACKGROUND_COLOR;
        let css = '';
        if (color) {
            const g = hexColor(ground), c = hexColor(color), a = Math.max(0, Math.min(1, alpha));
            const mix = (sh) => Math.round(((g >> sh) & 255) * (1 - a) + ((c >> sh) & 255) * a);
            css = `rgb(${mix(16)}, ${mix(8)}, ${mix(0)})`;
        }
        for (const el of [document.documentElement, document.body]) {
            if (!el) continue;
            el.style.transition = ms > 0 ? `background-color ${ms}ms linear` : '';
            el.style.backgroundColor = css || ground;
        }
    }

    // ================================================================
    // THE MERGE GAME
    // ================================================================
    // THE FIELD is world-space and does not depend on the screen's shape, so
    // it is built once per round, not in layout(). Only the HUD is relaid out.
    _buildLevel() {
        const M = CONFIG.MERGE;
        this._clearLevel();
        this._makeArena();
        this._drawFloor();

        const spots = this.spots = this._pickSpots(1 + M.ITEMS.length);
        this.player = this._makePiece(spots[0].x, spots[0].y, M.PLAYER_LEVEL || 1);
        this.items = M.ITEMS.map((lv, i) => this._makePiece(spots[i + 1].x, spots[i + 1].y, lv));
        // HIDDEN, not removed: OBSTACLES_ON false places none.
        this.obstacles = M.OBSTACLES_ON === false ? []
            : this._obstacleSpots(spots, M.ITEMS).map((p) => this._makeObstacle(p.x, p.y));
        // THE PLAYER FIRST, alone; the rest pop in after SPAWN_DELAY_MS.
        // Until then taps and spikes are off.
        this.spawning = true;
        for (const o of [...this.items, ...this.obstacles]) o.setVisible(false);
        // this.spots, not spots: a turn before the reveal rotates them.
        this._spawnTimer = this.time.delayedCall(M.SPAWN_DELAY_MS || 0, () => this._revealField(this.spots));
        // THE POINTER: a down-arrow over the player, so you know which one is you.
        const ps = M.POINTER_SIZE || 30;
        this.player.pointer = this.add.graphics()
            .fillStyle(0x000000, 1).fillTriangle(-ps / 2 - 4, -3, ps / 2 + 4, -3, 0, ps * 0.85 + 5)
            .fillStyle(hexColor(M.POINTER_COLOR || '#ffe066'), 1).fillTriangle(-ps / 2, 0, ps / 2, 0, 0, ps * 0.85);
        this.player.add(this.player.pointer);
        this._pulse();
        this.move = null;
        this.over = null;

        const cam = this.cameras.main;
        cam.centerOn(this.world.W / 2, this.world.H / 2);   // the whole arena on screen, no follow
        this._setMessage(null);
    }

    _makeArena() {
        const M = CONFIG.MERGE, wall = M.WALL;
        this.arena = { x0: wall, y0: wall + M.WALL_FACE, x1: this.world.W - wall, y1: this.world.H - wall };
    }

    // A QUARTER TURN of everything on the field, cw (clockwise on screen) or
    // not. Positions are mapped arena to arena, so nothing lands in a wall —
    // the two arenas are near enough each other turned that spacing barely
    // changes. The art itself stays upright: only where it stands turns. A run
    // in progress keeps going the same way across the field.
    _rotateField(cw) {
        const old = this.arena;
        this._makeArena();
        const a = this.arena;
        const map = (p) => {
            const u = (p.x - old.x0) / (old.x1 - old.x0), v = (p.y - old.y0) / (old.y1 - old.y0);
            const nu = cw ? 1 - v : v, nv = cw ? u : 1 - u;
            return { x: a.x0 + nu * (a.x1 - a.x0), y: a.y0 + nv * (a.y1 - a.y0) };
        };
        for (const o of [this.player, ...this.items, ...this.obstacles]) {
            if (o.sweep) { o.sweep.a = map(o.sweep.a); o.sweep.b = map(o.sweep.b); }
            if (o.vel) { const vx = o.vel.x; o.vel.x = cw ? -o.vel.y : o.vel.y; o.vel.y = cw ? vx : -vx; }
            const p = map(o);
            o.setPosition(p.x, p.y).setDepth(p.y);
        }
        if (this.spots) this.spots = this.spots.map(map);
        if (this.move) {
            const mv = this.move, ux = mv.ux;
            if (cw) { mv.ux = -mv.uy; mv.uy = ux; } else { mv.ux = mv.uy; mv.uy = -ux; }
            if (mv.toWall) mv.left = this._toWall(this.player.x, this.player.y, mv.ux, mv.uy);
        }
        this.floor.destroy();
        this._drawFloor();
    }

    _revealField(spots) {
        const M = CONFIG.MERGE;
        this._spawnTimer = null;
        this.spawning = false;
        for (const o of [...this.items, ...this.obstacles]) {
            o.setVisible(true).setScale(0);
            this.tweens.add({ targets: o, scale: 1, duration: M.SPAWN_POP_MS || 300, ease: 'Back.easeOut' });
        }
        // Movers are only those whose sweep keeps clear of every piece's spot —
        // the player's spawn (no death before the first touch) and each NPC's,
        // which stays put until merged.
        let movers = M.OBSTACLE_MOVERS || 0;
        for (const o of this.obstacles.slice().sort(() => Math.random() - 0.5)) {
            if (movers > 0 && this._sweep(o, spots)) movers--;
        }
    }

    _clearLevel() {
        if (this._spawnTimer) { this._spawnTimer.remove(); this._spawnTimer = null; }
        if (this.player) this.tweens.killTweensOf(this.player.img);
        for (const o of [this.floor, this.player, ...(this.items || []), ...(this.obstacles || [])]) {
            if (!o) continue;
            this.tweens.killTweensOf(o);
            if (o.sweep) this.tweens.killTweensOf(o.sweep);
            o.destroy();
        }
        this.floor = this.player = null;
        this.items = [];
        this.obstacles = [];
    }

    // 2.5D ON A FLAT STAGE: a checker floor, walls round it, and a front face
    // on the top wall so the floor reads as sunk below it. Pieces stand on
    // their feet and sort by y (depth = y), so nearer ones overlap farther ones.
    _drawFloor() {
        const M = CONFIG.MERGE, a = this.arena;
        const g = this.floor = this.add.graphics().setDepth(-1e6);
        // Wall well past the arena, so a taller screen shows more wall, not a gap.
        g.fillStyle(hexColor(M.WALL_COLOR), 1).fillRect(-2000, -2000, this.world.W + 4000, this.world.H + 4000);
        const c0 = hexColor(M.FLOOR_COLORS[0]), c1 = hexColor(M.FLOOR_COLORS[1]), T = M.TILE;
        for (let y = a.y0, r = 0; y < a.y1; y += T, r++) {
            for (let x = a.x0, c = 0; x < a.x1; x += T, c++) {
                g.fillStyle((r + c) % 2 ? c1 : c0, 1)
                 .fillRect(x, y, Math.min(T, a.x1 - x), Math.min(T, a.y1 - y));
            }
        }
        g.fillStyle(hexColor(M.WALL_FACE_COLOR), 1).fillRect(a.x0, a.y0 - M.WALL_FACE, a.x1 - a.x0, M.WALL_FACE);
    }

    // Spread out at random; the first spot is the player's.
    _pickSpots(n) {
        const M = CONFIG.MERGE, a = this.arena, m = M.SPAWN_MARGIN;
        const out = [];
        for (let tries = 0; out.length < n && tries < 5000; tries++) {
            // Loosen the gap if the field is too crowded to honour it.
            const gap = M.MIN_GAP * Math.max(0.3, 1 - tries / 5000);
            const p = { x: Phaser.Math.Between(a.x0 + m, a.x1 - m), y: Phaser.Math.Between(a.y0 + m, a.y1 - m) };
            if (out.every((q) => Math.hypot(p.x - q.x, p.y - q.y) >= gap)) out.push(p);
        }
        return out;
    }

    // A PIECE: a container standing on its feet at (x, y) — shadow, art, label.
    _makePiece(x, y, level) {
        const M = CONFIG.MERGE;
        const shadow = this.add.graphics();
        shadow.fillStyle(0x000000, 0.35).fillEllipse(0, 0, 420 * M.SCALE, 130 * M.SCALE);
        const img = this.add.image(0, 0, pieceKey(level)).setOrigin(0.5, 1);
        const label = this.add.text(0, M.LABEL_GAP, '', {
            fontSize: M.LABEL_SIZE, fontFamily: CONFIG.FONT_FAMILY, fontStyle: CONFIG.FONT_WEIGHT,
            color: '#ffffff', stroke: '#000000', strokeThickness: 6,
        }).setOrigin(0.5, 0);
        const c = this.add.container(x, y, [shadow, img, label]).setDepth(y);
        c.img = img; c.label = label;
        this._setLevel(c, level);
        return c;
    }

    _setLevel(c, level) {
        const M = CONFIG.MERGE;
        c.level = level;
        c.img.setScale(M.SCALE * (1 + M.GROW * (level - 1)));
        c.img.setTexture(pieceKey(level));
        c.label.setText(`LV ${level}`);
    }

    // THE PIECE YOU STEER BREATHES, so it stands out from the rest. On the art
    // itself, restarted from the new size after every merge; the merge pop and
    // the wall bump play on the container, so they do not fight it.
    _pulse() {
        const M = CONFIG.MERGE, img = this.player.img;
        this.tweens.killTweensOf(img);   // a hop cut short by a merge is dropped too
        img.y = 0; img.hopping = false;
        this._setLevel(this.player, this.player.level);   // back to the level's own scale
        // Over the head at its tallest, so the pulse never reaches it.
        const top = img.displayHeight * (M.PULSE || 1.12);
        this.player.pointer.y = -top - (M.POINTER_GAP || 12) - (M.POINTER_SIZE || 30) * 0.85;
        this.tweens.add({ targets: img, scale: img.scale * (M.PULSE || 1.12), duration: M.PULSE_MS || 450,
            yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    }

    // A TAP sets a direction. The run goes on until something stops it.
    _onTap(p) {
        if (this.isWatchingAd || this.gamePaused) return;
        if (this.over) {
            if (this.over.ready && this.time.now - this.over.at > 500) this._buildLevel();
            return;
        }
        if (!this.player || this.spawning) return;   // a tap mid-run simply re-aims it from where it is
        const M = CONFIG.MERGE;
        const px = this.player.x, py = this.player.y;
        // A TAP ON THE PLAYER ITSELF does nothing. Tapping the piece you mean
        // to steer gives a direction you did not choose — a few px off its feet
        // either way — so a circle round the body's middle ignores taps.
        const bodyY = py - this.player.img.displayHeight / 2;
        if (Math.hypot(p.worldX - px, p.worldY - bodyY) < (M.TAP_DEAD_RADIUS || 0)) return;
        const dx = p.worldX - px, dy = p.worldY - py, len = Math.hypot(dx, dy);
        if (len < 5) return;
        const ux = dx / len, uy = dy / len;
        let left = this._toWall(px, py, ux, uy), toWall = true;
        if (M.STOP_AT_TAP && len < left) { left = len; toWall = false; }
        this.move = { ux, uy, left, toWall };
        this._idleFor = 0;
        this._tapRing(p.worldX, p.worldY);
    }

    // Distance along the line to the wall, feet kept HIT_RADIUS off it.
    _toWall(px, py, ux, uy) {
        const a = this.arena, r = CONFIG.MERGE.HIT_RADIUS;
        const tx = ux > 0 ? (a.x1 - r - px) / ux : ux < 0 ? (a.x0 + r - px) / ux : Infinity;
        const ty = uy > 0 ? (a.y1 - r - py) / uy : uy < 0 ? (a.y0 + r - py) / uy : Infinity;
        return Math.max(0, Math.min(tx, ty));
    }

    _tapRing(x, y) {
        const g = this.add.graphics({ x, y }).setDepth(-1e5);
        g.lineStyle(6, 0xffffff, 0.8).strokeCircle(0, 0, 40);
        this.tweens.add({ targets: g, scale: 1.6, alpha: 0, duration: 350, onComplete: () => g.destroy() });
    }

    // IN SMALL STEPS, so a fast piece cannot pass through another in one frame.
    _stepMove(delta) {
        const M = CONFIG.MERGE, mv = this.move, pl = this.player;
        let dist = Math.min(mv.left, M.SPEED * delta / 1000);
        mv.left -= dist;
        const stepMax = M.HIT_RADIUS / 2;
        while (dist > 0) {
            const s = Math.min(stepMax, dist);
            dist -= s;
            pl.x += mv.ux * s; pl.y += mv.uy * s;
            const hit = this.items.find((it) => Math.hypot(it.x - pl.x, it.y - pl.y) < M.HIT_RADIUS * 2);
            if (hit) { pl.setDepth(pl.y); this.move = null; this._contact(hit); return; }
            const spike = this._spikeAt(pl);
            if (spike) { pl.setDepth(pl.y); this.move = null; this._lose(spike, 'Hit a spike'); return; }
        }
        pl.setDepth(pl.y);
        if (mv.left <= 0) {
            this.move = null;
            if (mv.toWall) this.tweens.add({ targets: pl, scaleY: 0.85, duration: 70, yoyo: true });
        }
    }

    _contact(it) {
        const pl = this.player;
        if (it.level !== pl.level) { this._lose(it); return; }
        // MERGE: the pair becomes one piece of the next level, where the other stood.
        this.items.splice(this.items.indexOf(it), 1);
        pl.setPosition(it.x, it.y).setDepth(it.y);
        it.destroy();
        pl.level++;
        this._pulse();
        this.tweens.add({ targets: pl, scale: 1.25, duration: 110, yoyo: true, ease: 'Quad.easeOut' });
        if (!this.items.length) this._win();
        else this._setMessage(null);
    }

    // WHERE THE SPIKES GO. Most along the legs of the merge route — the order
    // the pieces have to be taken in, by level — so the direct line is blocked;
    // the rest anywhere. Never on a piece, and never so close together that
    // they wall a gap off.
    _obstacleSpots(spots, levels) {
        const M = CONFIG.MERGE, a = this.arena, m = M.OBSTACLE_RADIUS + M.WALL;
        const n = M.OBSTACLES || 0;
        const route = [spots[0], ...levels.map((lv, i) => ({ lv, p: spots[i + 1] }))
            .sort((x, y) => x.lv - y.lv).map((e) => e.p)];
        const onPath = Math.round(n * (M.OBSTACLE_ON_PATH !== undefined ? M.OBSTACLE_ON_PATH : 0.7));
        const out = [];
        const fits = (p) => p.x > a.x0 + m && p.x < a.x1 - m && p.y > a.y0 + m && p.y < a.y1 - m &&
            spots.every((q) => Math.hypot(p.x - q.x, p.y - q.y) >= M.OBSTACLE_CLEAR) &&
            out.every((q) => Math.hypot(p.x - q.x, p.y - q.y) >= M.OBSTACLE_GAP);
        for (let tries = 0; out.length < n && tries < 4000; tries++) {
            let p;
            if (out.length < onPath && route.length > 1) {
                const leg = Phaser.Math.Between(0, route.length - 2);
                const s = route[leg], e = route[leg + 1];
                const t = Phaser.Math.FloatBetween(0.2, 0.8);
                const len = Math.hypot(e.x - s.x, e.y - s.y) || 1;
                const off = Phaser.Math.FloatBetween(-M.OBSTACLE_SPREAD, M.OBSTACLE_SPREAD);
                p = { x: s.x + (e.x - s.x) * t - (e.y - s.y) / len * off,
                      y: s.y + (e.y - s.y) * t + (e.x - s.x) / len * off };
            } else {
                p = { x: Phaser.Math.Between(a.x0 + m, a.x1 - m), y: Phaser.Math.Between(a.y0 + m, a.y1 - m) };
            }
            if (fits(p)) out.push(p);
        }
        return out;
    }

    // A SPIKE BALL: drawn, not art. Steer round it — touching it is death.
    _makeObstacle(x, y) {
        const r = CONFIG.MERGE.OBSTACLE_RADIUS, n = 10, pts = [];
        for (let i = 0; i < n * 2; i++) {
            const a = (i / (n * 2)) * Math.PI * 2, d = i % 2 ? r * 0.7 : r * 1.25;
            pts.push({ x: Math.cos(a) * d, y: Math.sin(a) * d - r });
        }
        const g = this.add.graphics({ x, y }).setDepth(y);
        g.fillStyle(0x000000, 0.35).fillEllipse(0, 0, r * 2.2, r * 0.7);
        g.fillStyle(0x8a1020, 1).fillPoints(pts, true);
        g.fillStyle(0xff3b4a, 1).fillCircle(0, -r, r * 0.72);
        g.fillStyle(0xffffff, 0.5).fillCircle(-r * 0.25, -r * 1.25, r * 0.2);
        return g;
    }

    // TO AND FRO about its home, across or up and down at random, kept inside
    // the walls. Looping, so it never holds a relayout back. False (and left
    // still) if neither way keeps its whole sweep OBSTACLE_CLEAR off every
    // point in `safe`.
    _sweep(o, safe) {
        const M = CONFIG.MERGE, a = this.arena, m = M.OBSTACLE_RADIUS + M.WALL;
        const first = Math.random() < 0.5;
        let k, from, to;
        for (const across of [first, !first]) {
            k = across ? 'x' : 'y';
            const lo = across ? a.x0 + m : a.y0 + m, hi = across ? a.x1 - m : a.y1 - m;
            from = Math.max(lo, o[k] - M.OBSTACLE_SWEEP); to = Math.min(hi, o[k] + M.OBSTACLE_SWEEP);
            // Nearest point of the sweep to each safe spot.
            const clear = safe.every((p) => {
                const near = Math.max(from, Math.min(to, p[k]));
                const dx = across ? near - p.x : o.x - p.x, dy = across ? o.y - p.y : near - p.y;
                return Math.hypot(dx, dy) >= M.OBSTACLE_CLEAR;
            });
            if (clear) break;
            k = null;
        }
        if (!k) return false;
        // BETWEEN TWO POINTS, a to b, rather than along one axis: a turn of the
        // field (_rotateField) just moves the points and the sweep runs on.
        const sw = o.sweep = { a: { x: o.x, y: o.y }, b: { x: o.x, y: o.y }, t: 0 };
        sw.a[k] = from; sw.b[k] = to;
        o.setPosition(sw.a.x, sw.a.y).setDepth(sw.a.y);
        this.tweens.add({ targets: sw, t: 1, duration: M.OBSTACLE_SWEEP_MS, yoyo: true, repeat: -1,
            ease: 'Sine.easeInOut', delay: Phaser.Math.Between(0, M.OBSTACLE_SWEEP_MS),
            onUpdate: () => {
                o.setPosition(sw.a.x + (sw.b.x - sw.a.x) * sw.t, sw.a.y + (sw.b.y - sw.a.y) * sw.t);
                o.setDepth(o.y);
            } });
        return true;
    }

    // STANDING STILL, the player hops every so often — one more way to tell
    // the piece you steer from the rest. The art only; the shadow stays down.
    _idleHop(delta) {
        const M = CONFIG.MERGE, img = this.player.img;
        if (img.hopping) return;
        this._idleFor = (this._idleFor || 0) + delta;
        if (this._idleFor < (M.IDLE_HOP_EVERY_MS || 1500)) return;
        this._idleFor = 0;
        img.hopping = true;
        this.tweens.add({ targets: img, y: -(M.IDLE_HOP_HEIGHT || 22), duration: M.IDLE_HOP_MS || 180,
            ease: 'Quad.easeOut', yoyo: true, onComplete: () => { img.y = 0; img.hopping = false; } });
    }

    // THE NPCS WANDER, so the player has to chase them: a straight line at
    // NPC_SPEED, a new heading now and then, bouncing off the walls and
    // turning away from each other so two never stack up.
    _stepNpcs(delta) {
        const M = CONFIG.MERGE, a = this.arena, r = M.NPC_WALL_GAP || 60;
        const s = (M.NPC_SPEED || 140) * delta / 1000;
        for (const it of this.items) {
            it.turnIn = (it.turnIn || 0) - delta;
            if (!it.vel || it.turnIn <= 0) this._npcTurn(it);
            for (const o of this.items) {
                if (o === it) continue;
                const dx = it.x - o.x, dy = it.y - o.y, d = Math.hypot(dx, dy);
                if (d > 0 && d < (M.NPC_GAP || 160)) { it.vel.x = dx / d; it.vel.y = dy / d; }
            }
            it.x += it.vel.x * s; it.y += it.vel.y * s;
            if (it.x < a.x0 + r) { it.x = a.x0 + r; it.vel.x = Math.abs(it.vel.x); }
            if (it.x > a.x1 - r) { it.x = a.x1 - r; it.vel.x = -Math.abs(it.vel.x); }
            if (it.y < a.y0 + r) { it.y = a.y0 + r; it.vel.y = Math.abs(it.vel.y); }
            if (it.y > a.y1 - r) { it.y = a.y1 - r; it.vel.y = -Math.abs(it.vel.y); }
            it.setDepth(it.y);
        }
    }

    _npcTurn(it) {
        const M = CONFIG.MERGE, ang = Math.random() * Math.PI * 2;
        it.vel = { x: Math.cos(ang), y: Math.sin(ang) };
        it.turnIn = Phaser.Math.Between(M.NPC_TURN_MIN_MS || 1200, M.NPC_TURN_MAX_MS || 2800);
    }

    // A spike touching the player — checked every frame, since a sweeping one
    // can run into a player standing still.
    _spikeAt(pl) {
        const M = CONFIG.MERGE;
        return this.obstacles.find((o) => Math.hypot(o.x - pl.x, o.y - pl.y) < M.HIT_RADIUS + M.OBSTACLE_RADIUS);
    }

    // A LOSS BLINKS RED FIRST, so you see what killed you before the pane
    // covers it. Taps are ignored until the pane is up (over.ready).
    _lose(it, why) {
        const M = CONFIG.MERGE, pl = this.player;
        this.over = { at: this.time.now, won: false, ready: false };
        this.tweens.killTweensOf(pl.img);   // stop the breathing and hopping
        this.tweens.add({ targets: it, scale: 1.15, duration: 120, yoyo: true });
        const red = hexColor(M.LOSE_BLINK_COLOR || '#ff2a2a'), n = M.LOSE_BLINKS || 6;
        this.tweens.add({
            targets: { t: 0 }, t: 1, duration: M.LOSE_BLINK_MS || 1500,
            onUpdate: (tw, o) => {
                if (Math.floor(o.t * n * 2) % 2 === 0) pl.img.setTintFill(red);
                else pl.img.clearTint();
            },
            onComplete: () => {
                pl.img.clearTint();
                this.tweens.add({ targets: pl, scale: 0, alpha: 0, angle: 180, duration: 350, ease: 'Back.easeIn' });
                this.over.at = this.time.now;
                this.over.ready = true;
                this._setMessage({ title: 'GAME OVER', sub: `${why || `LV ${pl.level} hit LV ${it.level}`} — tap to retry`, color: '#ff5a5a' });
            },
        });
    }

    _win() {
        this.over = { at: this.time.now, won: true, ready: true };
        this._setMessage({ title: `LV ${this.player.level}!`, sub: 'All merged — tap to play again', color: '#ffe066' });
    }

    _setMessage(msg) {
        this.msg = msg;
        if (this.layoutConfig) { if (this.hud) this.hud.destroy(); this._buildHud(); }
    }

    // THE HUD sits on the screen, not the world (scroll factor 0), and is
    // rebuilt by layout() on a reshape.
    _buildHud() {
        const M = CONFIG.MERGE, L = this.layoutConfig;
        const style = (size, color) => ({ fontSize: size, fontFamily: CONFIG.FONT_FAMILY, fontStyle: CONFIG.FONT_WEIGHT,
            color, stroke: '#000000', strokeThickness: 10, align: 'center' });
        const parts = [this.add.text(40, 30, `Merge everything into LV ${M.MAX_LEVEL}`, style(M.HUD_SIZE, '#ffffff'))];
        if (this.msg) {
            parts.push(this.add.rectangle(L.cx, L.cy, L.W, L.H, 0x000000, 0.45));
            parts.push(this.add.text(L.cx, L.cy - 20, this.msg.title, style(M.MSG_SIZE, this.msg.color)).setOrigin(0.5, 1));
            parts.push(this.add.text(L.cx, L.cy + 10, this.msg.sub, style(M.HUD_SIZE, '#ffffff')).setOrigin(0.5, 0));
        }
        this.hud = this.add.container(0, 0, parts).setScrollFactor(0).setDepth(1e7);
    }

    // ================================================================
    // UPDATE
    // ================================================================
    update(time, delta) {
        if (!this._firstFrameMarked) { this._firstFrameMarked = true; loadMark('first frame — create() finished'); }
        if (this.gamePaused) return;
        this._pollStage();
        if (this._relayoutPending) {
            const why = this._unsettledBy();
            if (why !== this._waitWhy) { this._waitWhy = why; if (why) stageLog(`relayout waiting: ${why}`); }
            if (!why) { this._fastForward(false); this._relayout(); }
            else this._fastForward(true);
        } else {
            this._fastForward(false);   // reshaped back before it ran
        }
        if (this.player && !this.over && !this.spawning) this._stepNpcs(delta);
        if (this.move) this._stepMove(delta);
        else if (this.player && !this.over) {
            const M = CONFIG.MERGE, pl = this.player;
            const spike = !this.spawning && this._spikeAt(pl);
            // AN NPC WALKING INTO A PLAYER standing still counts as contact too.
            const npc = !this.spawning && this.items.find((it) => Math.hypot(it.x - pl.x, it.y - pl.y) < M.HIT_RADIUS * 2);
            if (spike) this._lose(spike, 'Hit a spike');
            else if (npc) this._contact(npc);
            else this._idleHop(delta);
        }
    }
}

// ================================================================
// PHASER CONFIG + BOOT
// ================================================================
// [stage] console lines — CONFIG.DEBUG_STAGE.
function stageLog(msg) {
    if (typeof CONFIG !== 'undefined' && CONFIG.DEBUG_STAGE) console.log(`[stage] ${msg}`);
}

// ── THE STAGE ──────────────────────────────────────────────────────────────
// One fixed render width, scaled by the browser to fill whatever window it
// lands in. The height is taken from the window's shape — at boot, and again
// when it changes shape enough (STAGE.RESHAPE_TOLERANCE — see _pollStage).
// That does not restart anything: the scene takes the new size and re-lays
// itself out in place (see _relayout). A smaller resize is just the browser
// scaling this stage.
//
// PORTRAIT is the same rule turned: the long side is W, the short side from
// the window's shape, within the same clamps.
function pickStage() {
    const S = (typeof CONFIG !== 'undefined' && CONFIG.STAGE) || {};
    const W = S.W || 1920;
    const winW = window.innerWidth  || 1280;
    const winH = window.innerHeight || 720;
    const portrait = S.PORTRAIT !== false && winH > winW;
    let short = S.H || 1080;
    if (S.DERIVE_HEIGHT !== false) {
        const shape = portrait ? winW / winH : winH / winW;
        const ratio = Math.min(Math.max(shape, S.MIN_RATIO || 0.3), S.MAX_RATIO || 3);
        short = Math.round(W * ratio);
    }
    return portrait ? { width: short, height: W } : { width: W, height: short };
}

// A LEVEL'S ART: there are fewer pictures than levels, so they repeat in turn.
function pieceKey(level) {
    const n = CONFIG.MERGE.PIECE_ART || 6;
    return `piece${(level - 1) % n + 1}`;
}

// HOW FAR THE SCREEN IS TURNED from its natural way up, degrees, counter-
// clockwise; null where the browser does not say (most desktops).
function screenAngle() {
    try {
        if (screen.orientation && typeof screen.orientation.angle === 'number') return screen.orientation.angle;
    } catch (e) { /* not available */ }
    return typeof window.orientation === 'number' ? (window.orientation + 360) % 360 : null;
}
const STAGE = pickStage();
stageLog(`boot: frame ${window.innerWidth} x ${window.innerHeight} -> stage ${STAGE.width} x ${STAGE.height}`);

const GAME_WIDTH  = STAGE.width;
const GAME_HEIGHT = STAGE.height;

const config = {
    type: Phaser.AUTO,
    parent: 'game-container',
    // The canvas's own clear colour — matched to the page behind it so the
    // two cannot be told apart.
    backgroundColor: CONFIG.BACKGROUND_COLOR,
    scene: [GameScene],
    scale: {
        // FIT/ENVELOP means Phaser owns the canvas's DISPLAY size and keeps it
        // in step with the window on its own — no resize listener of ours, and
        // no restart. The game's own coordinate space stays GAME_WIDTH x
        // GAME_HEIGHT until a relayout changes it.
        mode: (Phaser.Scale[(CONFIG.STAGE || {}).MODE] || Phaser.Scale.FIT),
        autoCenter: Phaser.Scale.CENTER_BOTH,   // bars split evenly, not all on one side
        width:  GAME_WIDTH,
        height: GAME_HEIGHT,
        expandParent: true,
    },
    render: { antialias: true, pixelArt: false, roundPixels: false },
    // HOW MANY FILES DOWNLOAD AT ONCE. Phaser's own default is 32 — except on
    // Android, where it drops to 6. Poki's Inspector reports itself as an
    // Android phone, so a server slow to answer each file turned the opening
    // load into queues. Set here, it is 32 everywhere.
    //
    // IMAGES AS PLAIN <img> LOADS, not XHR. The build's index.html carries
    // <link rel="preload" as="image"> hints, and the browser only hands that
    // early download to a request of the SAME kind — an image load,
    // CORS-anonymous. Phaser's default XHR fetch would download every hinted
    // image a second time.
    loader: { maxParallelDownloads: 32, imageLoadType: 'HTMLImageElement', crossOrigin: 'anonymous' },
};

// The font has to be IN HAND before the game starts, not merely declared.
// Phaser renders each Text into its own canvas texture the moment it is created
// and never re-renders it, so a label built before the font arrives keeps the
// fallback for the life of the scene. document.fonts.load() both triggers the
// fetch and tells us when it is done.
//
// It resolves rather than rejects on failure: a missing font is not a reason
// to withhold the game.
function waitForFont() {
    if (!document.fonts || !document.fonts.load) return Promise.resolve();
    const f = (CONFIG.FONT_FAMILY || '').split(',')[0].trim();
    if (!f) return Promise.resolve();
    return document.fonts.load(`${CONFIG.FONT_WEIGHT || '600'} 16px ${f}`)
        .catch(() => {})
        .then(() => document.fonts.ready)
        .catch(() => {});
}

// ── Load timing ──────────────────────────────────────────────────────────────
// Where the time before play goes, stage by stage, printed as [timing] lines.
// performance.now() counts from the moment the page was opened, so each mark's
// first number is "ms since page open" — the same clock Poki's loading time
// runs on. The "+" figure is the gap since the mark before.
const loadMarks = [];
function loadMark(label) {
    if (!CONFIG.DEBUG_LOAD_TIMING || typeof performance === 'undefined') return;
    const t = Math.round(performance.now());
    const prev = loadMarks.length ? loadMarks[loadMarks.length - 1].t : 0;
    loadMarks.push({ label, t });
    console.log(`[timing] ${String(t).padStart(6)}ms  (+${t - prev}ms)  ${label}`);
}
// Once, when loading finishes: the page's own download, then the network
// requests that took longest. A request's time includes waiting its turn, so a
// long list of files all starting late points at queuing, not at size.
function loadTimingReport() {
    if (!CONFIG.DEBUG_LOAD_TIMING || typeof performance === 'undefined' || !performance.getEntriesByType) return;
    const nav = performance.getEntriesByType('navigation')[0];
    if (nav) {
        console.log(`[timing] page HTML: request sent at ${Math.round(nav.requestStart)}ms, ` +
            `downloaded by ${Math.round(nav.responseEnd)}ms, parsed by ${Math.round(nav.domContentLoadedEventEnd)}ms`);
    }
    const res = performance.getEntriesByType('resource');
    const short = (u) => String(u).split('?')[0].split('/').slice(-2).join('/');
    const kb = (r) => r.transferSize ? `${(r.transferSize / 1024).toFixed(0)}KB` : 'size n/a';
    console.log(`[timing] ${res.length} requests before loading finished. Slowest:`);
    for (const r of [...res].sort((a, b) => b.duration - a.duration).slice(0, 10)) {
        console.log(`[timing]    ${String(Math.round(r.duration)).padStart(5)}ms  ` +
            `from ${Math.round(r.startTime)}ms to ${Math.round(r.responseEnd)}ms  ${kb(r)}  ${short(r.name)}`);
    }
}

// The loading screen in index.html. The time before Phaser boots (font, Poki
// init) takes the first sliver of the bar; the asset loader fills the rest.
const LOAD_BOOT_SHARE  = 0.1;
const LOAD_PRELOAD_CAP = 0.85;   // the rest is create() building the view
let loadingScreenDone = false;
let loadingShown = 0;            // never goes back: a batch added mid-load grows
                                 // the total, which would otherwise pull it back
function setLoadingProgress(v) {
    if (loadingScreenDone || typeof window === 'undefined') return;
    // THE PAGE OWNS THE BAR (see the script in index.html): it starts moving on
    // the first paint, long before this file exists, and it refuses to go
    // backwards. Everything here is a request to move it forward.
    const bar = window.__loading;
    if (!bar) return;
    bar.set(Math.max(0, Math.min(1, v)));
    loadingShown = bar.value();
}
function finishLoadingScreen() {
    if (loadingScreenDone) return;
    loadMark('opening view built — LOADING FINISHED (this is what Poki times)');
    loadTimingReport();
    setLoadingProgress(1);
    loadingScreenDone = true;
    // gameplayStart waits for the player's FIRST INPUT, not the load — Poki's
    // rule. See the scene's first pointerdown (create) and pokiFirstInput.
    pokiCall('gameLoadingFinished');
    const screen = typeof document !== 'undefined' && document.getElementById('loading-screen');
    if (!screen) return;
    // A beat at 100% before fading, so the full bar is actually seen — create()
    // blocks the page while it builds, and a fade started now would freeze.
    setTimeout(() => {
        screen.classList.add('done');
        setTimeout(() => screen.remove(), 500);
    }, 250);
}

// ── Poki SDK ─────────────────────────────────────────────────────────────────
// Every call goes through here, because the SDK is optional at runtime: an ad
// blocker removes it, and a page served anywhere but Poki may not have it. A
// missing or throwing SDK must never cost the player the game.
let pokiReady = false;
function pokiCall(fn) {
    if (!pokiReady) return;
    try { window.PokiSDK[fn](); } catch (e) { console.warn(`[poki] ${fn} failed`, e); }
}
// Start/stop are sent only on a real change, so a stray repeat from either
// side never reaches Poki as a double event.
let pokiPlaying = false;
function pokiGameplay(on) {
    if (pokiPlaying === on) return;
    pokiPlaying = on;
    pokiCall(on ? 'gameplayStart' : 'gameplayStop');
}
// The player's first input has happened — gameplayStart may be sent. Before
// it, nothing (not even the end of an ad) may start gameplay.
let pokiFirstInput = false;

// A REWARDED BREAK. Resolves true only if Poki says the ad was watched.
function pokiRewardedBreak() {
    if (!pokiReady) return Promise.resolve(false);
    try {
        return Promise.resolve(window.PokiSDK.rewardedBreak(() => {}))
            .then((ok) => !!ok).catch(() => false);
    } catch (e) { console.warn('[poki] rewardedBreak failed', e); return Promise.resolve(false); }
}

// ── The save, as stored ─────────────────────────────────────────────────────
// Bump SAVE_VERSION if the shape changes incompatibly: an older save is then
// ignored (a fresh start) rather than misread.
const SAVE_VERSION = 1;
function saveKey() { return ((typeof CONFIG !== 'undefined' && CONFIG.SAVE) || {}).KEY || 'mergeDash.save'; }

// The stored run — or null for a fresh start: none saved, loading switched
// off, storage blocked, or anything malformed. A bad save must never stop the
// game from starting. Check and tidy each field here as the save grows.
function readSave() {
    const S = (typeof CONFIG !== 'undefined' && CONFIG.SAVE) || {};
    if (S.ENABLED === false || S.LOAD === false) return null;
    try {
        // ?newgame in the page's address wipes the save — a fresh run to test.
        if (typeof location !== 'undefined' && /[?&]newgame\b/.test(location.search)) {
            localStorage.removeItem(saveKey());
            return null;
        }
        const raw = localStorage.getItem(saveKey());
        if (!raw) return null;
        const d = JSON.parse(raw);
        if (!d || d.v !== SAVE_VERSION) return null;
        return d;
    } catch (e) {
        return null;
    }
}

// Running on the developer's own machine — where the mock ad stands in.
function isLocalDev() {
    if (typeof location === 'undefined') return false;
    return location.protocol === 'file:' || /^(localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0)$/.test(location.hostname);
}

// THE PARENT PAGE MUST NOT SCROLL under the game — arrow keys, space and the
// mouse wheel would otherwise scroll Poki's page around it. Poki's rule.
if (typeof window !== 'undefined') {
    window.addEventListener('keydown', (ev) => {
        if (['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', ' '].includes(ev.key)) ev.preventDefault();
    });
    window.addEventListener('wheel', (ev) => ev.preventDefault(), { passive: false });
}

// Resolves either way. The timeout is there so a hung init can never hold the
// game on the loading screen — Poki would rather lose a metric than a player.
function initPoki() {
    if (typeof window === 'undefined' || !window.PokiSDK) {
        console.warn('[poki] SDK not present — running without it');
        loadMark('Poki SDK not present');
        return Promise.resolve();
    }
    let settled = false;
    const init = window.PokiSDK.init()
        .then(() => { pokiReady = true; loadMark('Poki SDK ready'); })
        .catch((e) => { console.warn('[poki] init failed — running without it', e); loadMark('Poki SDK init FAILED'); })
        .finally(() => { settled = true; });
    const cap = new Promise((r) => setTimeout(() => {
        if (!settled) loadMark('Poki SDK still not ready after 4000ms — TIMED OUT, carrying on');
        r();
    }, 4000));
    return Promise.race([init, cap]);
}

if (typeof window !== 'undefined') {
    loadMark('game script running (page, Phaser and Poki SDK scripts are in)');
    setLoadingProgress(LOAD_BOOT_SHARE * 0.4);
    Promise.all([
        waitForFont().then(() => loadMark('font ready')),
        initPoki(),
    ]).then(() => {
        loadMark('boot checks done — starting Phaser');
        setLoadingProgress(LOAD_BOOT_SHARE);
        new Phaser.Game(config);
    });
}
