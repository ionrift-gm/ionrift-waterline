const MODULE_ID = 'ionrift-waterline';
const LOG = (...args) => { try { if (game.settings?.get?.(MODULE_ID, 'debug')) console.log('Waterline |', ...args); } catch { /* setting not yet registered */ } };

/**
 * Generates a Signed Distance Field (SDF) texture from a polygon boundary.
 * Uses the linear-time O(N) Felzenszwalb-Huttenlocher Euclidean Distance Transform.
 *
 * Texture layout:
 * - R: Normalized distance to shore for water pixels (0 at shore, 1 at deep water >= maxDist)
 * - G: Normalized distance to shore for land pixels (0 at shore, 1 inland >= maxDist)
 * - B: Mask (1.0 inside water, 0.0 on land)
 * - A: 1.0 (255)
 */
export class ShoreSdfGenerator {

    /** Default maximum distance represented by the SDF in world pixels */
    static DEFAULT_MAX_DIST = 128.0;

    /** Margin in world pixels added around the polygon bounding box */
    static BOUNDS_MARGIN = 96.0;

    /** Maximum dimension of the internal distance grid */
    static MAX_GRID_DIM = 384;

    /**
     * Compute an SDF texture for a polygon.
     * @param {number[]} flatPoints - Flat polygon vertices [x0, y0, x1, y1, ...]
     * @param {object} [options]
     * @param {number} [options.maxDist=128.0]
     * @param {number} [options.margin=96.0]
     * @returns {{ texture: PIXI.Texture, sdfBounds: Float32Array, maxDist: number } | null}
     */
    static generate(flatPoints, options = {}) {
        if (!flatPoints || flatPoints.length < 6) return null;

        const maxDist = options.maxDist ?? ShoreSdfGenerator.DEFAULT_MAX_DIST;
        const margin = options.margin ?? ShoreSdfGenerator.BOUNDS_MARGIN;
        const maxGridDim = ShoreSdfGenerator.MAX_GRID_DIM;

        // 1. Calculate polygon bounding box
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (let i = 0; i < flatPoints.length; i += 2) {
            const x = flatPoints[i];
            const y = flatPoints[i + 1];
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
        }

        const worldMinX = minX - margin;
        const worldMinY = minY - margin;
        const worldW = (maxX - minX) + 2 * margin;
        const worldH = (maxY - minY) + 2 * margin;

        if (worldW <= 0 || worldH <= 0) return null;

        // 2. Aspect-ratio-preserving grid dimensions
        let gridW, gridH;
        if (worldW >= worldH) {
            gridW = maxGridDim;
            gridH = Math.max(32, Math.round(maxGridDim * (worldH / worldW)));
        } else {
            gridH = maxGridDim;
            gridW = Math.max(32, Math.round(maxGridDim * (worldW / worldH)));
        }

        const scaleX = gridW / worldW;
        const scaleY = gridH / worldH;
        const worldScale = (worldW / gridW + worldH / gridH) * 0.5; // Avg world px per grid cell

        // 3. Rasterize polygon mask to offscreen canvas
        const canvas = document.createElement('canvas');
        canvas.width = gridW;
        canvas.height = gridH;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) return null;

        ctx.fillStyle = '#000000';
        ctx.fillRect(0, 0, gridW, gridH);

        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.moveTo((flatPoints[0] - worldMinX) * scaleX, (flatPoints[1] - worldMinY) * scaleY);
        for (let i = 2; i < flatPoints.length; i += 2) {
            ctx.lineTo((flatPoints[i] - worldMinX) * scaleX, (flatPoints[i + 1] - worldMinY) * scaleY);
        }
        ctx.closePath();
        ctx.fill();

        const imgData = ctx.getImageData(0, 0, gridW, gridH);
        const pixels = imgData.data;

        // 4. Build binary mask (1 inside water, 0 on land)
        const totalCells = gridW * gridH;
        const mask = new Uint8Array(totalCells);
        for (let i = 0; i < totalCells; i++) {
            mask[i] = pixels[i * 4] > 128 ? 1 : 0;
        }

        // 5. Compute Euclidean Distance Transform (both inside and outside)
        // insideDist: distance to nearest land pixel for water cells
        const insideDist = ShoreSdfGenerator.#computeEDT(mask, gridW, gridH, 1);
        // outsideDist: distance to nearest water pixel for land cells
        const outsideDist = ShoreSdfGenerator.#computeEDT(mask, gridW, gridH, 0);

