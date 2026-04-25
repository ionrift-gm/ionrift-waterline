const MODULE_ID = 'ionrift-waterline';

/**
 * Client-side wake tuning defaults (merged with saved settings).
 * @type {Readonly<Record<string, number|string>>}
 */
export const WAKE_TUNING_DEFAULTS = {
    /** shader | sprites | both */
    visualMode: 'shader',

    /**
     * ripple -- expanding ring bursts (particle-style).
     * wake -- continuous line/trail waves along token path (not radial ripples).
     */
    wakeStyle: 'ripple',

    duration: 1.0,
    maxRadius: 80,
    ringCount: 2,
    baseAlpha: 0.95,

    expandEasePower: 2.4,
    fadeStartT: 0.55,
    shaderAmpBoost: 0.5,

    rippleStartMul: 0.4,
    rippleMaxMul: 1.5,

    rippleLeadPx: 13,

    /**
     * Master variance multiplier (0 = perfectly uniform ripples, 1 = full per-ripple randomness).
     * Scales all five per-ripple jitter params proportionally so one slider controls "feel".
     */
    rippleVariance: 1.0,

    // Individual jitter maxima -- scaled by rippleVariance at spawn time.
    // Exposed in the Advanced section for fine-tuning; most users should leave these alone.
    rippleOriginJitterPx: 6,
    rippleDurationJitter: 0.18,
    rippleRadiusJitter: 0.15,
    rippleAlphaJitter: 0.12,
    rippleRingCountJitter: 1,

    minMoveDist: 46,
    longMoveMidPx: 355,
    moveRadiusScale: 335,

    refreshMinDist: 3,
    refreshMaxDist: 150,
    spawnCooldownPx: 34,
    refreshDuration: 1.45,
    refreshMaxRadius: 40,
    refreshBaseAlpha: 0.25,

    maxRipplesPool: 63,

    /** Idle ripple strength scalar for stationary tokens (0 = disabled, 1 = full movement strength) */
    idleRippleStrength: 0.6,

    /**
     * Shader wave speed multiplier for idle-only ripples (0..1 fraction of shaderRippleSpeed).
     * Applied when every active ripple was spawned by a stationary token.
     */
    idleShaderSpeedMul: 0.35,

    /** Idle ripple interval for stationary tokens in water (seconds, random between min and max) */
    idleRippleMinSec: 0.5,
    idleRippleMaxSec: 3.8,

    shaderBandPx: 32,
    shaderPhaseScale: 0.30,
    shaderRippleSpeed: 9.25,
    shaderStrengthMul: 2.25,

    spriteColor: '#c8e8ff',
    spriteLineWidthMax: 3,
    wakeSpriteAlpha: 0.45,

    // -------------------------------------------------------------------------
    // Wake (V-chevron) strategy
    // -------------------------------------------------------------------------

    /** Half-angle of the wake V in degrees (19–22° is physically Kelvin; wider reads better at VTT scale). */
    wakeHalfAngleDeg: 22,
    /** Random per-stamp jitter added to half-angle (±deg). Breaks "tiled decal" look. */
    wakeHalfAngleJitterDeg: 2.5,

    /** Trail arm length in pixels (how far behind the token the wake extends). */
    wakeTrailLengthPx: 160,
    /** Random per-stamp jitter on trail length (fraction, e.g. 0.12 = ±12%). */
    wakeTrailLengthJitter: 0.12,

    /** Minimum token movement (px) before a new stamp is deposited. */
    wakeStampIntervalPx: 48,
    /** Stamp lifetime in seconds. */
    wakeStampLifetime: 2.5,
    /** Maximum concurrent stamps passed to the shader (hard-capped at 4 by the shader budget). */
    wakeStampPoolMax: 4,

    /** Base strength for a stamp at rest (low speed). Scales with move distance. */
    wakeStampStrengthBase: 0.52,
    /** Maximum stamp strength (caps the speed-scaling). */
    wakeStrengthMax: 0.9,
    /** Strength gain per pixel of movement distance. */
    wakeStrengthPerPx: 0.003,
    /** Random per-stamp jitter on strength (fraction, e.g. 0.15 = ±15%). */
    wakeStrengthJitter: 0.15,

    // Shader wave parameters for the divergent-crest model
    /** Spatial wave-number along each V-arm (crests per px). Higher = tighter crests. */
    wakeDivergentK: 0.085,
    /** Temporal animation rate for divergent crests (drift speed of crests outward). */
    wakeDivergentOmega: 2.4,

    // Future: per-token seed variance (enable to give each creature a distinct wake character)
    // wakeVariancePerToken: false,

    // Future: transverse crests filling the V interior (classic Kelvin pattern).
    // Requires shader stub to be enabled; parameters kept here as placeholders.
    // wakeTransverseEnabled: false,
    // wakeTransverseK: 0.018,
    // wakeTransverseOmega: 1.1
};

export class WakeTuning {

    /** @returns {Record<string, number|string>} */
    static get() {
        const raw = game.settings.get(MODULE_ID, 'wakeTuning') ?? {};
        return foundry.utils.mergeObject(
            foundry.utils.deepClone(WAKE_TUNING_DEFAULTS),
            raw,
            { inplace: false }
        );
    }

    /**
     * @param {Record<string, number|string>} partial
     */
    static async setPartial(partial) {
        const cur = WakeTuning.get();
        const next = foundry.utils.mergeObject(cur, partial, { inplace: false });
        await game.settings.set(MODULE_ID, 'wakeTuning', next);
    }

    static async reset() {
        await game.settings.set(
            MODULE_ID,
            'wakeTuning',
            foundry.utils.deepClone(WAKE_TUNING_DEFAULTS)
        );
    }

    /** @returns {string[]} Names of saved custom presets. */
    static listPresets() {
        const store = game.settings.get(MODULE_ID, 'wakeTuning')?._presets ?? {};
        return Object.keys(store).sort();
    }

    /** Save current tuning as a named preset. */
    static async savePreset(name) {
        if (!name) return;
        const cur = WakeTuning.get();
        delete cur._presets;
        const raw = game.settings.get(MODULE_ID, 'wakeTuning') ?? {};
        raw._presets ??= {};
        raw._presets[name] = foundry.utils.deepClone(cur);
        await game.settings.set(MODULE_ID, 'wakeTuning', raw);
    }

    /** Load a named preset (replaces current tuning, keeps presets store). */
    static async loadPreset(name) {
        const raw = game.settings.get(MODULE_ID, 'wakeTuning') ?? {};
        const presets = raw._presets ?? {};
        const preset = presets[name];
        if (!preset) { ui.notifications?.warn(`Preset "${name}" not found`); return; }
        const next = foundry.utils.mergeObject(
            foundry.utils.deepClone(WAKE_TUNING_DEFAULTS),
            preset,
            { inplace: false }
        );
        next._presets = presets;
        await game.settings.set(MODULE_ID, 'wakeTuning', next);
    }

    /** Delete a named preset. */
    static async deletePreset(name) {
        const raw = game.settings.get(MODULE_ID, 'wakeTuning') ?? {};
        if (raw._presets) {
            delete raw._presets[name];
            await game.settings.set(MODULE_ID, 'wakeTuning', raw);
        }
    }
}
