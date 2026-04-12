const MODULE_ID = 'ionrift-waterline';

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
        const bgPath = scene.background?.src;
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

                const { s, l } = WaterDetector.#rgbToHsl(r, g, b);

                if (s <= satMax && l >= lumMin && l <= lumMax) {
                    waterMask[gy * cols + gx] = 1;
                }
            }
        }

        // Find connected components
        const components = WaterDetector.#findComponents(waterMask, cols, rows);
        console.log(`Waterline | Found ${components.length} raw components, sizes: [${components.map(c => c.length).sort((a,b) => b-a).join(', ')}]`);

        // Filter to components above minimum area
        const validComponents = components.filter(c => c.length >= minArea);
        if (!validComponents.length) {
            ui.notifications.warn('Waterline | No water regions detected. Try adjusting thresholds.');
            return [];
        }

        // Sort by area descending so largest appears first
        validComponents.sort((a, b) => b.length - a.length);
        console.log(`Waterline | ${validComponents.length} component(s) above minArea=${minArea}`);

        // Scene dimensions for mapping grid coords to scene coords
        const dims = canvas.dimensions;
        const scaleX = dims.sceneWidth / imgW;
        const scaleY = dims.sceneHeight / imgH;

        // Build candidate data without creating Regions
        const candidates = [];
        for (let ci = 0; ci < validComponents.length; ci++) {
            const component = validComponents[ci];
            const contour = WaterDetector.#traceContour(component, cols, rows);
            console.log(`Waterline | Component ${ci}: area=${component.length}, contour=${contour.length/2} pts`);

            if (contour.length < 6) {
                console.log(`Waterline | Component ${ci}: SKIPPED (contour too short: ${contour.length} coords)`);
                continue;
            }

            const simplified = WaterDetector.#simplifyRDP(contour, simplifyTolerance);
            console.log(`Waterline | Component ${ci}: simplified to ${simplified.length/2} pts`);

            if (simplified.length < 6) {
                console.log(`Waterline | Component ${ci}: SKIPPED (simplified too short)`);
                continue;
            }

            // Convert grid coords to scene coords
            const scenePoints = [];
            for (let i = 0; i < simplified.length; i += 2) {
                scenePoints.push(
                    Math.round(dims.sceneX + simplified[i] * gridStep * scaleX),
                    Math.round(dims.sceneY + simplified[i + 1] * gridStep * scaleY)
                );
            }

            // Compute centroid and area for display
            let cx = 0, cy = 0;
            const vertCount = scenePoints.length / 2;
            for (let i = 0; i < scenePoints.length; i += 2) {
                cx += scenePoints[i];
                cy += scenePoints[i + 1];
            }

            candidates.push({
                points: scenePoints,
                area: component.length,
                centroid: { x: cx / vertCount, y: cy / vertCount },
                vertexCount: vertCount
            });
        }

        return candidates;
    }

    /**
     * Create a Foundry Region from a detection candidate.
     * @param {object} candidate - Result from detectCandidates
     * @param {string} [name] - Region name
     * @returns {Promise<RegionDocument|null>}
     */
    static async createRegionFromCandidate(candidate, name = 'Water') {
        const scene = canvas.scene;
        if (!scene || !game.user.isGM) return null;

        const regionData = {
            name,
            color: '#2a6496',
            shapes: [{
                type: 'polygon',
                points: candidate.points
            }],
            behaviors: []
        };

        try {
            const created = await scene.createEmbeddedDocuments('Region', [regionData]);
            if (created.length && CONFIG.RegionBehavior.dataModels[`${MODULE_ID}.waterFX`]) {
                await created[0].createEmbeddedDocuments('RegionBehavior', [{
                    type: `${MODULE_ID}.waterFX`,
                    name: 'Water FX'
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
        const bgPath = scene.background?.src;
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
        const cellCount = WaterDetector.#floodFillIntoMask(
            filled, cols, rows, gridStep, sceneX, sceneY, tolerance
        );

        if (cellCount < 10) {
            console.log(`Waterline | Flood fill too small (${cellCount} cells)`);
            return null;
        }

        console.log(`Waterline | Flood fill: ${cellCount} cells filled`);

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
        const cellCount = WaterDetector.#floodFillIntoMask(
            tempMask, cols, rows, gridStep, sceneX, sceneY, tolerance
        );

        if (cellCount < 3) {
            console.log(`Waterline | Refine fill too small (${cellCount} cells), ignoring`);
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

        console.log(`Waterline | Refine (${mode}): ${cellCount} fill cells, ${changed} mask cells changed`);

        if (changed === 0) return null;

        // Re-trace the contour from the updated mask
        const candidate = WaterDetector.candidateFromMask(maskData, smoothing);
        if (!candidate) return null;
        candidate.maskData = maskData;
        return candidate;
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

        // ── Strategy: run both sweep directions, pick the best result ──
        // Column-sweep handles rivers (horizontal). Row-sweep handles coastlines (vertical).

        const colPoly = WaterDetector.#columnSweepContour(mask, cols, rows, smoothing);
        const rowPoly = WaterDetector.#rowSweepContour(mask, cols, rows, smoothing);

        // Pick the contour with more vertices (more shape detail)
        let simplified;
        if (!colPoly && !rowPoly) return null;
        if (!colPoly) simplified = rowPoly;
        else if (!rowPoly) simplified = colPoly;
        else simplified = (rowPoly.length > colPoly.length) ? rowPoly : colPoly;

        if (simplified.length < 6) return null;

        // Convert to scene coords
        const scaleX = dims.sceneWidth / imgW;
        const scaleY = dims.sceneHeight / imgH;
        const scenePoints = [];
        for (let i = 0; i < simplified.length; i += 2) {
            scenePoints.push(
                Math.round(dims.sceneX + simplified[i] * gridStep * scaleX),
                Math.round(dims.sceneY + simplified[i + 1] * gridStep * scaleY)
            );
        }

        let cx = 0, cy = 0;
        const vertCount = scenePoints.length / 2;
        for (let i = 0; i < scenePoints.length; i += 2) {
            cx += scenePoints[i];
            cy += scenePoints[i + 1];
        }

        return {
            points: scenePoints,
            area,
            centroid: { x: cx / vertCount, y: cy / vertCount },
            vertexCount: vertCount
        };
    }

    /**
     * Column sweep: top edge L-R, bottom edge R-L. Best for horizontal water bodies.
     * @private
     */
    static #columnSweepContour(mask, cols, rows, smoothing) {
        const topEdge = [];
        const bottomEdge = [];

        for (let x = 0; x < cols; x++) {
            let minY = -1, maxY = -1;
            for (let y = 0; y < rows; y++) {
                if (mask[y * cols + x]) {
                    if (minY < 0) minY = y;
                    maxY = y;
                }
            }
            if (minY >= 0) {
                topEdge.push(x, minY);
                bottomEdge.push(x, maxY);
            }
        }

        if (topEdge.length < 4) return null;

        // Simplify each edge independently
        const simTop = WaterDetector.#simplifyRDP(topEdge, smoothing);
        const simBot = WaterDetector.#simplifyRDP(bottomEdge, smoothing);

        // Combine: top L-R, bottom R-L
        const contour = [...simTop];
        for (let i = simBot.length - 2; i >= 0; i -= 2) {
            contour.push(simBot[i], simBot[i + 1]);
        }
        return contour.length >= 6 ? contour : null;
    }

    /**
     * Row sweep: left edge T-B, right edge B-T. Best for vertical water bodies.
     * @private
     */
    static #rowSweepContour(mask, cols, rows, smoothing) {
        const leftEdge = [];
        const rightEdge = [];

        for (let y = 0; y < rows; y++) {
            let minX = -1, maxX = -1;
            for (let x = 0; x < cols; x++) {
                if (mask[y * cols + x]) {
                    if (minX < 0) minX = x;
                    maxX = x;
                }
            }
            if (minX >= 0) {
                leftEdge.push(minX, y);
                rightEdge.push(maxX, y);
            }
        }

        if (leftEdge.length < 4) return null;

        // Simplify each edge independently
        const simLeft = WaterDetector.#simplifyRDP(leftEdge, smoothing);
        const simRight = WaterDetector.#simplifyRDP(rightEdge, smoothing);

        // Combine: left T-B, right B-T
        const contour = [...simLeft];
        for (let i = simRight.length - 2; i >= 0; i -= 2) {
            contour.push(simRight[i], simRight[i + 1]);
        }
        return contour.length >= 6 ? contour : null;
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
     * Core flood fill operation. Fills cells into an existing mask array.
     * @param {Uint8Array} mask - Target mask to fill into
     * @param {number} cols
     * @param {number} rows
     * @param {number} gridStep
     * @param {number} sceneX - Scene X coordinate
     * @param {number} sceneY - Scene Y coordinate
     * @param {number} tolerance
     * @returns {number} Number of cells filled
     * @private
     */
    static #floodFillIntoMask(mask, cols, rows, gridStep, sceneX, sceneY, tolerance) {
        const imgW = WaterDetector.#cachedImgW;
        const imgH = WaterDetector.#cachedImgH;
        const pixels = WaterDetector.#cachedImageData.data;
        const dims = canvas.dimensions;

        // Convert scene coords to image pixel coords
        const imgX = Math.round(((sceneX - dims.sceneX) / dims.sceneWidth) * imgW);
        const imgY = Math.round(((sceneY - dims.sceneY) / dims.sceneHeight) * imgH);

        if (imgX < 0 || imgX >= imgW || imgY < 0 || imgY >= imgH) return 0;

        // Sample seed color
        const seedIdx = (imgY * imgW + imgX) * 4;
        const seedR = pixels[seedIdx];
        const seedG = pixels[seedIdx + 1];
        const seedB = pixels[seedIdx + 2];

        console.log(`Waterline | Flood fill from (${imgX}, ${imgY}), seed: rgb(${seedR}, ${seedG}, ${seedB}), tol: ${tolerance}`);

        // Convert seed to grid coords
        const seedGX = Math.floor(imgX / gridStep);
        const seedGY = Math.floor(imgY / gridStep);
        if (seedGX < 0 || seedGX >= cols || seedGY < 0 || seedGY >= rows) return 0;

        const tolSq = tolerance * tolerance;
        const visited = new Uint8Array(cols * rows);

        const colorMatch = (gx, gy) => {
            const px = Math.min(gx * gridStep, imgW - 1);
            const py = Math.min(gy * gridStep, imgH - 1);
            const idx = (py * imgW + px) * 4;
            const dr = pixels[idx] - seedR;
            const dg = pixels[idx + 1] - seedG;
            const db = pixels[idx + 2] - seedB;
            return (dr * dr + dg * dg + db * db) <= tolSq;
        };

        // BFS flood fill
        const stack = [{ x: seedGX, y: seedGY }];
        visited[seedGY * cols + seedGX] = 1;
        let count = 0;

        while (stack.length) {
            const { x, y } = stack.pop();
            mask[y * cols + x] = 1;
            count++;

            for (const [dx, dy] of [[-1,0],[1,0],[0,-1],[0,1]]) {
                const nx = x + dx;
                const ny = y + dy;
                if (nx < 0 || nx >= cols || ny < 0 || ny >= rows) continue;
                const nIdx = ny * cols + nx;
                if (visited[nIdx]) continue;
                visited[nIdx] = 1;
                if (!colorMatch(nx, ny)) continue;
                stack.push({ x: nx, y: ny });
            }
        }

        return count;
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

        const imgX = Math.round(((sceneX - dims.sceneX) / dims.sceneWidth) * imgW);
        const imgY = Math.round(((sceneY - dims.sceneY) / dims.sceneHeight) * imgH);
        if (imgX < 0 || imgX >= imgW || imgY < 0 || imgY >= imgH) return null;

        const seedIdx = (imgY * imgW + imgX) * 4;
        const seedR = pixels[seedIdx];
        const seedG = pixels[seedIdx + 1];
        const seedB = pixels[seedIdx + 2];

        const cols = Math.ceil(imgW / gridStep);
        const rows = Math.ceil(imgH / gridStep);
        const filled = new Uint8Array(cols * rows);
        const seedGX = Math.floor(imgX / gridStep);
        const seedGY = Math.floor(imgY / gridStep);
        if (seedGX < 0 || seedGX >= cols || seedGY < 0 || seedGY >= rows) return null;

        const tolSq = tolerance * tolerance;
        const stack = [{ x: seedGX, y: seedGY }];
        filled[seedGY * cols + seedGX] = 1;

        while (stack.length) {
            const { x, y } = stack.pop();
            for (const [dx, dy] of [[-1,0],[1,0],[0,-1],[0,1]]) {
                const nx = x + dx;
                const ny = y + dy;
                if (nx < 0 || nx >= cols || ny < 0 || ny >= rows) continue;
                const nIdx = ny * cols + nx;
                if (filled[nIdx]) continue;
                const px = Math.min(nx * gridStep, imgW - 1);
                const py = Math.min(ny * gridStep, imgH - 1);
                const pi = (py * imgW + px) * 4;
                const dr = pixels[pi] - seedR;
                const dg = pixels[pi + 1] - seedG;
                const db = pixels[pi + 2] - seedB;
                if (dr * dr + dg * dg + db * db <= tolSq) {
                    filled[nIdx] = 1;
                    stack.push({ x: nx, y: ny });
                }
            }
        }

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

        const bgPath = scene.background?.src;
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

                const { s, l } = WaterDetector.#rgbToHsl(r, g, b);

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

    /**
     * Convert RGB (0-1) to HSL.
     */
    static #rgbToHsl(r, g, b) {
        const max = Math.max(r, g, b);
        const min = Math.min(r, g, b);
        const l = (max + min) / 2;

        if (max === min) return { h: 0, s: 0, l };

        const d = max - min;
        const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);

        let h;
        if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
        else if (max === g) h = ((b - r) / d + 2) / 6;
        else h = ((r - g) / d + 4) / 6;

        return { h, s, l };
    }

    /**
     * Flood-fill connected component labelling.
     */
    static #findComponents(mask, cols, rows) {
        const visited = new Uint8Array(cols * rows);
        const components = [];

        for (let y = 0; y < rows; y++) {
            for (let x = 0; x < cols; x++) {
                const idx = y * cols + x;
                if (mask[idx] && !visited[idx]) {
                    const component = [];
                    const stack = [{ x, y }];
                    visited[idx] = 1;

                    while (stack.length) {
                        const { x: cx, y: cy } = stack.pop();
                        component.push({ x: cx, y: cy });

                        for (const [dx, dy] of [[-1,0],[1,0],[0,-1],[0,1]]) {
                            const nx = cx + dx;
                            const ny = cy + dy;
                            if (nx < 0 || nx >= cols || ny < 0 || ny >= rows) continue;
                            const nIdx = ny * cols + nx;
                            if (mask[nIdx] && !visited[nIdx]) {
                                visited[nIdx] = 1;
                                stack.push({ x: nx, y: ny });
                            }
                        }
                    }

                    components.push(component);
                }
            }
        }

        return components;
    }

    /**
     * Extract the outer contour of a connected component.
     * Primary: walks 8-connected boundary cells on the grid.
     * Fallback: convex hull if the walk covers too few boundary cells.
     * Returns a flat array of [x, y, x, y, ...] grid coordinates.
     */
    static #traceContour(component, cols, rows) {
        const inRegion = new Uint8Array(cols * rows);
        for (const p of component) {
            inRegion[p.y * cols + p.x] = 1;
        }

        const isSet = (x, y) => {
            if (x < 0 || x >= cols || y < 0 || y >= rows) return false;
            return inRegion[y * cols + x] === 1;
        };

        // Collect boundary cells and mark in a grid
        const isBoundary = new Uint8Array(cols * rows);
        const boundary = [];
        for (const p of component) {
            const { x, y } = p;
            if (!isSet(x-1, y) || !isSet(x+1, y) || !isSet(x, y-1) || !isSet(x, y+1)) {
                isBoundary[y * cols + x] = 1;
                boundary.push(p);
            }
        }

        if (boundary.length < 3) {
            const pts = [];
            for (const p of component) pts.push(p.x, p.y);
            return pts;
        }

        // ── Attempt 1: Grid-walk ──
        const dirs = [[0,-1],[1,-1],[1,0],[1,1],[0,1],[-1,1],[-1,0],[-1,-1]];

        boundary.sort((a, b) => a.y - b.y || a.x - b.x);
        const start = boundary[0];

        const visited = new Uint8Array(cols * rows);
        visited[start.y * cols + start.x] = 1;
        const chain = [start];

        let cx = start.x, cy = start.y;
        let lastDir = 4;
        const minBeforeClose = Math.max(8, Math.floor(boundary.length * 0.3));

        for (let step = 0; step < boundary.length * 4; step++) {
            let found = false;
            const scanStart = (lastDir + 5) % 8;

            for (let i = 0; i < 8; i++) {
                const d = (scanStart + i) % 8;
                const nx = cx + dirs[d][0];
                const ny = cy + dirs[d][1];

                if (nx < 0 || nx >= cols || ny < 0 || ny >= rows) continue;
                if (!isBoundary[ny * cols + nx]) continue;
                if (visited[ny * cols + nx]) {
                    if (nx === start.x && ny === start.y && chain.length >= minBeforeClose) {
                        found = false;
                        break;
                    }
                    continue;
                }

                visited[ny * cols + nx] = 1;
                chain.push({ x: nx, y: ny });
                cx = nx;
                cy = ny;
                lastDir = d;
                found = true;
                break;
            }

            if (!found) break;
        }

        // If the walk covered enough boundary, use it
        if (chain.length >= boundary.length * 0.3) {
            const contour = [];
            for (const p of chain) contour.push(p.x, p.y);
            return contour;
        }

        // ── Fallback: Convex Hull ──
        console.log(`Waterline | Grid-walk covered ${chain.length}/${boundary.length} boundary cells, falling back to convex hull`);
        const points = boundary.slice().sort((a, b) => a.x - b.x || a.y - b.y);

        const cross = (o, a, b) =>
            (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

        const lower = [];
        for (const p of points) {
            while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
            lower.push(p);
        }

        const upper = [];
        for (let i = points.length - 1; i >= 0; i--) {
            const p = points[i];
            while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
            upper.push(p);
        }

        lower.pop();
        upper.pop();
        const hull = lower.concat(upper);
        const contour = [];
        for (const p of hull) contour.push(p.x, p.y);
        return contour;
    }

    /**
     * Ramer-Douglas-Peucker line simplification.
     * Points is a flat array [x, y, x, y, ...].
     */
    static #simplifyRDP(points, tolerance) {
        if (points.length <= 4) return points;

        const n = points.length / 2;

        function perpDist(px, py, ax, ay, bx, by) {
            const dx = bx - ax;
            const dy = by - ay;
            const lenSq = dx * dx + dy * dy;
            if (lenSq === 0) return Math.sqrt((px - ax) ** 2 + (py - ay) ** 2);
            let t = ((px - ax) * dx + (py - ay) * dy) / lenSq;
            t = Math.max(0, Math.min(1, t));
            return Math.sqrt((px - (ax + t * dx)) ** 2 + (py - (ay + t * dy)) ** 2);
        }

        function simplify(start, end) {
            let maxDist = 0;
            let maxIdx = start;
            const ax = points[start * 2];
            const ay = points[start * 2 + 1];
            const bx = points[end * 2];
            const by = points[end * 2 + 1];

            for (let i = start + 1; i < end; i++) {
                const d = perpDist(points[i * 2], points[i * 2 + 1], ax, ay, bx, by);
                if (d > maxDist) {
                    maxDist = d;
                    maxIdx = i;
                }
            }

            if (maxDist > tolerance) {
                const left = simplify(start, maxIdx);
                const right = simplify(maxIdx, end);
                return [...left.slice(0, -2), ...right];
            }

            return [ax, ay, bx, by];
        }

        return simplify(0, n - 1);
    }
}
