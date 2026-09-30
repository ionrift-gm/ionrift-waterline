import { WaterMesh } from './WaterMesh.js';

const MODULE_ID = 'ionrift-waterline';
const LOG = (...args) => { try { if (game.settings?.get?.(MODULE_ID, 'debug')) console.log('Waterline |', ...args); } catch { /* setting not yet registered */ } };

/**
 * Water body type presets. Each maps to a set of uniform defaults.
 */
/**
 * Tabletop Fluid Archetypes with distinct visual identities and fantasy roles.
 */
export const WATER_ARCHETYPES = {
    ocean: {
        key: 'ocean',
        label: 'Ocean',
        icon: 'fas fa-sailboat',
        accentColor: '#3b82f6',
        defaultPreset: 'ocean_choppy',
        description: 'Vast rolling swells, deep ocean chop, and seafoam whitecaps.'
    },
    coast: {
        key: 'coast',
        label: 'Coastline',
        icon: 'fas fa-umbrella-beach',
        accentColor: '#0d9488',
        defaultPreset: 'coast',
        description: 'Breaking coastal surf, tidal swash surges, and shallow reefs.'
    },
    lake: {
        key: 'lake',
        label: 'Lake',
        icon: 'fas fa-compass',
        accentColor: '#0284c7',
        defaultPreset: 'lake',
        description: 'Placid mirror glass, gentle wind ruffles, and bottomless tarns.'
    },
    river: {
        key: 'river',
        label: 'River',
        icon: 'fas fa-water',
        accentColor: '#06b6d4',
        defaultPreset: 'river',
        description: 'Directional current, tumbling white-water rapids, and forest creeks.'
    },
    pond: {
        key: 'pond',
        label: 'Pond',
        icon: 'fas fa-spa',
        accentColor: '#059669',
        defaultPreset: 'pond_woodland',
        description: 'Small inland pools, garden springs, hot springs, and cavern grottos.'
    },
    puddle: {
        key: 'puddle',
        label: 'Puddle',
        icon: 'fas fa-tint',
        accentColor: '#d97706',
        defaultPreset: 'puddle_rain',
        description: 'Rain ruts, shallow damp cobblestones, murky slimes, and spilled liquid.'
    }
};

/**
 * Water body type presets organized by Tabletop Archetype.
 */
