import { WaterMesh } from './WaterMesh.js';
import { warmWaterShader } from './shaders/WaterShader.js';

import { MODULE_ID } from '../data/moduleId.js';
const LOG = (...args) => { try { if (game.settings?.get?.(MODULE_ID, 'debug')) console.log('Waterline |', ...args); } catch { /* setting not yet registered */ } };

import { WATER_ARCHETYPES, WATER_PRESETS } from './WaterPresets.js';
import { WaterBehaviorType } from './WaterBehaviorType.js';
import { WaterColorSampler } from './WaterColorSampler.js';
import { WaterTokenPolicy } from './WaterTokenPolicy.js';
import { createWaterTuneApi, registerBehaviorSheetHook } from './WaterTuneApi.js';

export { WATER_ARCHETYPES, WATER_PRESETS, WaterBehaviorType, WaterTokenPolicy };

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

        game.ionrift.waterTune = createWaterTuneApi(forMeshes, LOG);
        LOG('Water tuning API available: game.ionrift.waterTune.help()');

        registerBehaviorSheetHook(LOG);
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
                const baseOpacity = config.opacity ?? preset.opacity ?? 0.2;
                mesh.setOpacity(Math.min(0.75, baseOpacity + 0.28));
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
     * @param {Scene} [scene=canvas?.scene]
     * @returns {string|null}
     */
    static resolveSceneBackgroundSrc(scene = canvas?.scene) {
        return WaterColorSampler.resolveSceneBackgroundSrc(scene);
    }

    /**
     * Clear cached background colors (e.g. on scene change).
     */
    static clearSampledColorCache() {
        WaterColorSampler.clearSampledColorCache();
    }

    static async #renderWater(regionDoc, config, generation = WaterManager.#generation) {
        const allPoints = WaterColorSampler.extractPoints(regionDoc);
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
        if (colorHex) {
            resolvedConfig.opacity = Math.min(0.75, (resolvedConfig.opacity ?? 0.2) + 0.28);
        }

        // Auto-sample background (cached per region) and shift toward blue
        const bgColor = await WaterColorSampler.sampleBackgroundColor(allPoints, regionDoc.id);
        const autoSampledColor = [
            bgColor[0] * 0.7,
            bgColor[1] * 0.85,
            Math.min(bgColor[2] * 1.4 + 0.15, 1.0)
        ];

        let waterColor;
        if (colorHex) {
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
        let topBound = 0;

        if (typeof regionDoc.elevation === 'number') {
            meshElevation = regionDoc.elevation;
            bottomBound = regionDoc.elevation;
            topBound = regionDoc.elevation;
        } else if (regionDoc.elevation && typeof regionDoc.elevation === 'object') {
            bottomBound = regionDoc.elevation.bottom ?? -Infinity;
            topBound = regionDoc.elevation.top ?? Infinity;
            meshElevation = Number.isFinite(bottomBound) ? bottomBound : (Number.isFinite(topBound) ? topBound : 0);
            if (!Number.isFinite(topBound)) topBound = meshElevation;
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
            bgTexture = WaterColorSampler.getSolidBgTexture();
        }

        // Meshes must not draw until the shader is ready, or the renderer compiles it synchronously
        await shaderReady;
        if (generation !== WaterManager.#generation || canvas.scene?.id !== regionDoc.parent?.id) {
            LOG(`  Skipping stale water render for "${regionDoc.name}"`);
            return;
        }

        for (const points of allPoints) {
            const waterMesh = new WaterMesh(points, {
                holes:       points.holes,
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
                    holes: points.holes ?? [],
                    bounds: [pMinX, pMinY, pMaxX, pMaxY],
                    elevation: { bottom: bottomBound, top: topBound }
                });
                LOG(`  Water mesh active for "${regionDoc.name}" at elevation ${meshElevation}`);
            }
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
     * Whether WaterManager currently holds active water polygons or meshes.
     * @returns {boolean}
     */
    static get hasActiveZones() {
        return WaterManager.#zones.size > 0 || WaterManager.#polygons.length > 0;
    }

    /**
     * Determine whether a token or token document represents an airborne or flying creature.
     * @param {Token|TokenDocument|Actor|object|null|undefined} tokenOrDoc
     * @param {object|null} [changes=null]
     * @returns {boolean}
     */
    static isTokenAirborne(tokenOrDoc, changes = null) {
        return WaterTokenPolicy.isTokenAirborne(tokenOrDoc, changes);
    }

    /**
     * Canonical gate determining whether a token is eligible to interact with water bodies
     * (wakes, ripples, idle wavelets, and water movement foley).
     * @param {Token|TokenDocument|object|null|undefined} tokenOrDoc
     * @param {object|null} [changes=null]
     * @returns {boolean}
     */
    static canTokenInteractWithWater(tokenOrDoc, changes = null) {
        return WaterTokenPolicy.canTokenInteractWithWater(tokenOrDoc, changes);
    }

    /**
     * Test whether a token is eligible to interact with water AND its world-space point is in water.
     * Flying / airborne creatures immediately return false without evaluating polygon geometry.
     * @param {Token|TokenDocument|object} tokenOrDoc
     * @param {number} px - World X
     * @param {number} py - World Y
     * @param {number} [elevation] - Optional elevation override
     * @param {object|null} [changes=null] - Optional pending token changes
     * @returns {boolean}
     */
    static isTokenInWater(tokenOrDoc, px, py, elevation = undefined, changes = null) {
        if (!WaterManager.canTokenInteractWithWater(tokenOrDoc, changes)) return false;
        const tokenDoc = tokenOrDoc?.document ?? tokenOrDoc;
        const effectiveElevation = Number(
            elevation
            ?? changes?.elevation
            ?? tokenDoc?.elevation
            ?? tokenDoc?._source?.elevation
            ?? tokenOrDoc?.elevation
            ?? 0
        ) || 0;
        if (effectiveElevation > 0) return false;
        return WaterManager.isPointInWater(px, py, effectiveElevation);
    }

    /**
     * Test whether a world-space point is inside any active water zone.
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
                const maxEl = Number.isFinite(bounds.top) ? bounds.top : (Number.isFinite(bounds.bottom) && bounds.bottom > 0 ? bounds.bottom : 0);
                if (elevation < minEl || elevation > maxEl) continue;
            }

            const aabb = entry?.bounds;
            if (aabb && (px < aabb[0] || px > aabb[2] || py < aabb[1] || py > aabb[3])) {
                continue;
            }

            if (WaterColorSampler.pointInPolygon(px, py, pts)) {
                const holes = entry?.holes ?? pts?.holes;
                if (holes?.length && holes.some(h => WaterColorSampler.pointInPolygon(px, py, h))) {
                    continue;
                }
                return true;
            }
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
     * Returns the best canvas layer for water placement.
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
