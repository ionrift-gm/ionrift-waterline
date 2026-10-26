import { WaterShapeEstimator } from './WaterShapeEstimator.js';
import { MapBorderDetector } from './MapBorderDetector.js';
import { WATER_ARCHETYPES, WATER_PRESETS, WaterManager } from './WaterManager.js';
import { RasterContourTracer } from './detection/RasterContourTracer.js';

const MODULE_ID = 'ionrift-waterline';
const LOG = (...args) => { try { if (game.settings?.get?.(MODULE_ID, 'debug')) console.log('Waterline |', ...args); } catch { /* setting not yet registered */ } };

/**
 * Analyses the scene background image to detect water regions
 * by color heuristics, then generates simplified polygon contours.
 */
export class WaterDetector {

    /**
     * Detect water candidates in the current scene. Returns data without creating Regions.
     * @param {object} [options]
     * @param {number} [options.gridStep=8]          - Sample every N pixels
     * @param {number} [options.satMax=0.30]         - Max saturation to count as water
     * @param {number} [options.lumMin=0.18]         - Min lightness for water
     * @param {number} [options.lumMax=0.65]         - Max lightness for water
     * @param {number} [options.simplifyTolerance=3] - RDP simplification tolerance
     * @param {number} [options.minArea=100]         - Min connected region size in grid cells
     * @returns {Promise<{points: number[], area: number, centroid: {x,y}, vertexCount: number}[]>}
     */
    static async detectCandidates(options = {}) {
        const {
            gridStep = 6,
            satMax = 0.30,
            lumMin = 0.18,
            lumMax = 0.65,
            simplifyTolerance = 1.5,
            minArea = 50
        } = options;

        if (!game.user.isGM) return;

        const scene = canvas.scene;
        if (!scene) {
            ui.notifications.warn('Waterline | No active scene.');
            return;
        }

        ui.notifications.info('Waterline | Analyzing scene for water...');

        // Get the scene background texture
        const bgPath = WaterManager.resolveSceneBackgroundSrc(scene);
        if (!bgPath) {
            ui.notifications.warn('Waterline | Scene has no background image.');
            return;
        }

        // Load image
        const img = await WaterDetector.#loadImage(bgPath);
        const imgW = img.width;
        const imgH = img.height;

        // Draw to offscreen canvas
        const offscreen = document.createElement('canvas');
        offscreen.width = imgW;
        offscreen.height = imgH;
        const ctx = offscreen.getContext('2d');
        ctx.drawImage(img, 0, 0);

        // Sample at grid resolution
        const cols = Math.ceil(imgW / gridStep);
        const rows = Math.ceil(imgH / gridStep);
        const waterMask = new Uint8Array(cols * rows);

        const imageData = ctx.getImageData(0, 0, imgW, imgH);
        const pixels = imageData.data;

        for (let gy = 0; gy < rows; gy++) {
            for (let gx = 0; gx < cols; gx++) {
                const px = Math.min(gx * gridStep, imgW - 1);
                const py = Math.min(gy * gridStep, imgH - 1);
                const idx = (py * imgW + px) * 4;

                const r = pixels[idx] / 255;
                const g = pixels[idx + 1] / 255;
                const b = pixels[idx + 2] / 255;

                const { s, l } = RasterContourTracer.rgbToHsl(r, g, b);

                if (s <= satMax && l >= lumMin && l <= lumMax) {
                    waterMask[gy * cols + gx] = 1;
                }
            }
        }

        // Find connected components
        const components = RasterContourTracer.findComponents(waterMask, cols, rows);
        LOG(`Waterline | Found ${components.length} raw components, sizes: [${components.map(c => c.length).sort((a,b) => b-a).join(', ')}]`);

        // Filter to components above minimum area
        const validComponents = components.filter(c => c.length >= minArea);
        if (!validComponents.length) {
            ui.notifications.warn('Waterline | No water regions detected. Try adjusting thresholds.');
            return [];
        }

        // Sort by area descending so largest appears first
        validComponents.sort((a, b) => b.length - a.length);
        LOG(`Waterline | ${validComponents.length} component(s) above minArea=${minArea}`);

        // Scene dimensions for mapping grid coords to scene coords
        const dims = canvas.dimensions;
        const scaleX = dims.sceneWidth / imgW;
        const scaleY = dims.sceneHeight / imgH;

        // Build candidate data without creating Regions
        const candidates = [];
        for (let ci = 0; ci < validComponents.length; ci++) {
            const component = validComponents[ci];
            const contour = RasterContourTracer.traceContour(component, cols, rows);
            LOG(`Waterline | Component ${ci}: area=${component.length}, contour=${contour.length/2} pts`);

            if (contour.length < 6) {
                LOG(`Waterline | Component ${ci}: SKIPPED (contour too short: ${contour.length} coords)`);
                continue;
            }

            const simplified = RasterContourTracer.simplifyRDP(contour, simplifyTolerance);
            LOG(`Waterline | Component ${ci}: simplified to ${simplified.length/2} pts`);

            if (simplified.length < 6) {
                LOG(`Waterline | Component ${ci}: SKIPPED (simplified too short)`);
                continue;
            }

            // Convert grid coords to scene coords
            let scenePoints = [];
            for (let i = 0; i < simplified.length; i += 2) {
                scenePoints.push(
                    Math.round(dims.sceneX + simplified[i] * gridStep * scaleX),
                    Math.round(dims.sceneY + simplified[i + 1] * gridStep * scaleY)
                );
            }
            scenePoints = RasterContourTracer.smoothContour(scenePoints, 1, dims);

            // Compute centroid and area for display
            let cx = 0, cy = 0;
            const vertCount = scenePoints.length / 2;
            for (let i = 0; i < scenePoints.length; i += 2) {
                cx += scenePoints[i];
                cy += scenePoints[i + 1];
            }

            const cand = {
                points: scenePoints,
                area: component.length,
                centroid: { x: cx / vertCount, y: cy / vertCount },
                vertexCount: vertCount
            };
            cand.estimation = WaterShapeEstimator.estimate(cand, dims);
            candidates.push(cand);
        }

        return candidates;
    }