export const WATER_PRESETS = {
    // Custom fallback
    custom:         { label: 'Custom',            archetype: 'ocean',  opacity: 0.20, speed: 0.80, distortion: 0.020, intensity: 0.50, fadeWidth: 50, scale: 110, flowAngle: 0,   shoreWaves: 0.10, waveSegment: 0.85, waveRegularity: 0.60, swashSurge: 24.0, surfFoam: 0.70, choppySeas: 0.00, riverWaves: 0.00, lakeWaves: 0.00, lakeRings: false, whitecaps: 0.00, sunGlint: 0.00 },

    // 1. Open Sea / Ocean
    ocean_choppy:   { label: 'Choppy Sea',        archetype: 'ocean',  opacity: 0.34, speed: 0.85, distortion: 0.026, intensity: 0.75, fadeWidth: 85, scale: 130, flowAngle: 45,  shoreWaves: 0.15, waveCount: 4, waveSegment: 0.85, waveRegularity: 0.50, swashSurge: 28.0, surfFoam: 0.75, choppySeas: 0.90, riverWaves: 0.00, lakeWaves: 0.00, lakeRings: false, whitecaps: 0.75, sunGlint: 0.80 },
    ocean_swell:    { label: 'Ocean Swells',      archetype: 'ocean',  opacity: 0.32, speed: 0.70, distortion: 0.022, intensity: 0.75, fadeWidth: 85, scale: 160, flowAngle: 30,  shoreWaves: 0.12, waveCount: 4, waveSegment: 0.85, waveRegularity: 0.70, swashSurge: 26.0, surfFoam: 0.65, choppySeas: 0.65, riverWaves: 0.00, lakeWaves: 0.00, lakeRings: false, whitecaps: 0.35, sunGlint: 0.75 },
    ocean_storm:    { label: 'Stormy Sea',        archetype: 'ocean',  opacity: 0.36, speed: 1.20, distortion: 0.035, intensity: 0.85, fadeWidth: 90, scale: 220, flowAngle: 60,  shoreWaves: 0.25, waveCount: 5, waveSegment: 0.90, waveRegularity: 0.35, swashSurge: 42.0, surfFoam: 0.90, choppySeas: 1.35, riverWaves: 0.00, lakeWaves: 0.00, lakeRings: false, whitecaps: 1.25, sunGlint: 0.90 },
    ocean_calm:     { label: 'Calm Sea',          archetype: 'ocean',  opacity: 0.40, speed: 0.45, distortion: 0.018, intensity: 0.60, fadeWidth: 100, scale: 190, flowAngle: 45, shoreWaves: 0.05, waveCount: 3, waveSegment: 0.85, waveRegularity: 0.80, swashSurge: 20.0, surfFoam: 0.40, choppySeas: 0.50, riverWaves: 0.00, lakeWaves: 0.00, lakeRings: false, whitecaps: 0.20, sunGlint: 0.40 },

    // 2. Shoreline / Coast
    coast:          { label: 'Coastal Surf',      archetype: 'coast',  opacity: 0.20, speed: 0.85, distortion: 0.020, intensity: 0.65, fadeWidth: 65, scale: 135, flowAngle: 270, shoreWaves: 0.55, waveCount: 4, waveSegment: 0.90, waveRegularity: 0.60, swashSurge: 34.0, surfFoam: 0.85, choppySeas: 0.35, riverWaves: 0.00, lakeWaves: 0.00, lakeRings: false, whitecaps: 0.30, sunGlint: 0.50 },
    coast_gentle:   { label: 'Gentle Tide',       archetype: 'coast',  opacity: 0.18, speed: 0.55, distortion: 0.016, intensity: 0.45, fadeWidth: 55, scale: 110, flowAngle: 270, shoreWaves: 0.30, waveCount: 3, waveSegment: 0.85, waveRegularity: 0.75, swashSurge: 20.0, surfFoam: 0.55, choppySeas: 0.15, riverWaves: 0.00, lakeWaves: 0.00, lakeRings: false, whitecaps: 0.10, sunGlint: 0.45 },
    bay_chop:       { label: 'Bay Chop',          archetype: 'coast',  opacity: 0.22, speed: 0.90, distortion: 0.018, intensity: 0.60, fadeWidth: 55, scale: 75,  flowAngle: 120, shoreWaves: 0.30, waveCount: 4, waveSegment: 0.80, waveRegularity: 0.40, swashSurge: 18.0, surfFoam: 0.70, choppySeas: 0.65, riverWaves: 0.00, lakeWaves: 0.00, lakeRings: false, whitecaps: 0.40, sunGlint: 0.60 },
    coast_crashing: { label: 'Crashing Surf',     archetype: 'coast',  opacity: 0.26, speed: 1.15, distortion: 0.028, intensity: 0.85, fadeWidth: 75, scale: 145, flowAngle: 270, shoreWaves: 0.85, waveCount: 6, waveSegment: 0.92, waveRegularity: 0.30, swashSurge: 46.0, surfFoam: 0.95, choppySeas: 0.60, riverWaves: 0.00, lakeWaves: 0.00, lakeRings: false, whitecaps: 0.65, sunGlint: 0.70 },

    // 3. Lake / Deep Water
    lake:           { label: 'Calm Lake',         archetype: 'lake',   opacity: 0.15, speed: 0.28, distortion: 0.014, intensity: 0.35, fadeWidth: 35, scale: 140, flowAngle: 0,   shoreWaves: 0.12, waveSegment: 0.70, waveRegularity: 0.85, swashSurge: 14.0, surfFoam: 0.30, choppySeas: 0.00, riverWaves: 0.00, lakeWaves: 0.12, lakeRings: true,  whitecaps: 0.00, sunGlint: 0.25 },
    lake_windswept: { label: 'Windy Lake',        archetype: 'lake',   opacity: 0.22, speed: 0.65, distortion: 0.022, intensity: 0.55, fadeWidth: 40, scale: 105, flowAngle: 60,  shoreWaves: 0.35, waveSegment: 0.75, waveRegularity: 0.45, swashSurge: 22.0, surfFoam: 0.55, choppySeas: 0.00, riverWaves: 0.00, lakeWaves: 0.65, lakeRings: true,  whitecaps: 0.10, sunGlint: 0.50 },
    deep:           { label: 'Deep Lake',         archetype: 'lake',   opacity: 0.30, speed: 0.45, distortion: 0.018, intensity: 0.50, fadeWidth: 50, scale: 150, flowAngle: 45,  shoreWaves: 0.20, waveSegment: 0.80, waveRegularity: 0.65, swashSurge: 16.0, surfFoam: 0.25, choppySeas: 0.00, riverWaves: 0.00, lakeWaves: 0.35, lakeRings: false, whitecaps: 0.05, sunGlint: 0.40 },

    // 4. River / Stream
    river:          { label: 'Meandering Stream', archetype: 'river',  opacity: 0.15, speed: 1.25, distortion: 0.032, intensity: 0.25, fadeWidth: 60, scale: 90,  flowAngle: 90,  shoreWaves: 0.20, waveSegment: 0.85, waveRegularity: 0.60, swashSurge: 16.0, surfFoam: 0.35, choppySeas: 0.00, riverWaves: 0.65, lakeWaves: 0.00, lakeRings: false, whitecaps: 0.15, sunGlint: 0.35 },
    torrent:        { label: 'Mountain Rapids',   archetype: 'river',  opacity: 0.12, speed: 1.85, distortion: 0.038, intensity: 0.30, fadeWidth: 45, scale: 72,  flowAngle: 90,  shoreWaves: 0.50, waveSegment: 0.80, waveRegularity: 0.15, swashSurge: 26.0, surfFoam: 0.60, choppySeas: 0.00, riverWaves: 0.95, lakeWaves: 0.00, lakeRings: false, whitecaps: 0.48, sunGlint: 0.55 },
    river_forest:   { label: 'Forest Brook',      archetype: 'river',  opacity: 0.14, speed: 0.95, distortion: 0.025, intensity: 0.20, fadeWidth: 50, scale: 80,  flowAngle: 90,  shoreWaves: 0.12, waveSegment: 0.75, waveRegularity: 0.70, swashSurge: 10.0, surfFoam: 0.30, choppySeas: 0.00, riverWaves: 0.45, lakeWaves: 0.00, lakeRings: false, whitecaps: 0.08, sunGlint: 0.25 },
    canal:          { label: 'Calm Canal',        archetype: 'river',  opacity: 0.18, speed: 0.55, distortion: 0.015, intensity: 0.25, fadeWidth: 20, scale: 85,  flowAngle: 90,  shoreWaves: 0.04, waveSegment: 0.80, waveRegularity: 0.85, swashSurge: 4.0,  surfFoam: 0.15, choppySeas: 0.00, riverWaves: 0.20, lakeWaves: 0.00, lakeRings: false, whitecaps: 0.00, sunGlint: 0.20 },

    // 5. Pond / Small Body
    pond_woodland:  { label: 'Woodland Pond',     archetype: 'pond',   opacity: 0.18, speed: 0.35, distortion: 0.012, intensity: 0.30, fadeWidth: 45, scale: 90,  flowAngle: 30,  shoreWaves: 0.08, waveSegment: 0.70, waveRegularity: 0.65, swashSurge: 8.0,  surfFoam: 0.20, choppySeas: 0.00, riverWaves: 0.00, lakeWaves: 0.25, lakeRings: true,  whitecaps: 0.00, sunGlint: 0.15 },
    pond_hotspring: { label: 'Hot Springs',       archetype: 'pond',   opacity: 0.22, speed: 0.45, distortion: 0.020, intensity: 0.40, fadeWidth: 35, scale: 85,  flowAngle: 90,  shoreWaves: 0.06, waveSegment: 0.70, waveRegularity: 0.50, swashSurge: 9.0,  surfFoam: 0.25, choppySeas: 0.00, riverWaves: 0.00, lakeWaves: 0.35, lakeRings: true,  whitecaps: 0.00, sunGlint: 0.30 },
    cistern:        { label: 'Cavern Pool',       archetype: 'pond',   opacity: 0.16, speed: 0.25, distortion: 0.010, intensity: 0.35, fadeWidth: 30, scale: 80,  flowAngle: 0,   shoreWaves: 0.06, waveSegment: 0.85, waveRegularity: 0.80, swashSurge: 4.0,  surfFoam: 0.10, choppySeas: 0.00, riverWaves: 0.00, lakeWaves: 0.15, lakeRings: true,  whitecaps: 0.00, sunGlint: 0.00 },
    swamp:          { label: 'Murky Swamp',       archetype: 'pond',   opacity: 0.28, speed: 0.30, distortion: 0.015, intensity: 0.15, fadeWidth: 40, scale: 100, flowAngle: 180, shoreWaves: 0.05, waveSegment: 0.85, waveRegularity: 0.40, swashSurge: 8.0,  surfFoam: 0.15, choppySeas: 0.00, riverWaves: 0.00, lakeWaves: 0.10, lakeRings: true,  whitecaps: 0.00, sunGlint: 0.00 },

    // 6. Puddle / Standing Water
    puddle_rain:    { label: 'Rain Puddle',       archetype: 'puddle', opacity: 0.14, speed: 0.85, distortion: 0.025, intensity: 0.25, fadeWidth: 20, scale: 50,  flowAngle: 0,   shoreWaves: 0.06, waveSegment: 0.85, waveRegularity: 0.40, swashSurge: 8.0,  surfFoam: 0.10, choppySeas: 0.00, riverWaves: 0.00, lakeWaves: 0.05, lakeRings: true,  whitecaps: 0.00, sunGlint: 0.00 },
    puddle_mud:     { label: 'Muddy Puddle',      archetype: 'puddle', opacity: 0.30, speed: 0.50, distortion: 0.015, intensity: 0.15, fadeWidth: 15, scale: 45,  flowAngle: 0,   shoreWaves: 0.02, waveSegment: 0.85, waveRegularity: 0.50, swashSurge: 6.0,  surfFoam: 0.05, choppySeas: 0.00, riverWaves: 0.00, lakeWaves: 0.00, lakeRings: false, whitecaps: 0.00, sunGlint: 0.00, colorOverride: '#3d3020' },
    puddle_slime:   { label: 'Slime Pool',        archetype: 'puddle', opacity: 0.35, speed: 0.65, distortion: 0.030, intensity: 0.35, fadeWidth: 15, scale: 55,  flowAngle: 0,   shoreWaves: 0.04, waveSegment: 0.85, waveRegularity: 0.30, swashSurge: 8.0,  surfFoam: 0.10, choppySeas: 0.00, riverWaves: 0.00, lakeWaves: 0.00, lakeRings: false, whitecaps: 0.00, sunGlint: 0.20, colorOverride: '#235914' },
    puddle_blood:   { label: 'Crimson Pool',      archetype: 'puddle', opacity: 0.38, speed: 0.55, distortion: 0.020, intensity: 0.25, fadeWidth: 18, scale: 50,  flowAngle: 0,   shoreWaves: 0.03, waveSegment: 0.85, waveRegularity: 0.60, swashSurge: 8.0,  surfFoam: 0.10, choppySeas: 0.00, riverWaves: 0.00, lakeWaves: 0.00, lakeRings: false, whitecaps: 0.00, sunGlint: 0.35, colorOverride: '#540c11' },

    // Legacy alias
    puddle:         { label: 'Rain Puddle',       archetype: 'puddle', opacity: 0.14, speed: 0.85, distortion: 0.025, intensity: 0.25, fadeWidth: 20, scale: 50,  flowAngle: 0,   shoreWaves: 0.06, waveSegment: 0.85, waveRegularity: 0.40, swashSurge: 8.0,  surfFoam: 0.10, choppySeas: 0.00, riverWaves: 0.00, lakeWaves: 0.05, lakeRings: true,  whitecaps: 0.00, sunGlint: 0.00 }
};

