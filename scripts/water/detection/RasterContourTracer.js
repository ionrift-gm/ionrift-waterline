import { MapBorderDetector } from '../MapBorderDetector.js';

const MODULE_ID = 'ionrift-waterline';
const LOG = (...args) => {
    try {
        if (game.settings?.get?.(MODULE_ID, 'debug')) console.log('Waterline |', ...args);
    } catch {
        /* setting not yet registered */
    }
};

/**
 * Pure raster, computer vision, and geometric contour tracing algorithms.
 * Handles morphological operations, Marching Squares, RDP decimation,
 * Chaikin smoothing with map-border pinning, and flood fill.
 */
export class RasterContourTracer {

    /**
     * Morphological erosion of a cell mask.
     * Strips 1-cell outer perimeter to prevent water bleeding onto dry ground.
     * @param {object} maskData - { mask, cols, rows, gridStep }
     * @param {number} [iterations=1]
     * @returns {object} Updated maskData
     */
    static erodeMask(maskData, iterations = 1) {
        const { cols, rows } = maskData;
        let current = maskData.mask;

        for (let iter = 0; iter < iterations; iter++) {
            const next = new Uint8Array(cols * rows);
            for (let y = 0; y < rows; y++) {
                const yOffset = y * cols;
                for (let x = 0; x < cols; x++) {
                    const idx = yOffset + x;
                    if (current[idx] === 0) continue;

                    const left   = (x > 0) ? current[idx - 1] : 1;
                    const right  = (x < cols - 1) ? current[idx + 1] : 1;
                    const top    = (y > 0) ? current[idx - cols] : 1;
                    const bottom = (y < rows - 1) ? current[idx + cols] : 1;

                    if (left === 1 && right === 1 && top === 1 && bottom === 1) {
                        next[idx] = 1;
                    }
                }
            }
            current = next;
        }

        maskData.mask = current;
        return maskData;
    }

    /**
     * Morphological dilation of a cell mask.
     * Expands water boundaries outward into surrounding land.
     * @param {object} maskData - { mask, cols, rows, gridStep }
     * @param {number} [iterations=1]
     * @returns {object} Updated maskData
     */
    static dilateMask(maskData, iterations = 1) {
        const { cols, rows } = maskData;
        let current = maskData.mask;

        for (let iter = 0; iter < iterations; iter++) {
            const next = new Uint8Array(current);
            for (let y = 0; y < rows; y++) {
                const yOffset = y * cols;
                for (let x = 0; x < cols; x++) {
                    const idx = yOffset + x;
                    if (current[idx] === 1) continue;

                    const left   = (x > 0) ? current[idx - 1] : 0;
                    const right  = (x < cols - 1) ? current[idx + 1] : 0;
                    const top    = (y > 0) ? current[idx - cols] : 0;
                    const bottom = (y < rows - 1) ? current[idx + cols] : 0;

                    if (left === 1 || right === 1 || top === 1 || bottom === 1) {
                        next[idx] = 1;
                    }
                }
            }
            current = next;
        }

        maskData.mask = current;
        return maskData;
    }

