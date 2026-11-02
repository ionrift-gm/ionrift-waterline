import { WaterShapeEstimator } from '../WaterShapeEstimator.js';
import { MapBorderDetector } from '../MapBorderDetector.js';
import { WATER_ARCHETYPES, WATER_PRESETS, WaterManager } from '../WaterManager.js';
import { RasterContourTracer } from './RasterContourTracer.js';
import { MODULE_ID } from '../../data/moduleId.js';

/**
 * Foundry Region document creation, shape rasterization to grid masks,
 * and PIXI preview sprite generation for WaterDetector.
 */
export const waterDetectorRegionBridgeMethods = {
    /**
     * Create a Foundry Region from a detection candidate.
     * @param {object} candidate - Result from detectCandidates
     * @param {string} [name] - Region name
     * @param {object} [overrides] - Optional archetype, preset, and FX overrides from Studio UI
     * @returns {Promise<RegionDocument|null>}
     */
    async createRegionFromCandidate(candidate, name = 'Water', overrides = null) {
        const scene = canvas.scene;
        if (!scene || !game.user.isGM) return null;

        const est = candidate.estimation ?? WaterShapeEstimator.estimate(candidate);
        const archetype = overrides?.archetype || est?.archetype || 'river';
        const presetKey = overrides?.preset || est?.preset || WATER_ARCHETYPES[archetype]?.defaultPreset || 'river';
        const preset = WATER_PRESETS[presetKey] ?? {};
        const fx = overrides?.fx ?? {};
        const flowAngle = Number.isFinite(fx.flowAngle) ? fx.flowAngle : (est?.flowAngle ?? preset.flowAngle ?? 90);
        const colorOverride = (fx.autoColor === false && fx.colorOverride) ? fx.colorOverride : (preset.colorOverride || '');

        let regionName = name;
        const defaultWaterLabel = game.i18n.localize('IonriftWaterline.detector.defaultWaterName');
        const defaultRegionLabel = game.i18n?.has?.('TYPES.Region') ? game.i18n.localize('TYPES.Region') : '';
        const isDefaultName = !regionName
            || regionName === 'Water'
            || regionName === defaultWaterLabel
            || (Boolean(defaultRegionLabel) && regionName === defaultRegionLabel)
            || candidate?.hasCustomName === false;

        if (isDefaultName) {
            const allRegions = Array.from(scene.regions?.values?.() ?? scene.regions?.contents ?? scene.regions ?? []);
            const archLabel = WATER_ARCHETYPES[archetype]?.label || est?.archetypeLabel || defaultWaterLabel;
            const existingNames = new Set(allRegions.map(r => (r.name || '').trim().toLowerCase()));
            let nextIndex = allRegions.filter(r => {
                const behaviors = Array.from(r.behaviors?.values?.() ?? r.behaviors?.contents ?? r.behaviors ?? []);
                const beh = behaviors.find(b => b.type === `${MODULE_ID}.waterFX`);
                return beh?.system?.archetype === archetype;
            }).length + 1;
            while (existingNames.has(`${archLabel} ${nextIndex}`.toLowerCase())) {
                nextIndex++;
            }
            regionName = `${archLabel} ${nextIndex}`;
        }

        const regionPoints = (est?.touches?.count > 0)
            ? MapBorderDetector.snap(candidate.points, scene?.dimensions || canvas?.dimensions)
            : candidate.points;

        const shapes = [{
            type: 'polygon',
            points: regionPoints,
            hole: false
        }];
        const validHoles = [];
        if (Array.isArray(candidate.holes)) {
            for (const holePts of candidate.holes) {
                if (Array.isArray(holePts) && holePts.length >= 6) {
                    shapes.push({
                        type: 'polygon',
                        points: holePts,
                        hole: true
                    });
                    validHoles.push(holePts);
                }
            }
        }

        const regionData = {
            name: regionName,
            color: colorOverride || (archetype === 'puddle' ? '#38bdf8' : WATER_ARCHETYPES[archetype]?.accentColor) || '#2a6496',
            shapes,
            flags: {
                [MODULE_ID]: {
                    configured: true,
                    hasCustomName: !isDefaultName,
                    ...(colorOverride ? { color: colorOverride } : {}),
                    ...(validHoles.length ? { holes: validHoles } : {})
                }
            },
            behaviors: []
        };

        try {
            const created = await scene.createEmbeddedDocuments('Region', [regionData]);
            if (created.length && CONFIG.RegionBehavior.dataModels[`${MODULE_ID}.waterFX`]) {
                const isSmallBody = (archetype === 'lake' || archetype === 'pond' || archetype === 'puddle');
                await created[0].createEmbeddedDocuments('RegionBehavior', [{
                    type: `${MODULE_ID}.waterFX`,
                    name: game.i18n.localize('IonriftWaterline.behavior.defaultName'),
                    flags: {
                        [MODULE_ID]: { configured: true }
                    },
                    system: {
                        archetype,
                        waterType: presetKey,
                        flowAngle,
                        speed: Number.isFinite(fx.speed) ? fx.speed : (preset.speed ?? 1.0),
                        intensity: Number.isFinite(fx.intensity) ? fx.intensity : (preset.intensity ?? 0.3),
                        opacity: Number.isFinite(fx.opacity) ? fx.opacity : (preset.opacity ?? 0.2),
                        distortion: Number.isFinite(fx.distortion) ? fx.distortion : (preset.distortion ?? 0.02),
                        fadeWidth: Number.isFinite(fx.fadeWidth) ? fx.fadeWidth : (preset.fadeWidth ?? 50),
                        scale: Number.isFinite(fx.scale) ? fx.scale : (preset.scale ?? 90),
                        shoreWaves: Number.isFinite(fx.shoreWaves) ? fx.shoreWaves : (preset.shoreWaves ?? 0.2),
                        waveCount: Number.isFinite(fx.waveCount) ? fx.waveCount : (preset.waveCount ?? 4),
                        swashSurge: Number.isFinite(fx.swashSurge) ? fx.swashSurge : (preset.swashSurge ?? 16.0),
                        surfFoam: Number.isFinite(fx.surfFoam) ? fx.surfFoam : (preset.surfFoam ?? 0.70),
                        waveSegment: Number.isFinite(fx.waveSegment) ? fx.waveSegment : (preset.waveSegment ?? 0.85),
                        waveRegularity: Number.isFinite(fx.waveRegularity) ? fx.waveRegularity : (preset.waveRegularity ?? 0.60),
                        choppySeas: Number.isFinite(fx.choppySeas) ? fx.choppySeas : (preset.choppySeas ?? 0.0),
                        riverWaves: Number.isFinite(fx.riverWaves) ? fx.riverWaves : (preset.riverWaves ?? (archetype === 'river' ? 0.36 : 0.0)),
                        lakeWaves: isSmallBody ? (Number.isFinite(fx.lakeWaves) ? fx.lakeWaves : (preset.lakeWaves ?? (archetype === 'lake' || archetype === 'pond' ? 0.25 : 0.0))) : 0.0,
                        lakeRings: isSmallBody ? (Number.isFinite(fx.lakeRings) ? fx.lakeRings : (preset.lakeRings ?? (archetype === 'lake' || archetype === 'pond' || archetype === 'puddle' ? 0.70 : 0.0))) : 0.0,
                        whitecaps: Number.isFinite(fx.whitecaps) ? fx.whitecaps : (preset.whitecaps ?? 0.1),
                        sunGlint: Number.isFinite(fx.sunGlint) ? fx.sunGlint : (preset.sunGlint ?? 0.3),
                        spindriftWake: Boolean(fx.spindriftWake ?? preset.spindriftWake),
                        crestBound: Boolean(fx.crestBound ?? preset.crestBound),
                        colorOverride
                    }
                }]);
            }
            return created[0] ?? null;
        } catch (err) {
            console.error('Waterline | Failed to create region:', err);
            return null;
        }
    },

    /**
     * Build maskData from an existing RegionDocument by rasterizing its shapes onto the grid.
     * @param {RegionDocument} region
     * @param {number} [gridStep=4]
     * @returns {Promise<object|null>} maskData { mask, cols, rows, gridStep }
     */
    async maskFromRegion(region, gridStep = 4) {
        if (!await this._ensureImageCache()) return null;

        const imgW = this._cachedImgW;
        const imgH = this._cachedImgH;
        const dims = canvas.dimensions;
        if (!dims || !imgW || !imgH) return null;

        const cols = Math.ceil(imgW / gridStep);
        const rows = Math.ceil(imgH / gridStep);
        const mask = new Uint8Array(cols * rows);

        const canvasEl = document.createElement('canvas');
        canvasEl.width = cols;
        canvasEl.height = rows;
        const ctx = canvasEl.getContext('2d');
        ctx.fillStyle = '#ffffff';

        // Extract shapes from region (draw positive shapes first, then carve holes)
        const rawShapes = Array.from(region.shapes?.contents ?? region.shapes ?? []);
        if (!rawShapes.length) return null;
        const shapes = [
            ...rawShapes.filter(s => !s.hole),
            ...rawShapes.filter(s => Boolean(s.hole))
        ];

        let hasDrawn = false;
        let hasHoleShapes = false;
        for (const shape of shapes) {
            const isHole = Boolean(shape.hole);
            if (isHole) hasHoleShapes = true;
            ctx.globalCompositeOperation = isHole ? 'destination-out' : 'source-over';

            const shapeType = shape.type ?? shape.constructor?.name ?? '';

            // Polygon
            if (shapeType === 'polygon' || shapeType === 'PolygonShapeData' || shape.points) {
                const pts = shape.points ?? shape.coordinates ?? [];
                if (pts.length >= 6) {
                    ctx.beginPath();
                    for (let i = 0; i < pts.length; i += 2) {
                        const sx = pts[i];
                        const sy = pts[i + 1];
                        const gx = ((sx - dims.sceneX) / dims.sceneWidth) * (imgW / gridStep);
                        const gy = ((sy - dims.sceneY) / dims.sceneHeight) * (imgH / gridStep);
                        if (i === 0) ctx.moveTo(gx, gy);
                        else ctx.lineTo(gx, gy);
                    }
                    ctx.closePath();
                    ctx.fill();
                    hasDrawn = true;
                    continue;
                }
            }

            // Rectangle
            if (shapeType === 'rectangle' || shapeType === 'RectangleShapeData') {
                const sx = shape.x ?? 0, sy = shape.y ?? 0;
                const sw = shape.width ?? 0, sh = shape.height ?? 0;
                if (sw > 0 && sh > 0) {
                    const gx = ((sx - dims.sceneX) / dims.sceneWidth) * (imgW / gridStep);
                    const gy = ((sy - dims.sceneY) / dims.sceneHeight) * (imgH / gridStep);
                    const gw = (sw / dims.sceneWidth) * (imgW / gridStep);
                    const gh = (sh / dims.sceneHeight) * (imgH / gridStep);
                    ctx.fillRect(gx, gy, gw, gh);
                    hasDrawn = true;
                    continue;
                }
            }

            // Ellipse / Circle
            if (shapeType === 'ellipse' || shapeType === 'circle' || shapeType === 'EllipseShapeData' || shapeType === 'CircleShapeData') {
                const radX = shape.radiusX ?? shape.radius ?? 0;
                const radY = shape.radiusY ?? shape.radius ?? 0;
                const cx = (shape.x ?? 0) + radX;
                const cy = (shape.y ?? 0) + radY;
                if (radX > 0 && radY > 0) {
                    const gcx = ((cx - dims.sceneX) / dims.sceneWidth) * (imgW / gridStep);
                    const gcy = ((cy - dims.sceneY) / dims.sceneHeight) * (imgH / gridStep);
                    const grx = (radX / dims.sceneWidth) * (imgW / gridStep);
                    const gry = (radY / dims.sceneHeight) * (imgH / gridStep);
                    ctx.beginPath();
                    ctx.ellipse(gcx, gcy, Math.max(1, grx), Math.max(1, gry), 0, 0, Math.PI * 2);
                    ctx.fill();
                    hasDrawn = true;
                    continue;
                }
            }
        }

        const flagHoles = region.flags?.[MODULE_ID]?.holes;
        if (!hasHoleShapes && Array.isArray(flagHoles) && flagHoles.length) {
            ctx.globalCompositeOperation = 'destination-out';
            for (const pts of flagHoles) {
                if (!Array.isArray(pts) || pts.length < 6) continue;
                ctx.beginPath();
                for (let i = 0; i < pts.length; i += 2) {
                    const gx = ((pts[i] - dims.sceneX) / dims.sceneWidth) * (imgW / gridStep);
                    const gy = ((pts[i + 1] - dims.sceneY) / dims.sceneHeight) * (imgH / gridStep);
                    if (i === 0) ctx.moveTo(gx, gy);
                    else ctx.lineTo(gx, gy);
                }
                ctx.closePath();
                ctx.fill();
            }
        }

        if (!hasDrawn) return null;

        const imgData = ctx.getImageData(0, 0, cols, rows);
        const d = imgData.data;
        let filledCount = 0;
        for (let i = 0; i < mask.length; i++) {
            if (d[i * 4 + 3] > 64) {
                mask[i] = 1;
                filledCount++;
            }
        }

        if (filledCount < 5) return null;

        return { mask, cols, rows, gridStep, subtractedCells: new Set() };
    },

    /**
     * Generate a preview sprite from mask data.
     * @param {object} maskData - { mask, cols, rows, gridStep }
     * @returns {PIXI.Sprite|null}
     */
    previewFromMask(maskData) {
        const { mask, cols, rows, gridStep } = maskData;
        const imgW = this._cachedImgW;
        const imgH = this._cachedImgH;
        const dims = canvas.dimensions;

        const maskCanvas = document.createElement('canvas');
        maskCanvas.width = imgW;
        maskCanvas.height = imgH;
        const maskCtx = maskCanvas.getContext('2d');
        const maskImgData = maskCtx.createImageData(imgW, imgH);
        const md = maskImgData.data;

        for (let gy = 0; gy < rows; gy++) {
            for (let gx = 0; gx < cols; gx++) {
                if (!mask[gy * cols + gx]) continue;
                for (let dy = 0; dy < gridStep && (gy * gridStep + dy) < imgH; dy++) {
                    for (let dx = 0; dx < gridStep && (gx * gridStep + dx) < imgW; dx++) {
                        const mi = ((gy * gridStep + dy) * imgW + (gx * gridStep + dx)) * 4;
                        md[mi]     = 40;
                        md[mi + 1] = 140;
                        md[mi + 2] = 240;
                        md[mi + 3] = 110;
                    }
                }
            }
        }
        maskCtx.putImageData(maskImgData, 0, 0);

        const texture = PIXI.Texture.from(maskCanvas);
        const sprite = new PIXI.Sprite(texture);
        sprite.x = dims.sceneX ?? 0;
        sprite.y = dims.sceneY ?? 0;
        sprite.width = dims.sceneWidth;
        sprite.height = dims.sceneHeight;
        sprite.alpha = 0.6;
        sprite.eventMode = 'none';
        return sprite;
    },

    /**
     * Generate a PIXI.Sprite preview of a flood fill from a scene coordinate.
     * @param {number} sceneX
     * @param {number} sceneY
     * @param {number} [tolerance=40]
     * @returns {Promise<PIXI.Sprite|null>}
     */
    async generateFloodPreview(sceneX, sceneY, tolerance = 40) {
        if (!await this._ensureImageCache()) return null;

        const imgData = this._cachedImageData;
        const imgW = this._cachedImgW;
        const imgH = this._cachedImgH;
        const pixels = imgData.data;
        const dims = canvas.dimensions;
        const gridStep = 4;

        const cols = Math.ceil(imgW / gridStep);
        const rows = Math.ceil(imgH / gridStep);
        const filled = new Uint8Array(cols * rows);
        const filteredGrid = this._getFilteredGrid(gridStep);

        const cellCount = RasterContourTracer.floodFillIntoMask({
            mask: filled, cols, rows, gridStep, sceneX, sceneY, tolerance,
            imgW, imgH, pixels, dims, filteredGrid
        });

        if (cellCount === 0) return null;

        return this.previewFromMask({ mask: filled, cols, rows, gridStep });
    },

    /**
     * Generate a fast preview mask showing which pixels match detection thresholds.
     * Returns a PIXI.Sprite positioned on the scene, or null on failure.
     * @param {object} options - satMax, lumMin, lumMax
     * @returns {Promise<PIXI.Sprite|null>}
     */
    async generatePreviewMask({ satMax = 0.30, lumMin = 0.18, lumMax = 0.65 } = {}) {
        const scene = canvas.scene;
        if (!scene) return null;

        const bgPath = WaterManager.resolveSceneBackgroundSrc(scene);
        if (!bgPath) return null;

        const img = await this._loadImage(bgPath);
        const imgW = img.width;
        const imgH = img.height;

        // Use same step as detection for consistent results
        const previewStep = 6;
        const offscreen = document.createElement('canvas');
        offscreen.width = imgW;
        offscreen.height = imgH;
        const ctx = offscreen.getContext('2d');
        ctx.drawImage(img, 0, 0);

        const imageData = ctx.getImageData(0, 0, imgW, imgH);
        const pixels = imageData.data;

        // Create mask canvas at image resolution
        const maskCanvas = document.createElement('canvas');
        maskCanvas.width = imgW;
        maskCanvas.height = imgH;
        const maskCtx = maskCanvas.getContext('2d');
        const maskData = maskCtx.createImageData(imgW, imgH);
        const md = maskData.data;

        for (let y = 0; y < imgH; y += previewStep) {
            for (let x = 0; x < imgW; x += previewStep) {
                const idx = (y * imgW + x) * 4;
                const r = pixels[idx] / 255;
                const g = pixels[idx + 1] / 255;
                const b = pixels[idx + 2] / 255;

                const { s, l } = RasterContourTracer.rgbToHsl(r, g, b);

                if (s <= satMax && l >= lumMin && l <= lumMax) {
                    // Fill previewStep x previewStep block in blue
                    for (let dy = 0; dy < previewStep && (y + dy) < imgH; dy++) {
                        for (let dx = 0; dx < previewStep && (x + dx) < imgW; dx++) {
                            const mi = ((y + dy) * imgW + (x + dx)) * 4;
                            md[mi]     = 40;   // R
                            md[mi + 1] = 120;  // G
                            md[mi + 2] = 220;  // B
                            md[mi + 3] = 100;  // A (semi-transparent)
                        }
                    }
                }
            }
        }

        maskCtx.putImageData(maskData, 0, 0);

        // Convert to PIXI sprite scaled to scene
        const dims = canvas.dimensions;
        const texture = PIXI.Texture.from(maskCanvas);
        const sprite = new PIXI.Sprite(texture);
        sprite.x = dims.sceneX ?? 0;
        sprite.y = dims.sceneY ?? 0;
        sprite.width = dims.sceneWidth;
        sprite.height = dims.sceneHeight;
        sprite.alpha = 0.6;
        sprite.eventMode = 'none';

        return sprite;
    }
};