/**
 * Custom RegionBehaviorType for animated water overlay.
 */
export class WaterBehaviorType extends foundry.data.regionBehaviors.RegionBehaviorType {

    static defineSchema() {
        const fields = foundry.data.fields;
        return {
            archetype:     new fields.StringField({
                initial: 'river',
                label: 'Archetype',
                choices: Object.fromEntries(
                    Object.entries(WATER_ARCHETYPES).map(([k, v]) => [k, v.label])
                )
            }),
            intensity:     new fields.NumberField({ initial: 0.25,    min: 0.0,  max: 2.0,   step: 0.05,  label: 'Intensity' }),
            speed:         new fields.NumberField({ initial: 1.40,    min: 0.05, max: 3.0,   step: 0.05,  label: 'Speed' }),
            opacity:       new fields.NumberField({ initial: 0.15,    min: 0.05, max: 0.5,   step: 0.01,  label: 'Opacity' }),
            distortion:    new fields.NumberField({ initial: 0.035,   min: 0.0,  max: 0.05,  step: 0.001, label: 'Distortion' }),
            fadeWidth:     new fields.NumberField({ initial: 60,      min: 0,    max: 200,   step: 5,     label: 'Edge Fade' }),
            scale:         new fields.NumberField({ initial: 90,      min: 30,   max: 400,   step: 5,     label: 'Scale' }),
            flowAngle:     new fields.NumberField({ initial: 90,      min: 0,    max: 359,   step: 5,     label: 'Flow Direction' }),
            shoreWaves:    new fields.NumberField({ initial: 0.15,    min: 0.0,  max: 1.0,   step: 0.05,  label: 'Shore Waves' }),
            waveCount:     new fields.NumberField({ initial: 4,       min: 1,    max: 8,     step: 1,     label: 'Wave Count' }),
            waveSegment:   new fields.NumberField({ initial: 0.85,    min: 0.0,  max: 1.0,   step: 0.05,  label: 'Wave Breakup' }),
            waveRegularity: new fields.NumberField({ initial: 0.60,   min: 0.0,  max: 1.0,   step: 0.05,  label: 'Wave Regularity' }),
            swashSurge:    new fields.NumberField({ initial: 24.0,    min: 0.0,  max: 60.0,  step: 1.0,   label: 'Surge Reach' }),
            surfFoam:      new fields.NumberField({ initial: 0.70,    min: 0.0,  max: 1.0,   step: 0.05,  label: 'Shoreline Foam' }),
            choppySeas:    new fields.NumberField({ initial: 0.0,     min: 0.0,  max: 1.5,   step: 0.05,  label: 'Open Sea Chop' }),
            riverWaves:    new fields.NumberField({ initial: 0.0,     min: 0.0,  max: 1.5,   step: 0.05,  label: 'River Waves' }),
            lakeWaves:     new fields.NumberField({ initial: 0.0,     min: 0.0,  max: 1.5,   step: 0.05,  label: 'Lake Waves' }),
            lakeRings:     new fields.NumberField({ initial: 0.0,     min: 0.0,  max: 2.0,   step: 0.05,  label: 'Drop Rings' }),
            whitecaps:     new fields.NumberField({ initial: 0.5,     min: 0.0,  max: 1.5,   step: 0.05,  label: 'Whitecaps' }),
            sunGlint:      new fields.NumberField({ initial: 0.6,     min: 0.0,  max: 2.0,   step: 0.05,  label: 'Sun Glint' }),
            spindriftWake: new fields.BooleanField({ initial: false,   label: 'Trailing Wake' }),
            crestBound:    new fields.BooleanField({ initial: false,   label: 'Crest-Locked' }),
            waterType:     new fields.StringField({
                initial: 'river',
                label: 'Preset',
                choices: Object.fromEntries(
                    Object.entries(WATER_PRESETS).map(([k, v]) => [k, v.label])
                )
            }),
            colorOverride: new fields.StringField({ initial: '',       label: 'Color Override' })
        };
    }

    static events = {};
}

/**
 * Manages water FX overlays using PIXI.Mesh + custom shaders.
 */
export class WaterManager {

    /** @type {Map<string, WaterMesh>} */
    static #zones = new Map();

    /** @type {Array<{ points: number[], elevation: { bottom: number, top: number } } | number[]>} */
    static #polygons = [];

    /** @type {number|null} Debounce timer for hook-triggered refreshes */
    static #refreshTimer = null;

