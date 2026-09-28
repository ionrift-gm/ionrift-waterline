import { WaterDetector } from '../water/WaterDetector.js';
import { MapBorderDetector } from '../water/MapBorderDetector.js';
import { WaterShapeEstimator } from '../water/WaterShapeEstimator.js';

const MODULE_ID = 'ionrift-waterline';

/**
 * Controller for interactive water sampling (pick mode) on the canvas.
 * Manages canvas pointer events, flood-fill generation, PIXI preview overlays,
 * refinement (add/subtract), Douglas-Peucker candidate smoothing, and undo history.
 */
export class WaterSamplingController {

    /** @type {boolean} */
    #active = false;

    /** @type {string|null} ID of RegionDocument currently being edited */
    #editingRegionId = null;

    /** @type {object|null} Current flood fill candidate */
    #currentCandidate = null;

    /** @type {object|null} Current cell mask data { mask, cols, rows, gridStep } */
    #currentMaskData = null;

    /** @type {Uint8Array[]} Undo stack of mask snapshots */
    #undoStack = [];

    /** @type {{ x: number, y: number }|null} Current seed point */
    #seedPoint = null;

    /** @type {PIXI.Sprite|null} Live flood preview sprite */
    #previewSprite = null;

    /** @type {PIXI.Graphics|null} Candidate polygon outline overlay */
    #polyPreview = null;

    /** @type {Function|null} Canvas pointerdown event listener */
    #canvasHandler = null;

    /** @type {Function|null} Keyboard event listener for Ctrl+Z */
    #keyHandler = null;

    /** @type {number|null} Debounce timer */
    #debounceTimer = null;

    /** @type {number} */
    tolerance = 40;

    /** @type {number} */
    smoothing = 7.0;

    /** @type {{ onCandidate?: Function, onClear?: Function, onStatus?: Function }} */
    #callbacks = {};

    get isActive() {
        return this.#active;
    }

    get editingRegionId() {
        return this.#editingRegionId;
    }

    get candidate() {
        return this.#currentCandidate;
    }

    get undoCount() {
        return this.#undoStack.length;
    }

