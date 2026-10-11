import { WaterMesh } from './WaterMesh.js';
import { warmWaterShader } from './shaders/WaterShader.js';

const MODULE_ID = 'ionrift-waterline';
const LOG = (...args) => { try { if (game.settings?.get?.(MODULE_ID, 'debug')) console.log('Waterline |', ...args); } catch { /* setting not yet registered */ } };

import { WATER_ARCHETYPES, WATER_PRESETS } from './WaterPresets.js';
import { WaterBehaviorType } from './WaterBehaviorType.js';

export { WATER_ARCHETYPES, WATER_PRESETS, WaterBehaviorType };

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

    /** @type {number} Incremented on every full rebuild; stale async renders check it and bail */
    static #generation = 0;

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
        const userArchetype = /^user_(ocean|coast|lake|river|pond|puddle)_/i.exec(waterType || '');
        if (userArchetype) return userArchetype[1].toLowerCase();
        if (/^ocean/i.test(waterType) || waterType === 'abyssal_depths') return 'ocean';
        if (/^coast/i.test(waterType) || waterType === 'bay_chop') return 'coast';
        if (/^lake/i.test(waterType) || waterType === 'deep') return 'lake';
        if (/^river|^torrent|canal/i.test(waterType)) return 'river';
        if (/^pond|cistern|swamp/i.test(waterType)) return 'pond';
        if (/^puddle/i.test(waterType)) return 'puddle';
        return 'river';
    }

    /**
     * Split a studio preset key into the value stored on the behavior.
     * system.waterType only accepts built-in preset keys. That list is fixed
     * when the behavior type is registered, before world settings exist, so a
     * user key such as user_river_willowshore is rejected and the save is dropped.
     * User presets keep their key on a flag. The numeric settings still live on system.
     * @param {string} presetKey
     * @returns {{ waterType: string, customPreset: string }}
     */
    static persistPresetChoice(presetKey) {
        const key = presetKey === 'abyssal_depths' ? 'ocean_calm' : (presetKey || 'river');
        if (WATER_PRESETS[key]) return { waterType: key, customPreset: '' };
        return { waterType: 'custom', customPreset: key };
    }

    /**
     * Preset key to show in the studio for a saved water behavior.
     * An explicit empty customPreset on the behavior means a built-in preset was saved later.
     * @param {{ waterType?: string } | null | undefined} system
     * @param {{ customPreset?: string } | null | undefined} behaviorFlags
     * @param {{ customPreset?: string } | null | undefined} [regionFlags]
     * @returns {string}
     */
    static readPresetChoice(system, behaviorFlags, regionFlags) {
        const hasBehaviorKey = Boolean(
            behaviorFlags && Object.prototype.hasOwnProperty.call(behaviorFlags, 'customPreset')
        );
        const custom = hasBehaviorKey ? behaviorFlags.customPreset : regionFlags?.customPreset;
        if (typeof custom === 'string' && custom) return custom;
        const waterType = system?.waterType;
        if (waterType === 'abyssal_depths') return 'ocean_calm';
        return waterType || 'river';
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
        const generation = ++WaterManager.#generation;
        if (!canvas.scene) return;

        const regions = canvas.scene.regions?.contents ?? [];
        LOG(`refreshAll: scanning ${regions.length} regions`);

        const tasks = [];
        for (const regionDoc of regions) {
            const config = WaterManager.#getWaterConfig(regionDoc);
            if (config) {
                LOG(`Found water behavior on region "${regionDoc.name}"`);
                tasks.push(WaterManager.#renderWater(regionDoc, config, generation));
            }
        }
        await Promise.all(tasks);

        LOG(`refreshAll complete: ${WaterManager.#zones.size} water zones active`);
    }

    /**
     * Starts compiling the water shader in the background if the scene has any water.
     * Called early in canvas setup so the compile overlaps scene loading.
     * @param {Scene} [scene=canvas?.scene]
     */
    static prepareShader(scene = canvas?.scene) {
        const regions = scene?.regions?.contents ?? [];
        if (!regions.some(r => WaterManager.#getWaterConfig(r))) return;
        void warmWaterShader();
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
            if (config) await WaterManager.#renderWater(regionDoc, config, WaterManager.#generation);
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

    /**
     * Resolves the background image path for a scene across Foundry v11, v12, v13, and v14+.
     * Properly handles v14 SceneLevel embedded documents and legacy scene.background.src.
     * @param {Scene} [scene=canvas?.scene]
     * @returns {string|null}
     */
    static resolveSceneBackgroundSrc(scene = canvas?.scene) {
        if (!scene) return null;
        const level = scene.firstLevel ?? scene.levels?.contents?.[0] ?? null;
        return (level?.background?.src || scene._source?.background?.src || scene.background?.src || scene.img) || null;
    }

    static #solidBgTexture = null;
    static #solidBgColor = null;

    /**
     * Creates or returns a cached solid-color texture matching the scene background color.
     * Used when the scene has no background artwork, preventing water from rendering as solid white.
     * @returns {PIXI.Texture}
     */
    static #getSolidBgTexture() {
        const hex = canvas.scene?.backgroundColor || '#111922';
        if (WaterManager.#solidBgTexture && WaterManager.#solidBgColor === hex) {
            return WaterManager.#solidBgTexture;
        }
        try {
            if (typeof document !== 'undefined') {
                const canvasEl = document.createElement('canvas');
                canvasEl.width = 4;
                canvasEl.height = 4;
                const ctx = canvasEl.getContext('2d');
                ctx.fillStyle = hex;
                ctx.fillRect(0, 0, 4, 4);
                WaterManager.#solidBgTexture?.destroy?.(true);
                WaterManager.#solidBgTexture = PIXI.Texture.from(canvasEl);
                WaterManager.#solidBgColor = hex;
                return WaterManager.#solidBgTexture;
            }
        } catch {
            // Fallback silent ignore
        }
        return PIXI.Texture.WHITE;
    }

    static async #renderWater(regionDoc, config, generation = WaterManager.#generation) {
        const allPoints = WaterManager.#extractPoints(regionDoc);
        LOG(`  Extracted ${allPoints.length} point sets`);
        if (!allPoints.length) return;

        // Shared across all water bodies; compiles off the main thread while colour sampling runs
        const shaderReady = warmWaterShader();

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
        const bgPath = WaterManager.resolveSceneBackgroundSrc();
        let bgTexture = (canvas.primary?.background?.texture?.valid && canvas.primary.background.texture !== PIXI.Texture.WHITE && canvas.primary.background.texture !== PIXI.Texture.EMPTY)
            ? canvas.primary.background.texture
            : null;
        if (!bgTexture && bgPath) {
            try {
                bgTexture = await PIXI.Assets.load(bgPath);
                LOG(`  Background texture loaded for distortion`);
            } catch {
                LOG(`  WARNING: Could not load bg texture`);
            }
        }
        if (!bgTexture) {
            bgTexture = WaterManager.#getSolidBgTexture();
        }

        // Meshes must not draw until the shader is ready, or the renderer compiles it synchronously
        await shaderReady;
        if (generation !== WaterManager.#generation || canvas.scene?.id !== regionDoc.parent?.id) {
            LOG(`  Skipping stale water render for "${regionDoc.name}"`);
            return;
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
    static #bgThumbnailCache = new Map();

    /**
     * Clear cached background colors (e.g. on scene change).
     */
    static clearSampledColorCache() {
        WaterManager.#sampledColorCache.clear();
        WaterManager.#bgThumbnailCache.clear();
        try {
            WaterManager.#solidBgTexture?.destroy?.(true);
        } catch { /* ignore */ }
        WaterManager.#solidBgTexture = null;
        WaterManager.#solidBgColor = null;
    }

    /**
     * Retrieves or generates a downsampled thumbnail of the scene background image.
     * Prevents multi-megabyte canvas allocations and main-thread freezes on high-res battlemaps.
     * @param {string} bgPath
     * @returns {Promise<{ data: Uint8ClampedArray, width: number, height: number } | null>}
     */
    static #getSceneThumbnail(bgPath) {
        if (!bgPath) return Promise.resolve(null);
        if (!WaterManager.#bgThumbnailCache.has(bgPath)) {
            const pending = WaterManager.#buildSceneThumbnail(bgPath).then(thumb => {
                if (!thumb && WaterManager.#bgThumbnailCache.get(bgPath) === pending) {
                    WaterManager.#bgThumbnailCache.delete(bgPath);
                }
                return thumb;
            });
            WaterManager.#bgThumbnailCache.set(bgPath, pending);
        }
        return WaterManager.#bgThumbnailCache.get(bgPath);
    }

    static async #buildSceneThumbnail(bgPath) {
        try {
            const img = await new Promise((resolve, reject) => {
                const i = new Image();
                i.crossOrigin = 'anonymous';
                i.onload = () => resolve(i);
                i.onerror = reject;
                i.src = bgPath;
            });
            // Decode off the main thread so drawImage below does not stall on large maps
            try { await img.decode?.(); } catch { /* drawImage will decode */ }

            const maxDim = 384;
            const rawW = img.naturalWidth || img.width || 1000;
            const rawH = img.naturalHeight || img.height || 1000;
            let targetW = rawW;
            let targetH = rawH;
            if (targetW > maxDim || targetH > maxDim) {
                if (targetW >= targetH) {
                    targetH = Math.max(1, Math.round(rawH * (maxDim / rawW)));
                    targetW = maxDim;
                } else {
                    targetW = Math.max(1, Math.round(rawW * (maxDim / rawH)));
                    targetH = maxDim;
                }
            }

            const offscreen = document.createElement('canvas');
            offscreen.width = targetW;
            offscreen.height = targetH;
            const ctx = offscreen.getContext('2d', { willReadFrequently: true });
            ctx.drawImage(img, 0, 0, targetW, targetH);

            return {
                data: ctx.getImageData(0, 0, targetW, targetH).data,
                width: targetW,
                height: targetH
            };
        } catch (err) {
            LOG('  Background thumbnail generation failed:', err);
            return null;
        }
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

        const bgPath = WaterManager.resolveSceneBackgroundSrc();
        if (!bgPath) return fallback;

        const cacheKey = `${regionId || 'anon'}-${bgPath}`;
        if (WaterManager.#sampledColorCache.has(cacheKey)) {
            return WaterManager.#sampledColorCache.get(cacheKey);
        }

        try {
            const thumb = await WaterManager.#getSceneThumbnail(bgPath);
            if (!thumb) return fallback;

            const dims = canvas.dimensions;
            if (!dims?.sceneWidth || !dims?.sceneHeight) return fallback;

            const scaleX = thumb.width / dims.sceneWidth;
            const scaleY = thumb.height / dims.sceneHeight;
            const fullImageData = thumb.data;

            // Collect individual samples with luminance
            const pixelSamples = [];

            for (const points of pointSets) {
                let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
                for (let i = 0; i < points.length; i += 2) {
                    minX = Math.min(minX, points[i]);
                    minY = Math.min(minY, points[i + 1]);
                    maxX = Math.max(maxX, points[i]);
                    maxY = Math.max(maxY, points[i + 1]);
                }

                const span = Math.max(maxX - minX, maxY - minY);
                const step = Math.max(16, Math.round(span / 30));

                for (let sy = minY; sy <= maxY; sy += step) {
                    for (let sx = minX; sx <= maxX; sx += step) {
                        const imgX = Math.round((sx - dims.sceneX) * scaleX);
                        const imgY = Math.round((sy - dims.sceneY) * scaleY);
                        if (imgX < 0 || imgX >= thumb.width || imgY < 0 || imgY >= thumb.height) continue;

                        const pIdx = (imgY * thumb.width + imgX) * 4;
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