    static registerBehavior() {
        try {
            Object.assign(CONFIG.RegionBehavior.dataModels, {
                [`${MODULE_ID}.waterFX`]: WaterBehaviorType
            });
            Object.assign(CONFIG.RegionBehavior.typeLabels, {
                [`${MODULE_ID}.waterFX`]: 'Ionrift: Water FX'
            });
            Object.assign(CONFIG.RegionBehavior.typeIcons, {
                [`${MODULE_ID}.waterFX`]: 'fas fa-water'
            });
            LOG('Registered WaterFX behavior type');
        } catch (err) {
            console.error(
                'Ionrift Waterline | Failed to register WaterFX behavior type. '
                + 'Scenes with existing water regions may show validation warnings. '
                + 'Error:', err
            );
        }
    }

    /**
     * Infer the archetype for a given waterType key.
     * @param {string} waterType
     * @returns {string} archetype key ('ocean'|'coast'|'lake'|'river'|'pond'|'puddle')
     */
    static inferArchetype(waterType) {
        if (WATER_PRESETS[waterType]?.archetype) return WATER_PRESETS[waterType].archetype;
        if (/^ocean/i.test(waterType) || waterType === 'abyssal_depths') return 'ocean';
        if (/^coast/i.test(waterType) || waterType === 'bay_chop') return 'coast';
        if (/^lake/i.test(waterType) || waterType === 'deep') return 'lake';
        if (/^river|^torrent|canal/i.test(waterType)) return 'river';
        if (/^pond|cistern|swamp/i.test(waterType)) return 'pond';
        if (/^puddle/i.test(waterType)) return 'puddle';
        return 'river';
    }

    /**
     * Retrieve all WaterMesh instances assigned to a specific region ID.
     * @param {string} regionId
     * @returns {WaterMesh[]}
     */
    static getMeshesForRegion(regionId) {
        if (!regionId) return [];
        const matches = [];
        for (const [, mesh] of WaterManager.#zones) {
            if (mesh.regionId === regionId) matches.push(mesh);
        }
        return matches;
    }

    static init() {
        LOG('WaterManager init');

        // Expose manager & tuning API on game.ionrift
        game.ionrift ??= {};
        game.ionrift.waterManager = WaterManager;

        const forMeshes = (targetRegionId, cb) => {
            for (const [, mesh] of WaterManager.#zones) {
                if (!targetRegionId || mesh.regionId === targetRegionId) cb(mesh);
            }
        };

        game.ionrift.waterTune = {
            /** Cycle blend mode on water meshes: waterTune.blend('SCREEN', regionId) */
            blend: (mode, regionId) => {
                forMeshes(regionId, m => m.setBlendMode(mode));
                LOG(`Blend mode set to: ${mode}`);
            },
            /** Set opacity: waterTune.opacity(0.4, regionId) */
            opacity: (val, regionId) => {
                forMeshes(regionId, m => m.setOpacity(val));
                LOG(`Opacity set to: ${val}`);
            },
            /** Set intensity: waterTune.intensity(1.0, regionId) */
            intensity: (val, regionId) => {
                forMeshes(regionId, m => m.setIntensity(val));
                LOG(`Intensity set to: ${val}`);
            },
            /** Set speed: waterTune.speed(0.8, regionId) */
            speed: (val, regionId) => {
                forMeshes(regionId, m => m.setSpeed(val));
                LOG(`Speed set to: ${val}`);
            },
            /** Set distortion: waterTune.distortion(0.01, regionId) */
            distortion: (val, regionId) => {
                forMeshes(regionId, m => m.setDistortion(val));
                LOG(`Distortion set to: ${val}`);
            },
            /** Set fadeWidth: waterTune.fadeWidth(50, regionId) */
            fadeWidth: (val, regionId) => {
                forMeshes(regionId, m => m.setFadeWidth(val));
                LOG(`FadeWidth set to: ${val}`);
            },
            /** Set scale: waterTune.scale(150, regionId) */
            scale: (val, regionId) => {
                forMeshes(regionId, m => m.setScale(val));
                LOG(`Scale set to: ${val}`);
            },
            /** Set flow angle in degrees: waterTune.flowAngle(90, regionId) */
            flowAngle: (deg, regionId) => {
                forMeshes(regionId, m => m.setFlowAngle(deg));
                LOG(`Flow angle set to: ${deg}°`);
            },
            /** Set shore wave intensity: waterTune.shoreWaves(0.5, regionId) */
            shoreWaves: (val, regionId) => {
                forMeshes(regionId, m => m.setShoreWaves(val));
                LOG(`Shore waves set to: ${val}`);
            },
            /** Set wave packet breakup: waterTune.waveSegment(0.85, regionId) */
            waveSegment: (val, regionId) => {
                forMeshes(regionId, m => m.setWaveSegment(val));
                LOG(`Wave breakup set to: ${val}`);
            },
            /** Set wave regularity: waterTune.waveRegularity(0.60, regionId) */
            waveRegularity: (val, regionId) => {
                forMeshes(regionId, m => m.setWaveRegularity(val));
                LOG(`Wave regularity set to: ${val}`);
            },
            /** Set swash surge reach: waterTune.swashSurge(24, regionId) */
            swashSurge: (val, regionId) => {
                forMeshes(regionId, m => m.setSwashSurge(val));
                LOG(`Surge reach set to: ${val}`);
            },
            /** Set shoreline foam intensity: waterTune.surfFoam(0.70, regionId) */
            surfFoam: (val, regionId) => {
                forMeshes(regionId, m => m.setSurfFoam(val));
                LOG(`Shoreline foam set to: ${val}`);
            },
            /** Set open sea chop intensity: waterTune.choppySeas(0.85, regionId) */
            choppySeas: (val, regionId) => {
                forMeshes(regionId, m => m.setChoppySeas(val));
                LOG(`Open sea chop set to: ${val}`);
            },
            /** Set river waves intensity: waterTune.riverWaves(0.65, regionId) */
            riverWaves: (val, regionId) => {
                forMeshes(regionId, m => m.setRiverWaves(val));
                LOG(`River waves set to: ${val}`);
            },
            /** Set lake waves intensity: waterTune.lakeWaves(0.65, regionId) */
            lakeWaves: (val, regionId) => {
                forMeshes(regionId, m => m.setLakeWaves(val));
                LOG(`Lake waves set to: ${val}`);
            },
            /** Toggle drop rings: waterTune.lakeRings(true, regionId) */
            lakeRings: (val, regionId) => {
                forMeshes(regionId, m => m.setLakeRings(val));
                LOG(`Lake rings set to: ${val}`);
            },
            /** Set whitecaps intensity: waterTune.whitecaps(0.65, regionId) */
            whitecaps: (val, regionId) => {
                forMeshes(regionId, m => m.setWhitecaps(val));
                LOG(`Whitecaps set to: ${val}`);
            },
            /** Set sun glint intensity: waterTune.sunGlint(0.80, regionId) */
            sunGlint: (val, regionId) => {
                forMeshes(regionId, m => m.setSunGlint(val));
                LOG(`Sun glint set to: ${val}`);
            },
            /** Toggle or set wave-triggered wake: waterTune.spindriftWake(true, regionId) */
            spindriftWake: (val, regionId) => {
                forMeshes(regionId, m => m.setSpindriftWake(val));
                LOG(`Spindrift wake set to: ${val}`);
            },
            /** Toggle or set crest-locked foam: waterTune.crestBound(true, regionId) */
            crestBound: (val, regionId) => {
                forMeshes(regionId, m => m.setCrestBound(val));
                LOG(`Crest-locked foam set to: ${val}`);
            },
            /** List available blend modes */
            modes: () => {
                const modes = ['NORMAL','ADD','MULTIPLY','SCREEN','OVERLAY','DARKEN',
                               'LIGHTEN','COLOR_DODGE','COLOR_BURN','HARD_LIGHT',
                               'SOFT_LIGHT','DIFFERENCE','EXCLUSION','HUE',
                               'SATURATION','COLOR','LUMINOSITY'];
                console.table(modes.map(m => ({
                    mode: m,
                    value: PIXI.BLEND_MODES[m] ?? '?'
                })));
                return modes;
            },
            /** Quick help */
            help: () => {
                console.log(`
Water Tuning API:
  game.ionrift.waterTune.blend('SCREEN', regionId)
  game.ionrift.waterTune.opacity(0.35, regionId)
  game.ionrift.waterTune.intensity(0.8, regionId)
  game.ionrift.waterTune.speed(0.5, regionId)
  game.ionrift.waterTune.distortion(0.01, regionId)
  game.ionrift.waterTune.flowAngle(90, regionId)
  game.ionrift.waterTune.shoreWaves(0.5, regionId)
  game.ionrift.waterTune.modes()
                `);
            }
        };
        LOG('Water tuning API available: game.ionrift.waterTune.help()');

        // Wire up preset dropdown in region behavior config sheets
        Hooks.on('renderRegionBehaviorConfig', (app, html) => {
            const typeKey = `${MODULE_ID}.waterFX`;
            const doc = app.document;
            if (doc?.type !== typeKey) return;

            // V12 ApplicationV2 passes HTMLElement, V1 AppV1 passes jQuery
            const root = html instanceof HTMLElement ? html
                : html?.[0] instanceof HTMLElement ? html[0]
                : null;
            if (!root) return;

            const select = root.querySelector('select[name="system.waterType"]');
            if (!select) {
                LOG('Preset select not found in behavior config');
                return;
            }

            select.addEventListener('change', () => {
                const preset = WATER_PRESETS[select.value];
                if (!preset || select.value === 'custom') return;

                const fieldMap = {
                    'system.speed': preset.speed,
                    'system.intensity': preset.intensity,
                    'system.opacity': preset.opacity,
                    'system.distortion': preset.distortion,
                    'system.fadeWidth': preset.fadeWidth,
                    'system.scale': preset.scale,
                    'system.shoreWaves': preset.shoreWaves,
                    'system.waveSegment': preset.waveSegment ?? 0.85,
                    'system.waveRegularity': preset.waveRegularity ?? 0.60,
                    'system.swashSurge': preset.swashSurge ?? 24.0,
                    'system.surfFoam': preset.surfFoam ?? 0.70,
                    'system.choppySeas': preset.choppySeas ?? 0.0,
                    'system.riverWaves': preset.riverWaves ?? 0.0,
                    'system.lakeWaves': preset.lakeWaves ?? 0.0,
                    'system.lakeRings': preset.lakeRings ?? false,
                    'system.whitecaps': preset.whitecaps ?? 0.5,
                    'system.sunGlint': preset.sunGlint ?? 0.6,
                    'system.colorOverride': preset.colorOverride ?? ''
                };

                for (const [name, val] of Object.entries(fieldMap)) {
                    const input = root.querySelector(`[name="${name}"]`);
                    if (input) {
                        input.value = val;
                        input.dispatchEvent(new Event('input', { bubbles: true }));
                        input.dispatchEvent(new Event('change', { bubbles: true }));
                    }
                }
                LOG(`Preset applied: ${select.value}`);
            });
            LOG('Preset dropdown wired');
        });
    }