    /**
     * Start interactive canvas pick mode.
     * @param {object} [options]
     * @param {number} [options.tolerance=40]
     * @param {number} [options.smoothing=7.0]
     * @param {object} [callbacks]
     */
    start(options = {}, callbacks = {}) {
        if (!game.user.isGM) return;

        this.#active = true;
        this.tolerance = options.tolerance ?? this.tolerance;
        this.smoothing = options.smoothing ?? this.smoothing;
        this.#callbacks = callbacks;

        // Attach canvas pointerdown handler
        this.#canvasHandler = (ev) => this.#onCanvasClick(ev);
        canvas.stage.on('pointerdown', this.#canvasHandler);

        // Attach Ctrl+Z keyboard handler
        this.#keyHandler = (ev) => this.#onKeyDown(ev);
        document.addEventListener('keydown', this.#keyHandler);

        this.#callbacks.onStatus?.('Click on water in the scene to sample. Shift+Click to add, Ctrl+Click to subtract.');
    }

    /**
     * Stop canvas pick mode and detach listeners.
     */
    stop() {
        this.#active = false;

        if (this.#canvasHandler) {
            canvas.stage.off('pointerdown', this.#canvasHandler);
            this.#canvasHandler = null;
        }

        if (this.#keyHandler) {
            document.removeEventListener('keydown', this.#keyHandler);
            this.#keyHandler = null;
        }

        if (this.#debounceTimer) {
            clearTimeout(this.#debounceTimer);
            this.#debounceTimer = null;
        }
    }

    /**
     * Set tolerance and trigger debounced re-fill if a seed point exists.
     * @param {number} val
     */
    setTolerance(val) {
        this.tolerance = Number(val);
        if (this.#seedPoint) this.#debouncedFill();
    }

    /**
     * Set smoothing and trigger contour update on current mask or debounced re-fill.
     * @param {number} val
     */
    setSmoothing(val) {
        this.smoothing = Number(val);
        if (this.#currentMaskData) {
            const candidate = WaterDetector.candidateFromMask(this.#currentMaskData, this.smoothing);
            if (candidate) {
                candidate.maskData = this.#currentMaskData;
                this.#currentCandidate = candidate;
                this.#showPolyPreview(candidate);
                this.#callbacks.onCandidate?.(candidate);
            }
        } else if (this.#seedPoint) {
            this.#debouncedFill();
        }
    }

    /**
     * Load an existing water Region into the sampler for boundary editing.
     * @param {string} regionId
     * @param {object} [callbacks]
     * @returns {Promise<boolean>}
     */
    async loadRegionForEditing(regionId, callbacks = {}) {
        if (!game.user.isGM) return false;

        const region = canvas.scene?.regions?.get(regionId);
        if (!region) {
            ui.notifications.warn(`Waterline | Region "${regionId}" not found on scene.`);
            return false;
        }

        // Start sampler if not already started
        if (!this.#active) {
            this.start({ tolerance: this.tolerance, smoothing: this.smoothing }, callbacks);
        } else if (callbacks) {
            this.#callbacks = { ...this.#callbacks, ...callbacks };
        }

        const maskData = await WaterDetector.maskFromRegion(region, 4);
        if (!maskData) {
            ui.notifications.warn(`Waterline | Could not extract shape from "${region.name}".`);
            return false;
        }

        // Extract raw points from existing region's primary shape
        const shapes = region.shapes?.contents ?? region.shapes ?? [];
        const polyShape = shapes.find(s => (s.points?.length >= 6) || (s.coordinates?.length >= 6));
        const rawPts = polyShape ? Array.from(polyShape.points ?? polyShape.coordinates ?? []) : null;

        let candidate = WaterDetector.candidateFromMask(maskData, this.smoothing);
        if (candidate && rawPts && rawPts.length >= 6) {
            // Keep the exact original boundary vertices until modified by user
            candidate.points = rawPts;
            candidate.vertexCount = Math.round(rawPts.length / 2);
        } else if (!candidate && rawPts && rawPts.length >= 6) {
            let cx = 0, cy = 0;
            const vertCount = rawPts.length / 2;
            for (let i = 0; i < rawPts.length; i += 2) {
                cx += rawPts[i];
                cy += rawPts[i + 1];
            }
            candidate = {
                points: rawPts,
                area: vertCount * 10,
                centroid: { x: cx / vertCount, y: cy / vertCount },
                vertexCount: vertCount
            };
        }

        if (!candidate) {
            ui.notifications.warn(`Waterline | Failed to trace boundary for "${region.name}".`);
            return false;
        }

        candidate.maskData = maskData;
        this.#currentCandidate = candidate;
        this.#currentMaskData = maskData;
        this.#editingRegionId = regionId;
        this.#undoStack = [];
        this.#seedPoint = candidate.centroid;

        this.clearPreviews();

        const sprite = WaterDetector.previewFromMask(maskData);
        if (sprite) {
            const layer = canvas.controls ?? canvas.stage;
            layer.addChild(sprite);
            this.#previewSprite = sprite;
        }

        this.#showPolyPreview(this.#currentCandidate);
        this.#callbacks.onCandidate?.(this.#currentCandidate);
        this.#callbacks.onStatus?.(`Editing "${region.name}": Shift+Click map to add water, Ctrl+Click to subtract.`);
        return true;
    }

    /**
     * Accept current candidate and create or update a RegionDocument on the active scene.
     * @param {string} [name]
     * @returns {Promise<RegionDocument|null>}
     */
    async acceptCandidate(name) {
        if (!this.#currentCandidate) return null;

        if (this.#editingRegionId) {
            const region = canvas.scene?.regions?.get(this.#editingRegionId);
            if (region) {
                const dims = canvas.dimensions;
                const est = this.#currentCandidate.estimation ?? WaterShapeEstimator.estimate(this.#currentCandidate, dims);
                const points = (est?.touches?.count > 0)
                    ? MapBorderDetector.snap(this.#currentCandidate.points, dims)
                    : this.#currentCandidate.points;

                const updateData = {
                    shapes: [{
                        type: 'polygon',
                        points
                    }]
                };
                if (name && name.trim() && name.trim() !== region.name) {
                    updateData.name = name.trim();
                }
                await region.update(updateData);
                ui.notifications.info(`Waterline | Updated boundary for "${region.name}".`);
                this.discardCandidate();
                return region;
            }
        }

        const region = await WaterDetector.createRegionFromCandidate(
            this.#currentCandidate, name
        );

        this.discardCandidate();
        return region;
    }

    /**
     * Discard current candidate, clear previews, and reset undo stack.
     */
    discardCandidate() {
        this.#currentCandidate = null;
        this.#currentMaskData = null;
        this.#undoStack.length = 0;
        this.#seedPoint = null;
        this.#editingRegionId = null;
        this.clearPreviews();
        this.#callbacks.onClear?.();
    }

    /**
     * Clear PIXI sprite and polygon overlays from canvas.
     */
    clearPreviews() {
        if (this.#previewSprite?.parent) {
            this.#previewSprite.parent.removeChild(this.#previewSprite);
        }
        this.#previewSprite?.destroy(true);
        this.#previewSprite = null;

        if (this.#polyPreview?.parent) {
            this.#polyPreview.parent.removeChild(this.#polyPreview);
        }
        this.#polyPreview?.destroy();
        this.#polyPreview = null;
    }

    /**
     * Snapshot current mask and candidate points for undo history.
     * @private
     */
    #pushUndoSnapshot() {
        if (!this.#currentMaskData) return;
        const entry = {
            mask: new Uint8Array(this.#currentMaskData.mask),
            points: this.#currentCandidate?.points ? Array.from(this.#currentCandidate.points) : null
        };
        this.#undoStack.push(entry);
        if (this.#undoStack.length > 20) this.#undoStack.shift();
    }

    /**
     * Undo last mask modification or boundary adjustment.
     */
    async undo() {
        if (!this.#undoStack.length || !this.#currentMaskData) {
            ui.notifications.info('Waterline | Nothing to undo.');
            return;
        }

        const entry = this.#undoStack.pop();
        const mask = (entry instanceof Uint8Array) ? entry : entry.mask;
        this.#currentMaskData.mask = mask;

        if (entry.points && this.#currentCandidate) {
            this.#currentCandidate.points = entry.points;
            this.#currentCandidate.vertexCount = Math.round(entry.points.length / 2);
        } else {
            const candidate = WaterDetector.candidateFromMask(this.#currentMaskData, this.smoothing);
            if (!candidate) return;
            candidate.maskData = this.#currentMaskData;
            this.#currentCandidate = candidate;
        }

        this.clearPreviews();

        const sprite = WaterDetector.previewFromMask(this.#currentMaskData);
        if (sprite) {
            const layer = canvas.controls ?? canvas.stage;
            layer.addChild(sprite);
            this.#previewSprite = sprite;
        }

        this.#showPolyPreview(this.#currentCandidate);
        this.#callbacks.onCandidate?.(this.#currentCandidate);
        ui.notifications.info(`Waterline | Undo (${this.#undoStack.length} remaining).`);
    }

    /**
     * Pull boundary inward away from shorelines (morphological erosion).
     * Shrinks candidate by 1 grid cell (approx. 4-8px) to align with drawn waterlines.
     */
    pullBack() {
        if (!this.#currentMaskData) return;
        this.#pushUndoSnapshot();

        WaterDetector.erodeMask(this.#currentMaskData, 1);

        const candidate = WaterDetector.candidateFromMask(this.#currentMaskData, this.smoothing);
        if (candidate) {
            candidate.maskData = this.#currentMaskData;
            this.#currentCandidate = candidate;

            this.clearPreviews();
            const sprite = WaterDetector.previewFromMask(this.#currentMaskData);
            if (sprite) {
                const layer = canvas.controls ?? canvas.stage;
                layer.addChild(sprite);
                this.#previewSprite = sprite;
            }
            this.#showPolyPreview(this.#currentCandidate);
            this.#callbacks.onCandidate?.(this.#currentCandidate);
            ui.notifications.info('Waterline | Pulled back boundary (1 step).');
        } else {
            this.undo();
            ui.notifications.warn('Waterline | Cannot pull back further (water body would disappear).');
        }
    }

    /**
     * Expand boundary outward into surrounding land (morphological dilation).
     * Grows candidate by 1 grid cell (approx. 4-8px).
     */
    expand() {
        if (!this.#currentMaskData) return;
        this.#pushUndoSnapshot();

        WaterDetector.dilateMask(this.#currentMaskData, 1);

        const candidate = WaterDetector.candidateFromMask(this.#currentMaskData, this.smoothing);
        if (candidate) {
            candidate.maskData = this.#currentMaskData;
            this.#currentCandidate = candidate;

            this.clearPreviews();
            const sprite = WaterDetector.previewFromMask(this.#currentMaskData);
            if (sprite) {
                const layer = canvas.controls ?? canvas.stage;
                layer.addChild(sprite);
                this.#previewSprite = sprite;
            }
            this.#showPolyPreview(this.#currentCandidate);
            this.#callbacks.onCandidate?.(this.#currentCandidate);
            ui.notifications.info('Waterline | Expanded boundary (1 step).');
        }
    }

    /**
     * Smooth candidate boundary curves using subdivision corner-rounding.
     * Eliminates stair-steps along inland shorelines while preserving map borders.
     */
    smooth() {
        if (!this.#currentCandidate?.points?.length) return;
        this.#pushUndoSnapshot();

        const dims = canvas.dimensions;
        const smoothed = WaterDetector.smoothContour(this.#currentCandidate.points, 1, dims);
        this.#currentCandidate.points = smoothed;
        this.#currentCandidate.vertexCount = Math.round(smoothed.length / 2);

        this.#showPolyPreview(this.#currentCandidate);
        this.#callbacks.onCandidate?.(this.#currentCandidate);
        ui.notifications.info(`Waterline | Smoothed boundary curves (${this.#currentCandidate.vertexCount} pts).`);
    }

    /**
     * Fully clean up controller state, remove overlays, and clear cached detector data.
     */
    cleanup() {
        this.stop();
        this.discardCandidate();
        WaterDetector.clearCache();
    }

    // ── Internal Canvas & Event Handlers ──────────────────────────────────────

    async #onCanvasClick(ev) {
        const button = ev.data?.button ?? ev.button;
        if (button !== 0) return;

        const pos = ev.data?.getLocalPosition(canvas.stage)
            ?? ev.getLocalPosition?.(canvas.stage)
            ?? { x: ev.x, y: ev.y };

        const origEv = ev.data?.originalEvent ?? ev.originalEvent ?? ev;
        const shiftKey = origEv.shiftKey;
        const ctrlKey = origEv.ctrlKey || origEv.metaKey;

        // If a mask already exists and modifier key is pressed, refine
        if (this.#currentMaskData && (shiftKey || ctrlKey)) {
            const mode = shiftKey ? 'add' : 'subtract';
            await this.#runRefine(pos.x, pos.y, mode);
            return;
        }

        // When editing an existing region, default click to 'add' to protect existing boundary
        if (this.#editingRegionId && this.#currentMaskData) {
            await this.#runRefine(pos.x, pos.y, 'add');
            return;
        }

        // Fresh flood fill
        this.#seedPoint = { x: pos.x, y: pos.y };
        await this.#runFloodFill();
    }

    #onKeyDown(ev) {
        if (ev.key === 'z' && (ev.ctrlKey || ev.metaKey) && !ev.shiftKey) {
            ev.preventDefault();
            ev.stopPropagation();
            this.undo();
        }
    }

    #debouncedFill() {
        if (this.#debounceTimer) clearTimeout(this.#debounceTimer);
        this.#debounceTimer = setTimeout(() => this.#runFloodFill(), 200);
    }

    async #runFloodFill() {
        if (!this.#seedPoint) return;

        this.clearPreviews();

        // Generate flood preview mask sprite
        const sprite = await WaterDetector.generateFloodPreview(
            this.#seedPoint.x, this.#seedPoint.y, this.tolerance
        );
        if (sprite) {
            const layer = canvas.controls ?? canvas.stage;
            layer.addChild(sprite);
            this.#previewSprite = sprite;
        }

        // Generate polygon contour candidate
        try {
            this.#currentCandidate = await WaterDetector.floodFillFromPoint(
                this.#seedPoint.x, this.#seedPoint.y, this.tolerance, 4, this.smoothing
            );
            this.#currentMaskData = this.#currentCandidate?.maskData ?? null;
        } catch (err) {
            console.error('Waterline | Flood fill error:', err);
            this.#currentCandidate = null;
            this.#currentMaskData = null;
        }

        if (this.#currentCandidate) {
            this.#showPolyPreview(this.#currentCandidate);
            this.#callbacks.onCandidate?.(this.#currentCandidate);
        } else {
            this.#callbacks.onClear?.();
        }
    }

    async #runRefine(sceneX, sceneY, mode) {
        if (!this.#currentMaskData) return;

        // Snapshot current mask and candidate for undo
        this.#pushUndoSnapshot();

        try {
            const refined = await WaterDetector.refineMask(
                this.#currentMaskData, sceneX, sceneY, mode, this.tolerance, this.smoothing
            );
            if (!refined) {
                ui.notifications.info(`Waterline | No change from ${mode} operation.`);
                return;
            }

            this.#currentCandidate = refined;
            this.#currentMaskData = refined.maskData;

            this.clearPreviews();
            const sprite = WaterDetector.previewFromMask(this.#currentMaskData);
            if (sprite) {
                const layer = canvas.controls ?? canvas.stage;
                layer.addChild(sprite);
                this.#previewSprite = sprite;
            }

            this.#showPolyPreview(this.#currentCandidate);
            this.#callbacks.onCandidate?.(this.#currentCandidate);
        } catch (err) {
            console.error(`Waterline | Refine (${mode}) error:`, err);
        }
    }

    #showPolyPreview(candidate) {
        if (!candidate?.points?.length) return;

        if (this.#polyPreview?.parent) {
            this.#polyPreview.parent.removeChild(this.#polyPreview);
        }
        this.#polyPreview?.destroy();

        const gfx = new PIXI.Graphics();
        gfx.beginFill(0x2a6496, 0.15);
        gfx.lineStyle(2, 0x4a9ad9, 0.8);

        const pts = candidate.points;
        gfx.moveTo(pts[0], pts[1]);
        for (let i = 2; i < pts.length; i += 2) {
            gfx.lineTo(pts[i], pts[i + 1]);
        }
        gfx.closePath();
        gfx.endFill();

        const layer = canvas.controls ?? canvas.stage;
        layer.addChild(gfx);
        this.#polyPreview = gfx;
    }
}
