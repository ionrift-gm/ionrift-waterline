const MODULE_ID = 'ionrift-waterline';

/**
 * Generates an organic wall border around the scene boundary.
 * Uses a rounded-rectangle base path so corners are naturally curved.
 * Vertices are placed at regular intervals with random inward offsets.
 */
export class BorderGenerator {

    /**
     * @param {object} options
     * @param {number} [options.totalVertices=40] - Total vertices around the perimeter
     * @param {number} [options.amplitude=100]    - Max inward offset in pixels
     * @param {number} [options.jitter=0.3]       - Spacing randomness (0-1)
     * @param {number} [options.inset=20]         - Base margin from scene edge in pixels
     * @param {number} [options.cornerRadius=150] - Corner rounding radius in pixels
     * @param {number} [options.seed]             - Optional seed for reproducibility
     */
    static generate(options = {}) {
        const {
            totalVertices = 40,
            amplitude = 100,
            jitter = 0.3,
            inset = 20,
            cornerRadius = 150,
            seed
        } = options;

        const dims = canvas.dimensions;
        const rng = BorderGenerator.#seededRandom(seed ?? Date.now());

        // Scene boundary (inset from edge)
        const left   = dims.sceneX + inset;
        const top    = dims.sceneY + inset;
        const right  = dims.sceneX + dims.sceneWidth - inset;
        const bottom = dims.sceneY + dims.sceneHeight - inset;
        const w = right - left;
        const h = bottom - top;

        // Clamp corner radius so it doesn't exceed half the shortest side
        const r = Math.min(cornerRadius, w / 2, h / 2);

        // Build the rounded-rectangle path as a series of sample points
        // 4 straight segments + 4 quarter-circle arcs
        const straightH = w - 2 * r;  // horizontal straight length
        const straightV = h - 2 * r;  // vertical straight length
        const arcLen = (Math.PI / 2) * r; // quarter-circle arc length
        const totalPerimeter = 2 * straightH + 2 * straightV + 4 * arcLen;

        // Place vertices at regular intervals around the rounded rect

        // Generate base positions and raw offsets
        const basePoints = [];
        const rawOffsets = [];

        for (let i = 0; i < totalVertices; i++) {
            let d = (i / totalVertices) * totalPerimeter;
            if (jitter > 0) {
                const spacing = totalPerimeter / totalVertices;
                d += (rng() * 2 - 1) * spacing * jitter * 0.5;
                d = ((d % totalPerimeter) + totalPerimeter) % totalPerimeter;
            }

            const pt = BorderGenerator.#sampleRoundedRect(
                d, left, top, w, h, r, straightH, straightV, arcLen
            );
            basePoints.push(pt);
            rawOffsets.push(rng() * rng() * amplitude);
        }

        // Smooth offsets to prevent adjacent vertices from crossing
        // Two passes of neighbor averaging (wrapping around the loop)
        let smoothed = [...rawOffsets];
        // Single light smoothing pass to prevent crossings without killing variation
        const next = [];
        for (let i = 0; i < smoothed.length; i++) {
            const prev = smoothed[(i - 1 + smoothed.length) % smoothed.length];
            const curr = smoothed[i];
            const nxt  = smoothed[(i + 1) % smoothed.length];
            next.push(prev * 0.15 + curr * 0.70 + nxt * 0.15);
        }
        smoothed = next;

        // Build final vertices
        const verts = [];
        for (let i = 0; i < totalVertices; i++) {
            const { x: baseX, y: baseY, nx, ny } = basePoints[i];
            const offset = smoothed[i];
            verts.push({
                x: Math.round(baseX + nx * offset),
                y: Math.round(baseY + ny * offset)
            });
        }

        // Create wall segments from consecutive vertex pairs (looping)
        const walls = [];
        for (let i = 0; i < verts.length; i++) {
            const a = verts[i];
            const b = verts[(i + 1) % verts.length];
            walls.push({
                c: [a.x, a.y, b.x, b.y],
                move: CONST.WALL_MOVEMENT_TYPES.NORMAL,
                sight: CONST.WALL_SENSE_TYPES.NORMAL,
                light: CONST.WALL_SENSE_TYPES.NORMAL,
                sound: CONST.WALL_SENSE_TYPES.NORMAL,
                flags: { [MODULE_ID]: { isBorder: true } }
            });
        }

