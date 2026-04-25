import { WakeRipple } from './WakeRipple.js';
import { WakeStamp } from './WakeStamp.js';
import { WaterManager } from './WaterManager.js';
import { WakeTuning } from './WakeTuning.js';
import { WakeTuningDialog } from './WakeTuningDialog.js';

const MODULE_ID = 'ionrift-waterline';
const LOG = (...args) => { try { if (game.settings?.get?.(MODULE_ID, 'debug')) console.log('Waterline | Wake |', ...args); } catch { /* setting not yet registered */ } };

/**
 * Velocity smoother state per token.
 * @typedef {{ vx: number, vy: number, lastStampX: number, lastStampY: number }} VelState
 */

/**
 * Tracks token movement and emits wake effects when tokens move through water.
 * Purely visual, client-local -- no persisted data.
 *
 * Wake (V-chevron) strategy:
 *   – Smoothed EMA velocity drives a unit direction vector.
 *   – Bow anchor = token leading edge (center + dir × halfSize).
 *   – A new WakeStamp is deposited every `wakeStampIntervalPx` pixels of movement.
 *   – Up to `wakeStampPoolMax` (≤ 4) stamps feed 4 shader stamp slots (uWake0–uWake7).
 *
 * Ripple strategy unchanged.
 */
export class WakeManager {

    /** @type {WakeRipple[]} Active ripple pool (wakeStyle === 'ripple') */
    static #ripples = [];

    /** @type {WakeStamp[]} Active V-wake stamps (wakeStyle === 'wake') */
    static #stamps = [];

    /** @type {Map<string, {x: number, y: number}>} Last known token centers */
    static #lastPositions = new Map();

    /** @type {Map<string, boolean|null>} Per-token last-known wet state (debug) */
    static #lastWet = new Map();

    /**
     * Per-token velocity state for EMA smoothing and stamp interval tracking.
     * @type {Map<string, VelState>}
     */
    static #velState = new Map();

    /**
     * Per-token countdown (seconds) until next idle ripple for stationary wet tokens.
     * Absent = timer not yet started for this token.
     * @type {Map<string, number>}
     */
    static #idleTimers = new Map();

    /** Epsilon (px): treat smaller center deltas as "no move" */
    static #POS_EPS = 0.5;

    /** @type {Function|null} Ticker callback */
    static #tickerFn = null;

    /** Reused buffer for water shader (8 vec4 = 32 floats) */
    static #wakeBuf = new Float32Array(32);

    /** Sprite overlay for sprites / both preview modes */
    static #spriteLayer = null;

    // -------------------------------------------------------------------------
    // Init / Destroy
    // -------------------------------------------------------------------------

    static init() {
        WakeManager.destroy();

        WakeManager.#tickerFn = (delta) => {
            WakeManager.#tick((1 / 60) * delta);
        };
        canvas.app.ticker.add(WakeManager.#tickerFn);

        WakeManager.#snapshotPositions();
        WakeManager.#syncWetFromPositions();

        game.ionrift ??= {};
        game.ionrift.wake = {
            help: () => {
                console.log(`
Token wake (client):
  game.ionrift.wake.enabled          - read whether wakes are on
  game.ionrift.wake.setEnabled(b)   - enable/disable
  game.ionrift.wake.setDebugLog(b)  - toggle debug flag (also available in module settings)
  game.ionrift.wake.openTuning()    - GM: open wake tuning panel
  (wakeStyle in panel: ripple vs wake (V-chevron))
`);
            },
            get enabled() {
                return game.settings.get(MODULE_ID, 'enableTokenWake');
            },
            setEnabled: (b) => {
                void game.settings.set(MODULE_ID, 'enableTokenWake', Boolean(b));
                LOG(`enableTokenWake = ${Boolean(b)}`);
            },
            get debugLog() {
                return game.settings.get(MODULE_ID, 'debug');
            },
            setDebugLog: (b) => {
                void game.settings.set(MODULE_ID, 'debug', Boolean(b));
                LOG(`debug = ${Boolean(b)}`);
            },
            openTuning: () => WakeTuningDialog.show()
        };
        LOG('Initialized (game.ionrift.wake.help())');
        WakeManager.onWakeTuningChanged();
    }

