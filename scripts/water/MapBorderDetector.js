/**
 * MapBorderDetector
 * Abstracted and refined map boundary detection, signature analysis, and geometry bleed utility.
 *
 * Capabilities:
 * 1. Analyzes water polygon vertices and boundary spans against scene frame limits.
 * 2. Generates a structured BorderSignature for archetype estimation and shader masking.
 * 3. Bleeds border-contacting polygon vertices outward past scene boundaries to eliminate
 *    animation edge seams, unshaded gaps, and unnatural shoreline meniscus artifacts
 *    where water bodies extend off-map.
 */
export class MapBorderDetector {

    /** Default margin in scene pixels to detect map border contact. */
    static DEFAULT_MARGIN = 40.0;

    /** Default distance in scene pixels to extend vertices past map boundaries. */
    static DEFAULT_BLEED = 96.0;

    /**
     * Resolve scene dimensions from canvas or explicit input.
     * @param {object} [dimensions]
     * @returns {{ sLeft: number, sRight: number, sTop: number, sBottom: number, sceneW: number, sceneH: number }}
     */
    static resolveDimensions(dimensions) {
        const dims = dimensions || canvas?.dimensions || {};
        const sLeft = dims.sceneX ?? 0;
        const sTop = dims.sceneY ?? 0;
        const sceneW = dims.sceneWidth || dims.width || 4000;
        const sceneH = dims.sceneHeight || dims.height || 3000;
        const sRight = sLeft + sceneW;
        const sBottom = sTop + sceneH;
        return { sLeft, sRight, sTop, sBottom, sceneW, sceneH };
    }

    /**
     * Compute adaptive detection margins based on scene scale.
     * @param {number} sceneW
     * @param {number} sceneH
     * @param {number} [customMargin]
     * @returns {{ x: number, y: number }}
     */
    static computeMargin(sceneW, sceneH, customMargin) {
        if (typeof customMargin === 'number' && customMargin > 0) {
            return { x: customMargin, y: customMargin };
        }
        const mx = Math.max(36, Math.min(80, sceneW * 0.025));
        const my = Math.max(36, Math.min(80, sceneH * 0.025));
        return { x: mx, y: my };
    }

    /**
     * Detect map border contact and generate a comprehensive BorderSignature.
     * @param {number[]|Float32Array} points - Flat array of [x, y, x, y, ...]
     * @param {object} [dimensions] - Scene dimensions
     * @param {object} [options]
     * @param {number} [options.margin] - Detection margin in px
     * @param {number} [options.minSpanRatio=0.06] - Minimum span along border to confirm touch (ratio of border length)
     * @returns {object} BorderSignature
     */
    static detect(points, dimensions, options = {}) {
        if (!points || points.length < 6) {
            return this.#emptySignature(dimensions);
        }

        const dims = this.resolveDimensions(dimensions);
        const { sLeft, sRight, sTop, sBottom, sceneW, sceneH } = dims;
        const margin = this.computeMargin(sceneW, sceneH, options.margin);
        const minSpanRatio = options.minSpanRatio ?? 0.06;
        const minSpanX = sceneW * minSpanRatio;
        const minSpanY = sceneH * minSpanRatio;

        const n = Math.floor(points.length / 2);

        const sideLeft = { count: 0, minY: Infinity, maxY: -Infinity, indices: [] };
        const sideRight = { count: 0, minY: Infinity, maxY: -Infinity, indices: [] };
        const sideTop = { count: 0, minX: Infinity, maxX: -Infinity, indices: [] };
        const sideBottom = { count: 0, minX: Infinity, maxX: -Infinity, indices: [] };

        const vertexBorderMap = new Array(n); // bitmask: 1=left, 2=right, 4=top, 8=bottom

        for (let i = 0; i < n; i++) {
            const x = points[i * 2];
            const y = points[i * 2 + 1];
            let mask = 0;

            if (x - sLeft <= margin.x) {
                sideLeft.count++;
                if (y < sideLeft.minY) sideLeft.minY = y;
                if (y > sideLeft.maxY) sideLeft.maxY = y;
                sideLeft.indices.push(i);
                mask |= 1;
            }
            if (sRight - x <= margin.x) {
                sideRight.count++;
                if (y < sideRight.minY) sideRight.minY = y;
                if (y > sideRight.maxY) sideRight.maxY = y;
                sideRight.indices.push(i);
                mask |= 2;
            }
            if (y - sTop <= margin.y) {
                sideTop.count++;
                if (x < sideTop.minX) sideTop.minX = x;
                if (x > sideTop.maxX) sideTop.maxX = x;
                sideTop.indices.push(i);
                mask |= 4;
            }
            if (sBottom - y <= margin.y) {
                sideBottom.count++;
                if (x < sideBottom.minX) sideBottom.minX = x;
                if (x > sideBottom.maxX) sideBottom.maxX = x;
                sideBottom.indices.push(i);
                mask |= 8;
            }

            vertexBorderMap[i] = mask;
        }

        const spanLeft = sideLeft.count > 0 ? (sideLeft.maxY - sideLeft.minY) : 0;
        const spanRight = sideRight.count > 0 ? (sideRight.maxY - sideRight.minY) : 0;
        const spanTop = sideTop.count > 0 ? (sideTop.maxX - sideTop.minX) : 0;
        const spanBottom = sideBottom.count > 0 ? (sideBottom.maxX - sideBottom.minX) : 0;

        const contactTol = options.contactTolerance ?? Math.max(20.0, margin.x * 0.4);

        const touchLeft = (sideLeft.count >= 2 && spanLeft >= minSpanY) ||
            sideLeft.indices.some(idx => points[idx * 2] <= sLeft + contactTol);
        const touchRight = (sideRight.count >= 2 && spanRight >= minSpanY) ||
            sideRight.indices.some(idx => points[idx * 2] >= sRight - contactTol);
        const touchTop = (sideTop.count >= 2 && spanTop >= minSpanX) ||
            sideTop.indices.some(idx => points[idx * 2 + 1] <= sTop + contactTol);
        const touchBottom = (sideBottom.count >= 2 && spanBottom >= minSpanX) ||
            sideBottom.indices.some(idx => points[idx * 2 + 1] >= sBottom - contactTol);

        const touches = {
            left: touchLeft,
            right: touchRight,
            top: touchTop,
            bottom: touchBottom,
            count: (touchLeft ? 1 : 0) + (touchRight ? 1 : 0) + (touchTop ? 1 : 0) + (touchBottom ? 1 : 0)
        };

        // Only classify vertices genuinely at the border frame as borderIndices
        // This prevents inland shoreline vertices from being squashed into shelves
        const borderIndices = new Set();
        if (touchLeft) {
            for (const idx of sideLeft.indices) {
                if (points[idx * 2] <= sLeft + contactTol) borderIndices.add(idx);
            }
        }
        if (touchRight) {
            for (const idx of sideRight.indices) {
                if (points[idx * 2] >= sRight - contactTol) borderIndices.add(idx);
            }
        }
        if (touchTop) {
            for (const idx of sideTop.indices) {
                if (points[idx * 2 + 1] <= sTop + contactTol) borderIndices.add(idx);
            }
        }
        if (touchBottom) {
            for (const idx of sideBottom.indices) {
                if (points[idx * 2 + 1] >= sBottom - contactTol) borderIndices.add(idx);
            }
        }

        const inlandPoints = [];
        for (let i = 0; i < n; i++) {
            if (!borderIndices.has(i)) {
                inlandPoints.push({ x: points[i * 2], y: points[i * 2 + 1] });
            }
        }

        return {
            touches,
            hasBorderContact: touches.count > 0,
            sides: {
                left: { touched: touchLeft, count: sideLeft.count, span: spanLeft, indices: sideLeft.indices },
                right: { touched: touchRight, count: sideRight.count, span: spanRight, indices: sideRight.indices },
                top: { touched: touchTop, count: sideTop.count, span: spanTop, indices: sideTop.indices },
                bottom: { touched: touchBottom, count: sideBottom.count, span: spanBottom, indices: sideBottom.indices }
            },
            borderIndices,
            vertexBorderMap,
            inlandPoints,
            dims,
            margin,
            contactTol
        };
    }

