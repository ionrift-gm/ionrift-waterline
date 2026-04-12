import { WaterMesh } from './WaterMesh.js';

const MODULE_ID = 'ionrift-waterline';
const LOG = (...args) => console.log('Waterline |', ...args);

/**
 * Water body type presets. Each maps to a set of uniform defaults.
 */
export const WATER_PRESETS = {
    custom: { label: 'Custom',    opacity: 0.35, speed: 0.4,  distortion: 0.008, intensity: 0.8, fadeWidth: 50, scale: 150, flowAngle: 0,   shoreWaves: 0.0 },
    river:  { label: 'River',     opacity: 0.15, speed: 1.45, distortion: 0.040, intensity: 0.2, fadeWidth: 70, scale: 90,  flowAngle: 90,  shoreWaves: 0.0 },
    lake:   { label: 'Lake',      opacity: 0.35, speed: 0.25, distortion: 0.006, intensity: 0.6, fadeWidth: 60, scale: 200, flowAngle: 0,   shoreWaves: 0.0 },
    puddle: { label: 'Puddle',    opacity: 0.25, speed: 0.15, distortion: 0.004, intensity: 0.4, fadeWidth: 20, scale: 60,  flowAngle: 0,   shoreWaves: 0.0 },
    coast:  { label: 'Coast',     opacity: 0.40, speed: 0.5,  distortion: 0.010, intensity: 0.8, fadeWidth: 80, scale: 180, flowAngle: 270, shoreWaves: 0.0 },
    deep:   { label: 'Deep Sea',  opacity: 0.50, speed: 0.35, distortion: 0.015, intensity: 1.0, fadeWidth: 100, scale: 250, flowAngle: 0,  shoreWaves: 0.0 }
};

/**
 * Custom RegionBehaviorType for animated water overlay.
 */
export class WaterBehaviorType extends foundry.data.regionBehaviors.RegionBehaviorType {