    static async refreshAll() {
        WaterManager.destroyAll();
        if (!canvas.scene) return;

        const regions = canvas.scene.regions?.contents ?? [];
        LOG(`refreshAll: scanning ${regions.length} regions`);

        const tasks = [];
        for (const regionDoc of regions) {
            const config = WaterManager.#getWaterConfig(regionDoc);
            if (config) {
                LOG(`Found water behavior on region "${regionDoc.name}"`);
                tasks.push(WaterManager.#renderWater(regionDoc, config));
            }
        }
        await Promise.all(tasks);

        LOG(`refreshAll complete: ${WaterManager.#zones.size} water zones active`);
    }

    /**
     * Debounced refresh for hook-triggered updates.
     * Coalesces rapid sequential updates into a single rebuild.
     */
    static debouncedRefresh() {
        if (WaterManager.#refreshTimer) clearTimeout(WaterManager.#refreshTimer);
        WaterManager.#refreshTimer = setTimeout(() => {
            WaterManager.#refreshTimer = null;
            void WaterManager.refreshAll();
        }, 100);
    }

    /**
     * Handle updates to a water RegionBehavior without tearing down the mesh.
     * Updates shader uniforms in-place for instant, zero-flicker adjustments.
     * @param {RegionBehavior} behaviorDoc
     */
    static async onUpdateBehavior(behaviorDoc) {
        if (behaviorDoc.type !== `${MODULE_ID}.waterFX`) return;
        const regionDoc = behaviorDoc.parent;
        if (!regionDoc) return;

        const meshes = WaterManager.getMeshesForRegion(regionDoc.id);
        if (!meshes.length) {
            const config = WaterManager.#getWaterConfig(regionDoc);
            if (config) await WaterManager.#renderWater(regionDoc, config);
            return;
        }

        const config = behaviorDoc.system ?? {};
        const waterType = config.waterType === 'abyssal_depths' ? 'ocean_calm' : config.waterType;
        const preset = WATER_PRESETS[waterType] ?? WATER_PRESETS.custom;
        const resolvedArchetype = config.archetype ?? preset.archetype ?? 'river';
        const isSmallBody = (resolvedArchetype === 'lake' || resolvedArchetype === 'pond' || resolvedArchetype === 'puddle');

        for (const mesh of meshes) {
            mesh.setSpeed(config.speed ?? preset.speed ?? 1.0);
            mesh.setIntensity(config.intensity ?? preset.intensity ?? 0.3);
            mesh.setOpacity(config.opacity ?? preset.opacity ?? 0.2);
            mesh.setDistortion(config.distortion ?? preset.distortion ?? 0.02);
            mesh.setFadeWidth(config.fadeWidth ?? preset.fadeWidth ?? 50);
            mesh.setScale(config.scale ?? preset.scale ?? 90);
            mesh.setFlowAngle(config.flowAngle ?? preset.flowAngle ?? 0);
            mesh.setShoreWaves(config.shoreWaves ?? preset.shoreWaves ?? 0);
            mesh.setWaveCount(config.waveCount ?? preset.waveCount ?? 4);
            mesh.setWaveSegment(config.waveSegment ?? preset.waveSegment ?? 0.85);
            mesh.setWaveRegularity(config.waveRegularity ?? preset.waveRegularity ?? 0.60);
            mesh.setSwashSurge(config.swashSurge ?? preset.swashSurge ?? 24.0);
            mesh.setSurfFoam(config.surfFoam ?? preset.surfFoam ?? 0.70);
            mesh.setChoppySeas(config.choppySeas ?? preset.choppySeas ?? 0.0);
            mesh.setArchetype?.(resolvedArchetype);
            mesh.setRiverWaves(config.riverWaves ?? preset.riverWaves ?? 0.0);
            mesh.setLakeWaves(isSmallBody ? (config.lakeWaves ?? preset.lakeWaves ?? 0.0) : 0.0);
            const ringsVal = isSmallBody ? (config.lakeRings ?? preset.lakeRings ?? 0.0) : 0.0;
            mesh.setLakeRings(typeof ringsVal === 'number' ? ringsVal : (ringsVal ? 0.70 : 0.0));
            mesh.setWhitecaps(config.whitecaps ?? preset.whitecaps ?? 0.5);
            mesh.setSunGlint(config.sunGlint ?? preset.sunGlint ?? 0.6);
            mesh.setSpindriftWake(config.spindriftWake ?? preset.spindriftWake ?? false);
            mesh.setCrestBound(config.crestBound ?? preset.crestBound ?? false);
            mesh.setCoastSurf?.(resolvedArchetype === 'coast' || resolvedArchetype === 'ocean');

            let colorHex = null;
            if (typeof config.colorOverride === 'string') {
                colorHex = config.colorOverride.length >= 6 ? config.colorOverride : null;
            } else if (preset.colorOverride && preset.colorOverride.length >= 6) {
                colorHex = preset.colorOverride;
            }

            if (colorHex) {
                const hex = colorHex.replace('#', '');
                const rgb = [
                    parseInt(hex.slice(0, 2), 16) / 255,
                    parseInt(hex.slice(2, 4), 16) / 255,
                    parseInt(hex.slice(4, 6), 16) / 255
                ];
                mesh.setWaterColor(rgb);
            } else if (mesh.baseSampledColor) {
                mesh.setWaterColor(mesh.baseSampledColor);
            }
        }
    }