        // 6. Encode into RGBA canvas buffer
        for (let i = 0; i < totalCells; i++) {
            const pIdx = i * 4;
            const isWater = mask[i];

            // Convert grid distance to world pixel distance
            const inDistWorld = insideDist[i] * worldScale;
            const outDistWorld = outsideDist[i] * worldScale;

            const normIn = Math.min(inDistWorld / maxDist, 1.0);
            const normOut = Math.min(outDistWorld / maxDist, 1.0);

            pixels[pIdx + 0] = Math.floor(normIn * 255);       // R: Inside water distance
            pixels[pIdx + 1] = Math.floor(normOut * 255);      // G: Outside land distance
            pixels[pIdx + 2] = isWater ? 255 : 0;              // B: Binary mask
            pixels[pIdx + 3] = 255;                            // A: Solid alpha
        }

        ctx.putImageData(imgData, 0, 0);

        // 7. Create PIXI.Texture
        const texture = PIXI.Texture.from(canvas);
        if (texture.baseTexture) {
            texture.baseTexture.scaleMode = PIXI.SCALE_MODES.LINEAR;
            texture.baseTexture.wrapMode = PIXI.WRAP_MODES.CLAMP;
        }

        LOG(`ShoreSdfGenerator | Generated ${gridW}x${gridH} SDF for bounds [${worldMinX.toFixed(0)}, ${worldMinY.toFixed(0)}, ${worldW.toFixed(0)}, ${worldH.toFixed(0)}]`);