    static defineSchema() {
        const fields = foundry.data.fields;
        return {
            intensity:     new fields.NumberField({ initial: 0.8,     min: 0.0,  max: 2.0,   step: 0.1,   label: 'Intensity' }),
            speed:         new fields.NumberField({ initial: 0.4,     min: 0.05, max: 3.0,   step: 0.05,  label: 'Speed' }),
            opacity:       new fields.NumberField({ initial: 0.35,    min: 0.05, max: 0.5,   step: 0.05,  label: 'Opacity' }),
            distortion:    new fields.NumberField({ initial: 0.008,   min: 0.0,  max: 0.05,  step: 0.001, label: 'Distortion' }),
            fadeWidth:     new fields.NumberField({ initial: 50,      min: 0,    max: 200,   step: 5,     label: 'Edge Fade' }),
            scale:         new fields.NumberField({ initial: 150,     min: 30,   max: 400,   step: 10,    label: 'Scale' }),
            flowAngle:     new fields.NumberField({ initial: 0,       min: 0,    max: 359,   step: 5,     label: 'Flow Direction' }),
            shoreWaves:    new fields.NumberField({ initial: 0.0,     min: 0.0,  max: 1.0,   step: 0.1,   label: 'Shore Waves' }),
            waterType:     new fields.StringField({
                initial: 'custom',
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

    /** @type {number|null} Debounce timer for hook-triggered refreshes */
    static #refreshTimer = null;

    static registerBehavior() {
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
    }

    static init() {
        LOG('WaterManager init');

        // Expose tuning API on game.ionrift
        game.ionrift ??= {};
        game.ionrift.waterTune = {
            /** Cycle blend mode on all water meshes: waterTune.blend('SCREEN') */
            blend: (mode) => {
                for (const [, mesh] of WaterManager.#zones) {
                    mesh.setBlendMode(mode);
                }
                LOG(`Blend mode set to: ${mode}`);
            },
            /** Set opacity: waterTune.opacity(0.4) */
            opacity: (val) => {
                for (const [, mesh] of WaterManager.#zones) {
                    mesh.setOpacity(val);
                }
                LOG(`Opacity set to: ${val}`);
            },
            /** Set intensity: waterTune.intensity(1.0) */
            intensity: (val) => {
                for (const [, mesh] of WaterManager.#zones) {
                    mesh.setIntensity(val);
                }
                LOG(`Intensity set to: ${val}`);
            },
            /** Set speed: waterTune.speed(0.8) */
            speed: (val) => {
                for (const [, mesh] of WaterManager.#zones) {
                    mesh.setSpeed(val);
                }
                LOG(`Speed set to: ${val}`);
            },
            /** Set distortion: waterTune.distortion(0.01) */
            distortion: (val) => {
                for (const [, mesh] of WaterManager.#zones) {
                    mesh.setDistortion(val);
                }
                LOG(`Distortion set to: ${val}`);
            },
            /** Set fadeWidth: waterTune.fadeWidth(50) */
            fadeWidth: (val) => {
                for (const [, mesh] of WaterManager.#zones) {
                    mesh.setFadeWidth(val);
                }
                LOG(`FadeWidth set to: ${val}`);
            },
            /** Set scale: waterTune.scale(150) */
            scale: (val) => {
                for (const [, mesh] of WaterManager.#zones) {
                    mesh.setScale(val);
                }
                LOG(`Scale set to: ${val}`);
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
  game.ionrift.waterTune.blend('SCREEN')    - Set blend mode
  game.ionrift.waterTune.opacity(0.35)      - Set water tint opacity (0-1)
  game.ionrift.waterTune.intensity(0.8)     - Set caustic intensity (0-2)
  game.ionrift.waterTune.speed(0.5)         - Set animation speed (0-2)
  game.ionrift.waterTune.distortion(0.01)   - Set refraction strength (0-0.05)
  game.ionrift.waterTune.flowAngle(90)      - Set flow direction in degrees
  game.ionrift.waterTune.shoreWaves(0.5)    - Set shore wave intensity (0-1)
  game.ionrift.waterTune.modes()            - List all blend modes
                `);
            },
            /** Set distortion: waterTune.distortion(0.01) */
            distortion: (val) => {
                for (const [, mesh] of WaterManager.#zones) {
                    mesh.setDistortion(val);
                }
                LOG(`Distortion set to: ${val}`);
            },
            /** Set flow angle in degrees: waterTune.flowAngle(90) */
            flowAngle: (deg) => {
                for (const [, mesh] of WaterManager.#zones) {
                    mesh.setFlowAngle(deg);
                }
                LOG(`Flow angle set to: ${deg}°`);
            },
            /** Set shore wave intensity: waterTune.shoreWaves(0.5) */
            shoreWaves: (val) => {
                for (const [, mesh] of WaterManager.#zones) {
                    mesh.setShoreWaves(val);
                }
                LOG(`Shore waves set to: ${val}`);
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
                    'system.flowAngle': preset.flowAngle,
                    'system.shoreWaves': preset.shoreWaves
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

    static refreshAll() {
        WaterManager.destroyAll();
        if (!canvas.scene) return;

        const regions = canvas.scene.regions?.contents ?? [];
        LOG(`refreshAll: scanning ${regions.length} regions`);

        for (const regionDoc of regions) {
            const config = WaterManager.#getWaterConfig(regionDoc);
            if (config) {
                LOG(`Found water behavior on region "${regionDoc.name}"`);
                WaterManager.#renderWater(regionDoc, config);
            }
        }

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
            WaterManager.refreshAll();
        }, 100);
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
        const preset = WATER_PRESETS[config.waterType] ?? WATER_PRESETS.custom;
        const resolvedConfig = {
            speed:      config.speed      ?? preset.speed,
            intensity:  config.intensity  ?? preset.intensity,
            opacity:    config.opacity    ?? preset.opacity,
            distortion: config.distortion ?? preset.distortion,
            fadeWidth:  config.fadeWidth  ?? preset.fadeWidth,
            scale:      config.scale      ?? preset.scale,
            flowAngle:  config.flowAngle  ?? preset.flowAngle ?? 0,
            shoreWaves: config.shoreWaves ?? preset.shoreWaves ?? 0
        };

        // Determine water color: manual override or auto-sample
        let waterColor;
        if (config.colorOverride && config.colorOverride.length >= 6) {
            // Parse hex color override
            const hex = config.colorOverride.replace('#', '');
            waterColor = [
                parseInt(hex.slice(0, 2), 16) / 255,
                parseInt(hex.slice(2, 4), 16) / 255,
                parseInt(hex.slice(4, 6), 16) / 255
            ];
            LOG(`  Using color override: ${config.colorOverride}`);
        } else {
            // Auto-sample background and shift toward blue
            const bgColor = await WaterManager.#sampleBackgroundColor(allPoints);
            waterColor = [
                bgColor[0] * 0.7,
                bgColor[1] * 0.85,
                Math.min(bgColor[2] * 1.4 + 0.15, 1.0)
            ];
            LOG(`  Auto-sampled water color: [${waterColor.map(v => v.toFixed(3))}]`);
        }

        // Load background texture for distortion
        const bgPath = canvas.scene?.background?.src;
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
            LOG('  No background texture, skipping water');
            return;
        }

        for (const points of allPoints) {
            const waterMesh = new WaterMesh(points, {
                speed:      resolvedConfig.speed,
                intensity:  resolvedConfig.intensity,
                opacity:    resolvedConfig.opacity,
                distortion: resolvedConfig.distortion,
                fadeWidth:  resolvedConfig.fadeWidth,
                scale:      resolvedConfig.scale,
                flowAngle:  resolvedConfig.flowAngle,
                shoreWaves: resolvedConfig.shoreWaves,
                bgTexture:  bgTexture,
                waterColor: waterColor,
                highlightColor: [
                    Math.min(waterColor[0] + 0.15, 1.0),
                    Math.min(waterColor[1] + 0.15, 1.0),
                    Math.min(waterColor[2] + 0.1, 1.0)
                ]
            });

            if (waterMesh.mesh) {
                const layer = WaterManager.#getTargetLayer();
                layer.addChild(waterMesh.mesh);
                waterMesh.startAnimation();
                WaterManager.#zones.set(`${regionDoc.id}-${WaterManager.#zones.size}`, waterMesh);
                LOG(`  Water mesh active for "${regionDoc.name}"`);
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

    /**
     * Samples the average background color under the given polygons.
     * Uses IQR filtering to discard terrain bleed from imperfect borders.
     * Returns [r, g, b] normalized to 0-1 range.
     */
    static async #sampleBackgroundColor(pointSets) {
        const fallback = [0.05, 0.15, 0.25];

        const bgPath = canvas.scene?.background?.src;
        if (!bgPath) return fallback;

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
            const ctx = offscreen.getContext('2d');
            ctx.drawImage(img, 0, 0);

            const dims = canvas.dimensions;
            const scaleX = img.width / dims.sceneWidth;
            const scaleY = img.height / dims.sceneHeight;

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

                        const pixel = ctx.getImageData(imgX, imgY, 1, 1).data;
                        const r = pixel[0] / 255;
                        const g = pixel[1] / 255;
                        const b = pixel[2] / 255;
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

            return [
                totalR / filtered.length,
                totalG / filtered.length,
                totalB / filtered.length
            ];
        } catch (err) {
            LOG('  Background sampling failed:', err);
            return fallback;
        }
    }

    static destroyAll() {
        for (const [, mesh] of WaterManager.#zones) {
            mesh.destroy();
        }
        WaterManager.#zones.clear();
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
