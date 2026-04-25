import { WakeTuning } from './WakeTuning.js';

/**
 * A single V-wake chevron stamp.
 *
 * Each stamp is deposited at the bow (leading edge) of the token when it has
 * moved far enough. It carries its own randomised parameters (angle jitter, trail
 * length jitter, strength jitter, phase offset) so a chain of stamps along a path
 * does not look like tiled decals.
 *
 * DATA PACKING (2 × vec4 = 8 floats per stamp slot in the shader):
 *   [0] cx         -- world X of bow anchor
 *   [1] cy         -- world Y of bow anchor
 *   [2] dirX       -- unit forward direction X (normalised motion dir)
 *   [3] dirY       -- unit forward direction Y
 *   [4] age01      -- normalised lifetime progress 0->1
 *   [5] halfAngleTan -- tan(half-angle with per-stamp jitter)
 *   [6] trailLengthPx -- trailing arm length (with jitter)
 *   [7] strength   -- amplitude (baked jitter + lifetime fade, updated each tick)
 *
 * NOTE -- per-stamp phase is derived in the shader from hash(cx, cy) so it costs
 * no extra float. Per-token character variance can be added later by encoding a
 * stable token seed into a fractional component of slot [6] or via a dedicated
 * uniform pair; leave a comment below wherever that would plug in.
 */
export class WakeStamp {

    dead = false;

    /** @type {number} */ #cx;
    /** @type {number} */ #cy;
    /** @type {number} */ #dirX;
    /** @type {number} */ #dirY;
    /** @type {number} */ #halfAngleTan;
    /** @type {number} */ #trailLengthPx;
    /** @type {number} */ #strengthBase;
    /** @type {number} */ #lifetime;
    /** @type {number} */ #elapsed = 0;

    /** @type {PIXI.Graphics|null} */ #gfx = null;

    /**
     * @param {number} cx        World X of bow anchor (token leading edge)
     * @param {number} cy        World Y of bow anchor
     * @param {number} dirX      Unit forward direction X
     * @param {number} dirY      Unit forward direction Y
     * @param {object} [opts]
     * @param {number} [opts.strength]       Base strength before jitter
     * @param {number} [opts.trailLengthPx]  Override trail length
     * @param {number} [opts.lifetime]       Override lifetime (s)
     */
    constructor(cx, cy, dirX, dirY, opts = {}) {
        this.#cx = cx;
        this.#cy = cy;
        this.#dirX = dirX;
        this.#dirY = dirY;

        const tu = WakeTuning.get();

        // --- Per-stamp jitter ---
        // FUTURE: per-token seed could bias these ranges:
        //   const tokenBias = (tokenSeed * 2 - 1) * 0.3;  // ±30% of jitter range
        //   then apply bias to the random()*2-1 terms below.
        const rng = () => Math.random() * 2 - 1;

        const baseDeg = Number(tu.wakeHalfAngleDeg ?? 22);
        const jDeg    = Number(tu.wakeHalfAngleJitterDeg ?? 2.5);
        const jitteredDeg = baseDeg + rng() * jDeg;
        this.#halfAngleTan = Math.tan(Math.max(5, Math.min(45, jitteredDeg)) * Math.PI / 180);

        const trailBase = opts.trailLengthPx ?? Number(tu.wakeTrailLengthPx ?? 200);
        const trailJit  = Number(tu.wakeTrailLengthJitter ?? 0.12);
        this.#trailLengthPx = Math.max(30, trailBase * (1 + rng() * trailJit));

        const strBase = opts.strength ?? Number(tu.wakeStampStrengthBase ?? 0.6);
        const strJit  = Number(tu.wakeStrengthJitter ?? 0.15);
        this.#strengthBase = Math.max(0.05, strBase * (1 + rng() * strJit));

        this.#lifetime = opts.lifetime ?? Number(tu.wakeStampLifetime ?? 2.5);
    }