    /**
     * Bleed / extend polygon vertices that touch map borders past the scene boundaries.
     * Replaces artificial shorelines with deep water continuation off the edge of the map.
     *
     * @param {number[]|Float32Array} points - Flat array of [x, y, ...]
     * @param {object} [dimensions] - Scene dimensions
     * @param {object|number} [options] - Options or bleed distance in px
     * @returns {number[]} - New array of bled points
     */
    static bleed(points, dimensions, options = {}) {
        if (!points || points.length < 6) return Array.from(points || []);

        const bleedDist = typeof options === 'number' ? options : (options.bleedDistance ?? MapBorderDetector.DEFAULT_BLEED);
        const sig = this.detect(points, dimensions, typeof options === 'object' ? options : {});

        if (!sig.hasBorderContact) {
            return Array.from(points);
        }

        const { sLeft, sRight, sTop, sBottom } = sig.dims;
        const { touches, borderIndices } = sig;
        const contactTol = sig.contactTol ?? 12.0;
        const n = Math.floor(points.length / 2);
        const result = new Array(points.length);

        for (let i = 0; i < n; i++) {
            let x = points[i * 2];
            let y = points[i * 2 + 1];

            if (borderIndices.has(i)) {
                if (touches.left && x <= sLeft + contactTol) {
                    x = Math.min(x, sLeft - bleedDist);
                } else if (touches.right && x >= sRight - contactTol) {
                    x = Math.max(x, sRight + bleedDist);
                }

                if (touches.top && y <= sTop + contactTol) {
                    y = Math.min(y, sTop - bleedDist);
                } else if (touches.bottom && y >= sBottom - contactTol) {
                    y = Math.max(y, sBottom + bleedDist);
                }
            }

            result[i * 2] = Math.round(x);
            result[i * 2 + 1] = Math.round(y);
        }

        return result;
    }

    /**
     * Snap vertices touching map borders to the exact scene boundary.
     * @param {number[]|Float32Array} points
     * @param {object} [dimensions]
     * @param {object} [options]
     * @returns {number[]}
     */
    static snap(points, dimensions, options = {}) {
        const opts = typeof options === 'object' ? { ...options, bleedDistance: 0 } : 0;
        return this.bleed(points, dimensions, opts);
    }

    static #emptySignature(dimensions) {
        const dims = this.resolveDimensions(dimensions);
        return {
            touches: { left: false, right: false, top: false, bottom: false, count: 0 },
            hasBorderContact: false,
            sides: {
                left: { touched: false, count: 0, span: 0, indices: [] },
                right: { touched: false, count: 0, span: 0, indices: [] },
                top: { touched: false, count: 0, span: 0, indices: [] },
                bottom: { touched: false, count: 0, span: 0, indices: [] }
            },
            borderIndices: new Set(),
            vertexBorderMap: [],
            inlandPoints: [],
            dims,
            margin: { x: MapBorderDetector.DEFAULT_MARGIN, y: MapBorderDetector.DEFAULT_MARGIN }
        };
    }
}