        return {
            texture,
            sdfBounds: new Float32Array([worldMinX, worldMinY, worldW, worldH]),
            maxDist
        };
    }

    /**
     * Builds a combined mesh geometry with an exterior skirt extending beyond the water boundary.
     * Preserves interior earcut triangulation and connects the perimeter to outward-offset vertices.
     *
     * @param {number[]} flatPoints - Flat polygon coords [x0, y0, x1, y1, ...]
     * @param {number[]} innerIndices - Triangulated index array from earcut
     * @param {number} [margin=45.0] - Skirt reach in world pixels onto the dry bank
     * @returns {{ vertices: Float32Array, indices: Uint16Array | Uint32Array }}
     */
    static buildSkirtGeometry(flatPoints, innerIndices, margin = 45.0) {
        if (!flatPoints || flatPoints.length < 6 || !innerIndices?.length) {
            return {
                vertices: new Float32Array(flatPoints || []),
                indices: new Uint16Array(innerIndices || [])
            };
        }

        let pts = flatPoints;
        let n = pts.length / 2;
        // Strip closing point if duplicate of first
        if (n > 2 && Math.hypot(pts[0] - pts[(n - 1) * 2], pts[1] - pts[(n - 1) * 2 + 1]) < 0.001) {
            pts = pts.slice(0, (n - 1) * 2);
            n = pts.length / 2;
        }

        if (n < 3) {
            return {
                vertices: new Float32Array(flatPoints),
                indices: new Uint16Array(innerIndices)
            };
        }

        // Determine winding order via shoelace formula
        // In screen coordinates (Y down): sum < 0 is Clockwise, sum > 0 is Counter-Clockwise
        let sum = 0;
        for (let i = 0; i < n; i++) {
            const x1 = pts[i * 2];
            const y1 = pts[i * 2 + 1];
            const nextIdx = ((i + 1) % n) * 2;
            const x2 = pts[nextIdx];
            const y2 = pts[nextIdx + 1];
            sum += (x2 - x1) * (y2 + y1);
        }
        const isClockwise = sum < 0;

        // Allocate combined vertex buffer: 2n vertices (n inner + n outer) * 2 coords
        const combined = new Float32Array(n * 4);

        // Copy inner vertices to first half
        combined.set(pts, 0);

        // Compute outward normals for outer vertices
        const miterLimit = margin * 1.5;
        for (let i = 0; i < n; i++) {
            const prev = ((i - 1 + n) % n) * 2;
            const curr = i * 2;
            const next = ((i + 1) % n) * 2;

            const dx1 = pts[curr] - pts[prev];
            const dy1 = pts[curr + 1] - pts[prev + 1];
            const len1 = Math.hypot(dx1, dy1) || 1e-6;
            // Outward normal: (dy, -dx) for CW, (-dy, dx) for CCW
            const nx1 = isClockwise ? (dy1 / len1) : (-dy1 / len1);
            const ny1 = isClockwise ? (-dx1 / len1) : (dx1 / len1);

            const dx2 = pts[next] - pts[curr];
            const dy2 = pts[next + 1] - pts[curr + 1];
            const len2 = Math.hypot(dx2, dy2) || 1e-6;
            const nx2 = isClockwise ? (dy2 / len2) : (-dy2 / len2);
            const ny2 = isClockwise ? (-dx2 / len2) : (dx2 / len2);

            let nx = nx1 + nx2;
            let ny = ny1 + ny2;
            const nlen = Math.hypot(nx, ny);
            if (nlen > 1e-6) {
                nx /= nlen;
                ny /= nlen;
            } else {
                nx = nx1;
                ny = ny1;
            }

            const dot = nx * nx1 + ny * ny1;
            const miter = Math.min(margin / Math.max(dot, 0.45), miterLimit);

            const outIdx = (n + i) * 2;
            combined[outIdx] = pts[curr] + nx * miter;
            combined[outIdx + 1] = pts[curr + 1] + ny * miter;
        }

        // Allocate combined index buffer: interior indices + 2 triangles per skirt edge
        const skirtIndexCount = n * 6;
        const totalIndices = innerIndices.length + skirtIndexCount;
        const IndexArrayType = (n * 2 > 65535) ? Uint32Array : Uint16Array;
        const indices = new IndexArrayType(totalIndices);

        // Copy inner indices
        indices.set(innerIndices, 0);

        // Append skirt quads
        let writePtr = innerIndices.length;
        for (let i = 0; i < n; i++) {
            const next = (i + 1) % n;
            const iInner = i;
            const iNextInner = next;
            const iOuter = i + n;
            const iNextOuter = next + n;

            // Two triangles for edge quad (matching polygon winding)
            indices[writePtr++] = iInner;
            indices[writePtr++] = iNextInner;
            indices[writePtr++] = iOuter;

            indices[writePtr++] = iNextInner;
            indices[writePtr++] = iNextOuter;
            indices[writePtr++] = iOuter;
        }

        LOG(`ShoreSdfGenerator | Built skirt geometry with ${n} inner + ${n} outer vertices, ${totalIndices / 3} total triangles`);

        return { vertices: combined, indices };
    }

    /**
     * Exact 2D Euclidean Distance Transform in O(N) time.
     * Computes distance from every cell where mask === foregroundVal to nearest cell where mask !== foregroundVal.
     *
     * @param {Uint8Array} mask - 1 inside, 0 outside
     * @param {number} w - Grid width
     * @param {number} h - Grid height
     * @param {number} foregroundVal - 1 to measure water interior, 0 to measure land exterior
     * @returns {Float32Array} - Euclidean distance in grid cells
     */
    static #computeEDT(mask, w, h, foregroundVal) {
        const INF = 1e9;
        const total = w * h;
        const dist = new Float32Array(total);

        // Distance is 0 on boundary/sites, INF on query points
        for (let i = 0; i < total; i++) {
            dist[i] = (mask[i] === foregroundVal) ? INF : 0;
        }

        const maxDim = Math.max(w, h);
        const f = new Float64Array(maxDim);
        const d = new Float64Array(maxDim);
        const v = new Int32Array(maxDim);
        const z = new Float64Array(maxDim + 1);

        // Transform along columns
        for (let x = 0; x < w; x++) {
            for (let y = 0; y < h; y++) {
                f[y] = dist[y * w + x];
            }
            let k = 0;
            v[0] = 0;
            z[0] = -INF;
            z[1] = INF;
            for (let q = 1; q < h; q++) {
                let s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
                while (s <= z[k]) {
                    k--;
                    s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
                }
                k++;
                v[k] = q;
                z[k] = s;
                z[k + 1] = INF;
            }
            k = 0;
            for (let q = 0; q < h; q++) {
                while (z[k + 1] < q) k++;
                const dy = q - v[k];
                d[q] = dy * dy + f[v[k]];
            }
            for (let y = 0; y < h; y++) {
                dist[y * w + x] = d[y];
            }
        }

        // Transform along rows
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                f[x] = dist[y * w + x];
            }
            let k = 0;
            v[0] = 0;
            z[0] = -INF;
            z[1] = INF;
            for (let q = 1; q < w; q++) {
                let s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
                while (s <= z[k]) {
                    k--;
                    s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
                }
                k++;
                v[k] = q;
                z[k] = s;
                z[k + 1] = INF;
            }
            k = 0;
            for (let q = 0; q < w; q++) {
                while (z[k + 1] < q) k++;
                const dx = q - v[k];
                d[q] = dx * dx + f[v[k]];
            }
            for (let x = 0; x < w; x++) {
                const sqDist = d[x];
                dist[y * w + x] = sqDist >= INF ? maxDim : Math.sqrt(sqDist);
            }
        }

        return dist;
    }
}
