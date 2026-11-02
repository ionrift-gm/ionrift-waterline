import { WaterShapeEstimator } from './WaterShapeEstimator.js';
import { WaterManager } from './WaterManager.js';
import { RasterContourTracer } from './detection/RasterContourTracer.js';
import { waterDetectorRegionBridgeMethods } from './detection/WaterDetectorRegionBridge.js';

import { MODULE_ID } from '../data/moduleId.js';
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
            ui.notifications.warn(game.i18n.localize('IonriftWaterline.detector.warnNoActiveScene'));
            return;
        }

        ui.notifications.info(game.i18n.localize('IonriftWaterline.detector.notifyAnalyzing'));

        // Get the scene background texture
        const bgPath = WaterManager.resolveSceneBackgroundSrc(scene);
        if (!bgPath) {
            ui.notifications.warn(game.i18n.localize('IonriftWaterline.detector.warnNoBackground'));
            return;
        }

        // Load image
        const img = await WaterDetector._loadImage(bgPath);
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
            ui.notifications.warn(game.i18n.localize('IonriftWaterline.detector.warnNoneDetected'));
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
     * Convenience: detect and auto-accept all candidates.
     */
    static async detect(options = {}) {
        const candidates = await WaterDetector.detectCandidates(options);
        if (!candidates.length) return;

        let count = 0;
        for (const candidate of candidates) {
            const region = await WaterDetector.createRegionFromCandidate(candidate, game.i18n.format('IonriftWaterline.detector.defaultNumberedWaterName', { index: count + 1 }));
            if (region) count++;
        }

        if (count) {
            ui.notifications.info(game.i18n.format('IonriftWaterline.detector.notifyCreatedCount', { count }));
        } else {
            ui.notifications.warn(game.i18n.localize('IonriftWaterline.detector.warnInvalidPolygons'));
        }
    }

    // ------------------------------------------------------------------
    // Flood Fill from Click Point
    // ------------------------------------------------------------------

    /** @type {ImageData|null} Cached image data for repeated fills */
    static _cachedImageData = null;
    static _cachedImgW = 0;
    static _cachedImgH = 0;
    /** @type {{ rawRGB: Float32Array, smoothRGB: Float32Array, gridStep: number }|null} */
    static _cachedFilteredGrid = null;

    /**
     * Load and cache the scene background for flood fill operations.
     * @returns {Promise<boolean>}
     */
    static async _ensureImageCache() {
        const scene = canvas.scene;
        if (!scene) return false;
        const bgPath = WaterManager.resolveSceneBackgroundSrc(scene);
        if (!bgPath) return false;

        // Only reload if not cached
        if (WaterDetector._cachedImageData) return true;

        const img = await WaterDetector._loadImage(bgPath);
        const offscreen = document.createElement('canvas');
        offscreen.width = img.width;
        offscreen.height = img.height;
        const ctx = offscreen.getContext('2d');
        ctx.drawImage(img, 0, 0);
        WaterDetector._cachedImageData = ctx.getImageData(0, 0, img.width, img.height);
        WaterDetector._cachedImgW = img.width;
        WaterDetector._cachedImgH = img.height;
        WaterDetector._cachedFilteredGrid = null;
        return true;
    }

    /**
     * Retrieve or build the pre-filtered bilateral grid for the cached background image.
     * @param {number} gridStep
     * @returns {{ rawRGB: Float32Array, smoothRGB: Float32Array, gridStep: number }|null}
     */
    static _getFilteredGrid(gridStep) {
        if (!WaterDetector._cachedImageData) return null;
        if (WaterDetector._cachedFilteredGrid?.gridStep === gridStep) {
            return WaterDetector._cachedFilteredGrid;
        }
        const imgW = WaterDetector._cachedImgW;
        const imgH = WaterDetector._cachedImgH;
        const cols = Math.ceil(imgW / gridStep);
        const rows = Math.ceil(imgH / gridStep);
        WaterDetector._cachedFilteredGrid = RasterContourTracer.buildFilteredGrid(
            WaterDetector._cachedImageData.data, imgW, imgH, cols, rows, gridStep
        );
        return WaterDetector._cachedFilteredGrid;
    }

    /** Clear image cache (call on scene change) */
    static clearCache() {
        WaterDetector._cachedImageData = null;
        WaterDetector._cachedFilteredGrid = null;
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
        if (!await WaterDetector._ensureImageCache()) return null;

        const imgW = WaterDetector._cachedImgW;
        const imgH = WaterDetector._cachedImgH;

        // Grid dimensions
        const cols = Math.ceil(imgW / gridStep);
        const rows = Math.ceil(imgH / gridStep);
        const filled = new Uint8Array(cols * rows);
        const filteredGrid = WaterDetector._getFilteredGrid(gridStep);

        // Run the core flood fill into the mask
        const cellCount = RasterContourTracer.floodFillIntoMask({
            mask: filled, cols, rows, gridStep, sceneX, sceneY, tolerance,
            imgW, imgH, pixels: WaterDetector._cachedImageData.data, dims: canvas.dimensions,
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
        if (!await WaterDetector._ensureImageCache()) return null;

        const { mask, cols, rows, gridStep } = maskData;
        const imgW = WaterDetector._cachedImgW;
        const imgH = WaterDetector._cachedImgH;
        const pixels = WaterDetector._cachedImageData.data;
        const dims = canvas.dimensions;
        const filteredGrid = WaterDetector._getFilteredGrid(gridStep);

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
     * Generate a candidate polygon (plus interior island holes) from a cell mask.
     * Public so it can be called after refinement.
     * @param {object} maskData - { mask, cols, rows, gridStep }
     * @param {number} smoothing - RDP simplification tolerance
     * @returns {object|null} Candidate with { points, holes, area, centroid, vertexCount }
     */
    static candidateFromMask(maskData, smoothing = 7.0) {
        const { mask, cols, rows, gridStep } = maskData;
        const dims = maskData.dims || canvas.dimensions;
        const imgW = maskData.imgW || WaterDetector._cachedImgW || (cols * gridStep);
        const imgH = maskData.imgH || WaterDetector._cachedImgH || (rows * gridStep);

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
     * Loads an image from a Foundry path.
     */
    static _loadImage(src) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.crossOrigin = 'anonymous';
            img.onload = () => resolve(img);
            img.onerror = reject;
            img.src = src;
        });
    }
}

Object.assign(WaterDetector, waterDetectorRegionBridgeMethods);
