import { MODULE_ID } from '../data/moduleId.js';

const LOG = (...args) => {
    try {
        if (game.settings?.get?.(MODULE_ID, 'debug')) console.log('Waterline |', ...args);
    } catch { /* setting not yet registered */ }
};

/**
 * Background image sampling, solid texture fallback, and polygon geometry helpers for WaterManager.
 */
export class WaterColorSampler {
    static #solidBgTexture = null;
    static #solidBgColor = null;
    static #sampledColorCache = new Map();
    static #bgThumbnailCache = new Map();

    /**
     * Resolves the background image path for a scene across Foundry v11, v12, v13, and v14+.
     * Properly handles v14 SceneLevel embedded documents and legacy scene.background.src.
     * @param {Scene} [scene=canvas?.scene]
     * @returns {string|null}
     */
    static resolveSceneBackgroundSrc(scene = canvas?.scene) {
        if (!scene) return null;
        const level = scene.firstLevel ?? scene.levels?.contents?.[0] ?? null;
        return (level?.background?.src || scene._source?.background?.src || scene.background?.src || scene.img) || null;
    }

    /**
     * Creates or returns a cached solid-color texture matching the scene background color.
     * Used when the scene has no background artwork, preventing water from rendering as solid white.
     * @returns {PIXI.Texture}
     */
    static getSolidBgTexture() {
        const hex = canvas.scene?.backgroundColor || '#111922';
        if (WaterColorSampler.#solidBgTexture && WaterColorSampler.#solidBgColor === hex) {
            return WaterColorSampler.#solidBgTexture;
        }
        try {
            if (typeof document !== 'undefined') {
                const canvasEl = document.createElement('canvas');
                canvasEl.width = 4;
                canvasEl.height = 4;
                const ctx = canvasEl.getContext('2d');
                ctx.fillStyle = hex;
                ctx.fillRect(0, 0, 4, 4);
                WaterColorSampler.#solidBgTexture?.destroy?.(true);
                WaterColorSampler.#solidBgTexture = PIXI.Texture.from(canvasEl);
                WaterColorSampler.#solidBgColor = hex;
                return WaterColorSampler.#solidBgTexture;
            }
        } catch {
            // Fallback silent ignore
        }
        return PIXI.Texture.WHITE;
    }

    /**
     * Clear cached background colors (e.g. on scene change).
     */
    static clearSampledColorCache() {
        WaterColorSampler.#sampledColorCache.clear();
        WaterColorSampler.#bgThumbnailCache.clear();
        try {
            WaterColorSampler.#solidBgTexture?.destroy?.(true);
        } catch { /* ignore */ }
        WaterColorSampler.#solidBgTexture = null;
        WaterColorSampler.#solidBgColor = null;
    }

