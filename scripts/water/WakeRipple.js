import { WakeTuning } from './WakeTuning.js';

/**
 * Token wake ripple -- shader refraction + optional sprite rings (debug preview).
 *
 * Per-ripple randomisation:
 *   - Origin offset (px jitter from the nominal spawn point)
 *   - Duration jitter (±fraction of base duration)
 *   - Max-radius jitter
 *   - Base-alpha jitter
 *   - Ring count jitter (±1 from nominal)
 *   - Phase offset for the shader ring band (so adjacent ripples beat differently)
 *
 * All jitter parameters are baked at construction time so they stay stable
 * across the ripple lifetime.
 */
export class WakeRipple {

    dead = false;
    worldX;
    worldY;

    /** @type {number} */ #x;
    /** @type {number} */ #y;
    /** @type {object}  */ #spawnOpts;

    /** Baked per-ripple random offsets */
    /** @type {number} */ #durationMul;
    /** @type {number} */ #radiusMul;
    /** @type {number} */ #alphaMul;
    /** @type {number} */ #ringCountDelta;

    /** @type {number} */ #elapsed = 0;
    /** @type {PIXI.Graphics|null} */ #gfx = null;

    /**
     * @param {number} x
     * @param {number} y
     * @param {object} [spawnOpts]
     */
    /**
     * @param {number} x
     * @param {number} y
     * @param {object} [spawnOpts]
     * @param {number} [spawnOpts.dirX]  Unit direction X of travel (for lead offset)
     * @param {number} [spawnOpts.dirY]  Unit direction Y of travel (for lead offset)
     */
    constructor(x, y, spawnOpts = {}) {
        /** Token that spawned this ripple -- used for fair pool eviction. */
        this.tokenId = spawnOpts.tokenId ?? null;
        /** True when spawned by a stationary token (idle ambient ripple). */
        this.isIdle  = spawnOpts.idleEase ?? false;

        const tu = WakeTuning.get();
        const rng = () => Math.random() * 2 - 1; // -1..+1

        // Lead offset: nudge spawn slightly ahead of the direction of travel
        const leadPx = Number(tu.rippleLeadPx ?? 8);
        const ldx = (spawnOpts.dirX ?? 0) * leadPx;
        const ldy = (spawnOpts.dirY ?? 0) * leadPx;

        // Master variance multiplier scales all jitter params (0 = uniform, 1 = baseline, >1 = amplified)
        const variance = Math.max(0, Number(tu.rippleVariance ?? 1.0));

        // Origin jitter: random XY scatter on top of lead offset
        const posJitterPx = Number(tu.rippleOriginJitterPx ?? 6) * variance;
        const ox = ldx + rng() * posJitterPx;
        const oy = ldy + rng() * posJitterPx;

        this.#x = x + ox;
        this.#y = y + oy;
        this.worldX = this.#x;
        this.worldY = this.#y;
        this.#spawnOpts = spawnOpts;

        // Per-ripple variance baked at spawn -- each scaled by the master variance
        const durJit   = Number(tu.rippleDurationJitter ?? 0.18) * variance;
        const radJit   = Number(tu.rippleRadiusJitter   ?? 0.15) * variance;
        const alphaJit = Number(tu.rippleAlphaJitter    ?? 0.12) * variance;
        const rcJit    = Number(tu.rippleRingCountJitter ?? 1)   * variance;

        this.#durationMul   = 1 + rng() * durJit;
        this.#radiusMul     = 1 + rng() * radJit;
        this.#alphaMul      = 1 + rng() * alphaJit;
        this.#ringCountDelta = Math.round(rng() * rcJit);
    }

    #effectiveParams() {
        const tu  = WakeTuning.get();
        const tokR = this.#spawnOpts.tokenRadiusPx ?? 50;

        // idleMul scales size + alpha for stationary-token ripples
        const idleMul  = this.#spawnOpts.idleMul  ?? 1.0;
        const idleEase = this.#spawnOpts.idleEase ?? false;