        return walls;
    }

    /**
     * Samples a point and inward normal on a rounded rectangle.
     *
     * Walk order starting from top-left after the TL arc:
     *   1. Top straight    (left+r to right-r, y=top)
     *   2. TR arc
     *   3. Right straight  (top+r to bottom-r, x=right)
     *   4. BR arc
     *   5. Bottom straight (right-r to left+r, y=bottom)
     *   6. BL arc
     *   7. Left straight   (bottom-r to top+r, x=left)
     *   8. TL arc
     */
    static #sampleRoundedRect(d, left, top, w, h, r, straightH, straightV, arcLen) {
        // Segment 1: Top straight
        if (d < straightH) {
            const t = d / Math.max(1, straightH);
            return { x: left + r + t * straightH, y: top, nx: 0, ny: 1 };
        }
        d -= straightH;

        // Segment 2: Top-right arc (center at right-r, top+r)
        if (d < arcLen) {
            const angle = -Math.PI / 2 + (d / Math.max(1, arcLen)) * (Math.PI / 2);
            const cx = left + w - r;
            const cy = top + r;
            return {
                x: cx + r * Math.cos(angle),
                y: cy + r * Math.sin(angle),
                nx: -Math.cos(angle),
                ny: -Math.sin(angle)
            };
        }
        d -= arcLen;

        // Segment 3: Right straight
        if (d < straightV) {
            const t = d / Math.max(1, straightV);
            return { x: left + w, y: top + r + t * straightV, nx: -1, ny: 0 };
        }
        d -= straightV;

        // Segment 4: Bottom-right arc (center at right-r, bottom-r)
        if (d < arcLen) {
            const angle = 0 + (d / Math.max(1, arcLen)) * (Math.PI / 2);
            const cx = left + w - r;
            const cy = top + h - r;
            return {
                x: cx + r * Math.cos(angle),
                y: cy + r * Math.sin(angle),
                nx: -Math.cos(angle),
                ny: -Math.sin(angle)
            };
        }
        d -= arcLen;

        // Segment 5: Bottom straight (right to left)
        if (d < straightH) {
            const t = d / Math.max(1, straightH);
            return { x: left + w - r - t * straightH, y: top + h, nx: 0, ny: -1 };
        }
        d -= straightH;

        // Segment 6: Bottom-left arc (center at left+r, bottom-r)
        if (d < arcLen) {
            const angle = Math.PI / 2 + (d / Math.max(1, arcLen)) * (Math.PI / 2);
            const cx = left + r;
            const cy = top + h - r;
            return {
                x: cx + r * Math.cos(angle),
                y: cy + r * Math.sin(angle),
                nx: -Math.cos(angle),
                ny: -Math.sin(angle)
            };
        }
        d -= arcLen;

        // Segment 7: Left straight (bottom to top)
        if (d < straightV) {
            const t = d / Math.max(1, straightV);
            return { x: left, y: top + h - r - t * straightV, nx: 1, ny: 0 };
        }
        d -= straightV;

        // Segment 8: Top-left arc (center at left+r, top+r)
        {
            const angle = Math.PI + (d / Math.max(1, arcLen)) * (Math.PI / 2);
            const cx = left + r;
            const cy = top + r;
            return {
                x: cx + r * Math.cos(angle),
                y: cy + r * Math.sin(angle),
                nx: -Math.cos(angle),
                ny: -Math.sin(angle)
            };
        }
    }

    /**
     * Creates border walls in the current scene.
     */
    static async createBorder(options = {}) {
        if (!game.user.isGM) return;
        await BorderGenerator.clearBorder(true);

        const wallData = BorderGenerator.generate(options);
        if (!wallData.length) return [];

        const created = await canvas.scene.createEmbeddedDocuments('Wall', wallData);
        ui.notifications.info(`Waterline | Created ${created.length} border wall segments.`);
        return created;
    }

    /**
     * Creates 4 straight walls along the scene edges.
     * @param {number} [inset=0] - Margin from scene edge in pixels
     */
    static async createStraightBorder(inset = 0) {
        if (!game.user.isGM) return;
        await BorderGenerator.clearBorder(true);

        const dims = canvas.dimensions;
        const l = dims.sceneX + inset;
        const t = dims.sceneY + inset;
        const r = dims.sceneX + dims.sceneWidth - inset;
        const b = dims.sceneY + dims.sceneHeight - inset;

        const wallData = [
            { c: [l, t, r, t] },  // Top
            { c: [r, t, r, b] },  // Right
            { c: [r, b, l, b] },  // Bottom
            { c: [l, b, l, t] },  // Left
        ].map(w => ({
            ...w,
            move: CONST.WALL_MOVEMENT_TYPES.NORMAL,
            sight: CONST.WALL_SENSE_TYPES.NORMAL,
            light: CONST.WALL_SENSE_TYPES.NORMAL,
            sound: CONST.WALL_SENSE_TYPES.NORMAL,
            flags: { [MODULE_ID]: { isBorder: true } }
        }));

        const created = await canvas.scene.createEmbeddedDocuments('Wall', wallData);
        ui.notifications.info(`Waterline | Created 4 straight border walls.`);
        return created;
    }

    /**
     * Removes all border walls from the current scene.
     */
    static async clearBorder(silent = false) {
        if (!game.user.isGM) return;

        const borderWallIds = canvas.scene.walls
            .filter(w => w.flags?.[MODULE_ID]?.isBorder)
            .map(w => w.id);

        if (!borderWallIds.length) {
            if (!silent) ui.notifications.warn('Waterline | No border walls found to remove.');
            return;
        }

        await canvas.scene.deleteEmbeddedDocuments('Wall', borderWallIds);
        if (!silent) ui.notifications.info(`Waterline | Removed ${borderWallIds.length} border wall segments.`);
    }

    /** Seeded PRNG (Mulberry32). */
    static #seededRandom(seed) {
        let s = seed | 0;
        return () => {
            s = (s + 0x6D2B79F5) | 0;
            let t = Math.imul(s ^ (s >>> 15), 1 | s);
            t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    }
}