    /**
     * Create a Foundry Region from a detection candidate.
     * @param {object} candidate - Result from detectCandidates
     * @param {string} [name] - Region name
     * @param {object} [overrides] - Optional archetype, preset, and FX overrides from Studio UI
     * @returns {Promise<RegionDocument|null>}
     */
    static async createRegionFromCandidate(candidate, name = 'Water', overrides = null) {
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
        if (!regionName || regionName === 'Water') {
            const allRegions = Array.from(scene.regions?.values?.() ?? scene.regions?.contents ?? scene.regions ?? []);
            const archLabel = WATER_ARCHETYPES[archetype]?.label || est?.archetypeLabel || 'Water';
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
                    name: 'Water FX',
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
    }

    /**
     * Convenience: detect and auto-accept all candidates.
     */
    static async detect(options = {}) {
        const candidates = await WaterDetector.detectCandidates(options);
        if (!candidates.length) return;

        let count = 0;
        for (const candidate of candidates) {
            const region = await WaterDetector.createRegionFromCandidate(candidate, `Water ${count + 1}`);
            if (region) count++;
        }

        if (count) {
            ui.notifications.info(`Waterline | Created ${count} water region(s).`);
        } else {
            ui.notifications.warn('Waterline | Could not generate valid polygons from detected water.');
        }
    }

    // ------------------------------------------------------------------
    // Flood Fill from Click Point
    // ------------------------------------------------------------------

    /** @type {ImageData|null} Cached image data for repeated fills */
    static #cachedImageData = null;
    static #cachedImgW = 0;
    static #cachedImgH = 0;
    /** @type {{ rawRGB: Float32Array, smoothRGB: Float32Array, gridStep: number }|null} */
    static #cachedFilteredGrid = null;

    /**
     * Load and cache the scene background for flood fill operations.
     * @returns {Promise<boolean>}
     */
    static async #ensureImageCache() {
        const scene = canvas.scene;
        if (!scene) return false;
        const bgPath = WaterManager.resolveSceneBackgroundSrc(scene);
        if (!bgPath) return false;

        // Only reload if not cached
        if (WaterDetector.#cachedImageData) return true;

        const img = await WaterDetector.#loadImage(bgPath);
        const offscreen = document.createElement('canvas');
        offscreen.width = img.width;
        offscreen.height = img.height;
        const ctx = offscreen.getContext('2d');
        ctx.drawImage(img, 0, 0);
        WaterDetector.#cachedImageData = ctx.getImageData(0, 0, img.width, img.height);
        WaterDetector.#cachedImgW = img.width;
        WaterDetector.#cachedImgH = img.height;
        WaterDetector.#cachedFilteredGrid = null;
        return true;
    }

    /**
     * Retrieve or build the pre-filtered bilateral grid for the cached background image.
     * @param {number} gridStep
     * @returns {{ rawRGB: Float32Array, smoothRGB: Float32Array, gridStep: number }|null}
     */
    static #getFilteredGrid(gridStep) {
        if (!WaterDetector.#cachedImageData) return null;
        if (WaterDetector.#cachedFilteredGrid?.gridStep === gridStep) {
            return WaterDetector.#cachedFilteredGrid;
        }
        const imgW = WaterDetector.#cachedImgW;
        const imgH = WaterDetector.#cachedImgH;
        const cols = Math.ceil(imgW / gridStep);
        const rows = Math.ceil(imgH / gridStep);
        WaterDetector.#cachedFilteredGrid = RasterContourTracer.buildFilteredGrid(
            WaterDetector.#cachedImageData.data, imgW, imgH, cols, rows, gridStep
        );
        return WaterDetector.#cachedFilteredGrid;
    }