    /**
     * Retrieves or generates a downsampled thumbnail of the scene background image.
     * Prevents multi-megabyte canvas allocations and main-thread freezes on high-res battlemaps.
     * @param {string} bgPath
     * @returns {Promise<{ data: Uint8ClampedArray, width: number, height: number } | null>}
     */
    static #getSceneThumbnail(bgPath) {
        if (!bgPath) return Promise.resolve(null);
        if (!WaterColorSampler.#bgThumbnailCache.has(bgPath)) {
            const pending = WaterColorSampler.#buildSceneThumbnail(bgPath).then(thumb => {
                if (!thumb && WaterColorSampler.#bgThumbnailCache.get(bgPath) === pending) {
                    WaterColorSampler.#bgThumbnailCache.delete(bgPath);
                }
                return thumb;
            });
            WaterColorSampler.#bgThumbnailCache.set(bgPath, pending);
        }
        return WaterColorSampler.#bgThumbnailCache.get(bgPath);
    }

    static async #buildSceneThumbnail(bgPath) {
        try {
            const img = await new Promise((resolve, reject) => {
                const i = new Image();
                i.crossOrigin = 'anonymous';
                i.onload = () => resolve(i);
                i.onerror = reject;
                i.src = bgPath;
            });
            // Decode off the main thread so drawImage below does not stall on large maps
            try { await img.decode?.(); } catch { /* drawImage will decode */ }

            const maxDim = 384;
            const rawW = img.naturalWidth || img.width || 1000;
            const rawH = img.naturalHeight || img.height || 1000;
            let targetW = rawW;
            let targetH = rawH;
            if (targetW > maxDim || targetH > maxDim) {
                if (targetW >= targetH) {
                    targetH = Math.max(1, Math.round(rawH * (maxDim / rawW)));
                    targetW = maxDim;
                } else {
                    targetW = Math.max(1, Math.round(rawW * (maxDim / rawH)));
                    targetH = maxDim;
                }
            }

            const offscreen = document.createElement('canvas');
            offscreen.width = targetW;
            offscreen.height = targetH;
            const ctx = offscreen.getContext('2d', { willReadFrequently: true });
            ctx.drawImage(img, 0, 0, targetW, targetH);

            return {
                data: ctx.getImageData(0, 0, targetW, targetH).data,
                width: targetW,
                height: targetH
            };
        } catch (err) {
            LOG('  Background thumbnail generation failed:', err);
            return null;
        }
    }

    /**
     * Samples the average background color under the given polygons.
     * Uses IQR filtering to discard terrain bleed from imperfect borders.
     * Results are cached per region to guarantee rock-solid color stability across saves.
     * Returns [r, g, b] normalized to 0-1 range.
     * @param {number[][]} pointSets
     * @param {string} [regionId]
     */
    static async sampleBackgroundColor(pointSets, regionId) {
        const fallback = [0.05, 0.15, 0.25];

        const bgPath = WaterColorSampler.resolveSceneBackgroundSrc();
        if (!bgPath) return fallback;

        const cacheKey = `${regionId || 'anon'}-${bgPath}`;
        if (WaterColorSampler.#sampledColorCache.has(cacheKey)) {
            return WaterColorSampler.#sampledColorCache.get(cacheKey);
        }

        try {
            const thumb = await WaterColorSampler.#getSceneThumbnail(bgPath);
            if (!thumb) return fallback;

            const dims = canvas.dimensions;
            if (!dims?.sceneWidth || !dims?.sceneHeight) return fallback;

            const scaleX = thumb.width / dims.sceneWidth;
            const scaleY = thumb.height / dims.sceneHeight;
            const fullImageData = thumb.data;

            // Collect individual samples with luminance
            const pixelSamples = [];

            for (const points of pointSets) {
                let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
                for (let i = 0; i < points.length; i += 2) {
                    minX = Math.min(minX, points[i]);
                    minY = Math.min(minY, points[i + 1]);
                    maxX = Math.max(maxX, points[i]);
                    maxY = Math.max(maxY, points[i + 1]);
                }

                const span = Math.max(maxX - minX, maxY - minY);
                const step = Math.max(16, Math.round(span / 30));

                for (let sy = minY; sy <= maxY; sy += step) {
                    for (let sx = minX; sx <= maxX; sx += step) {
                        if (!WaterColorSampler.pointInPolygon(sx, sy, points)) continue;
                        if (points.holes?.some(h => WaterColorSampler.pointInPolygon(sx, sy, h))) continue;
                        const imgX = Math.round((sx - dims.sceneX) * scaleX);
                        const imgY = Math.round((sy - dims.sceneY) * scaleY);
                        if (imgX < 0 || imgX >= thumb.width || imgY < 0 || imgY >= thumb.height) continue;

                        const pIdx = (imgY * thumb.width + imgX) * 4;
                        const r = fullImageData[pIdx] / 255;
                        const g = fullImageData[pIdx + 1] / 255;
                        const b = fullImageData[pIdx + 2] / 255;
                        const lum = 0.299 * r + 0.587 * g + 0.114 * b;

                        // Compute saturation (HSL)
                        const max = Math.max(r, g, b);
                        const min = Math.min(r, g, b);
                        const sat = (max === 0) ? 0 : (max - min) / max;

                        pixelSamples.push({ r, g, b, lum, sat });
                    }
                }
            }

            if (!pixelSamples.length) return fallback;

            // Pass 1: Discard warm shore/mud bleed when cool/neutral water samples exist inside polygon
            const waterHued = pixelSamples.filter(s => s.b >= s.r * 0.85);
            LOG(`  Water-hue filter: ${pixelSamples.length} total, ${waterHued.length} cool/neutral`);

            // Use water-hued samples if enough exist, otherwise fall back to all in-polygon samples
            const pool = waterHued.length >= 5 ? waterHued : pixelSamples;

            // Pass 2: IQR on luminance to remove remaining outliers
            pool.sort((a, b) => a.lum - b.lum);
            const q1 = Math.floor(pool.length * 0.25);
            const q3 = Math.ceil(pool.length * 0.75);
            const filtered = pool.slice(q1, q3);

            if (!filtered.length) return fallback;

            let totalR = 0, totalG = 0, totalB = 0;
            for (const s of filtered) {
                totalR += s.r;
                totalG += s.g;
                totalB += s.b;
            }

            LOG(`  Final color pool: ${filtered.length} samples after IQR`);

            const result = [
                totalR / filtered.length,
                totalG / filtered.length,
                totalB / filtered.length
            ];
            WaterColorSampler.#sampledColorCache.set(cacheKey, result);
            return result;
        } catch (err) {
            LOG('  Background sampling failed:', err);
            return fallback;
        }
    }

    static shapeToPolygonPoints(shape) {
        const shapeType = shape.type ?? shape.constructor?.name ?? '';

        if (shapeType === 'polygon' || shapeType === 'PolygonShapeData') {
            const pts = shape.points ?? shape.coordinates ?? [];
            if (pts.length >= 6) return Array.from(pts);
        }

        if (shapeType === 'rectangle' || shapeType === 'RectangleShapeData') {
            const x = shape.x ?? 0, y = shape.y ?? 0;
            const w = shape.width ?? 0, h = shape.height ?? 0;
            if (w > 0 && h > 0) {
                return [x, y, x + w, y, x + w, y + h, x, y + h];
            }
        }

        if (shapeType === 'ellipse' || shapeType === 'circle' || shapeType === 'EllipseShapeData' || shapeType === 'CircleShapeData') {
            const rx = shape.radiusX ?? shape.radius ?? 0;
            const ry = shape.radiusY ?? shape.radius ?? 0;
            const cx = (shape.x ?? 0) + rx;
            const cy = (shape.y ?? 0) + ry;
            if (rx > 0 && ry > 0) {
                const pts = [];
                for (let i = 0; i < 24; i++) {
                    const a = (i / 24) * Math.PI * 2;
                    pts.push(Math.round(cx + rx * Math.cos(a)), Math.round(cy + ry * Math.sin(a)));
                }
                return pts;
            }
        }

        if (shape.points?.length >= 6) return Array.from(shape.points);

        if (typeof shape.toObject === 'function') {
            const plain = shape.toObject();
            if (plain.points?.length >= 6) return Array.from(plain.points);
        }

        return null;
    }

    static extractPoints(regionDoc) {
        const results = [];
        const holePolys = [];
        const shapes = regionDoc.shapes?.contents ?? regionDoc.shapes ?? [];

        for (const shape of shapes) {
            const pts = WaterColorSampler.shapeToPolygonPoints(shape);
            if (!pts) continue;
            if (Boolean(shape.hole)) {
                holePolys.push(pts);
            } else {
                results.push(pts);
            }
        }

        if (!holePolys.length && Array.isArray(regionDoc.flags?.[MODULE_ID]?.holes)) {
            for (const h of regionDoc.flags[MODULE_ID].holes) {
                if (Array.isArray(h) && h.length >= 6) {
                    holePolys.push(Array.from(h));
                }
            }
        }

        if (results.length && holePolys.length) {
            if (results.length === 1) {
                results[0].holes = holePolys;
            } else {
                for (const outerPts of results) {
                    const matched = holePolys.filter(h => WaterColorSampler.pointInPolygon(h[0], h[1], outerPts));
                    if (matched.length) outerPts.holes = matched;
                }
            }
        }

        return results;
    }

    /**
     * Ray-casting point-in-polygon test for a flat [x,y,x,y,...] array.
     * @param {number} px
     * @param {number} py
     * @param {number[]} flatPoints
     * @returns {boolean}
     */
    static pointInPolygon(px, py, flatPoints) {
        const n = flatPoints.length / 2;
        let inside = false;
        for (let i = 0, j = n - 1; i < n; j = i++) {
            const xi = flatPoints[i * 2],     yi = flatPoints[i * 2 + 1];
            const xj = flatPoints[j * 2],     yj = flatPoints[j * 2 + 1];
            if (((yi > py) !== (yj > py)) &&
                (px < (xj - xi) * (py - yi) / (yj - yi) + xi)) {
                inside = !inside;
            }
        }
        return inside;
    }
}
