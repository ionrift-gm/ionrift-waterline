import { WATER_ARCHETYPES, WATER_PRESETS } from './WaterManager.js';
import { MapBorderDetector } from './MapBorderDetector.js';

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

        // Shoelace polygon area & true geometric centroid
        let doubleArea = 0;
        let cX = 0, cY = 0;
        for (let i = 0; i < points.length; i += 2) {
            const nextI = (i + 2) % points.length;
            const x0 = points[i], y0 = points[i + 1];
            const x1 = points[nextI], y1 = points[nextI + 1];
            const a = x0 * y1 - x1 * y0;
            doubleArea += a;
            cX += (x0 + x1) * a;
            cY += (y0 + y1) * a;
        }
        const polyArea = Math.abs(doubleArea) / 2;
        const polyCx = Math.abs(doubleArea) > 1e-4 ? cX / (3 * doubleArea) : cx;
        const polyCy = Math.abs(doubleArea) > 1e-4 ? cY / (3 * doubleArea) : cy;
        const coverage = sceneArea > 0 ? polyArea / sceneArea : 0;

        // ── 1. Map Edge Boundary Contact Analysis ─────────────────────────────
        const borderSig = MapBorderDetector.detect(points, dims);
        const touches = borderSig.touches;
        const inlandPoints = borderSig.inlandPoints;

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
        // Coastal waves roll head-on toward the beach (perpendicular to the shoreline curve, directed inland).
        let shoreHeadingDeg = 270;
        const awayX = (touches.left ? 1 : 0) - (touches.right ? 1 : 0);
        const awayY = (touches.top ? 1 : 0) - (touches.bottom ? 1 : 0);

        if (inlandPoints && inlandPoints.length >= 2) {
            let sumInX = 0, sumInY = 0;
            for (const p of inlandPoints) {
                sumInX += p.x;
                sumInY += p.y;
            }
            const shoreCx = sumInX / inlandPoints.length;
            const shoreCy = sumInY / inlandPoints.length;

            let inVarXX = 0, inVarYY = 0, inCovXY = 0;
            for (const p of inlandPoints) {
                const dx = p.x - shoreCx;
                const dy = p.y - shoreCy;
                inVarXX += dx * dx;
                inVarYY += dy * dy;
                inCovXY += dx * dy;
            }
            inVarXX /= inlandPoints.length;
            inVarYY /= inlandPoints.length;
            inCovXY /= inlandPoints.length;

            const inDiff = inVarXX - inVarYY;
            const inDelta = Math.sqrt(Math.max(0, inDiff * inDiff + 4 * inCovXY * inCovXY));

            // If the inland shoreline forms an extended curve/line, compute its normal via PCA
            if (inDelta > 1.0) {
                // Shoreline tangent angle along principal variance axis
                const shoreTangent = 0.5 * Math.atan2(2 * inCovXY, inDiff);
                // Two candidate normals perpendicular to the beach tangent
                const n1 = shoreTangent + Math.PI / 2;
                const n2 = shoreTangent - Math.PI / 2;

                // Vector from true water centroid toward the inland shoreline/land
                let toLandX = shoreCx - polyCx;
                let toLandY = shoreCy - polyCy;

                // Reinforce with away-from-borders direction when water touches map borders
                if (touches.count > 0 && touches.count < 4) {
                    toLandX += awayX * 200;
                    toLandY += awayY * 200;
                }

                // Choose the normal that points into the land (away from water)
                const dot1 = Math.cos(n1) * toLandX + Math.sin(n1) * toLandY;
                const chosen = dot1 >= 0 ? n1 : n2;
                shoreHeadingDeg = (Math.round(chosen * 180 / Math.PI) + 360) % 360;
            } else {
                // Concentrated or symmetric shoreline: vector from water center to shoreline
                const toLandX = shoreCx - polyCx + (touches.count > 0 ? awayX * 100 : 0);
                const toLandY = shoreCy - polyCy + (touches.count > 0 ? awayY * 100 : 0);
                const shoreAngle = Math.atan2(toLandY, toLandX);
                shoreHeadingDeg = (Math.round(shoreAngle * 180 / Math.PI) + 360) % 360;
            }
        } else if (touches.count > 0 && touches.count < 4) {
            // Fallback: aim directly away from touched map borders
            const shoreAngle = Math.atan2(awayY, awayX);
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
        // C. River: high elongation (>= 2.3 inland, >= 2.0 border-touching), or channel crossing opposite borders
        else if (((touches.count > 0 ? elongation >= 2.0 : elongation >= 2.3) || isOppositeCrossing) && touches.count < 4) {
            archetype = 'river';
            preset = 'river';
            flowAngle = riverFlowDeg;
            explanation = `Elongated channel aligned along ${riverFlowDeg}°`;
        }
        // D. Inland basins: compact / circular lakes, ponds, or puddles
        else {
            const gridSize = dims.size || dims.grid?.size || canvas?.grid?.size || canvas?.dimensions?.size || canvas?.scene?.grid?.size || 100;
            const gridCells = polyArea / (gridSize * gridSize);

            if (gridCells <= 3.5 || polyArea < 25000) {
                archetype = 'puddle';
                preset = 'puddle_rain';
                flowAngle = 0;
                explanation = 'Small standing water';
            } else if ((gridCells <= 60 || polyArea < 500000) && coverage < 0.15) {
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
            borderSignature: borderSig,
            explanation
        };
    }

    /**
     * Extract flat polygon coordinates [x, y, x, y, ...] from a RegionDocument.
     * Supports polygon, rectangle, and ellipse shapes.
     * @param {RegionDocument} region
     * @returns {number[]|null}
     */
    static extractRegionPoints(region) {
        if (!region) return null;
        const shapes = region.shapes?.contents ?? region.shapes ?? [];
        if (!shapes.length) return null;

        for (const shape of shapes) {
            const pts = shape.points ?? shape.coordinates;
            if (Array.isArray(pts) && pts.length >= 6) {
                return Array.from(pts);
            }
        }

        const rect = shapes.find(s => (s.width > 0 && s.height > 0));
        if (rect) {
            const x = rect.x ?? 0, y = rect.y ?? 0, w = rect.width, h = rect.height;
            return [x, y, x + w, y, x + w, y + h, x, y + h];
        }

        const ellipse = shapes.find(s => (s.radiusX > 0 || s.radius > 0));
        if (ellipse) {
            const rx = ellipse.radiusX ?? ellipse.radius ?? 0;
            const ry = ellipse.radiusY ?? ellipse.radius ?? 0;
            const cx = (ellipse.x ?? 0) + rx;
            const cy = (ellipse.y ?? 0) + ry;
            const pts = [];
            const steps = 32;
            for (let i = 0; i < steps; i++) {
                const angle = (i / steps) * Math.PI * 2;
                pts.push(cx + Math.cos(angle) * rx, cy + Math.sin(angle) * ry);
            }
            return pts;
        }

        return null;
    }

    /**
     * Analyze an existing RegionDocument directly.
     * @param {RegionDocument} region
     * @param {object} [dimensions]
     * @returns {object|null} Estimation result or null if region has no valid shape
     */
    static estimateRegion(region, dimensions) {
        const points = this.extractRegionPoints(region);
        if (!points || points.length < 6) return null;
        const dims = dimensions || canvas?.dimensions || canvas?.scene?.dimensions;
        return this.estimate({
            points,
            vertexCount: Math.round(points.length / 2)
        }, dims);
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
            borderSignature: MapBorderDetector.detect(null),
            explanation: 'Default fallback'
        };
    }
}