    /**
     * Chaikin corner-cutting contour smoothing with map-border pinning.
     * Vertices within 8px of the scene boundary remain anchored to maintain clean map edges.
     * @param {number[]} points - Flat array of [x, y, x, y, ...] scene coordinates
     * @param {number} [iterations=1] - Number of Chaikin passes
     * @param {object} [dimensions] - Canvas / scene dimensions
     * @returns {number[]} Smoothed flat points array
     */
    static smoothContour(points, iterations = 1, dimensions) {
        if (!points || points.length < 8) return Array.from(points || []);

        const dims = MapBorderDetector.resolveDimensions(dimensions);
        const { sLeft, sRight, sTop, sBottom } = dims;
        const bTol = 8.0;

        const isOnBorder = (x, y) => {
            return (Math.abs(x - sLeft) <= bTol) ||
                   (Math.abs(x - sRight) <= bTol) ||
                   (Math.abs(y - sTop) <= bTol) ||
                   (Math.abs(y - sBottom) <= bTol);
        };

        const onSameBorder = (x1, y1, x2, y2) => {
            if (Math.abs(x1 - sLeft) <= bTol && Math.abs(x2 - sLeft) <= bTol) return true;
            if (Math.abs(x1 - sRight) <= bTol && Math.abs(x2 - sRight) <= bTol) return true;
            if (Math.abs(y1 - sTop) <= bTol && Math.abs(y2 - sTop) <= bTol) return true;
            if (Math.abs(y1 - sBottom) <= bTol && Math.abs(y2 - sBottom) <= bTol) return true;
            return false;
        };

        let current = Array.from(points);

        for (let iter = 0; iter < iterations; iter++) {
            const n = current.length / 2;
            if (n < 4) break;

            const next = [];

            for (let i = 0; i < n; i++) {
                const iNext = (i + 1) % n;
                const x0 = current[i * 2];
                const y0 = current[i * 2 + 1];
                const x1 = current[iNext * 2];
                const y1 = current[iNext * 2 + 1];

                const b0 = isOnBorder(x0, y0);
                const b1 = isOnBorder(x1, y1);

                if (b0 && b1 && onSameBorder(x0, y0, x1, y1)) {
                    next.push(x0, y0);
                } else if (b0 && !b1) {
                    next.push(x0, y0);
                    next.push(
                        Math.round(0.25 * x0 + 0.75 * x1),
                        Math.round(0.25 * y0 + 0.75 * y1)
                    );
                } else if (!b0 && b1) {
                    next.push(
                        Math.round(0.75 * x0 + 0.25 * x1),
                        Math.round(0.75 * y0 + 0.25 * y1)
                    );
                } else {
                    next.push(
                        Math.round(0.75 * x0 + 0.25 * x1),
                        Math.round(0.75 * y0 + 0.25 * y1)
                    );
                    next.push(
                        Math.round(0.25 * x0 + 0.75 * x1),
                        Math.round(0.25 * y0 + 0.75 * y1)
                    );
                }
            }

            current = next;
        }

        return current;
    }

    /**
     * Extract closed polygon rings from a 2D binary grid mask using Marching Squares.
     * Preserves topological detail around diagonal piers, jetties, outcrops, and coves.
     * @param {Uint8Array} mask
     * @param {number} cols
     * @param {number} rows
     * @returns {Array<Array<[number, number]>>} Array of closed polygon rings in grid coords
     */
    static marchingSquares(mask, cols, rows) {
        const pCols = cols + 2;
        const pRows = rows + 2;
        const pMask = new Uint8Array(pCols * pRows);

        for (let y = 0; y < rows; y++) {
            const yOff = (y + 1) * pCols;
            const srcOff = y * cols;
            for (let x = 0; x < cols; x++) {
                pMask[yOff + (x + 1)] = mask[srcOff + x];
            }
        }

        const segments = [];
        for (let y = 0; y < pRows - 1; y++) {
            const y0 = y * pCols;
            const y1 = (y + 1) * pCols;
            for (let x = 0; x < pCols - 1; x++) {
                const tl = pMask[y0 + x];
                const tr = pMask[y0 + x + 1];
                const br = pMask[y1 + x + 1];
                const bl = pMask[y1 + x];
                const code = (tl << 3) | (tr << 2) | (br << 1) | bl;
                if (code === 0 || code === 15) continue;

                const N = [x, y - 0.5];
                const E = [x + 0.5, y];
                const S = [x, y + 0.5];
                const W = [x - 0.5, y];

                switch (code) {
                    case 1:  segments.push([...S, ...W]); break;
                    case 2:  segments.push([...E, ...S]); break;
                    case 3:  segments.push([...E, ...W]); break;
                    case 4:  segments.push([...N, ...E]); break;
                    case 5:  segments.push([...N, ...E], [...S, ...W]); break;
                    case 6:  segments.push([...N, ...S]); break;
                    case 7:  segments.push([...N, ...W]); break;
                    case 8:  segments.push([...W, ...N]); break;
                    case 9:  segments.push([...S, ...N]); break;
                    case 10: segments.push([...W, ...N], [...E, ...S]); break;
                    case 11: segments.push([...E, ...N]); break;
                    case 12: segments.push([...W, ...E]); break;
                    case 13: segments.push([...S, ...E]); break;
                    case 14: segments.push([...W, ...S]); break;
                }
            }
        }

        if (!segments.length) return [];

        const key = (p) => Math.round(p[0] * 2) + ':' + Math.round(p[1] * 2);
        const edgeMap = new Map();
        for (let i = 0; i < segments.length; i++) {
            const s = segments[i];
            const k = key([s[0], s[1]]);
            let list = edgeMap.get(k);
            if (!list) {
                list = [];
                edgeMap.set(k, list);
            }
            list.push([s[2], s[3]]);
        }

        const rings = [];
        const visited = new Set();

        for (let i = 0; i < segments.length; i++) {
            const s = segments[i];
            const segId = Math.round(s[0] * 2) + ':' + Math.round(s[1] * 2) + ':' + Math.round(s[2] * 2) + ':' + Math.round(s[3] * 2);
            if (visited.has(segId)) continue;

            const startPt = [s[0], s[1]];
            const startKey = key(startPt);
            const ring = [startPt];
            let curr = [s[2], s[3]];
            visited.add(segId);

            let maxHops = segments.length * 2;
            while (curr && maxHops-- > 0) {
                ring.push(curr);
                const ck = key(curr);
                if (ck === startKey) {
                    break;
                }
                const nextList = edgeMap.get(ck);
                let nextPt = null;
                if (nextList) {
                    for (let j = 0; j < nextList.length; j++) {
                        const cand = nextList[j];
                        const candId = Math.round(curr[0] * 2) + ':' + Math.round(curr[1] * 2) + ':' + Math.round(cand[0] * 2) + ':' + Math.round(cand[1] * 2);
                        if (!visited.has(candId)) {
                            visited.add(candId);
                            nextPt = cand;
                            break;
                        }
                    }
                }
                curr = nextPt;
            }

            if (ring.length >= 4) {
                rings.push(ring);
            }
        }

        return rings;
    }