    /**
     * Advance by dt seconds. Returns true when dead.
     * @param {number} dt
     * @param {PIXI.Container|null} spriteParent
     */
    tick(dt, spriteParent) {
        if (this.dead) return true;

        this.#elapsed += dt;
        if (this.#elapsed >= this.#lifetime) {
            this.dead = true;
            this.#detachSprite();
            return true;
        }

        const tu = WakeTuning.get();
        const sprites = tu.visualMode === 'sprites' || tu.visualMode === 'both';
        if (sprites && spriteParent) {
            this.#ensureSprite(spriteParent);
            this.#drawSprite(tu);
        } else {
            this.#detachSprite();
        }

        return false;
    }

    clearSpriteDrawing() { this.#detachSprite(); }

    #ensureSprite(parent) {
        if (this.#gfx) return;
        this.#gfx = new PIXI.Graphics();
        this.#gfx.eventMode = 'none';
        this.#gfx.name = 'wake-stamp-sprite';
        parent.addChild(this.#gfx);
    }

    #detachSprite() {
        if (!this.#gfx) return;
        if (this.#gfx.parent) this.#gfx.parent.removeChild(this.#gfx);
        this.#gfx.destroy(true);
        this.#gfx = null;
    }

    /** Draw a thin V outline for sprite-mode preview. */
    #drawSprite(tu) {
        const gfx = this.#gfx;
        if (!gfx) return;

        const prog = this.#elapsed / this.#lifetime;
        const fade = 1 - WakeStamp.#smoothstep(0.5, 1.0, prog);
        const alpha = Math.max(0, (Number(tu.wakeSpriteAlpha ?? 0.45)) * fade);
        const color = WakeStamp.#hexToNumber(String(tu.spriteColor ?? '#c8e8ff'));
        const lineW = Math.max(1, 2 * (1 - prog * 0.5));

        // V arms extend behind the bow.  arm direction = -dir ± perp * tan(halfAngle)
        const armLen = this.#trailLengthPx * (1 - prog * 0.3);
        const perpMag = armLen * this.#halfAngleTan;
        const fwdBack = -1; // trailing direction
        const bx = this.#cx + this.#dirX * fwdBack * armLen;
        const by = this.#cy + this.#dirY * fwdBack * armLen;
        // Perp = (-dirY, dirX)
        const px = -this.#dirY;
        const py = this.#dirX;

        gfx.clear();
        gfx.lineStyle(lineW, color, alpha);
        // Left arm
        gfx.moveTo(this.#cx, this.#cy);
        gfx.lineTo(bx + px * perpMag, by + py * perpMag);
        // Right arm
        gfx.moveTo(this.#cx, this.#cy);
        gfx.lineTo(bx - px * perpMag, by - py * perpMag);
    }

    static #hexToNumber(hex) {
        const h = hex.replace('#', '');
        return h.length >= 6 ? parseInt(h.slice(0, 6), 16) : 0xc8e8ff;
    }

    static #smoothstep(edge0, edge1, x) {
        const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0 + 1e-6)));
        return t * t * (3 - 2 * t);
    }

    /**
     * Pack 8 floats (2 vec4) into buf at the given float offset.
     * @param {Float32Array} buf
     * @param {number} floatOffset  Multiple of 8 (stamp slot 0–3).
     */
    packInto(buf, floatOffset) {
        const prog     = Math.min(1, this.#elapsed / this.#lifetime);
        // Ease-in ramp prevents stamps from popping into existence at full strength.
        const popIn    = WakeStamp.#smoothstep(0.0, 0.08, prog);
        const tailFade = 1 - WakeStamp.#smoothstep(0.55, 1.0, prog);
        const o = floatOffset;
        buf[o + 0] = this.#cx;
        buf[o + 1] = this.#cy;
        buf[o + 2] = this.#dirX;
        buf[o + 3] = this.#dirY;
        buf[o + 4] = prog;
        buf[o + 5] = this.#halfAngleTan;
        buf[o + 6] = this.#trailLengthPx;
        buf[o + 7] = this.#strengthBase * popIn * tailFade;
        // FUTURE: per-token seed would be encoded here, e.g.:
        //   buf[o + 6] = this.#trailLengthPx + tokenSeed * 0.0001; // frac carries seed
    }

    destroy() {
        this.dead = true;
        this.#detachSprite();
    }
}