    /** Clear image cache (call on scene change) */
    static clearCache() {
        WaterDetector.#cachedImageData = null;
        WaterDetector.#cachedFilteredGrid = null;
    }

    /**
     * Flood fill from a scene coordinate. Samples the background color at the
     * click point and fills outward to pixels within `tolerance` RGB distance.
     * Returns a candidate object or null.
     *
     * @param {number} sceneX - Scene X coordinate
     * @param {number} sceneY - Scene Y coordinate
     * @param {number} [tolerance=40] - Max RGB distance from seed color (0-255 scale)
     * @param {number} [gridStep=4] - Sample grid resolution
     * @param {number} [smoothing=2.0] - RDP simplification tolerance
     * @returns {Promise<object|null>} Candidate with { points, area, centroid }
     */
    static async floodFillFromPoint(sceneX, sceneY, tolerance = 40, gridStep = 4, smoothing = 2.0) {
        if (!await WaterDetector.#ensureImageCache()) return null;

        const imgW = WaterDetector.#cachedImgW;
        const imgH = WaterDetector.#cachedImgH;

        // Grid dimensions
        const cols = Math.ceil(imgW / gridStep);
        const rows = Math.ceil(imgH / gridStep);
        const filled = new Uint8Array(cols * rows);
        const filteredGrid = WaterDetector.#getFilteredGrid(gridStep);

        // Run the core flood fill into the mask
        const cellCount = RasterContourTracer.floodFillIntoMask({
            mask: filled, cols, rows, gridStep, sceneX, sceneY, tolerance,
            imgW, imgH, pixels: WaterDetector.#cachedImageData.data, dims: canvas.dimensions,
            filteredGrid
        });

        if (cellCount < 10) {
            LOG(`Waterline | Flood fill too small (${cellCount} cells)`);
            return null;
        }

        LOG(`Waterline | Flood fill: ${cellCount} cells filled`);

        // Build candidate from the mask
        const maskData = {
            mask: filled,
            cols,
            rows,
            gridStep,
            seedPoint: { x: sceneX, y: sceneY },
            subtractedCells: new Set()
        };
        const candidate = WaterDetector.candidateFromMask(maskData, smoothing);
        if (!candidate) return null;

        // Attach mask data so the dialog can refine it later
        candidate.maskData = maskData;
        return candidate;
    }

    /**
     * Refine an existing mask by adding or subtracting a flood fill region.
     * @param {object} maskData - { mask, cols, rows, gridStep }
     * @param {number} sceneX - Click scene X
     * @param {number} sceneY - Click scene Y
     * @param {'add'|'subtract'} mode
     * @param {number} tolerance
     * @param {number} smoothing - RDP smoothing tolerance
     * @param {{ x: number, y: number }|null} [seedPoint=null] - Original water seed point
     * @returns {object|null} Updated candidate with maskData
     */
    static async refineMask(maskData, sceneX, sceneY, mode, tolerance, smoothing, seedPoint = null) {
        if (!await WaterDetector.#ensureImageCache()) return null;

        const { mask, cols, rows, gridStep } = maskData;
        const imgW = WaterDetector.#cachedImgW;
        const imgH = WaterDetector.#cachedImgH;
        const pixels = WaterDetector.#cachedImageData.data;
        const dims = canvas.dimensions;
        const filteredGrid = WaterDetector.#getFilteredGrid(gridStep);

        let avoidColor = null;
        const waterSeed = seedPoint ?? maskData.seedPoint ?? null;
        if (mode === 'subtract' && waterSeed && dims) {
            const wsX = Math.round(((waterSeed.x - dims.sceneX) / dims.sceneWidth) * imgW);
            const wsY = Math.round(((waterSeed.y - dims.sceneY) / dims.sceneHeight) * imgH);
            if (wsX >= 0 && wsX < imgW && wsY >= 0 && wsY < imgH) {
                const wsIdx = (wsY * imgW + wsX) * 4;
                avoidColor = [pixels[wsIdx], pixels[wsIdx + 1], pixels[wsIdx + 2]];
            }
        }

        maskData.subtractedCells ??= new Set();

        // Run a new flood fill into a temporary mask
        const tempMask = new Uint8Array(cols * rows);
        const cellCount = RasterContourTracer.floodFillIntoMask({
            mask: tempMask,
            cols,
            rows,
            gridStep,
            sceneX,
            sceneY,
            tolerance,
            imgW,
            imgH,
            pixels,
            dims,
            avoidColor,
            maxStepDiff: mode === 'subtract' ? Math.max(18, Math.round(tolerance * 0.65)) : 0,
            filteredGrid,
            preservedZeroCells: maskData.subtractedCells
        });

        if (cellCount < 3) {
            LOG(`Waterline | Refine fill too small (${cellCount} cells), ignoring`);
            return null;
        }

        // Apply the operation to the existing mask
        let changed = 0;
        let preservedNewHole = false;
        for (let i = 0; i < mask.length; i++) {
            if (!tempMask[i]) continue;
            if (mode === 'add') {
                maskData.subtractedCells.delete(i);
                if (!mask[i]) {
                    mask[i] = 1;
                    changed++;
                }
            } else if (mode === 'subtract') {
                if (!maskData.subtractedCells.has(i)) {
                    maskData.subtractedCells.add(i);
                    preservedNewHole = true;
                }
                if (mask[i]) {
                    mask[i] = 0;
                    changed++;
                }
            }
        }

        if (mode === 'add' && changed > 0) {
            RasterContourTracer.closeMask(mask, cols, rows, maskData.subtractedCells);
        }

        LOG(`Waterline | Refine (${mode}): ${cellCount} fill cells, ${changed} mask cells changed`);

        if (changed === 0 && !preservedNewHole) return null;

        // Re-trace the contour from the updated mask
        const candidate = WaterDetector.candidateFromMask(maskData, smoothing);
        if (!candidate) return null;
        candidate.maskData = maskData;
        return candidate;
    }

    /**
     * Morphological erosion of a cell mask.
     * Shrinks water boundaries inward away from shorelines.
     * Treats out-of-bounds cells as water to preserve map frame edges.
     *
     * @param {object} maskData - { mask, cols, rows, gridStep }
     * @param {number} [iterations=1]
     * @returns {object} Updated maskData
     */
    static erodeMask(maskData, iterations = 1) {
        return RasterContourTracer.erodeMask(maskData, iterations);
    }

    /**
     * Morphological dilation of a cell mask.
     * Expands water boundaries outward into surrounding land.
     *
     * @param {object} maskData - { mask, cols, rows, gridStep }
     * @param {number} [iterations=1]
     * @returns {object} Updated maskData
     */
    static dilateMask(maskData, iterations = 1) {
        return RasterContourTracer.dilateMask(maskData, iterations);
    }

    /**
     * Build maskData from an existing RegionDocument by rasterizing its shapes onto the grid.
     * @param {RegionDocument} region
     * @param {number} [gridStep=4]
     * @returns {Promise<object|null>} maskData { mask, cols, rows, gridStep }
     */
    static async maskFromRegion(region, gridStep = 4) {
        if (!await WaterDetector.#ensureImageCache()) return null;

        const imgW = WaterDetector.#cachedImgW;
        const imgH = WaterDetector.#cachedImgH;
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
    }

    /**
     * Generate a candidate polygon (plus interior island holes) from a cell mask.
     * Public so it can be called after refinement.
     * @param {object} maskData - { mask, cols, rows, gridStep }
     * @param {number} smoothing - RDP simplification tolerance
     * @returns {object|null} Candidate with { points, holes, area, centroid, vertexCount }
     */
    static candidateFromMask(maskData, smoothing = 7.0) {
        const { mask, cols, rows, gridStep } = maskData;
        const dims = maskData.dims || canvas.dimensions;
        const imgW = maskData.imgW || WaterDetector.#cachedImgW || (cols * gridStep);
        const imgH = maskData.imgH || WaterDetector.#cachedImgH || (rows * gridStep);

        const minHoleArea = Math.max(16, Math.round(1024 / (gridStep * gridStep)));
        RasterContourTracer.cleanMaskHoles(mask, cols, rows, minHoleArea, maskData.subtractedCells);

        // Count filled cells
        let area = 0;
        for (let i = 0; i < mask.length; i++) {
            if (mask[i]) area++;
        }
        if (area < 10) return null;

        // Strategy: extract 2D topological contour via Marching Squares.
        // Handles complex concave shorelines, diagonal piers, outcrops, bays, and interior islands.
        let simplified = null;
        let bestRing = null;
        const acceptedHoleRings = [];
        const rings = RasterContourTracer.marchingSquares(mask, cols, rows);
        const rdpTolerance = Math.max(0.25, smoothing / Math.max(2.5, gridStep * 0.7));

        if (rings.length > 0) {
            const outerRings = [];
            const holeCandidates = [];

            for (const r of rings) {
                let doubleArea = 0;
                const n = r.length;
                for (let i = 0; i < n - 1; i++) {
                    doubleArea += r[i][0] * r[i + 1][1] - r[i + 1][0] * r[i][1];
                }
                const ringArea = Math.abs(doubleArea) / 2;
                if (doubleArea < 0) {
                    outerRings.push({ ring: r, area: ringArea });
                } else if (doubleArea > 0) {
                    holeCandidates.push({ ring: r, area: ringArea });
                }
            }

            const pool = outerRings.length > 0 ? outerRings : holeCandidates;
            let maxRingArea = -1;
            for (const item of pool) {
                if (item.area > maxRingArea) {
                    maxRingArea = item.area;
                    bestRing = item.ring;
                }
            }

            if (bestRing && maxRingArea >= 5) {
                simplified = RasterContourTracer.simplifyClosedPolygon(bestRing, rdpTolerance);

                // Extract interior island holes contained within bestRing
                if (outerRings.length > 0 && holeCandidates.length > 0) {
                    holeCandidates.sort((a, b) => b.area - a.area);
                    const subCells = maskData.subtractedCells;

                    for (const hc of holeCandidates) {
                        let keepHole = hc.area >= minHoleArea;
                        if (!keepHole && hc.area >= 4 && subCells?.size) {
                            for (const cellIdx of subCells) {
                                const cy = Math.floor(cellIdx / cols) + 0.5;
                                const cx = (cellIdx % cols) + 0.5;
                                if (RasterContourTracer.pointInRing(cx, cy, hc.ring)) {
                                    keepHole = true;
                                    break;
                                }
                            }
                        }
                        if (!keepHole) continue;

                        // Must lie inside the primary outer water boundary
                        if (!RasterContourTracer.pointInRing(hc.ring[0][0], hc.ring[0][1], bestRing)) {
                            continue;
                        }

                        // Skip if nested inside an already-accepted larger island hole
                        const isNested = acceptedHoleRings.some(
                            parent => RasterContourTracer.pointInRing(hc.ring[0][0], hc.ring[0][1], parent.ring)
                        );
                        if (!isNested) {
                            acceptedHoleRings.push(hc);
                        }
                    }
                }
            }
        }

        // Fallback to 1D sweep contour only if Marching Squares found no rings
        if (!simplified || simplified.length < 6) {
            const colPoly = RasterContourTracer.columnSweepContour(mask, cols, rows, rdpTolerance);
            const rowPoly = RasterContourTracer.rowSweepContour(mask, cols, rows, rdpTolerance);
            if (!colPoly && !rowPoly) return null;
            if (!colPoly) simplified = rowPoly;
            else if (!rowPoly) simplified = colPoly;
            else simplified = (rowPoly.length > colPoly.length) ? rowPoly : colPoly;
        }

        if (!simplified || simplified.length < 6) return null;

        // Convert to scene coords
        const scaleX = dims.sceneWidth / imgW;
        const scaleY = dims.sceneHeight / imgH;
        const toSceneCoords = (gridPts) => {
            const out = [];
            for (let i = 0; i < gridPts.length; i += 2) {
                const gx = Math.max(0, Math.min(cols, gridPts[i]));
                const gy = Math.max(0, Math.min(rows, gridPts[i + 1]));
                out.push(
                    Math.round(dims.sceneX + gx * gridStep * scaleX),
                    Math.round(dims.sceneY + gy * gridStep * scaleY)
                );
            }
            return out;
        };

        let scenePoints = toSceneCoords(simplified);
        // Apply 1-pass corner rounding to inland vertices to eliminate discrete grid stair-stepping
        scenePoints = RasterContourTracer.smoothContour(scenePoints, 1, dims);

        // Convert and smooth accepted interior island holes
        const holes = [];
        const holeSmoothing = Math.max(0.25, rdpTolerance * 0.65);
        for (const hc of acceptedHoleRings) {
            // Clear any trapped 1-cells inside the island hole so raster preview stays clean
            let minGX = cols, maxGX = 0, minGY = rows, maxGY = 0;
            for (const pt of hc.ring) {
                if (pt[0] < minGX) minGX = Math.max(0, Math.floor(pt[0]));
                if (pt[0] > maxGX) maxGX = Math.min(cols - 1, Math.ceil(pt[0]));
                if (pt[1] < minGY) minGY = Math.max(0, Math.floor(pt[1]));
                if (pt[1] > maxGY) maxGY = Math.min(rows - 1, Math.ceil(pt[1]));
            }
            for (let gy = minGY; gy <= maxGY; gy++) {
                for (let gx = minGX; gx <= maxGX; gx++) {
                    if (mask[gy * cols + gx] && RasterContourTracer.pointInRing(gx + 0.5, gy + 0.5, hc.ring)) {
                        mask[gy * cols + gx] = 0;
                        area = Math.max(10, area - 1);
                    }
                }
            }

            const simHole = RasterContourTracer.simplifyClosedPolygon(hc.ring, holeSmoothing);
            if (!simHole || simHole.length < 6) continue;
            let holeScenePts = toSceneCoords(simHole);
            holeScenePts = RasterContourTracer.smoothContour(holeScenePts, 1, dims);
            if (holeScenePts.length >= 6) {
                holes.push(holeScenePts);
            }
        }

        let cx = 0, cy = 0;
        const vertCount = scenePoints.length / 2;
        for (let i = 0; i < scenePoints.length; i += 2) {
            cx += scenePoints[i];
            cy += scenePoints[i + 1];
        }
        const holeVertCount = holes.reduce((sum, h) => sum + Math.round(h.length / 2), 0);

        const candidate = {
            points: scenePoints,
            holes,
            area,
            centroid: { x: cx / vertCount, y: cy / vertCount },
            vertexCount: vertCount + holeVertCount
        };
        candidate.estimation = WaterShapeEstimator.estimate(candidate, dims);
        return candidate;
    }

    /**
     * Smooth an inland contour using corner-rounding subdivision (Chaikin's algorithm).
     * Eliminates stair-stepped grid artifacts while preserving straight map border edges.
     *
     * @param {number[]} points - Flat array of [x, y, x, y, ...]
     * @param {number} [iterations=1] - Number of smoothing passes
     * @param {object} [dimensions] - Canvas / scene dimensions
     * @returns {number[]} Smoothed flat points array
     */
    static smoothContour(points, iterations = 1, dimensions) {
        return RasterContourTracer.smoothContour(points, iterations, dimensions);
    }

    /**
     * Generate a preview sprite from mask data.
     * @param {object} maskData - { mask, cols, rows, gridStep }
     * @returns {PIXI.Sprite|null}
     */
    static previewFromMask(maskData) {
        const { mask, cols, rows, gridStep } = maskData;
        const imgW = WaterDetector.#cachedImgW;
        const imgH = WaterDetector.#cachedImgH;
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
    }

    /**
     * Generate a PIXI.Sprite preview of a flood fill from a scene coordinate.
     * @param {number} sceneX
     * @param {number} sceneY
     * @param {number} [tolerance=40]
     * @returns {Promise<PIXI.Sprite|null>}
     */
    static async generateFloodPreview(sceneX, sceneY, tolerance = 40) {
        if (!await WaterDetector.#ensureImageCache()) return null;

        const imgData = WaterDetector.#cachedImageData;
        const imgW = WaterDetector.#cachedImgW;
        const imgH = WaterDetector.#cachedImgH;
        const pixels = imgData.data;
        const dims = canvas.dimensions;
        const gridStep = 4;

        const cols = Math.ceil(imgW / gridStep);
        const rows = Math.ceil(imgH / gridStep);
        const filled = new Uint8Array(cols * rows);
        const filteredGrid = WaterDetector.#getFilteredGrid(gridStep);

        const cellCount = RasterContourTracer.floodFillIntoMask({
            mask: filled, cols, rows, gridStep, sceneX, sceneY, tolerance,
            imgW, imgH, pixels, dims, filteredGrid
        });

        if (cellCount === 0) return null;

        // Render mask
        const maskCanvas = document.createElement('canvas');
        maskCanvas.width = imgW;
        maskCanvas.height = imgH;
        const maskCtx = maskCanvas.getContext('2d');
        const maskData = maskCtx.createImageData(imgW, imgH);
        const md = maskData.data;

        for (let gy = 0; gy < rows; gy++) {
            for (let gx = 0; gx < cols; gx++) {
                if (!filled[gy * cols + gx]) continue;
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
        maskCtx.putImageData(maskData, 0, 0);

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

    /**
     * Generate a fast preview mask showing which pixels match detection thresholds.
     * Returns a PIXI.Sprite positioned on the scene, or null on failure.
     * @param {object} options - satMax, lumMin, lumMax
     * @returns {Promise<PIXI.Sprite|null>}
     */
    static async generatePreviewMask({ satMax = 0.30, lumMin = 0.18, lumMax = 0.65 } = {}) {
        const scene = canvas.scene;
        if (!scene) return null;

        const bgPath = WaterManager.resolveSceneBackgroundSrc(scene);
        if (!bgPath) return null;

        const img = await WaterDetector.#loadImage(bgPath);
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

    /**
     * Loads an image from a Foundry path.
     */
    static #loadImage(src) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.crossOrigin = 'anonymous';
            img.onload = () => resolve(img);
            img.onerror = reject;
            img.src = src;
        });
    }
}