    static #getWaterConfig(regionDoc) {
        const behaviors = regionDoc.behaviors?.contents ?? [];
        for (const b of behaviors) {
            if (b.type === `${MODULE_ID}.waterFX` && !b.disabled) {
                return b.system ?? {};
            }
        }
        return null;
    }

    static async #renderWater(regionDoc, config) {
        const allPoints = WaterManager.#extractPoints(regionDoc);
        LOG(`  Extracted ${allPoints.length} point sets`);
        if (!allPoints.length) return;

        // Resolve water type preset as base defaults
        const waterType = config.waterType === 'abyssal_depths' ? 'ocean_calm' : config.waterType;
        const preset = WATER_PRESETS[waterType] ?? WATER_PRESETS.custom;
        const resolvedArchetype = config.archetype ?? preset.archetype ?? 'river';
        const isSmallBody = (resolvedArchetype === 'lake' || resolvedArchetype === 'pond' || resolvedArchetype === 'puddle');
        const resolvedConfig = {
            speed:       config.speed       ?? preset.speed,
            intensity:   config.intensity   ?? preset.intensity,
            opacity:     config.opacity     ?? preset.opacity,
            distortion:  config.distortion  ?? preset.distortion,
            fadeWidth:   config.fadeWidth   ?? preset.fadeWidth,
            scale:       config.scale       ?? preset.scale,
            flowAngle:   config.flowAngle   ?? preset.flowAngle ?? 0,
            shoreWaves:  config.shoreWaves  ?? preset.shoreWaves ?? 0,
            waveCount:   config.waveCount   ?? preset.waveCount ?? 4,
            waveSegment: config.waveSegment ?? preset.waveSegment ?? 0.85,
            waveRegularity: config.waveRegularity ?? preset.waveRegularity ?? 0.60,
            swashSurge:  config.swashSurge  ?? preset.swashSurge ?? 24.0,
            surfFoam:    config.surfFoam    ?? preset.surfFoam   ?? 0.70,
            choppySeas:  config.choppySeas  ?? preset.choppySeas ?? 0.0,
            riverWaves:  config.riverWaves  ?? preset.riverWaves ?? 0.0,
            lakeWaves:   isSmallBody ? (config.lakeWaves ?? preset.lakeWaves ?? 0.0) : 0.0,
            lakeRings:   isSmallBody ? (typeof (config.lakeRings ?? preset.lakeRings) === 'number' ? (config.lakeRings ?? preset.lakeRings) : ((config.lakeRings ?? preset.lakeRings) ? 0.70 : 0.0)) : 0.0,
            whitecaps:   config.whitecaps   ?? preset.whitecaps ?? 0.5,
            sunGlint:    config.sunGlint    ?? preset.sunGlint ?? 0.6,
            spindriftWake: config.spindriftWake ?? preset.spindriftWake ?? false,
            crestBound:    config.crestBound    ?? preset.crestBound ?? false,
            archetype:   resolvedArchetype
        };

        // Determine water color: manual override, preset override, or auto-sample
        let colorHex = null;
        if (typeof config.colorOverride === 'string') {
            colorHex = config.colorOverride.length >= 6 ? config.colorOverride : null;
        } else if (preset.colorOverride && preset.colorOverride.length >= 6) {
            colorHex = preset.colorOverride;
        }

        // Auto-sample background (cached per region) and shift toward blue
        const bgColor = await WaterManager.#sampleBackgroundColor(allPoints, regionDoc.id);
        const autoSampledColor = [
            bgColor[0] * 0.7,
            bgColor[1] * 0.85,
            Math.min(bgColor[2] * 1.4 + 0.15, 1.0)
        ];

        let waterColor;
        if (colorHex) {
            // Parse hex color override
            const hex = colorHex.replace('#', '');
            waterColor = [
                parseInt(hex.slice(0, 2), 16) / 255,
                parseInt(hex.slice(2, 4), 16) / 255,
                parseInt(hex.slice(4, 6), 16) / 255
            ];
            LOG(`  Using color override: ${colorHex}`);
        } else {
            waterColor = autoSampledColor;
            LOG(`  Auto-sampled water color: [${waterColor.map(v => v.toFixed(3))}]`);
        }

        // Extract region elevation bounds for multi-level maps
        let meshElevation = 0;
        let bottomBound = -Infinity;
        let topBound = Infinity;

        if (typeof regionDoc.elevation === 'number') {
            meshElevation = regionDoc.elevation;
            bottomBound = regionDoc.elevation;
            topBound = regionDoc.elevation;
        } else if (regionDoc.elevation && typeof regionDoc.elevation === 'object') {
            bottomBound = regionDoc.elevation.bottom ?? -Infinity;
            topBound = regionDoc.elevation.top ?? Infinity;
            meshElevation = Number.isFinite(bottomBound) ? bottomBound : (Number.isFinite(topBound) ? topBound : 0);
        }

        // Load background texture for distortion
        const bgPath = canvas.scene?.levels?.[0]?.background?.src ?? canvas.scene?.background?.src;
        let bgTexture = null;
        if (bgPath) {
            try {
                bgTexture = await PIXI.Assets.load(bgPath);
                LOG(`  Background texture loaded for distortion`);
            } catch {
                LOG(`  WARNING: Could not load bg texture`);
            }
        }
        if (!bgTexture) {
            bgTexture = PIXI.Texture.WHITE;
        }

        for (const points of allPoints) {
            const waterMesh = new WaterMesh(points, {
                speed:       resolvedConfig.speed,
                intensity:   resolvedConfig.intensity,
                opacity:     resolvedConfig.opacity,
                distortion:  resolvedConfig.distortion,
                fadeWidth:   resolvedConfig.fadeWidth,
                scale:       resolvedConfig.scale,
                flowAngle:   resolvedConfig.flowAngle,
                shoreWaves:  resolvedConfig.shoreWaves,
                waveCount:   resolvedConfig.waveCount,
                waveSegment: resolvedConfig.waveSegment,
                waveRegularity: resolvedConfig.waveRegularity,
                swashSurge:  resolvedConfig.swashSurge,
                surfFoam:    resolvedConfig.surfFoam,
                choppySeas:  resolvedConfig.choppySeas,
                riverWaves:  resolvedConfig.riverWaves,
                lakeWaves:   resolvedConfig.lakeWaves,
                lakeRings:   resolvedConfig.lakeRings,
                whitecaps:   resolvedConfig.whitecaps,
                sunGlint:    resolvedConfig.sunGlint,
                archetype:   resolvedConfig.archetype ?? preset.archetype ?? 'river',
                bgTexture:   bgTexture,
                waterColor:  waterColor,
                baseSampledColor: autoSampledColor,
                elevation:   meshElevation,
                sortLayer:   100,
                highlightColor: [
                    Math.min(waterColor[0] + 0.15, 1.0),
                    Math.min(waterColor[1] + 0.15, 1.0),
                    Math.min(waterColor[2] + 0.1, 1.0)
                ]
            });

            if (waterMesh.mesh) {
                waterMesh.regionId = regionDoc.id;
                waterMesh.mesh.elevation = meshElevation;
                waterMesh.mesh.sortLayer = 100;
                const layer = WaterManager.#getTargetLayer();
                layer.addChild(waterMesh.mesh);
                waterMesh.startAnimation();
                WaterManager.#zones.set(`${regionDoc.id}-${WaterManager.#zones.size}`, waterMesh);
                let pMinX = Infinity, pMinY = Infinity, pMaxX = -Infinity, pMaxY = -Infinity;
                for (let i = 0; i < points.length; i += 2) {
                    if (points[i] < pMinX) pMinX = points[i];
                    if (points[i] > pMaxX) pMaxX = points[i];
                    if (points[i + 1] < pMinY) pMinY = points[i + 1];
                    if (points[i + 1] > pMaxY) pMaxY = points[i + 1];
                }
                WaterManager.#polygons.push({
                    points,
                    bounds: [pMinX, pMinY, pMaxX, pMaxY],
                    elevation: { bottom: bottomBound, top: topBound }
                });
                LOG(`  Water mesh active for "${regionDoc.name}" at elevation ${meshElevation}`);
            }
        }
    }

    static #extractPoints(regionDoc) {
        const results = [];
        const shapes = regionDoc.shapes ?? [];

        for (const shape of shapes) {
            const shapeType = shape.type ?? shape.constructor?.name ?? '';

            if (shapeType === 'polygon' || shapeType === 'PolygonShapeData') {
                const pts = shape.points ?? shape.coordinates ?? [];
                if (pts.length >= 6) { results.push(Array.from(pts)); continue; }
            }

            if (shapeType === 'rectangle' || shapeType === 'RectangleShapeData') {
                const x = shape.x ?? 0, y = shape.y ?? 0;
                const w = shape.width ?? 0, h = shape.height ?? 0;
                if (w > 0 && h > 0) {
                    results.push([x, y, x + w, y, x + w, y + h, x, y + h]);
                    continue;
                }
            }

            if (shapeType === 'ellipse' || shapeType === 'EllipseShapeData') {
                const cx = (shape.x ?? 0) + (shape.radiusX ?? 0);
                const cy = (shape.y ?? 0) + (shape.radiusY ?? 0);
                const rx = shape.radiusX ?? 0, ry = shape.radiusY ?? 0;
                if (rx > 0 && ry > 0) {
                    const pts = [];
                    for (let i = 0; i < 24; i++) {
                        const a = (i / 24) * Math.PI * 2;
                        pts.push(Math.round(cx + rx * Math.cos(a)), Math.round(cy + ry * Math.sin(a)));
                    }
                    results.push(pts);
                    continue;
                }
            }

            if (shape.points?.length >= 6) { results.push(Array.from(shape.points)); continue; }

            if (typeof shape.toObject === 'function') {
                const plain = shape.toObject();
                if (plain.points?.length >= 6) { results.push(Array.from(plain.points)); continue; }
            }
        }

        return results;
    }

    static #sampledColorCache = new Map();

    /**
     * Clear cached background colors (e.g. on scene change).
     */
    static clearSampledColorCache() {
        WaterManager.#sampledColorCache.clear();
    }

    /**
     * Samples the average background color under the given polygons.
     * Uses IQR filtering to discard terrain bleed from imperfect borders.
     * Results are cached per region to guarantee rock-solid color stability across saves.
     * Returns [r, g, b] normalized to 0-1 range.
     * @param {number[][]} pointSets
     * @param {string} [regionId]
     */
    static async #sampleBackgroundColor(pointSets, regionId) {
        const fallback = [0.05, 0.15, 0.25];

        const bgPath = canvas.scene?.levels?.[0]?.background?.src ?? canvas.scene?.background?.src;
        if (!bgPath) return fallback;

        const cacheKey = `${regionId || 'anon'}-${bgPath}`;
        if (WaterManager.#sampledColorCache.has(cacheKey)) {
            return WaterManager.#sampledColorCache.get(cacheKey);
        }

        try {
            const img = await new Promise((resolve, reject) => {
                const i = new Image();
                i.crossOrigin = 'anonymous';
                i.onload = () => resolve(i);
                i.onerror = reject;
                i.src = bgPath;
            });

            const offscreen = document.createElement('canvas');
            offscreen.width = img.width;
            offscreen.height = img.height;
            const ctx = offscreen.getContext('2d', { willReadFrequently: true });
            ctx.drawImage(img, 0, 0);

            const dims = canvas.dimensions;
            const scaleX = img.width / dims.sceneWidth;
            const scaleY = img.height / dims.sceneHeight;

            const fullImageData = ctx.getImageData(0, 0, img.width, img.height).data;

            // Collect individual samples with luminance
            const pixelSamples = [];
            const step = 20;

            for (const points of pointSets) {
                let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
                for (let i = 0; i < points.length; i += 2) {
                    minX = Math.min(minX, points[i]);
                    minY = Math.min(minY, points[i + 1]);
                    maxX = Math.max(maxX, points[i]);
                    maxY = Math.max(maxY, points[i + 1]);
                }

                for (let sy = minY; sy <= maxY; sy += step) {
                    for (let sx = minX; sx <= maxX; sx += step) {
                        const imgX = Math.round((sx - dims.sceneX) * scaleX);
                        const imgY = Math.round((sy - dims.sceneY) * scaleY);
                        if (imgX < 0 || imgX >= img.width || imgY < 0 || imgY >= img.height) continue;

                        const pIdx = (imgY * img.width + imgX) * 4;
                        const r = fullImageData[pIdx] / 255;
                        const g = fullImageData[pIdx + 1] / 255;
                        const b = fullImageData[pIdx + 2] / 255;
                        const lum = 0.299 * r + 0.587 * g + 0.114 * b;

                        // Compute saturation (HSL)
                        const max = Math.max(r, g, b);
                        const min = Math.min(r, g, b);
                        const sat = (max === 0) ? 0 : (max - min) / max;

                        pixelSamples.push({ r, g, b, lum, sat });
                    }
                }
            }

            if (!pixelSamples.length) return fallback;

            // Pass 1: Filter out high-saturation pixels (vegetation/terrain)
            // Water tends to be desaturated (grey/blue)
            const desaturated = pixelSamples.filter(s => s.sat < 0.35);
            LOG(`  Saturation filter: ${pixelSamples.length} total, ${desaturated.length} low-sat`);

            // Use desaturated if enough samples, otherwise fall back to all
            const pool = desaturated.length >= 5 ? desaturated : pixelSamples;

            // Pass 2: IQR on luminance to remove remaining outliers
            pool.sort((a, b) => a.lum - b.lum);
            const q1 = Math.floor(pool.length * 0.25);
            const q3 = Math.ceil(pool.length * 0.75);
            const filtered = pool.slice(q1, q3);

            if (!filtered.length) return fallback;

            let totalR = 0, totalG = 0, totalB = 0;
            for (const s of filtered) {
                totalR += s.r;
                totalG += s.g;
                totalB += s.b;
            }

            LOG(`  Final color pool: ${filtered.length} samples after IQR`);

            const result = [
                totalR / filtered.length,
                totalG / filtered.length,
                totalB / filtered.length
            ];
            WaterManager.#sampledColorCache.set(cacheKey, result);
            return result;
        } catch (err) {
            LOG('  Background sampling failed:', err);
            return fallback;
        }
    }

    static destroyAll() {
        for (const [, mesh] of WaterManager.#zones) {
            try {
                mesh.destroy();
            } catch (err) {
                console.warn('Waterline | Error destroying water mesh:', err);
            }
        }
        WaterManager.#zones.clear();
        WaterManager.#polygons = [];
    }

    /**
     * Test whether a world-space point is inside any active water zone.
     * Uses ray-casting point-in-polygon on the stored flat point arrays,
     * matching elevation against region bounds if provided.
     *
     * @param {number} px - World X
     * @param {number} py - World Y
     * @param {number} [elevation] - Optional elevation to match against region vertical bounds
     * @returns {boolean}
     */
    static isPointInWater(px, py, elevation = undefined) {
        for (const entry of WaterManager.#polygons) {
            const pts = Array.isArray(entry) ? entry : entry.points;
            const bounds = entry?.elevation;

            if (elevation !== undefined && elevation !== null && bounds) {
                const minEl = bounds.bottom ?? -Infinity;
                const maxEl = bounds.top ?? Infinity;
                if (elevation < minEl || elevation > maxEl) continue;
            }

            const aabb = entry?.bounds;
            if (aabb && (px < aabb[0] || px > aabb[2] || py < aabb[1] || py > aabb[3])) {
                continue;
            }

            if (WaterManager.#pointInPolygon(px, py, pts)) return true;
        }
        return false;
    }

    /**
     * Push wake ripple uniforms to every active water mesh (shader refraction).
     * @param {Float32Array} buf - 32 floats (8 vec4: cx, cy, ringR, amp)
     * @param {number} count - Active slots 0-8
     * @param {object} [tuning] - Optional wake tuning for shader globals
     */
    static syncWakeUniforms(buf, count, tuning) {
        for (const mesh of WaterManager.#zones.values()) {
            mesh.setWakeData(buf, count, tuning);
        }
    }

    /**
     * Push wet token position uniforms to every active water mesh (emanating wavelets).
     * @param {Float32Array} buf - 16 floats (4 vec4: cx, cy, tokR, isWet)
     * @param {number} count - Active slots 0-4
     */
    static syncTokenUniforms(buf, count) {
        for (const mesh of WaterManager.#zones.values()) {
            mesh.setTokenData?.(buf, count);
        }
    }

    /**
     * Ray-casting point-in-polygon test for a flat [x,y,x,y,...] array.
     * @param {number} px
     * @param {number} py
     * @param {number[]} flatPoints
     * @returns {boolean}
     */
    static #pointInPolygon(px, py, flatPoints) {
        const n = flatPoints.length / 2;
        let inside = false;
        for (let i = 0, j = n - 1; i < n; j = i++) {
            const xi = flatPoints[i * 2],     yi = flatPoints[i * 2 + 1];
            const xj = flatPoints[j * 2],     yj = flatPoints[j * 2 + 1];
            if (((yi > py) !== (yj > py)) &&
                (px < (xj - xi) * (py - yi) / (yj - yi) + xi)) {
                inside = !inside;
            }
        }
        return inside;
    }

    /**
     * Returns the best canvas layer for water placement.
     * Ideal: canvas.primary (above map, below effects/weather).
     * Falls back to effects, then interface.
     */
    static #getTargetLayer() {
        const candidates = [
            { ref: canvas.primary, name: 'canvas.primary' },
            { ref: canvas.effects, name: 'canvas.effects' },
            { ref: canvas.interface, name: 'canvas.interface' }
        ];
        for (const { ref, name } of candidates) {
            if (ref && typeof ref.addChild === 'function') {
                LOG(`  Target layer: ${name}`);
                return ref;
            }
        }
        LOG('  WARNING: No canvas layer found, using stage');
        return canvas.stage;
    }
}

