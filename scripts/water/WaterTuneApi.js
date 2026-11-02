import { MODULE_ID } from '../data/moduleId.js';
import { WATER_PRESETS } from './WaterPresets.js';

/**
 * Builds the `game.ionrift.waterTune` console helper and wires the region behavior preset dropdown.
 *
 * @param {(targetRegionId: string|undefined, cb: (mesh: import('./WaterMesh.js').WaterMesh) => void) => void} forMeshes
 * @param {(...args: unknown[]) => void} LOG
 * @returns {object}
 */
export function createWaterTuneApi(forMeshes, LOG) {
    return {
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
}

/**
 * Wires up the preset dropdown in Foundry RegionBehavior configuration sheets.
 * @param {(...args: unknown[]) => void} LOG
 */
export function registerBehaviorSheetHook(LOG) {
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