    /** Create/destroy sprite layer when preview mode changes. */
    static onWakeTuningChanged() {
        if (typeof canvas === 'undefined' || !canvas?.ready) return;
        const tu = WakeTuning.get();
        const needSprites = tu.visualMode === 'sprites' || tu.visualMode === 'both';
        if (needSprites && !WakeManager.#spriteLayer) {
            WakeManager.#spriteLayer = new PIXI.Container();
            WakeManager.#spriteLayer.name = 'wake-sprite-preview';
            WakeManager.#spriteLayer.eventMode = 'none';
            const layer = canvas.primary ?? canvas.effects ?? canvas.interface ?? canvas.stage;
            layer.addChild(WakeManager.#spriteLayer);
        } else if (!needSprites && WakeManager.#spriteLayer) {
            for (const r of WakeManager.#ripples) r.clearSpriteDrawing?.();
            for (const s of WakeManager.#stamps)  s.clearSpriteDrawing?.();
            if (WakeManager.#spriteLayer.parent) {
                WakeManager.#spriteLayer.parent.removeChild(WakeManager.#spriteLayer);
            }
            WakeManager.#spriteLayer.destroy({ children: true });
            WakeManager.#spriteLayer = null;
        }
    }

    // -------------------------------------------------------------------------
    // Token hooks
    // -------------------------------------------------------------------------

    /**
     * Called from the updateToken hook.
     *
     * For the WAKE (V-chevron) style we deliberately do NOT update lastPositions
     * or deposit stamps here -- Foundry's grid-step animation means the token
     * visually slides from old->new over many frames, while the document is
     * already at "new". refreshToken handles wake stamping at the actual
     * rendered position so direction and bow placement match what the user sees.
     *
     * For the RIPPLE style we keep the original grid-snap behaviour.
     *
     * @param {TokenDocument} tokenDoc
     * @param {object} changes
     */
    static onTokenUpdate(tokenDoc, changes) {
        const placeable = tokenDoc.object;
        if (!placeable) return;

        const tokenId = tokenDoc.id ?? tokenDoc._id;
        const c = WakeManager.#placeableCenter(placeable);
        if (!c) return;
        const { x: newX, y: newY } = c;

        const inWater = WaterManager.isPointInWater(newX, newY);
        WakeManager.#debugWetChange(tokenId, inWater, 'updateToken');

        if (!game.settings.get(MODULE_ID, 'enableTokenWake')) return;

        // Elevated (flying) tokens leave no water wake
        if ((tokenDoc.elevation ?? 0) > 0) return;

        // Per-token opt-out flag (set in Token Config > Identity)
        if (tokenDoc.getFlag?.(MODULE_ID, 'noRipple')) return;

        const tu = WakeTuning.get();

        // Wake (V) style: defer entirely to refreshToken (animation frames).
        if (tu.wakeStyle === 'wake') return;

        // --- Ripple strategy (grid-snap) ---
        const oldPos = WakeManager.#lastPositions.get(tokenId);
        if (oldPos) {
            if (Math.abs(newX - oldPos.x) < WakeManager.#POS_EPS
             && Math.abs(newY - oldPos.y) < WakeManager.#POS_EPS) return;
        } else if (!WakeManager.#changesMightMoveToken(changes)) {
            return;
        }

        WakeManager.#lastPositions.set(tokenId, { x: newX, y: newY });
        if (!inWater) return;

        const moveDist = oldPos ? Math.hypot(newX - oldPos.x, newY - oldPos.y) : 0;
        if (oldPos && moveDist < tu.minMoveDist) return;

        // Compute unit travel direction so the ripple can be nudged ahead
        let dirX = 0, dirY = 0;
        if (oldPos && moveDist > 0.5) {
            dirX = (newX - oldPos.x) / moveDist;
            dirY = (newY - oldPos.y) / moveDist;
        }

        const tokR = WakeManager.#tokenRadiusPx(placeable);
        WakeManager.#spawnRipple(newX, newY, { tokenId, dirX, dirY, tokenRadiusPx: tokR });

        if (oldPos && moveDist > tu.longMoveMidPx) {
            const midX = (oldPos.x + newX) / 2;
            const midY = (oldPos.y + newY) / 2;
            if (WaterManager.isPointInWater(midX, midY)) {
                WakeManager.#spawnRipple(midX, midY, { tokenId, dirX, dirY, tokenRadiusPx: tokR });
            }
        }
        LOG(`Ripple at (${newX.toFixed(0)}, ${newY.toFixed(0)}), dist=${moveDist.toFixed(0)}`);
    }

    /**
     * Called from refreshToken hook during animated movement (sub-grid ticks).
     *
     * Direction is the latest movement vector -- no EMA. The previous EMA
     * approach renormalised every frame which prevented direction reversal
     * (vx*0.55 + sample*0.45 always rounds back to the old sign once normalised).
     * For VTT motion the per-frame direction is already stable; tiny moves
     * below DIR_MIN_DIST keep the previous direction to avoid jitter.
     *
     * @param {Token} token
     */
    static onTokenRefresh(token) {
        if (!token) return;

        const tokenId = token.document?.id ?? token.id;
        const c = WakeManager.#placeableCenter(token);
        if (!c) return;
        const { x: cx, y: cy } = c;

        const inWater = WaterManager.isPointInWater(cx, cy);
        WakeManager.#debugWetChange(tokenId, inWater, 'refreshToken');

        if (!game.settings.get(MODULE_ID, 'enableTokenWake')) return;

        // Elevated (flying) tokens leave no water wake
        if ((token.document?.elevation ?? 0) > 0) return;

        // Per-token opt-out flag (set in Token Config > Identity)
        if (token.document?.getFlag?.(MODULE_ID, 'noRipple')) return;

        const oldPos = WakeManager.#lastPositions.get(tokenId);
        if (!oldPos) {
            WakeManager.#lastPositions.set(tokenId, { x: cx, y: cy });
            return;
        }

        const dx   = cx - oldPos.x;
        const dy   = cy - oldPos.y;
        const dist = Math.hypot(dx, dy);
        if (dist < 0.5) return; // jitter

        // Treat very large jumps as teleports -- reset state, no wake.
        const teleportThresh = (canvas.grid?.size ?? 100) * 6;
        if (dist > teleportThresh) {
            WakeManager.#lastPositions.set(tokenId, { x: cx, y: cy });
            const vs = WakeManager.#getVelState(tokenId);
            vs.vx = 0; vs.vy = 0;
            vs.lastStampX = NaN; vs.lastStampY = NaN;
            return;
        }

        const tu = WakeTuning.get();

        if (tu.wakeStyle === 'wake') {
            const vs = WakeManager.#getVelState(tokenId);
            // Update direction from latest motion (skip micro-jitter to keep direction stable)
            const DIR_MIN_DIST = 3;
            if (dist >= DIR_MIN_DIST) {
                vs.vx = dx / dist;
                vs.vy = dy / dist;
            }
            WakeManager.#lastPositions.set(tokenId, { x: cx, y: cy });

            if (!inWater) return;
            if (!WaterManager.isPointInWater(oldPos.x, oldPos.y)) return;
            WakeManager.#tryDepositStamp(tokenId, token, cx, cy, dist, tu);
            return;
        }

        // --- Ripple trail ---
        if (dist < tu.refreshMinDist || dist > tu.refreshMaxDist) {
            WakeManager.#lastPositions.set(tokenId, { x: cx, y: cy });
            return;
        }
        WakeManager.#lastPositions.set(tokenId, { x: cx, y: cy });
        if (!inWater) return;
        if (WakeManager.#rippleTooClose(cx, cy, tu.spawnCooldownPx, tokenId)) return;

        const dirX = dist > 0.5 ? dx / dist : 0;
        const dirY = dist > 0.5 ? dy / dist : 0;
        const tokR = WakeManager.#tokenRadiusPx(token);
        WakeManager.#spawnRipple(cx, cy, {
            tokenId,
            duration: tu.refreshDuration,
            baseAlpha: tu.refreshBaseAlpha,
            dirX,
            dirY,
            tokenRadiusPx: tokR
        });
    }

    // -------------------------------------------------------------------------
    // Wake (V-chevron) internals
    // -------------------------------------------------------------------------

    /** @returns {VelState} */
    static #getVelState(tokenId) {
        if (!WakeManager.#velState.has(tokenId)) {
            WakeManager.#velState.set(tokenId, { vx: 0, vy: 0, lastStampX: NaN, lastStampY: NaN });
        }
        return WakeManager.#velState.get(tokenId);
    }

    /**
     * Deposit a stamp if velocity direction is known and stamp interval is met.
     * @param {string} tokenId
     * @param {PIXI.Container} placeable
     * @param {number} cx  Current token center X
     * @param {number} cy  Current token center Y
     * @param {number} moveDist  Distance since last recorded position
     * @param {object} tu  Current tuning
     */
    static #tryDepositStamp(tokenId, placeable, cx, cy, moveDist, tu) {
        const vs = WakeManager.#getVelState(tokenId);

        const vl = Math.hypot(vs.vx, vs.vy);
        if (vl < 0.01) return;
        const dirX = vs.vx / vl; // ensure unit length
        const dirY = vs.vy / vl;

        const interval = Number(tu.wakeStampIntervalPx ?? 48);
        const sinceLastX = isNaN(vs.lastStampX)
            ? Infinity
            : Math.hypot(cx - vs.lastStampX, cy - vs.lastStampY);
        if (sinceLastX < interval) return;
        vs.lastStampX = cx;
        vs.lastStampY = cy;

        // Bow anchor = token leading edge in motion direction.
        // Token half-size from grid (width attribute × grid px ÷ 2).
        // NOTE: multi-width tokens scale the offset proportionally; this is
        // also where future per-token-size scaling could be tuned.
        const gridSize = canvas.grid?.size ?? 100;
        const tokenW   = placeable.document?.width ?? 1;
        const halfSize = tokenW * gridSize * 0.5;
        const bowX = cx + dirX * halfSize;
        const bowY = cy + dirY * halfSize;

        // Strength from move distance (faster moves = stronger stamp)
        const smin = Number(tu.wakeStampStrengthBase ?? 0.5);
        const spx  = Number(tu.wakeStrengthPerPx ?? 0.003);
        const rawStr = Math.min(Number(tu.wakeStrengthMax ?? 0.9), smin + moveDist * spx);

        WakeManager.#pushStamp(bowX, bowY, dirX, dirY, rawStr, tu);
        LOG(`Wake stamp at bow (${bowX.toFixed(0)}, ${bowY.toFixed(0)}), dir=(${dirX.toFixed(2)},${dirY.toFixed(2)})`);
    }

    /** Push a new WakeStamp, evicting the oldest if pool is full. */
    static #pushStamp(cx, cy, dirX, dirY, strength, tu) {
        const pool = Math.max(1, Math.min(4, Math.round(Number(tu.wakeStampPoolMax ?? 4))));
        if (WakeManager.#stamps.length >= pool) {
            WakeManager.#stamps.shift()?.destroy();
        }
        WakeManager.#stamps.push(new WakeStamp(cx, cy, dirX, dirY, {
            strength,
            trailLengthPx: Number(tu.wakeTrailLengthPx ?? 200),
            lifetime: Number(tu.wakeStampLifetime ?? 2.5)
        }));
    }

    // -------------------------------------------------------------------------
    // Ripple internals
    // -------------------------------------------------------------------------

    static #spawnRipple(x, y, opts = {}) {
        const pool = Math.max(4, Math.round(WakeTuning.get().maxRipplesPool));
        if (WakeManager.#ripples.length >= pool) {
            WakeManager.#evictForPool(opts.tokenId);
        }
        WakeManager.#ripples.push(new WakeRipple(x, y, opts));
    }

    /**
     * Fair pool eviction: remove the oldest ripple belonging to whichever token
     * currently holds the most slots. Prefers evicting ripples that have never
     * been shown to the shader (still queued) so we don't visibly cut off a
     * ripple that's mid-effect.
     *
     * @param {string|null} incomingTokenId - The token about to spawn a ripple
     *   (passed for logging; eviction targets the richest token regardless).
     */
    static #evictForPool(incomingTokenId) {
        // Count live ripples per token
        const counts = new Map();
        for (const r of WakeManager.#ripples) {
            const tid = r.tokenId ?? '__none__';
            counts.set(tid, (counts.get(tid) ?? 0) + 1);
        }
        // Find the token currently holding the most slots
        let maxTid = null, maxCount = 0;
        for (const [tid, n] of counts) {
            if (n > maxCount) { maxCount = n; maxTid = tid; }
        }

        // Pass 1: find the oldest UNSHOWN ripple from the richest token (least disruptive)
        let idx = WakeManager.#ripples.findIndex(r => (r.tokenId ?? '__none__') === maxTid && !r.shown);
        // Pass 2: fall back to the oldest ripple regardless of shown state
        if (idx < 0) idx = WakeManager.#ripples.findIndex(r => (r.tokenId ?? '__none__') === maxTid);

        if (idx >= 0) {
            const evicted = WakeManager.#ripples.splice(idx, 1)[0];
            evicted?.destroy();
            LOG(`Pool evict: removed ${evicted?.shown ? 'shown' : 'queued'} ripple from token ${maxTid} (had ${maxCount}), new token: ${incomingTokenId}`);
        } else {
            WakeManager.#ripples.shift()?.destroy();
        }
    }

    /**
     * Returns true if there is already a live ripple from this token within
     * the cooldown radius. Cooldown is scoped per-token so two different
     * tokens moving near each other don't suppress each other's ripples.
     *
     * @param {number} cx
     * @param {number} cy
     * @param {number} cd  Cooldown radius in px
     * @param {string|null} tokenId
     */
    static #rippleTooClose(cx, cy, cd, tokenId = null) {
        return WakeManager.#ripples.some(r => {
            if (r.dead) return false;
            if (tokenId !== null && r.tokenId !== tokenId) return false;
            return Math.hypot(cx - r.worldX, cy - r.worldY) < cd;
        });
    }

    // -------------------------------------------------------------------------
    // Tick
    // -------------------------------------------------------------------------

    static #tick(dt) {
        const tu = WakeTuning.get();
        const spriteParent = (tu.visualMode === 'sprites' || tu.visualMode === 'both')
            ? WakeManager.#spriteLayer : null;

        for (let i = WakeManager.#ripples.length - 1; i >= 0; i--) {
            const r = WakeManager.#ripples[i];
            if (r.tick(dt, spriteParent)) {
                r.destroy();
                WakeManager.#ripples.splice(i, 1);
            }
        }
        for (let i = WakeManager.#stamps.length - 1; i >= 0; i--) {
            const s = WakeManager.#stamps[i];
            if (s.tick(dt, spriteParent)) {
                s.destroy();
                WakeManager.#stamps.splice(i, 1);
            }
        }

        // Idle ripples for stationary wet tokens (ripple style only)
        if (tu.wakeStyle !== 'wake' && game.settings.get(MODULE_ID, 'enableTokenWake')) {
            WakeManager.#tickIdleRipples(dt, tu);
        }

        const { buf, count, speedMul } = WakeManager.#packWakeShaderBuffer(tu);
        // Blend shader wave speed down when only idle ripples are active
        const effectiveTu = speedMul === 1.0 ? tu : { ...tu, shaderRippleSpeed: tu.shaderRippleSpeed * speedMul };
        WaterManager.syncWakeUniforms(buf, count, effectiveTu);
    }

    /**
     * Emit occasional ambient ripples from tokens that are stationary in water.
     * Each token gets a random countdown between idleRippleMinSec and idleRippleMaxSec.
     * When the countdown expires a ripple is spawned and the timer resets.
     */
    static #tickIdleRipples(dt, tu) {
        const idleMul = Number(tu.idleRippleStrength ?? 0.75);
        if (idleMul <= 0) return;   // slider at 0 = feature disabled

        const minSec = Number(tu.idleRippleMinSec ?? 1.0);
        const maxSec = Number(tu.idleRippleMaxSec ?? 2.0);

        for (const token of (canvas.tokens?.placeables ?? [])) {
            const tokenId = token.document?.id ?? token.id;

            if ((token.document?.elevation ?? 0) > 0) { WakeManager.#idleTimers.delete(tokenId); continue; }
            if (token.document?.getFlag?.(MODULE_ID, 'noRipple'))  { WakeManager.#idleTimers.delete(tokenId); continue; }

            const c = WakeManager.#placeableCenter(token);
            if (!c) continue;

            if (!WaterManager.isPointInWater(c.x, c.y)) {
                WakeManager.#idleTimers.delete(tokenId);
                continue;
            }

            // Seed #lastPositions for tokens we haven't seen move yet
            const lastPos = WakeManager.#lastPositions.get(tokenId);
            if (!lastPos) {
                WakeManager.#lastPositions.set(tokenId, { x: c.x, y: c.y });
                continue;
            }

            // Consider the token stationary if its canvas position hasn't changed
            const isStationary = Math.abs(c.x - lastPos.x) < WakeManager.#POS_EPS
                               && Math.abs(c.y - lastPos.y) < WakeManager.#POS_EPS;

            if (!isStationary) {
                // Token is moving -- clear idle timer so it resets fresh when it stops
                WakeManager.#idleTimers.delete(tokenId);
                continue;
            }

            // Tick down (or initialise) the idle countdown
            let countdown = WakeManager.#idleTimers.get(tokenId);
            if (countdown === undefined) {
                countdown = minSec + Math.random() * (maxSec - minSec);
                WakeManager.#idleTimers.set(tokenId, countdown);
            }

            countdown -= dt;
            if (countdown <= 0) {
                const tokR = WakeManager.#tokenRadiusPx(token);
                WakeManager.#spawnRipple(c.x, c.y, {
                    tokenId, dirX: 0, dirY: 0, tokenRadiusPx: tokR,
                    idleMul,       // scales size + distortion
                    idleEase: true // gentler fade-in envelope + flags ripple as idle for shader speed
                });
                LOG(`Idle ripple for token ${tokenId} at (${c.x.toFixed(0)}, ${c.y.toFixed(0)})`);
                countdown = minSec + Math.random() * (maxSec - minSec);
            }
            WakeManager.#idleTimers.set(tokenId, countdown);
        }
    }

    static #packWakeShaderBuffer(tu) {
        const buf = WakeManager.#wakeBuf;
        buf.fill(0);

        // Sprites-only mode: send empty buffer (no shader distortion)
        if (tu.visualMode === 'sprites') return { buf, count: 0 };

        if (tu.wakeStyle === 'wake') {
            const alive = WakeManager.#stamps.filter(s => !s.dead);
            const slice = alive.slice(-4);   // newest 4 fit in shader budget
            let n = 0;
            for (const st of slice) {
                st.packInto(buf, n * 8);
                n++;
            }
            return { buf, count: n };
        }

        // Ripple mode: pack up to 8 ring vec4s -- distribute shader slots fairly
        // across all active tokens (1 token gets all 8; 2 tokens get 4 each; 4 -> 2 each etc.)
        const alive = WakeManager.#ripples.filter(r => !r.dead);

        // Group by token, preserving insertion order (oldest -> newest per token)
        const byToken = new Map();
        for (const r of alive) {
            const tid = r.tokenId ?? '__none__';
            const arr = byToken.get(tid);
            if (arr) arr.push(r);
            else byToken.set(tid, [r]);
        }

        // Slots per token: divide the 8 shader slots evenly, minimum 1 each
        const tokenCount = Math.max(1, byToken.size);
        const slotsPerToken = Math.max(1, Math.floor(8 / tokenCount));

        // Collect newest slotsPerToken ripples from each token, interleaved
        const tokenQueues = [...byToken.values()].map(arr => arr.slice(-slotsPerToken).reverse()); // newest first
        const slice = [];
        for (let pass = 0; pass < slotsPerToken && slice.length < 8; pass++) {
            for (const q of tokenQueues) {
                if (pass < q.length && slice.length < 8) slice.push(q[pass]);
            }
        }

        // Fading ripples (already in graceful fast-fade) get any leftover shader
        // slots so their decay is visible in shader mode rather than vanishing.
        // We only fill REMAINING budget -- newest ripples retain priority so
        // current movement keeps showing without delay.
        if (slice.length < 8) {
            for (const r of alive) {
                if (slice.length >= 8) break;
                if (r.isKilling && !slice.includes(r)) slice.push(r);
            }
        }

        let n = 0;
        let allIdle = slice.length > 0;
        const sliceSet = new Set(slice);
        for (const r of slice) {
            const v = r.getShaderWakeVec4();
            if (!v) continue;
            buf.set(v, n * 4);
            n++;
            r.shown = true;   // sticky: once shown, stays shown until death
            if (!r.isIdle) allIdle = false;
        }

        // Gracefully retire ripples that were previously shown but lost their slot
        // due to re-allocation (e.g. another token entering water shrank slotsPerToken).
        // beginFastFade() ramps amplitude to zero over ~150ms, then auto-dies for
        // normal cleanup. Without this, suppressed ripples could resurrect at old
        // spawn positions later, producing ghost artifacts from movement history.
        // Ripples that were never shown (still in the spawn queue) are left alive
        // -- they get a chance next frame as slots free up.
        for (const r of alive) {
            if (!sliceSet.has(r) && r.shown) r.beginFastFade?.();
        }

        // When every visible ripple is an idle (stationary) ripple, slow the shader
        // wave animation down so it feels ambient rather than splashy.
        const speedMul = allIdle ? Number(tu.idleShaderSpeedMul ?? 0.35) : 1.0;
        return { buf, count: n, speedMul };
    }

    // -------------------------------------------------------------------------
    // Helpers
    // -------------------------------------------------------------------------

    static #changesMightMoveToken(changes) {
        if (!changes || typeof changes !== 'object') return false;
        if ('x' in changes || 'y' in changes || 'elevation' in changes || changes.movement) return true;
        if (foundry?.utils?.flattenObject) {
            const flat = foundry.utils.flattenObject(changes);
            return Object.keys(flat).some(k => k === 'x' || k === 'y' || k.endsWith('.x') || k.endsWith('.y'));
        }
        return false;
    }

    /**
     * @param {PIXI.Container & {
     *   getCenterPoint?: () => {x:number,y:number},
     *   getCenter?: (o?:object) => {x:number,y:number},
     *   w?: number, width?: number
     * }} t
     */
    static #placeableCenter(t) {
        if (typeof t.getCenterPoint === 'function') return t.getCenterPoint();
        if (typeof t.getCenter     === 'function') return t.getCenter({ exact: true });
        const w = t.w ?? t.width  ?? 0;
        const h = t.h ?? t.height ?? 0;
        return { x: t.x + w / 2, y: t.y + h / 2 };
    }

    /** Token radius in px (half the token's grid footprint). */
    static #tokenRadiusPx(placeable) {
        const gridSize = canvas.grid?.size ?? 100;
        const tokenW   = placeable?.document?.width ?? 1;
        return tokenW * gridSize * 0.5;
    }

    static #snapshotPositions() {
        WakeManager.#lastPositions.clear();
        for (const token of (canvas.tokens?.placeables ?? [])) {
            const id = token.document?.id ?? token.id;
            const c  = WakeManager.#placeableCenter(token);
            if (c) WakeManager.#lastPositions.set(id, { x: c.x, y: c.y });
        }
    }

    static #syncWetFromPositions() {
        WakeManager.#lastWet.clear();
        for (const [id, pos] of WakeManager.#lastPositions) {
            WakeManager.#lastWet.set(id, WaterManager.isPointInWater(pos.x, pos.y));
        }
    }

    static #debugWetChange(tokenId, inWater, source) {
        const prev = WakeManager.#lastWet.get(tokenId);
        WakeManager.#lastWet.set(tokenId, inWater);
        if (!game.settings.get(MODULE_ID, 'debug')) return;
        if (prev === undefined || prev === inWater) return;
        LOG(inWater
            ? `Token ${tokenId} entered water (${source})`
            : `Token ${tokenId} left water (${source})`);
    }

    // -------------------------------------------------------------------------
    // Destroy
    // -------------------------------------------------------------------------

    static destroy() {
        if (WakeManager.#tickerFn) {
            canvas.app?.ticker?.remove(WakeManager.#tickerFn);
            WakeManager.#tickerFn = null;
        }
        for (const r of WakeManager.#ripples) r.destroy();
        WakeManager.#ripples = [];
        for (const s of WakeManager.#stamps)  s.destroy();
        WakeManager.#stamps = [];
        WakeManager.#lastPositions.clear();
        WakeManager.#lastWet.clear();
        WakeManager.#velState.clear();
        WakeManager.#idleTimers.clear();
        WakeManager.#wakeBuf.fill(0);
        WaterManager.syncWakeUniforms(WakeManager.#wakeBuf, 0, WakeTuning.get());
        if (WakeManager.#spriteLayer) {
            if (WakeManager.#spriteLayer.parent) {
                WakeManager.#spriteLayer.parent.removeChild(WakeManager.#spriteLayer);
            }
            WakeManager.#spriteLayer.destroy({ children: true });
            WakeManager.#spriteLayer = null;
        }
    }
}

