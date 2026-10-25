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
     * Ray-casting point-in-ring test for a ring of [x, y] coordinate pairs.
     * @param {number} px
     * @param {number} py
     * @param {Array<[number, number]>} ring
     * @returns {boolean}
     */
    static pointInRing(px, py, ring) {
        if (!ring || ring.length < 3) return false;
        let inside = false;
        const n = ring.length;
        for (let i = 0, j = n - 1; i < n; j = i++) {
            const xi = ring[i][0], yi = ring[i][1];
            const xj = ring[j][0], yj = ring[j][1];
            if (((yi > py) !== (yj > py)) &&
                (px < (xj - xi) * (py - yi) / (yj - yi) + xi)) {
                inside = !inside;
            }
        }
        return inside;
    }

    /**
     * Ray-casting point-in-polygon test for a flat [x, y, x, y, ...] array,
     * with optional interior hole polygons.
     * @param {number} px
     * @param {number} py
     * @param {number[]} flatPoints
     * @param {number[][]} [holes=null]
     * @returns {boolean}
     */
    static pointInPolygon(px, py, flatPoints, holes = null) {
        if (!flatPoints || flatPoints.length < 6) return false;
        const n = flatPoints.length / 2;
        let inside = false;
        for (let i = 0, j = n - 1; i < n; j = i++) {
            const xi = flatPoints[i * 2], yi = flatPoints[i * 2 + 1];
            const xj = flatPoints[j * 2], yj = flatPoints[j * 2 + 1];
            if (((yi > py) !== (yj > py)) &&
                (px < (xj - xi) * (py - yi) / (yj - yi) + xi)) {
                inside = !inside;
            }
        }
        if (inside && Array.isArray(holes)) {
            for (const hole of holes) {
                if (RasterContourTracer.pointInPolygon(px, py, hole)) {
                    return false;
                }
            }
        }
        return inside;
    }

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
    static cleanMaskHoles(mask, cols, rows, minHoleArea = 36, preservedZeroCells = null) {
        const total = cols * rows;
        if (!total) return;

        // 1. Keep only significant connected components of 1s (drop tiny severed interior fragments)
        const comps = RasterContourTracer.findComponents(mask, cols, rows);
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
    }

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
    static buildFilteredGrid(pixels, imgW, imgH, cols, rows, gridStep) {
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
    }

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
    static closeMask(mask, cols, rows, preservedZeroCells = null) {
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
    }

    /**
     * BFS flood fill from a clicked scene point into a grid mask.
     * Uses pre-filtered bilateral grid cells, a 9x9 local patch seed profile,
     * scale-invariant chromaticity + damped luminance matching, and a warm-land guard.
     * @returns {number} Number of cells filled
     */
    static floodFillIntoMask({
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
            : RasterContourTracer.buildFilteredGrid(pixels, imgW, imgH, cols, rows, gridStep);
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
            RasterContourTracer.closeMask(mask, cols, rows, preservedZeroCells);
            count = 0;
            for (let i = 0; i < mask.length; i++) {
                if (mask[i]) count++;
            }
        }

        return count;
    }
}