    /**
     * Simplify a closed polygon ring using Ramer-Douglas-Peucker line decimation.
     * Splits closed ring at the point farthest from start to prevent degenerate chord shortcuts.
     * @param {Array<[number, number]>} ring - Array of [x, y] coordinates
     * @param {number} tolerance - RDP simplification tolerance
     * @returns {number[]} Flat array of [x, y, x, y, ...] simplified points
     */
    static simplifyClosedPolygon(ring, tolerance) {
        if (!ring || ring.length < 3) return [];

        const pts = [];
        for (let i = 0; i < ring.length; i++) {
            pts.push(ring[i][0], ring[i][1]);
        }

        const n = pts.length / 2;
        if (n <= 4 || tolerance <= 0.05) {
            if (n >= 4 && pts[0] === pts[(n - 1) * 2] && pts[1] === pts[(n - 1) * 2 + 1]) {
                return pts.slice(0, (n - 1) * 2);
            }
            return pts;
        }

        const startX = pts[0];
        const startY = pts[1];

        let maxD = 0;
        let farIdx = Math.floor(n / 2);
        for (let i = 1; i < n; i++) {
            const dx = pts[i * 2] - startX;
            const dy = pts[i * 2 + 1] - startY;
            const dSq = dx * dx + dy * dy;
            if (dSq > maxD) {
                maxD = dSq;
                farIdx = i;
            }
        }

        function perpDist(px, py, ax, ay, bx, by) {
            const dx = bx - ax;
            const dy = by - ay;
            const lenSq = dx * dx + dy * dy;
            if (lenSq === 0) return Math.sqrt((px - ax) ** 2 + (py - ay) ** 2);
            let t = ((px - ax) * dx + (py - ay) * dy) / lenSq;
            t = Math.max(0, Math.min(1, t));
            return Math.sqrt((px - (ax + t * dx)) ** 2 + (py - (ay + t * dy)) ** 2);
        }

        function simplifyOpen(start, end) {
            let maxDist = 0;
            let maxIdx = start;
            const ax = pts[start * 2];
            const ay = pts[start * 2 + 1];
            const bx = pts[end * 2];
            const by = pts[end * 2 + 1];

            for (let i = start + 1; i < end; i++) {
                const d = perpDist(pts[i * 2], pts[i * 2 + 1], ax, ay, bx, by);
                if (d > maxDist) {
                    maxDist = d;
                    maxIdx = i;
                }
            }

            if (maxDist > tolerance) {
                const left = simplifyOpen(start, maxIdx);
                const right = simplifyOpen(maxIdx, end);
                return [...left.slice(0, -2), ...right];
            }
            return [ax, ay, bx, by];
        }

        const part1 = simplifyOpen(0, farIdx);
        const part2 = simplifyOpen(farIdx, n - 1);
        const result = [...part1.slice(0, -2), ...part2];

        const resN = result.length / 2;
        if (resN >= 4 && result[0] === result[(resN - 1) * 2] && result[1] === result[(resN - 1) * 2 + 1]) {
            return result.slice(0, (resN - 1) * 2);
        }
        return result;
    }

