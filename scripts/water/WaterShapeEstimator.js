import { WATER_ARCHETYPES, WATER_PRESETS } from './WaterManager.js';

/**
 * WaterShapeEstimator
 * Geometric and topological shape analyzer for water candidate polygons.
 * Evaluates:
 * - Map edge boundary contact (open ocean vs coastal cut-off vs inland basin)
 * - Elongation and principal orientation axis (PCA / moment of inertia for rivers)
 * - Undulating inland shore vs straight map border cuts (coastal wave headings)
 * - Area and compactness (lakes, ponds, puddles)
 */
export class WaterShapeEstimator {

    /**
     * Analyze candidate polygon geometry against scene boundaries.
     * @param {object} candidate - Detection candidate with { points, area, centroid, vertexCount }
     * @param {object} [dimensions] - Scene dimensions { sceneX, sceneY, sceneWidth, sceneHeight }
     * @returns {object} Estimation result with { archetype, preset, flowAngle, touches, elongation, explanation }
     */
    static estimate(candidate, dimensions) {
        const points = candidate?.points;
        if (!Array.isArray(points) || points.length < 6) {
            return this.#fallbackResult();
        }

        const dims = dimensions || canvas?.dimensions || {
            sceneX: 0,
            sceneY: 0,
            sceneWidth: 4000,
            sceneHeight: 3000
        };

        const sLeft = dims.sceneX ?? 0;
        const sRight = sLeft + (dims.sceneWidth ?? 4000);
        const sTop = dims.sceneY ?? 0;
        const sBottom = sTop + (dims.sceneHeight ?? 3000);
        const sceneArea = (dims.sceneWidth ?? 4000) * (dims.sceneHeight ?? 3000);

        const vertCount = points.length / 2;
        let minX = Infinity, maxX = -Infinity;
        let minY = Infinity, maxY = -Infinity;
        let sumX = 0, sumY = 0;

        for (let i = 0; i < points.length; i += 2) {
            const x = points[i];
            const y = points[i + 1];
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
            sumX += x;
            sumY += y;
        }

        const cx = sumX / vertCount;
        const cy = sumY / vertCount;

        // Shoelace polygon area
        let doubleArea = 0;
        for (let i = 0; i < points.length; i += 2) {
            const nextI = (i + 2) % points.length;
            doubleArea += points[i] * points[nextI + 1] - points[nextI] * points[i + 1];
        }
        const polyArea = Math.abs(doubleArea) / 2;
        const coverage = sceneArea > 0 ? polyArea / sceneArea : 0;

        // ── 1. Map Edge Boundary Contact Analysis ─────────────────────────────
        const marginX = Math.max(28, (dims.sceneWidth ?? 4000) * 0.02);
        const marginY = Math.max(28, (dims.sceneHeight ?? 3000) * 0.02);

        let touchLeftCount = 0, touchRightCount = 0, touchTopCount = 0, touchBottomCount = 0;
        let minTouchY_left = Infinity, maxTouchY_left = -Infinity;
        let minTouchY_right = Infinity, maxTouchY_right = -Infinity;
        let minTouchX_top = Infinity, maxTouchX_top = -Infinity;
        let minTouchX_bottom = Infinity, maxTouchX_bottom = -Infinity;

        for (let i = 0; i < points.length; i += 2) {
            const x = points[i];
            const y = points[i + 1];

            if (x - sLeft <= marginX) {
                touchLeftCount++;
                if (y < minTouchY_left) minTouchY_left = y;
                if (y > maxTouchY_left) maxTouchY_left = y;
            }
            if (sRight - x <= marginX) {
                touchRightCount++;
                if (y < minTouchY_right) minTouchY_right = y;
                if (y > maxTouchY_right) maxTouchY_right = y;
            }
            if (y - sTop <= marginY) {
                touchTopCount++;
                if (x < minTouchX_top) minTouchX_top = x;
                if (x > maxTouchX_top) maxTouchX_top = x;
            }
            if (sBottom - y <= marginY) {
                touchBottomCount++;
                if (x < minTouchX_bottom) minTouchX_bottom = x;
                if (x > maxTouchX_bottom) maxTouchX_bottom = x;
            }
        }

        const minSpanY = (dims.sceneHeight ?? 3000) * 0.10;
        const minSpanX = (dims.sceneWidth ?? 4000) * 0.10;

        const touches = {
            left: touchLeftCount >= 2 && (maxTouchY_left - minTouchY_left) >= minSpanY,
            right: touchRightCount >= 2 && (maxTouchY_right - minTouchY_right) >= minSpanY,
            top: touchTopCount >= 2 && (maxTouchX_top - minTouchX_top) >= minSpanX,
            bottom: touchBottomCount >= 2 && (maxTouchX_bottom - minTouchX_bottom) >= minSpanX
        };
        touches.count = (touches.left ? 1 : 0) + (touches.right ? 1 : 0) + (touches.top ? 1 : 0) + (touches.bottom ? 1 : 0);

        // Classify inland vertices (not clamped to a touched map border)
        const inlandPoints = [];
        for (let i = 0; i < points.length; i += 2) {
            const x = points[i];
            const y = points[i + 1];
            const isBorder = (touches.left && x <= sLeft + marginX)
                || (touches.right && x >= sRight - marginX)
                || (touches.top && y <= sTop + marginY)
                || (touches.bottom && y >= sBottom - marginY);
            if (!isBorder) {
                inlandPoints.push({ x, y });
            }
        }

        // ── 2. PCA / Second Moments Analysis (Elongation & Major Axis) ─────────
        let varXX = 0, varYY = 0, covXY = 0;
        for (let i = 0; i < points.length; i += 2) {
            const dx = points[i] - cx;
            const dy = points[i + 1] - cy;
            varXX += dx * dx;
            varYY += dy * dy;
            covXY += dx * dy;
        }
        varXX /= vertCount;
        varYY /= vertCount;
        covXY /= vertCount;

        const trace = varXX + varYY;
        const diff = varXX - varYY;
        const delta = Math.sqrt(Math.max(0, diff * diff + 4 * covXY * covXY));
        const lambda1 = (trace + delta) / 2;
        const lambda2 = Math.max(1e-4, (trace - delta) / 2);
        const elongation = Math.sqrt(lambda1 / lambda2);

        // Major axis orientation
        let majorAngle = 0.5 * Math.atan2(2 * covXY, diff);
        // Orient flow along reading / gravity convention:
        // If significant vertical component, flow downward (+Y, South)
        if (Math.abs(Math.sin(majorAngle)) > 0.35) {
            if (Math.sin(majorAngle) < 0) majorAngle += Math.PI;
        } else {
            // Mostly horizontal: flow rightward (+X, East)
            if (Math.cos(majorAngle) < 0) majorAngle += Math.PI;
        }
        const riverFlowDeg = (Math.round(majorAngle * 180 / Math.PI) + 360) % 360;

        // ── 3. Inland Shoreline Normal & Wave Heading (Coastline) ─────────────
        let shoreHeadingDeg = 270;
        if (inlandPoints.length > 0) {
            let sumInX = 0, sumInY = 0;
            for (const p of inlandPoints) {
                sumInX += p.x;
                sumInY += p.y;
            }
            const shoreCx = sumInX / inlandPoints.length;
            const shoreCy = sumInY / inlandPoints.length;
            const toShoreX = shoreCx - cx;
            const toShoreY = shoreCy - cy;
            const shoreAngle = Math.atan2(toShoreY, toShoreX);
            shoreHeadingDeg = (Math.round(shoreAngle * 180 / Math.PI) + 360) % 360;
        }

        // ── 4. Archetype & Preset Classification ──────────────────────────────
        let archetype = 'river';
        let preset = 'river';
        let flowAngle = 90;
        let explanation = '';

        const isOppositeCrossing = (touches.left && touches.right && !touches.top && !touches.bottom)
            || (touches.top && touches.bottom && !touches.left && !touches.right);

        // A. Open Sea / Ocean: all 4 map edges touched, or >= 3 with massive coverage
        if (touches.count === 4 || (touches.count >= 3 && coverage > 0.55) || coverage > 0.75) {
            archetype = 'ocean';
            preset = 'ocean_swell';
            flowAngle = 45;
            explanation = 'Open sea covering map boundaries';
        }
        // B. Coastline: 1 to 3 hard edges against map frame with inland undulating shore
        else if (touches.count >= 1 && touches.count <= 3 && inlandPoints.length >= 3 && !isOppositeCrossing && (coverage > 0.08 || polyArea > 40000)) {
            archetype = 'coast';
            preset = 'coast';
            flowAngle = shoreHeadingDeg;
            explanation = `Coastal shoreline facing inland (${shoreHeadingDeg}°)`;
        }
        // C. River: high elongation (>= 2.0), or channel crossing opposite borders
        else if ((elongation >= 2.0 || isOppositeCrossing) && touches.count < 4) {
            archetype = 'river';
            preset = 'river';
            flowAngle = riverFlowDeg;
            explanation = `Elongated channel aligned along ${riverFlowDeg}°`;
        }
        // D. Inland basins: compact / circular lakes, ponds, or puddles
        else {
            if (polyArea < 8000) {
                archetype = 'puddle';
                preset = 'puddle_rain';
                flowAngle = 0;
                explanation = 'Small standing water';
            } else if (polyArea < 45000) {
                archetype = 'pond';
                preset = 'pond_woodland';
                flowAngle = 30;
                explanation = 'Inland pool / pond';
            } else {
                archetype = 'lake';
                preset = 'lake';
                flowAngle = 0;
                explanation = 'Inland lake basin';
            }
        }

        const archMeta = WATER_ARCHETYPES[archetype] ?? WATER_ARCHETYPES.river;

        return {
            archetype,
            archetypeLabel: archMeta.label,
            icon: archMeta.icon,
            accentColor: archMeta.accentColor,
            preset,
            presetLabel: WATER_PRESETS[preset]?.label ?? preset,
            flowAngle,
            hasDirection: archetype === 'river' || archetype === 'coast' || archetype === 'ocean' || archetype === 'lake',
            elongation: +elongation.toFixed(2),
            coverage: +coverage.toFixed(3),
            area: Math.round(polyArea),
            touches,
            explanation
        };
    }

    static #fallbackResult() {
        return {
            archetype: 'river',
            archetypeLabel: WATER_ARCHETYPES.river.label,
            icon: WATER_ARCHETYPES.river.icon,
            accentColor: WATER_ARCHETYPES.river.accentColor,
            preset: 'river',
            presetLabel: WATER_PRESETS.river.label,
            flowAngle: 90,
            hasDirection: true,
            elongation: 1.0,
            coverage: 0,
            area: 0,
            touches: { left: false, right: false, top: false, bottom: false, count: 0 },
            explanation: 'Default fallback'
        };
    }
}
