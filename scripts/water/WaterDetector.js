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

        const regionData = {
            name: regionName,
            color: colorOverride || (archetype === 'puddle' ? '#38bdf8' : WATER_ARCHETYPES[archetype]?.accentColor) || '#2a6496',
            shapes: [{
                type: 'polygon',
                points: regionPoints
            }],
            flags: {
                [MODULE_ID]: {
                    configured: true,
                    ...(colorOverride ? { color: colorOverride } : {})
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
                        riverWaves: Number.isFinite(fx.riverWaves) ? fx.riverWaves : (preset.riverWaves ?? (archetype === 'river' ? 0.65 : 0.0)),
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
        return true;
    }

    /** Clear image cache (call on scene change) */
    static clearCache() {
        WaterDetector.#cachedImageData = null;
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

        // Run the core flood fill into the mask
        const cellCount = RasterContourTracer.floodFillIntoMask({
            mask: filled, cols, rows, gridStep, sceneX, sceneY, tolerance,
            imgW, imgH, pixels: WaterDetector.#cachedImageData.data, dims: canvas.dimensions
        });

        if (cellCount < 10) {
            LOG(`Waterline | Flood fill too small (${cellCount} cells)`);
            return null;
        }

        LOG(`Waterline | Flood fill: ${cellCount} cells filled`);

        // Build candidate from the mask
        const maskData = { mask: filled, cols, rows, gridStep };
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
     * @returns {object|null} Updated candidate with maskData
     */
    static async refineMask(maskData, sceneX, sceneY, mode, tolerance, smoothing) {
        if (!await WaterDetector.#ensureImageCache()) return null;

        const { mask, cols, rows, gridStep } = maskData;

        // Run a new flood fill into a temporary mask
        const tempMask = new Uint8Array(cols * rows);
        const cellCount = RasterContourTracer.floodFillIntoMask({
            mask: tempMask, cols, rows, gridStep, sceneX, sceneY, tolerance,
            imgW: WaterDetector.#cachedImgW,
            imgH: WaterDetector.#cachedImgH,
            pixels: WaterDetector.#cachedImageData.data,
            dims: canvas.dimensions
        });

        if (cellCount < 3) {
            LOG(`Waterline | Refine fill too small (${cellCount} cells), ignoring`);
            return null;
        }

        // Apply the operation to the existing mask
        let changed = 0;
        for (let i = 0; i < mask.length; i++) {
            if (mode === 'add' && tempMask[i] && !mask[i]) {
                mask[i] = 1;
                changed++;
            } else if (mode === 'subtract' && tempMask[i] && mask[i]) {
                mask[i] = 0;
                changed++;
            }
        }

        LOG(`Waterline | Refine (${mode}): ${cellCount} fill cells, ${changed} mask cells changed`);

        if (changed === 0) return null;

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

        // Extract shapes from region
        const shapes = region.shapes?.contents ?? region.shapes ?? [];
        if (!shapes.length) return null;

        let hasDrawn = false;
        for (const shape of shapes) {
            const isHole = Boolean(shape.hole);
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

        return { mask, cols, rows, gridStep };
    }

    /**
     * Generate a candidate polygon from a cell mask.
     * Public so it can be called after refinement.
     * @param {object} maskData - { mask, cols, rows, gridStep }
     * @param {number} smoothing - RDP simplification tolerance
     * @returns {object|null} Candidate with { points, area, centroid, vertexCount }
     */
    static candidateFromMask(maskData, smoothing = 7.0) {
        const { mask, cols, rows, gridStep } = maskData;
        const dims = canvas.dimensions;
        const imgW = WaterDetector.#cachedImgW;
        const imgH = WaterDetector.#cachedImgH;

        // Count filled cells
        let area = 0;
        for (let i = 0; i < mask.length; i++) {
            if (mask[i]) area++;
        }
        if (area < 10) return null;

        // Strategy: extract 2D topological contour via Marching Squares.
        // Handles complex concave shorelines, diagonal piers, outcrops, and bays without bridging.
        let simplified = null;
        const rings = RasterContourTracer.marchingSquares(mask, cols, rows);
        if (rings.length > 0) {
            let bestRing = null;
            let maxRingArea = -1;
            for (const r of rings) {
                let doubleArea = 0;
                const n = r.length;
                for (let i = 0; i < n - 1; i++) {
                    doubleArea += r[i][0] * r[i + 1][1] - r[i + 1][0] * r[i][1];
                }
                const ringArea = Math.abs(doubleArea) / 2;
                if (ringArea > maxRingArea) {
                    maxRingArea = ringArea;
                    bestRing = r;
                }
            }
            if (bestRing && maxRingArea >= 5) {
                simplified = RasterContourTracer.simplifyClosedPolygon(bestRing, smoothing);
            }
        }

        // Fallback to 1D sweep contour only if Marching Squares found no rings
        if (!simplified || simplified.length < 6) {
            const colPoly = RasterContourTracer.columnSweepContour(mask, cols, rows, smoothing);
            const rowPoly = RasterContourTracer.rowSweepContour(mask, cols, rows, smoothing);
            if (!colPoly && !rowPoly) return null;
            if (!colPoly) simplified = rowPoly;
            else if (!rowPoly) simplified = colPoly;
            else simplified = (rowPoly.length > colPoly.length) ? rowPoly : colPoly;
        }

        if (!simplified || simplified.length < 6) return null;

        // Convert to scene coords
        const scaleX = dims.sceneWidth / imgW;
        const scaleY = dims.sceneHeight / imgH;
        let scenePoints = [];
        for (let i = 0; i < simplified.length; i += 2) {
            const gx = Math.max(0, Math.min(cols, simplified[i]));
            const gy = Math.max(0, Math.min(rows, simplified[i + 1]));
            scenePoints.push(
                Math.round(dims.sceneX + gx * gridStep * scaleX),
                Math.round(dims.sceneY + gy * gridStep * scaleY)
            );
        }

        // Apply 1-pass corner rounding to inland vertices to eliminate discrete grid stair-stepping
        scenePoints = RasterContourTracer.smoothContour(scenePoints, 1, dims);

        let cx = 0, cy = 0;
        const vertCount = scenePoints.length / 2;
        for (let i = 0; i < scenePoints.length; i += 2) {
            cx += scenePoints[i];
            cy += scenePoints[i + 1];
        }

        const candidate = {
            points: scenePoints,
            area,
            centroid: { x: cx / vertCount, y: cy / vertCount },
            vertexCount: vertCount
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

        const cellCount = RasterContourTracer.floodFillIntoMask({
            mask: filled, cols, rows, gridStep, sceneX, sceneY, tolerance,
            imgW, imgH, pixels, dims
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