        // Radii are multiples of token radius (not fixed px)
        const startMul = Number(tu.rippleStartMul ?? 0.9);
        const maxMul   = Number(tu.rippleMaxMul   ?? 2.5);
        const startPx  = tokR * startMul;
        const maxPx    = Math.max(startPx + 10, tokR * maxMul * this.#radiusMul * idleMul);

        const baseDur   = this.#spawnOpts.duration  ?? tu.duration;
        const baseAlpha = this.#spawnOpts.baseAlpha ?? tu.baseAlpha;
        const baseRC    = Math.round(this.#spawnOpts.ringCount ?? tu.ringCount);

        return {
            startRadius:      startPx,
            maxRadius:        maxPx,
            duration:         Math.max(0.3, baseDur * this.#durationMul),
            baseAlpha:        Math.max(0.05, baseAlpha * this.#alphaMul * idleMul),
            idleEase,
            ringCount:        Math.max(1, baseRC + this.#ringCountDelta),
            expandEasePower:  tu.expandEasePower,
            fadeStartT:       tu.fadeStartT,
            shaderAmpBoost:   tu.shaderAmpBoost,
            spriteColor:      tu.spriteColor,
            spriteLineWidthMax: tu.spriteLineWidthMax
        };
    }

    #normalizedT() {
        const { duration } = this.#effectiveParams();
        return duration > 0 ? this.#elapsed / duration : 1;
    }

    static #smoothstep(edge0, edge1, x) {
        const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0 + 1e-6)));
        return t * t * (3 - 2 * t);
    }

    /**
     * Fade envelope: fast surge -> relax -> slow fade -> zero.
     *
     * Shape (with default fadeStartT = 0.3):
     *   t=0.00 -> 0.0   (not yet visible)
     *   t=0.02 -> ~1.3  (surge peak: brief overshoot above 1.0)
     *   t=0.06 -> ~1.0  (settles to full strength)
     *   t=0.30 -> ~1.0  (holds)
     *   t=0.50 -> ~0.65 (relaxing)
     *   t=0.80 -> ~0.15 (fading out slowly)
     *   t=1.00 -> 0.0   (gone -- removed next tick)
     *
     * @param {number} t  Normalised lifetime 0..1
     * @param {object} p  effectiveParams
     */
    static #fadeEnvelope(t, p) {
        if (p.idleEase) {
            // Idle ripples: slow gentle rise over ~15% of life, no surge, same fade out
            const attack = WakeRipple.#smoothstep(0.0, 0.15, t);
            const fade   = t < p.fadeStartT
                ? 1.0
                : 1.0 - WakeRipple.#smoothstep(p.fadeStartT, 0.95, t);
            const tail   = 1.0 - WakeRipple.#smoothstep(0.80, 1.0, t);
            return attack * fade * tail;
        }

        // Movement ripples: very fast attack (0->peak in ~2% of life)
        const attack = WakeRipple.#smoothstep(0.0, 0.02, t);
        // Brief overshoot surge that relaxes back to 1.0 by ~6%
        const surge  = 1.0 + 0.35 * Math.max(0, 1.0 - WakeRipple.#smoothstep(0.02, 0.08, t));
        // Main fade after fadeStartT (long ease curve)
        const fade   = t < p.fadeStartT
            ? 1.0
            : 1.0 - WakeRipple.#smoothstep(p.fadeStartT, 0.95, t);
        // Tail: ensure amplitude reaches exactly 0 at end of life
        const tail   = 1.0 - WakeRipple.#smoothstep(0.80, 1.0, t);
        return attack * surge * fade * tail;
    }

    /**
     * @param {number} dt
     * @param {PIXI.Container|null} spriteParent
     */
    tick(dt, spriteParent) {
        if (this.dead) return true;

        const tu = WakeTuning.get();
        const sprites = tu.visualMode === 'sprites' || tu.visualMode === 'both';

        this.#elapsed += dt;
        const t = this.#normalizedT();

        if (t >= 1.0) {
            this.dead = true;
            this.#detachSprite();
            return true;
        }

        if (sprites && spriteParent) {
            if (!this.#gfx) {
                this.#gfx = new PIXI.Graphics();
                this.#gfx.eventMode = 'none';
                this.#gfx.name = 'wake-ripple-sprite';
                spriteParent.addChild(this.#gfx);
            }
            this.#drawSpriteRings(t);
        } else {
            this.#detachSprite();
        }

        return false;
    }

    #detachSprite() {
        if (!this.#gfx) return;
        if (this.#gfx.parent) this.#gfx.parent.removeChild(this.#gfx);
        this.#gfx.destroy(true);
        this.#gfx = null;
    }

    clearSpriteDrawing() { this.#detachSprite(); }

    #drawSpriteRings(t) {
        const gfx = this.#gfx;
        if (!gfx) return;
        const p = this.#effectiveParams();
        // Radius keeps growing for the entire life -- never curves off.
        // Use a linear t (or very mild ease) so rings keep expanding even as
        // the distortion/alpha fades to zero.
        const expand = 1 - Math.pow(1 - t, p.expandEasePower);
        const env    = WakeRipple.#fadeEnvelope(t, p);
        const color  = WakeRipple.#hexToNumber(String(p.spriteColor));
        const rc     = Math.max(p.ringCount, 1);

        gfx.clear();
        for (let i = 0; i < rc; i++) {
            const ringPhase = i / rc;
            const ringT     = Math.max(0, t - ringPhase * 0.15);
            // Radius lerps from startRadius -> maxRadius over lifetime
            const radius    = p.startRadius + ringT * (p.maxRadius - p.startRadius);
            if (radius < 2) continue;
            const ringAlpha = p.baseAlpha * env * (1 - i * 0.18);
            const lineWidth = Math.max(1, p.spriteLineWidthMax * (1 - expand * 0.35));
            gfx.lineStyle(lineWidth, color, Math.max(0, ringAlpha));
            gfx.drawCircle(this.#x, this.#y, radius);
        }
    }

    static #hexToNumber(hex) {
        const h = hex.replace('#', '');
        return h.length >= 6 ? parseInt(h.slice(0, 6), 16) : 0xc8e8ff;
    }

    /** @returns {Float32Array|null} */
    getShaderWakeVec4() {
        if (this.dead) return null;
        const t = this.#normalizedT();
        if (t >= 1.0) return null;

        const p = this.#effectiveParams();
        const env = WakeRipple.#fadeEnvelope(t, p);

        // Radius lerps from startRadius -> maxRadius over lifetime.
        // Distortion amplitude fades via env, but the ring keeps expanding.
        const rc        = Math.max(p.ringCount, 1);
        const ringPhase = (rc - 1) / rc * 0.15;
        const ringT     = Math.max(0, t - ringPhase);
        const radius    = p.startRadius + ringT * (p.maxRadius - p.startRadius);
        const amp       = Math.min(1.0, p.baseAlpha * env * p.shaderAmpBoost);

        return new Float32Array([this.#x, this.#y, Math.max(radius, 3), amp]);
    }

    destroy() {
        this.dead = true;
        this.#detachSprite();
    }
}
