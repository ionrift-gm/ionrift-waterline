import { MODULE_ID } from '../../data/moduleId.js';

const LOG = (...args) => {
    try {
        if (game.settings?.get?.(MODULE_ID, 'debug')) console.log('Waterline |', ...args);
    } catch {
        /* setting not yet registered */
    }
};

/**
 * Bilateral grid pre-filtering, morphological mask closing, speckle/hole cleaning,
 * and chroma-guided BFS flood fill for RasterContourTracer.
 */
export const rasterFloodFilterMethods = {
    /**
     * Fills small enclosed 0-speckles (water texture grain) below minHoleArea while
     * preserving genuine island holes (>= minHoleArea or explicitly user-subtracted).
     * Also removes tiny disconnected 1-islands that were severed from the main waterbody.
     *
     * @param {Uint8Array} mask
     * @param {number} cols
     * @param {number} rows
     * @param {number} [minHoleArea=36]
     * @param {Set<number>|null} [preservedZeroCells=null]
     */
    cleanMaskHoles(mask, cols, rows, minHoleArea = 36, preservedZeroCells = null) {
        const total = cols * rows;
        if (!total) return;

        // 1. Keep only significant connected components of 1s (drop tiny severed interior fragments)
        const comps = this.findComponents(mask, cols, rows);
        if (comps.length > 1) {
            let maxLen = 0;
            for (const c of comps) {
                if (c.length > maxLen) maxLen = c.length;
            }
            for (const c of comps) {
                // Drop small disconnected fragments (< 15% of main body and < 60 cells)
                if (c.length < maxLen && c.length < Math.min(60, maxLen * 0.15)) {
                    for (const pt of c) {
                        mask[pt.y * cols + pt.x] = 0;
                    }
                }
            }
        }

        // 2. Find connected components of 0s; fill tiny interior speckles (< minHoleArea)
        const visitedZero = new Uint8Array(total);
        for (let y = 0; y < rows; y++) {
            for (let x = 0; x < cols; x++) {
                const startIdx = y * cols + x;
                if (mask[startIdx] !== 0 || visitedZero[startIdx]) continue;

                const zeroComp = [];
                const stack = [startIdx];
                visitedZero[startIdx] = 1;
                let touchesBorder = false;
                let hasPreserved = false;

                while (stack.length) {
                    const idx = stack.pop();
                    zeroComp.push(idx);
                    const cy = Math.floor(idx / cols);
                    const cx = idx - cy * cols;

                    if (cx === 0 || cx === cols - 1 || cy === 0 || cy === rows - 1) {
                        touchesBorder = true;
                    }
                    if (preservedZeroCells && preservedZeroCells.has(idx)) {
                        hasPreserved = true;
                    }

                    if (cx > 0) {
                        const n = idx - 1;
                        if (mask[n] === 0 && !visitedZero[n]) { visitedZero[n] = 1; stack.push(n); }
                    }
                    if (cx < cols - 1) {
                        const n = idx + 1;
                        if (mask[n] === 0 && !visitedZero[n]) { visitedZero[n] = 1; stack.push(n); }
                    }
                    if (cy > 0) {
                        const n = idx - cols;
                        if (mask[n] === 0 && !visitedZero[n]) { visitedZero[n] = 1; stack.push(n); }
                    }
                    if (cy < rows - 1) {
                        const n = idx + cols;
                        if (mask[n] === 0 && !visitedZero[n]) { visitedZero[n] = 1; stack.push(n); }
                    }
                }

                if (!touchesBorder && !hasPreserved && zeroComp.length < minHoleArea) {
                    for (let i = 0; i < zeroComp.length; i++) {
                        mask[zeroComp[i]] = 1;
                    }
                }
            }
        }
    },

    /**
     * Pre-filter image pixels onto the sampling grid using box-averaging followed by
     * a 2-pass 3x3 chroma-guided bilateral filter. Melts high-frequency caustic webs,
     * mottled depth pockets, and baked map gridlines into a smooth local color field
     * while keeping hue transitions (shorelines) sharp.
     *
     * @param {Uint8ClampedArray} pixels
     * @param {number} imgW
     * @param {number} imgH
     * @param {number} cols
     * @param {number} rows
     * @param {number} gridStep
     * @returns {{ rawRGB: Float32Array, smoothRGB: Float32Array, gridStep: number }}
     */
    buildFilteredGrid(pixels, imgW, imgH, cols, rows, gridStep) {
        const total = cols * rows;
        const rawRGB = new Float32Array(total * 3);

        // Pass 1: Box-average each gridStep x gridStep pixel block
        for (let gy = 0; gy < rows; gy++) {
            const py0 = gy * gridStep;
            const py1 = Math.min(py0 + gridStep, imgH);
            for (let gx = 0; gx < cols; gx++) {
                const px0 = gx * gridStep;
                const px1 = Math.min(px0 + gridStep, imgW);
                let rSum = 0, gSum = 0, bSum = 0, count = 0;
                for (let py = py0; py < py1; py++) {
                    const rowOff = py * imgW;
                    for (let px = px0; px < px1; px++) {
                        const idx = (rowOff + px) * 4;
                        rSum += pixels[idx];
                        gSum += pixels[idx + 1];
                        bSum += pixels[idx + 2];
                        count++;
                    }
                }
                const cIdx = (gy * cols + gx) * 3;
                const inv = count > 0 ? 1 / count : 0;
                rawRGB[cIdx]     = rSum * inv;
                rawRGB[cIdx + 1] = gSum * inv;
                rawRGB[cIdx + 2] = bSum * inv;
            }
        }

        // Pass 2: 2-iteration 3x3 Chroma-Guided Bilateral Grid Filter
        let src = rawRGB;
        for (let pass = 0; pass < 2; pass++) {
            const dst = new Float32Array(total * 3);
            for (let gy = 0; gy < rows; gy++) {
                const y0 = Math.max(0, gy - 1);
                const y1 = Math.min(rows - 1, gy + 1);
                for (let gx = 0; gx < cols; gx++) {
                    const x0 = Math.max(0, gx - 1);
                    const x1 = Math.min(cols - 1, gx + 1);

                    const cIdx = (gy * cols + gx) * 3;
                    const r0 = src[cIdx], g0 = src[cIdx + 1], b0 = src[cIdx + 2];
                    const s0 = Math.max(r0 + g0 + b0, 36);
                    const nr0 = r0 / s0, ng0 = g0 / s0, nb0 = b0 / s0;

                    let wSum = 0, rAcc = 0, gAcc = 0, bAcc = 0;
                    for (let ny = y0; ny <= y1; ny++) {
                        for (let nx = x0; nx <= x1; nx++) {
                            const nIdx = (ny * cols + nx) * 3;
                            const r1 = src[nIdx], g1 = src[nIdx + 1], b1 = src[nIdx + 2];
                            const s1 = Math.max(r1 + g1 + b1, 36);
                            const dr = (r1 / s1) - nr0;
                            const dg = (g1 / s1) - ng0;
                            const db = (b1 / s1) - nb0;
                            const chromaDistSq = dr * dr + dg * dg + db * db;

                            const isCenter = (nx === gx && ny === gy);
                            const isCard = (nx === gx || ny === gy);
                            const wSpatial = isCenter ? 2.0 : (isCard ? 1.0 : 0.7);
                            const wChroma = Math.exp(-chromaDistSq / 0.008);
                            const w = wSpatial * wChroma;

                            wSum += w;
                            rAcc += r1 * w;
                            gAcc += g1 * w;
                            bAcc += b1 * w;
                        }
                    }
                    dst[cIdx]     = rAcc / wSum;
                    dst[cIdx + 1] = gAcc / wSum;
                    dst[cIdx + 2] = bAcc / wSum;
                }
            }
            src = dst;
        }

        return { rawRGB, smoothRGB: src, gridStep };
    },

    /**
     * Morphological closing (dilate -> erode) followed by a 3x3 majority filter.
     * Welds narrow caustic fissures and serrated 1-2 cell shoreline notches without
     * shifting the net shoreline position or overwriting user-subtracted cells.
     *
     * @param {Uint8Array} mask
     * @param {number} cols
     * @param {number} rows
     * @param {Set<number>|null} [preservedZeroCells=null]
     */
    closeMask(mask, cols, rows, preservedZeroCells = null) {
        const total = cols * rows;
        if (!total) return;

        // 1. Dilate 1 step (skipping preservedZeroCells)
        const dilated = new Uint8Array(mask);
        for (let y = 0; y < rows; y++) {
            const yOff = y * cols;
            for (let x = 0; x < cols; x++) {
                const idx = yOff + x;
                if (mask[idx] === 1) continue;
                if (preservedZeroCells && preservedZeroCells.has(idx)) continue;

                const left   = (x > 0) ? mask[idx - 1] : 0;
                const right  = (x < cols - 1) ? mask[idx + 1] : 0;
                const top    = (y > 0) ? mask[idx - cols] : 0;
                const bottom = (y < rows - 1) ? mask[idx + cols] : 0;
                if (left || right || top || bottom) {
                    dilated[idx] = 1;
                }
            }
        }

        // 2. Erode 1 step (preserving map borders)
        const closed = new Uint8Array(total);
        for (let y = 0; y < rows; y++) {
            const yOff = y * cols;
            for (let x = 0; x < cols; x++) {
                const idx = yOff + x;
                if (dilated[idx] === 0) continue;
                const left   = (x > 0) ? dilated[idx - 1] : 1;
                const right  = (x < cols - 1) ? dilated[idx + 1] : 1;
                const top    = (y > 0) ? dilated[idx - cols] : 1;
                const bottom = (y < rows - 1) ? dilated[idx + cols] : 1;
                if (left && right && top && bottom) {
                    closed[idx] = 1;
                }
            }
        }

        // 3. 3x3 Majority filter to weld 1-cell notches and shave 1-cell burrs
        for (let y = 0; y < rows; y++) {
            const y0 = Math.max(0, y - 1), y1 = Math.min(rows - 1, y + 1);
            for (let x = 0; x < cols; x++) {
                const idx = y * cols + x;
                if (preservedZeroCells && preservedZeroCells.has(idx)) {
                    mask[idx] = 0;
                    continue;
                }
                const x0 = Math.max(0, x - 1), x1 = Math.min(cols - 1, x + 1);
                let ones = 0, neighbors = 0;
                for (let ny = y0; ny <= y1; ny++) {
                    for (let nx = x0; nx <= x1; nx++) {
                        neighbors++;
                        if (closed[ny * cols + nx]) ones++;
                    }
                }
                if (closed[idx] === 0 && ones >= Math.ceil(neighbors * 0.65)) {
                    mask[idx] = 1;
                } else if (closed[idx] === 1 && ones <= Math.floor(neighbors * 0.25)) {
                    mask[idx] = 0;
                } else {
                    mask[idx] = closed[idx];
                }
            }
        }
    },

    /**
     * BFS flood fill from a clicked scene point into a grid mask.
     * Uses pre-filtered bilateral grid cells, a 9x9 local patch seed profile,
     * scale-invariant chromaticity + damped luminance matching, and a warm-land guard.
     * @returns {number} Number of cells filled
     */
    floodFillIntoMask({
        mask, cols, rows, gridStep, sceneX, sceneY, tolerance,
        imgW, imgH, pixels, dims, avoidColor = null, maxStepDiff = 0,
        filteredGrid = null, preservedZeroCells = null
    }) {
        const imgX = Math.round(((sceneX - dims.sceneX) / dims.sceneWidth) * imgW);
        const imgY = Math.round(((sceneY - dims.sceneY) / dims.sceneHeight) * imgH);

        if (imgX < 0 || imgX >= imgW || imgY < 0 || imgY >= imgH) return 0;

        const seedGX = Math.floor(imgX / gridStep);
        const seedGY = Math.floor(imgY / gridStep);
        if (seedGX < 0 || seedGX >= cols || seedGY < 0 || seedGY >= rows) return 0;

        const grid = (filteredGrid && filteredGrid.gridStep === gridStep)
            ? filteredGrid
            : this.buildFilteredGrid(pixels, imgW, imgH, cols, rows, gridStep);
        const cellRGB = grid.smoothRGB;

        const clickIdx = (seedGY * cols + seedGX) * 3;
        const clickR = cellRGB[clickIdx];
        const clickG = cellRGB[clickIdx + 1];
        const clickB = cellRGB[clickIdx + 2];
        const clickS = Math.max(clickR + clickG + clickB, 36);
        const clickNR = clickR / clickS, clickNG = clickG / clickS, clickNB = clickB / clickS;

        // Sample a 9x9 local grid patch around the click to find the robust core water color
        // and measure local luminance grain (caustics vs deep pockets)
        const patchRadius = maxStepDiff > 0 ? 1 : 4;
        const inliers = [];
        for (let dy = -patchRadius; dy <= patchRadius; dy++) {
            const ny = seedGY + dy;
            if (ny < 0 || ny >= rows) continue;
            for (let dx = -patchRadius; dx <= patchRadius; dx++) {
                const nx = seedGX + dx;
                if (nx < 0 || nx >= cols) continue;
                const idx = (ny * cols + nx) * 3;
                const r = cellRGB[idx], g = cellRGB[idx + 1], b = cellRGB[idx + 2];
                const s = Math.max(r + g + b, 36);
                const nr = r / s, ng = g / s, nb = b / s;
                const cDistSq = (nr - clickNR) ** 2 + (ng - clickNG) ** 2 + (nb - clickNB) ** 2;
                if (cDistSq <= 0.025) {
                    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
                    inliers.push({ r, g, b, lum });
                }
            }
        }

        let seedR = clickR, seedG = clickG, seedB = clickB;
        let patchLumSpread = 0;

        if (inliers.length >= 3) {
            inliers.sort((a, b) => a.lum - b.lum);
            const trimStart = Math.floor(inliers.length * 0.2);
            const trimEnd = Math.max(trimStart + 1, Math.ceil(inliers.length * 0.8));
            let rSum = 0, gSum = 0, bSum = 0, cnt = 0;
            for (let i = trimStart; i < trimEnd; i++) {
                rSum += inliers[i].r;
                gSum += inliers[i].g;
                bSum += inliers[i].b;
                cnt++;
            }
            seedR = rSum / cnt;
            seedG = gSum / cnt;
            seedB = bSum / cnt;

            const p10 = inliers[Math.floor(inliers.length * 0.1)].lum;
            const p90 = inliers[Math.floor(inliers.length * 0.9)].lum;
            patchLumSpread = p90 - p10;
        }

        LOG(`Waterline | Flood fill from (${imgX}, ${imgY}), patchSeed: rgb(${Math.round(seedR)}, ${Math.round(seedG)}, ${Math.round(seedB)}), spread: ${patchLumSpread.toFixed(1)}, tol: ${tolerance}`);

        const seedS = Math.max(seedR + seedG + seedB, 36);
        const seedNR = seedR / seedS, seedNG = seedG / seedS, seedNB = seedB / seedS;
        const seedLum = 0.299 * seedR + 0.587 * seedG + 0.114 * seedB;
        const clickLum = 0.299 * clickR + 0.587 * clickG + 0.114 * clickB;

        const isAquaticCool = (seedNG > seedNR + 0.045 || seedNB > seedNR + 0.045) && (seedG > seedR + 4 || seedB > seedR + 4);
        const seedChromaMag = Math.sqrt((seedNR - 1 / 3) ** 2 + (seedNG - 1 / 3) ** 2 + (seedNB - 1 / 3) ** 2);

        let effectiveTol = tolerance;
        let useAvoidBisector = false;
        let avoidR = 0, avoidG = 0, avoidB = 0;

        if (Array.isArray(avoidColor) && avoidColor.length >= 3) {
            avoidR = avoidColor[0];
            avoidG = avoidColor[1];
            avoidB = avoidColor[2];
            const dSeedAvoidSq = (clickR - avoidR) ** 2 + (clickG - avoidG) ** 2 + (clickB - avoidB) ** 2;
            if (dSeedAvoidSq >= 100) {
                useAvoidBisector = true;
            } else {
                // Subtracting a region whose interior color is nearly identical to the water seed:
                // tighten tolerance so the fill stays bounded by the island's outline.
                effectiveTol = Math.min(tolerance, 28);
            }
        }

        const tolSq = effectiveTol * effectiveTol;
        const stepLimSq = maxStepDiff > 0 ? maxStepDiff * maxStepDiff : 0;
        const visited = new Uint8Array(cols * rows);
        const rejected = new Uint8Array(cols * rows);

        const cellDistSqToSeed = (gx, gy) => {
            const idx = (gy * cols + gx) * 3;
            const r = cellRGB[idx];
            const g = cellRGB[idx + 1];
            const b = cellRGB[idx + 2];

            if (useAvoidBisector) {
                const dSq = (r - clickR) ** 2 + (g - clickG) ** 2 + (b - clickB) ** 2;
                const dAvoidSq = (r - avoidR) ** 2 + (g - avoidG) ** 2 + (b - avoidB) ** 2;
                if (dAvoidSq < dSq) return Infinity;
                return dSq;
            }

            if (!isAquaticCool || stepLimSq > 0) {
                const dMeanSq = (r - seedR) ** 2 + (g - seedG) ** 2 + (b - seedB) ** 2;
                const dClickSq = (r - clickR) ** 2 + (g - clickG) ** 2 + (b - clickB) ** 2;
                return Math.min(dMeanSq, dClickSq);
            }

            const s = Math.max(r + g + b, 36);
            const nr = r / s, ng = g / s, nb = b / s;
            const lum = 0.299 * r + 0.587 * g + 0.114 * b;

            const warmRG = (nr - ng) - (seedNR - seedNG);
            const warmRB = (nr - nb) - (seedNR - seedNB);

            // 1. Warm Land Guard:
            // Reject brown dirt/mud/bark where Red overtakes both Green and Blue
            if (r >= g - 1.5 && r >= b - 1.5) return Infinity;
            // If seed is green-dominant over red (teal/emerald/swamp), reject where Red overtakes Green (unless deep blue B > R + 10)
            if (seedNG > seedNR + 0.05 && r >= g - 1.5 && b <= r + 10) return Infinity;
            // If seed has Blue >= Red (ocean/lake/teal river), reject warm mud/grass where Red significantly overtakes Blue
            if (seedNB >= seedNR - 0.02 && (nr - nb) > 0.035) return Infinity;

            // 2. Desaturation / Neutral Grey Rock Guard:
            const pixChromaMag = Math.sqrt((nr - 1 / 3) ** 2 + (ng - 1 / 3) ** 2 + (nb - 1 / 3) ** 2);
            let desatPenalty = 0;
            if (seedChromaMag > 0.06 && pixChromaMag < seedChromaMag * 0.45) {
                desatPenalty = (seedChromaMag - pixChromaMag) * 260;
            }

            // 3. Scale-invariant Chromaticity distance
            const cDistSeed = Math.sqrt((nr - seedNR) ** 2 + (ng - seedNG) ** 2 + (nb - seedNB) ** 2);
            const cDistClick = Math.sqrt((nr - clickNR) ** 2 + (ng - clickNG) ** 2 + (nb - clickNB) ** 2);
            let chromaDist = Math.min(cDistSeed, cDistClick) * 165;

            if (warmRG > 0) chromaDist += warmRG * 140;
            if (warmRB > 0) chromaDist += warmRB * 120;

            // 4. Damped Luminance distance with local texture grain deadband
            const rawLumDiff = Math.min(Math.abs(lum - seedLum), Math.abs(lum - clickLum));
            const deadband = Math.min(28, patchLumSpread * 0.65);
            const lumDist = Math.max(0, rawLumDiff - deadband) * 0.34;

            return chromaDist * chromaDist + lumDist * lumDist + desatPenalty * desatPenalty;
        };

        const colorMatch = (gx, gy) => {
            return cellDistSqToSeed(gx, gy) <= tolSq;
        };

        const canStep = (x, y, nx, ny) => {
            if (stepLimSq > 0) {
                const i0 = (y * cols + x) * 3;
                const i1 = (ny * cols + nx) * 3;
                const sdr = cellRGB[i1] - cellRGB[i0];
                const sdg = cellRGB[i1 + 1] - cellRGB[i0 + 1];
                const sdb = cellRGB[i1 + 2] - cellRGB[i0 + 2];
                if ((sdr * sdr + sdg * sdg + sdb * sdb) > stepLimSq) return false;
            }
            return true;
        };

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
                if (visited[nIdx] || rejected[nIdx]) continue;
                if (!colorMatch(nx, ny)) {
                    rejected[nIdx] = 1;
                    continue;
                }
                if (!canStep(x, y, nx, ny)) continue;
                visited[nIdx] = 1;
                stack.push({ x: nx, y: ny });
            }
        }

        // Apply morphological closing + 3x3 majority smoothing on primary/additive water fills
        if (maxStepDiff === 0 && count >= 10) {
            this.closeMask(mask, cols, rows, preservedZeroCells);
            count = 0;
            for (let i = 0; i < mask.length; i++) {
                if (mask[i]) count++;
            }
        }

        return count;
    }
};