    /**
     * Column sweep: top edge L-R, bottom edge R-L. Best for horizontal water bodies.
     */
    static columnSweepContour(mask, cols, rows, smoothing) {
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

        RasterContourTracer.dampenSweepEnds(topEdge, bottomEdge, 1);

        const simTop = RasterContourTracer.simplifyRDP(topEdge, smoothing);
        const simBot = RasterContourTracer.simplifyRDP(bottomEdge, smoothing);

        const contour = [...simTop];
        for (let i = simBot.length - 2; i >= 0; i -= 2) {
            contour.push(simBot[i], simBot[i + 1]);
        }
        return contour.length >= 6 ? contour : null;
    }

    /**
     * Row sweep: left edge T-B, right edge B-T. Best for vertical water bodies.
     */
    static rowSweepContour(mask, cols, rows, smoothing) {
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

        RasterContourTracer.dampenSweepEnds(leftEdge, rightEdge, 0);

        const simLeft = RasterContourTracer.simplifyRDP(leftEdge, smoothing);
        const simRight = RasterContourTracer.simplifyRDP(rightEdge, smoothing);

        const contour = [...simLeft];
        for (let i = simRight.length - 2; i >= 0; i -= 2) {
            contour.push(simRight[i], simRight[i + 1]);
        }
        return contour.length >= 6 ? contour : null;
    }

    /**
     * Dampens outlier jumps at the ends of sweep edges.
     * Prevents single-cell map frame or border noise from creating rectangular shelves.
     */
    static dampenSweepEnds(edgeA, edgeB, coordOffset = 0) {
        const dampen = (edge) => {
            const n = edge.length / 2;
            if (n < 4) return;
            const d10 = Math.abs(edge[coordOffset] - edge[2 + coordOffset]);
            const d21 = Math.abs(edge[2 + coordOffset] - edge[4 + coordOffset]);
            if (d10 > 8 && d21 <= 4) {
                edge[coordOffset] = edge[2 + coordOffset];
            }
            const lastIdx = (n - 1) * 2;
            const prevIdx = (n - 2) * 2;
            const pprevIdx = (n - 3) * 2;
            const dLast = Math.abs(edge[lastIdx + coordOffset] - edge[prevIdx + coordOffset]);
            const dPrev = Math.abs(edge[prevIdx + coordOffset] - edge[pprevIdx + coordOffset]);
            if (dLast > 8 && dPrev <= 4) {
                edge[lastIdx + coordOffset] = edge[prevIdx + coordOffset];
            }
        };
        dampen(edgeA);
        dampen(edgeB);
    }

    /**
     * Ramer-Douglas-Peucker line simplification.
     * Points is a flat array [x, y, x, y, ...].
     */
    static simplifyRDP(points, tolerance) {
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

    /**
     * Convert RGB (0-1) to HSL.
     */
    static rgbToHsl(r, g, b) {
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
    static findComponents(mask, cols, rows) {
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
     */
    static traceContour(component, cols, rows) {
        const inRegion = new Uint8Array(cols * rows);
        for (const p of component) {
            inRegion[p.y * cols + p.x] = 1;
        }

        const isSet = (x, y) => {
            if (x < 0 || x >= cols || y < 0 || y >= rows) return false;
            return inRegion[y * cols + x] === 1;
        };

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

        if (chain.length >= boundary.length * 0.3) {
            const contour = [];
            for (const p of chain) contour.push(p.x, p.y);
            return contour;
        }

        LOG(`Waterline | Grid-walk covered ${chain.length}/${boundary.length} boundary cells, falling back to convex hull`);
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
     * BFS flood fill from a clicked scene point into a grid mask.
     * @returns {number} Number of cells filled
     */
    static floodFillIntoMask({ mask, cols, rows, gridStep, sceneX, sceneY, tolerance, imgW, imgH, pixels, dims }) {
        const imgX = Math.round(((sceneX - dims.sceneX) / dims.sceneWidth) * imgW);
        const imgY = Math.round(((sceneY - dims.sceneY) / dims.sceneHeight) * imgH);

        if (imgX < 0 || imgX >= imgW || imgY < 0 || imgY >= imgH) return 0;

        const seedIdx = (imgY * imgW + imgX) * 4;
        const seedR = pixels[seedIdx];
        const seedG = pixels[seedIdx + 1];
        const seedB = pixels[seedIdx + 2];

        LOG(`Waterline | Flood fill from (${imgX}, ${imgY}), seed: rgb(${seedR}, ${seedG}, ${seedB}), tol: ${tolerance}`);

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
}
