import { WaterDetector } from './WaterDetector.js';
import { WATER_PRESETS } from './WaterManager.js';

const MODULE_ID = 'ionrift-waterline';

/**
 * Unified Water Configuration Dialog.
 * Single panel for zone management (add/remove) and FX tuning.
 * v1: All zones share the same FX settings.
 */
export class WaterConfigDialog extends Dialog {

    /** @type {object|null} Current flood fill candidate */
    #currentCandidate = null;

    /** @type {PIXI.Sprite|null} Live flood preview */
    #previewSprite = null;

    /** @type {PIXI.Graphics|null} Candidate polygon overlay */
    #polyPreview = null;

    /** @type {{ x: number, y: number }|null} Current seed point */
    #seedPoint = null;

    /** @type {Function|null} Canvas click handler ref */
    #canvasHandler = null;

    /** @type {boolean} Whether click mode is active */
    #clickModeActive = false;

    /** @type {number} Debounce timer */
    #debounceTimer = null;

    /** @type {number} Zone counter */
    #zoneCount = 0;

    /** @type {Array<{region: RegionDocument, name: string, verts: number}>} Tracked zones */
    #zones = [];

    /** @type {object|null} Current cell mask data { mask, cols, rows, gridStep } */
    #currentMaskData = null;

    /** @type {Uint8Array[]} Undo stack of mask snapshots */
    #undoStack = [];

    /** @type {Function|null} Keyboard handler for Ctrl+Z */
    #keyHandler = null;

    /** @type {WaterConfigDialog|null} */
    static _instance = null;

    constructor() {
        super({
            title: 'Waterline',
            content: WaterConfigDialog.#buildHtml(),
            buttons: {},
            render: (html) => this.#onRender(html)
        }, {
            width: 400,
            resizable: true,
            classes: ['ionrift-window', 'water-config-dialog']
        });
        WaterConfigDialog._instance = this;
    }

    static show() {
        if (!game.user.isGM) return;
        WaterConfigDialog.closeIfOpen();
        new WaterConfigDialog().render(true);
    }

    /** Close the dialog if open (called on scene change). */
    static closeIfOpen() {
        if (WaterConfigDialog._instance) {
            try { WaterConfigDialog._instance.close(); } catch (_) {}
            WaterConfigDialog._instance = null;
        }
    }

    // ------------------------------------------------------------------
    // HTML
    // ------------------------------------------------------------------

    static #buildHtml() {
        return `
            <form class="water-config-form">
                <div class="water-config-body">

                    <!-- Zone Management -->
                    <div class="wc-section">
                        <h3><i class="fas fa-water"></i> Water Zones</h3>
                        <div class="wc-zone-list ionrift-list"></div>
                        <p class="wc-empty-hint">No water zones on this scene. Use Add Zone to get started.</p>
                    </div>

                    <!-- Add Zone (pick mode) -->
                    <div class="wc-section wc-add-section">
                        <h3><i class="fas fa-plus-circle"></i> Add Zone</h3>
                        <div class="wc-pick-controls hidden">
                            <div class="form-group">
                                <label title="How far from the clicked color the fill spreads">Tolerance</label>
                                <input type="range" name="tolerance" min="1" max="120" value="40" step="1" />
                                <span class="range-value">40</span>
                            </div>
                            <div class="form-group">
                                <label title="Edge smoothing. Lower = detailed, higher = cleaner">Smoothing</label>
                                <input type="range" name="smoothing" min="0.5" max="15" value="7.0" step="0.5" />
                                <span class="range-value">7.0</span>
                            </div>
                        </div>

                        <button type="button" class="cartograph-btn cartograph-btn-pick">
                            <i class="fas fa-crosshairs"></i> Start Picking
                        </button>

                        <div class="wc-candidate hidden">
                            <div class="wc-candidate-header">
                                <i class="fas fa-water"></i>
                                <span class="wc-candidate-info"></span>
                            </div>
                            <p class="wc-vert-warning hidden">
                                <i class="fas fa-exclamation-triangle"></i>
                                High vertex count may impact performance. Increase Smoothing to reduce.
                            </p>
                            <div class="wc-candidate-actions">
                                <button type="button" class="cartograph-btn cartograph-btn-accept">
                                    <i class="fas fa-check"></i> Accept
                                </button>
                                <button type="button" class="cartograph-btn cartograph-btn-discard">
                                    <i class="fas fa-times"></i> Discard
                                </button>
                            </div>
                            <p class="wc-refine-hint">
                                <i class="fas fa-mouse-pointer"></i>
                                <strong>Shift+Click</strong> add &bull; <strong>Ctrl+Click</strong> subtract &bull; <strong>Ctrl+Z</strong> undo
                            </p>
                        </div>
                    </div>

                    <!-- FX Controls -->
                    <div class="wc-section wc-fx-section">
                        <h3><i class="fas fa-sliders-h"></i> Animation</h3>

                        <div class="wc-preset-row">
                            <label>Preset</label>
                            <select name="waterType"></select>
                            <button type="button" class="wc-preset-btn wc-preset-save" title="Save current values as preset">
                                <i class="fas fa-save"></i>
                            </button>
                            <button type="button" class="wc-preset-btn wc-preset-delete hidden" title="Delete this custom preset">
                                <i class="fas fa-trash"></i>
                            </button>
                        </div>

                        <div class="wc-preset-save-prompt hidden">
                            <input type="text" name="presetName" class="wc-preset-name"
                                   placeholder="Preset name..." maxlength="30" />
                            <button type="button" class="cartograph-btn wc-preset-confirm">
                                <i class="fas fa-check"></i>
                            </button>
                            <button type="button" class="cartograph-btn wc-preset-cancel">
                                <i class="fas fa-times"></i>
                            </button>
                        </div>

                        <div class="form-group">
                            <label title="Wave animation speed">Speed</label>
                            <input type="range" name="speed" min="0.05" max="3.0" value="0.4" step="0.05" />
                            <span class="range-value">0.40</span>
                        </div>

                        <div class="form-group">
                            <label title="Wave amplitude">Intensity</label>
                            <input type="range" name="intensity" min="0.0" max="2.0" value="0.8" step="0.1" />
                            <span class="range-value">0.80</span>
                        </div>

                        <div class="form-group">
                            <label title="Overlay opacity">Opacity</label>
                            <input type="range" name="opacity" min="0.05" max="0.5" value="0.35" step="0.05" />
                            <span class="range-value">0.35</span>
                        </div>

                        <div class="form-group">
                            <label title="Background distortion amount">Distortion</label>
                            <input type="range" name="distortion" min="0.0" max="0.05" value="0.008" step="0.001" />
                            <span class="range-value">0.008</span>
                        </div>

                        <div class="form-group">
                            <label title="Width of the transparent edge blend">Edge Fade</label>
                            <input type="range" name="fadeWidth" min="0" max="200" value="50" step="5" />
                            <span class="range-value">50</span>
                        </div>

                        <div class="form-group">
                            <label title="Texture pattern size. Lower = more repetitive, higher = broader">Scale</label>
                            <input type="range" name="scale" min="30" max="400" value="150" step="10" />
                            <span class="range-value">150</span>
                        </div>

                        <div class="form-group">
                            <label title="Direction of water flow in degrees (0 = right, 90 = down, 180 = left, 270 = up)">Flow Direction</label>
                            <input type="range" name="flowAngle" min="0" max="355" value="0" step="5" />
                            <span class="range-value">0°</span>
                        </div>

                        <div class="form-group hidden">
                            <label title="Intensity of shore wave foam at polygon edges. 0 = off.">Shore Waves</label>
                            <input type="range" name="shoreWaves" min="0.0" max="1.0" value="0.0" step="0.1" />
                            <span class="range-value">0.0</span>
                        </div>

                        <div class="form-group">
                            <label title="Leave blank to auto-sample from map">Color</label>
                            <input type="color" name="colorOverride" value="#0d2e4d" />
                            <label class="color-auto-label">
                                <input type="checkbox" name="autoColor" checked /> Auto
                            </label>
                        </div>
                    </div>

                    <!-- Footer -->
                    <p class="wc-layer-hint">
                        <i class="fas fa-info-circle"></i>
                        Switch to the <strong>Token</strong> layer to preview without region hatching.
                    </p>

                    <div class="wc-footer-actions">
                        <button type="button" class="cartograph-btn cartograph-btn-preview-layer">
                            <i class="fas fa-eye"></i> Preview
                        </button>
                        <button type="button" class="cartograph-btn cartograph-btn-save-fx">
                            <i class="fas fa-save"></i> Save FX
                        </button>
                    </div>

                </div>
            </form>
        `;
    }

    // ------------------------------------------------------------------
    // Render
    // ------------------------------------------------------------------

    #onRender(html) {
        this._html = html;
        this.#detectExistingZones();
        this.#bindEvents(html);
        this.#refreshUI();
    }

    // ------------------------------------------------------------------
    // Event Binding
    // ------------------------------------------------------------------

    #bindEvents(html) {
        // Detection sliders
        html.find('input[name="tolerance"]').on('input', (ev) => {
            ev.target.nextElementSibling.textContent = ev.target.value;
            if (this.#seedPoint) this.#debouncedFill();
        });
        html.find('input[name="smoothing"]').on('input', (ev) => {
            ev.target.nextElementSibling.textContent = ev.target.value;
            if (this.#seedPoint) this.#debouncedFill();
        });

        // Pick mode
        html.find('.cartograph-btn-pick').on('click', () => {
            this.#clickModeActive ? this.#stopPickMode() : this.#startPickMode();
        });

        // Accept candidate
        html.find('.cartograph-btn-accept').on('click', async () => {
            if (!this.#currentCandidate) return;
            this.#zoneCount++;
            const name = `Water ${this.#zoneCount}`;
            const region = await WaterDetector.createRegionFromCandidate(
                this.#currentCandidate, name
            );
            if (region) {
                this.#zones.push({ region, name, verts: this.#currentCandidate.vertexCount });
                ui.notifications.info(`Waterline | Created ${name}.`);
            }
            this.#clearCurrentFill();
            this.#refreshUI();
        });

        // Discard candidate
        html.find('.cartograph-btn-discard').on('click', () => {
            this.#clearCurrentFill();
        });

        // FX preset selector - handles both built-in and custom presets
        html.find('select[name="waterType"]').on('change', (ev) => {
            const key = ev.target.value;
            if (!key || key === 'custom') {
                this.#toggleDeleteButton(false);
                return;
            }

            // Check built-in presets first
            const builtIn = WATER_PRESETS[key];
            if (builtIn) {
                this.#applyPresetValues(builtIn);
                this.#toggleDeleteButton(false);
                return;
            }

            // Check custom presets
            const customs = this.#getCustomPresets();
            const custom = customs[key];
            if (custom) {
                this.#applyPresetValues(custom);
                if (custom.colorOverride && !custom.autoColor) {
                    html.find('input[name="autoColor"]').prop('checked', false);
                    html.find('input[name="colorOverride"]').prop('disabled', false).val(custom.colorOverride);
                } else {
                    html.find('input[name="autoColor"]').prop('checked', true);
                    html.find('input[name="colorOverride"]').prop('disabled', true);
                }
                this.#toggleDeleteButton(true);
            }
        });

        // Preset save button - show the name prompt
        html.find('.wc-preset-save').on('click', () => this.#showSavePrompt());

        // Preset save confirm
        html.find('.wc-preset-confirm').on('click', async () => {
            const name = html.find('input[name="presetName"]').val()?.trim();
            if (!name) {
                ui.notifications.warn('Waterline | Enter a preset name.');
                return;
            }
            await this.#saveCustomPreset(name);
            this.#hideSavePrompt();
        });

        // Preset save cancel
        html.find('.wc-preset-cancel').on('click', () => this.#hideSavePrompt());

        // Preset save on Enter key
        html.find('input[name="presetName"]').on('keydown', async (ev) => {
            if (ev.key === 'Enter') {
                ev.preventDefault();
                html.find('.wc-preset-confirm').trigger('click');
            } else if (ev.key === 'Escape') {
                this.#hideSavePrompt();
            }
        });

        // Preset delete
        html.find('.wc-preset-delete').on('click', async () => {
            const key = html.find('select[name="waterType"]').val();
            if (!key) return;
            // Only allow deleting custom presets
            if (WATER_PRESETS[key]) return;
            await this.#deleteCustomPreset(key);
        });

        // Populate the preset dropdown
        this.#refreshPresetDropdown();

        // FX sliders live update
        html.find('.wc-fx-section input[type="range"]').on('input', (ev) => {
            const val = parseFloat(ev.target.value);
            const name = ev.target.name;
            const step = ev.target.step;
            let display;
            if (name === 'flowAngle') {
                display = `${Math.round(val)}°`;
            } else {
                display = val.toFixed(
                    step.includes('.') ? step.split('.')[1].length : 0
                );
            }
            ev.target.nextElementSibling.textContent = display;
            html.find('select[name="waterType"]').val('custom');
            this.#toggleDeleteButton(false);
            this.#liveUpdateFX();
        });

        // Auto-color toggle
        html.find('input[name="autoColor"]').on('change', (ev) => {
            html.find('input[name="colorOverride"]').prop('disabled', ev.target.checked);
        });

        // Delete zone (delegated)
        html.find('.wc-zone-list').on('click', '.wc-zone-delete', async (ev) => {
            const idx = parseInt(ev.currentTarget.dataset.index);
            const zone = this.#zones[idx];
            if (!zone) return;

            // Delete the Foundry region
            if (zone.region) {
                try {
                    await zone.region.delete();
                } catch (err) {
                    console.error('Waterline | Failed to delete region:', err);
                }
            }
            this.#zones.splice(idx, 1);
            this.#refreshUI();
            ui.notifications.info(`Waterline | Removed ${zone.name}.`);
        });

        // Preview (switch to token layer)
        html.find('.cartograph-btn-preview-layer').on('click', () => {
            this.#stopPickMode();
            this.#clearPreview();
            this.#clearPolyPreview();
            if (ui.controls) {
                const tc = ui.controls.controls.find(c => c.name === 'token');
                if (tc) {
                    ui.controls.activeControl = 'token';
                    canvas.tokens?.activate();
                    ui.controls.render();
                }
            }
        });

        // Save FX to region behaviors
        html.find('.cartograph-btn-save-fx').on('click', async () => {
            await this.#saveFXToRegions();
        });


    }

    // ------------------------------------------------------------------
    // Existing Zone Detection
    // ------------------------------------------------------------------

    #detectExistingZones() {
        const behaviorType = `${MODULE_ID}.waterFX`;
        const regions = canvas.scene?.regions ?? [];

        for (const region of regions) {
            const hasWater = region.behaviors?.some(b => b.type === behaviorType);
            if (!hasWater) continue;
            if (this.#zones.some(z => z.region?.id === region.id)) continue;

            this.#zoneCount++;
            this.#zones.push({
                region,
                name: region.name || `Water ${this.#zoneCount}`,
                verts: 0
            });
        }

        // Load FX values from first zone's behavior if available
        if (this.#zones.length) {
            const firstBehavior = this.#zones[0].region?.behaviors
                ?.find(b => b.type === `${MODULE_ID}.waterFX`);
            if (firstBehavior?.system) {
                const s = firstBehavior.system;
                const html = this._html;
                if (s.waterType) html.find('select[name="waterType"]').val(s.waterType);
                if (s.speed != null) this.#setSlider('speed', s.speed);
                if (s.intensity != null) this.#setSlider('intensity', s.intensity);
                if (s.opacity != null) this.#setSlider('opacity', s.opacity);
                if (s.distortion != null) this.#setSlider('distortion', s.distortion);
                if (s.fadeWidth != null) this.#setSlider('fadeWidth', s.fadeWidth);
                if (s.scale != null) this.#setSlider('scale', s.scale);
                if (s.flowAngle != null) this.#setSlider('flowAngle', s.flowAngle);
                if (s.shoreWaves != null) this.#setSlider('shoreWaves', s.shoreWaves);
                if (s.colorOverride) {
                    html.find('input[name="colorOverride"]').val(s.colorOverride);
                    html.find('input[name="autoColor"]').prop('checked', false);
                    html.find('input[name="colorOverride"]').prop('disabled', false);
                }
            }
        }
    }

    // ------------------------------------------------------------------
    // UI Refresh
    // ------------------------------------------------------------------

    #refreshUI() {
        const html = this._html;
        const list = html.find('.wc-zone-list');
        const emptyHint = html.find('.wc-empty-hint');
        list.empty();

        if (this.#zones.length) {
            emptyHint.addClass('hidden');
            for (let i = 0; i < this.#zones.length; i++) {
                const z = this.#zones[i];
                const vertInfo = z.verts ? `${z.verts} verts` : '';
                list.append(`
                    <div class="wc-zone-item">
                        <i class="fas fa-check-circle"></i>
                        <span class="zone-name">${z.name}</span>
                        <span class="zone-meta">${vertInfo}</span>
                        <button type="button" class="wc-zone-delete" data-index="${i}"
                                title="Delete this water zone">
                            <i class="fas fa-trash"></i>
                        </button>
                    </div>
                `);
            }
        } else {
            emptyHint.removeClass('hidden');
        }

        this.setPosition({ height: 'auto' });
    }

    // ------------------------------------------------------------------
    // Pick Mode
    // ------------------------------------------------------------------

    #startPickMode() {
        this.#clickModeActive = true;
        const btn = this._html.find('.cartograph-btn-pick');
        btn.html('<i class="fas fa-stop"></i> Stop Picking');
        btn.addClass('pick-active');
        this._html.find('.wc-pick-controls').removeClass('hidden');

        this.#canvasHandler = (ev) => this.#onCanvasClick(ev);
        canvas.stage.on('pointerdown', this.#canvasHandler);

        this.#keyHandler = (ev) => this.#onKeyDown(ev);
        document.addEventListener('keydown', this.#keyHandler);

        ui.notifications.info('Waterline | Click on water in the scene.');
    }

    #stopPickMode() {
        this.#clickModeActive = false;
        const btn = this._html.find('.cartograph-btn-pick');
        btn.html('<i class="fas fa-crosshairs"></i> Start Picking');
        btn.removeClass('pick-active');
        this._html.find('.wc-pick-controls').addClass('hidden');

        if (this.#canvasHandler) {
            canvas.stage.off('pointerdown', this.#canvasHandler);
            this.#canvasHandler = null;
        }
        if (this.#keyHandler) {
            document.removeEventListener('keydown', this.#keyHandler);
            this.#keyHandler = null;
        }
    }

    async #onCanvasClick(ev) {
        const button = ev.data?.button ?? ev.button;
        if (button !== 0) return;

        const pos = ev.data?.getLocalPosition(canvas.stage)
            ?? ev.getLocalPosition?.(canvas.stage)
            ?? { x: ev.x, y: ev.y };

        const origEv = ev.data?.originalEvent ?? ev.originalEvent ?? ev;
        const shiftKey = origEv.shiftKey;
        const ctrlKey = origEv.ctrlKey || origEv.metaKey;

        // If we have a mask and a modifier key, refine instead of fresh fill
        if (this.#currentMaskData && (shiftKey || ctrlKey)) {
            const mode = shiftKey ? 'add' : 'subtract';
            await this.#runRefine(pos.x, pos.y, mode);
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
            this.#undoRefine();
        }
    }

    async #undoRefine() {
        if (!this.#undoStack.length || !this.#currentMaskData) {
            ui.notifications.info('Waterline | Nothing to undo.');
            return;
        }

        // Restore previous mask
        this.#currentMaskData.mask = this.#undoStack.pop();

        const smoothing = parseFloat(this._html.find('input[name="smoothing"]').val());
        const candidate = WaterDetector.candidateFromMask(this.#currentMaskData, smoothing);
        if (!candidate) return;

        candidate.maskData = this.#currentMaskData;
        this.#currentCandidate = candidate;

        // Rebuild preview
        this.#clearPreview();
        const sprite = WaterDetector.previewFromMask(this.#currentMaskData);
        if (sprite) {
            const layer = canvas.controls ?? canvas.stage;
            layer.addChild(sprite);
            this.#previewSprite = sprite;
        }

        this.#showPolyPreview(this.#currentCandidate);
        const candidateEl = this._html.find('.wc-candidate');
        const verts = this.#currentCandidate.vertexCount;
        candidateEl.find('.wc-candidate-info').text(
            `${verts} vertices, ~${this.#currentCandidate.area} cells`
        );
        const warnEl = candidateEl.find('.wc-vert-warning');
        verts > 60 ? warnEl.removeClass('hidden') : warnEl.addClass('hidden');

        ui.notifications.info(`Waterline | Undo (${this.#undoStack.length} remaining).`);
    }

    // ------------------------------------------------------------------
    // Flood Fill
    // ------------------------------------------------------------------

    #debouncedFill() {
        if (this.#debounceTimer) clearTimeout(this.#debounceTimer);
        this.#debounceTimer = setTimeout(() => this.#runFloodFill(), 200);
    }

    async #runFloodFill() {
        if (!this.#seedPoint) return;

        const tolerance = parseInt(this._html.find('input[name="tolerance"]').val());
        const smoothing = parseFloat(this._html.find('input[name="smoothing"]').val());

        this.#clearPreview();

        // Preview mask
        const sprite = await WaterDetector.generateFloodPreview(
            this.#seedPoint.x, this.#seedPoint.y, tolerance
        );
        if (sprite) {
            const layer = canvas.controls ?? canvas.stage;
            layer.addChild(sprite);
            this.#previewSprite = sprite;
        }

        // Candidate polygon
        try {
            this.#currentCandidate = await WaterDetector.floodFillFromPoint(
                this.#seedPoint.x, this.#seedPoint.y, tolerance, 4, smoothing
            );
            // Store the mask data for future refinement
            this.#currentMaskData = this.#currentCandidate?.maskData ?? null;
        } catch (err) {
            console.error('Waterline | Flood fill error:', err);
            this.#currentCandidate = null;
            this.#currentMaskData = null;
        }

        const candidateEl = this._html.find('.wc-candidate');

        if (this.#currentCandidate) {
            const verts = this.#currentCandidate.vertexCount;
            candidateEl.find('.wc-candidate-info').text(
                `${verts} vertices, ~${this.#currentCandidate.area} cells`
            );

            const warnEl = candidateEl.find('.wc-vert-warning');
            verts > 60 ? warnEl.removeClass('hidden') : warnEl.addClass('hidden');

            this.#showPolyPreview(this.#currentCandidate);
            candidateEl.removeClass('hidden');
        } else {
            candidateEl.addClass('hidden');
        }

        this.setPosition({ height: 'auto' });
    }

    /**
     * Refine the current mask by adding or subtracting from a click point.
     */
    async #runRefine(sceneX, sceneY, mode) {
        if (!this.#currentMaskData) return;

        // Snapshot current mask for undo before modifying
        const snapshot = new Uint8Array(this.#currentMaskData.mask);
        this.#undoStack.push(snapshot);
        if (this.#undoStack.length > 20) this.#undoStack.shift();

        const tolerance = parseInt(this._html.find('input[name="tolerance"]').val());
        const smoothing = parseFloat(this._html.find('input[name="smoothing"]').val());

        try {
            const refined = await WaterDetector.refineMask(
                this.#currentMaskData, sceneX, sceneY, mode, tolerance, smoothing
            );
            if (!refined) {
                ui.notifications.info(`Waterline | No change from ${mode} operation.`);
                return;
            }

            this.#currentCandidate = refined;
            this.#currentMaskData = refined.maskData;

            // Update preview from the mask
            this.#clearPreview();
            const sprite = WaterDetector.previewFromMask(this.#currentMaskData);
            if (sprite) {
                const layer = canvas.controls ?? canvas.stage;
                layer.addChild(sprite);
                this.#previewSprite = sprite;
            }

            // Update candidate info
            this.#showPolyPreview(this.#currentCandidate);
            const candidateEl = this._html.find('.wc-candidate');
            const verts = this.#currentCandidate.vertexCount;
            candidateEl.find('.wc-candidate-info').text(
                `${verts} vertices, ~${this.#currentCandidate.area} cells`
            );
            const warnEl = candidateEl.find('.wc-vert-warning');
            verts > 60 ? warnEl.removeClass('hidden') : warnEl.addClass('hidden');
        } catch (err) {
            console.error(`Waterline | Refine (${mode}) error:`, err);
        }
    }

    // ------------------------------------------------------------------
    // Live FX Update
    // ------------------------------------------------------------------

    #liveUpdateFX() {
        const tune = game.ionrift?.waterTune;
        if (!tune) return;

        const html = this._html;
        tune.speed(parseFloat(html.find('input[name="speed"]').val()));
        tune.intensity(parseFloat(html.find('input[name="intensity"]').val()));
        tune.opacity(parseFloat(html.find('input[name="opacity"]').val()));
        if (tune.distortion) tune.distortion(parseFloat(html.find('input[name="distortion"]').val()));
        if (tune.fadeWidth) tune.fadeWidth(parseFloat(html.find('input[name="fadeWidth"]').val()));
        if (tune.scale) tune.scale(parseFloat(html.find('input[name="scale"]').val()));
        if (tune.flowAngle) tune.flowAngle(parseInt(html.find('input[name="flowAngle"]').val()));
        if (tune.shoreWaves) tune.shoreWaves(parseFloat(html.find('input[name="shoreWaves"]').val()));
    }

    // ------------------------------------------------------------------
    // Save FX
    // ------------------------------------------------------------------

    async #saveFXToRegions() {
        const html = this._html;
        const waterType = html.find('select[name="waterType"]').val();
        const speed = parseFloat(html.find('input[name="speed"]').val());
        const intensity = parseFloat(html.find('input[name="intensity"]').val());
        const opacity = parseFloat(html.find('input[name="opacity"]').val());
        const distortion = parseFloat(html.find('input[name="distortion"]').val());
        const fadeWidth = parseFloat(html.find('input[name="fadeWidth"]').val());
        const scale = parseFloat(html.find('input[name="scale"]').val());
        const flowAngle = parseInt(html.find('input[name="flowAngle"]').val());
        const shoreWaves = parseFloat(html.find('input[name="shoreWaves"]').val());
        const autoColor = html.find('input[name="autoColor"]').prop('checked');
        const colorOverride = autoColor ? '' : html.find('input[name="colorOverride"]').val();

        const behaviorType = `${MODULE_ID}.waterFX`;
        let updated = 0;

        for (const zone of this.#zones) {
            const region = zone.region;
            if (!region) continue;
            const behavior = region.behaviors?.find(b => b.type === behaviorType);
            if (!behavior) continue;

            try {
                await behavior.update({
                    system: { waterType, speed, intensity, opacity, distortion, fadeWidth, scale, flowAngle, shoreWaves, colorOverride }
                });
                updated++;
            } catch (err) {
                console.error(`Waterline | Failed to update ${zone.name}:`, err);
            }
        }

        ui.notifications.info(`Waterline | Saved FX to ${updated} zone(s).`);
    }

    // ------------------------------------------------------------------
    // Helpers
    // ------------------------------------------------------------------

    #setSlider(name, value) {
        const input = this._html.find(`input[name="${name}"]`);
        input.val(value);
        if (name === 'flowAngle') {
            input[0].nextElementSibling.textContent = `${Math.round(value)}°`;
        } else {
            const step = input.attr('step');
            const decimals = step && step.includes('.') ? step.split('.')[1].length : 0;
            input[0].nextElementSibling.textContent = value.toFixed(decimals);
        }
    }

    // ------------------------------------------------------------------
    // Custom Presets
    // ------------------------------------------------------------------

    #getCustomPresets() {
        return game.settings.get(MODULE_ID, 'waterCustomPresets') ?? {};
    }

    #refreshPresetDropdown() {
        const select = this._html.find('select[name="waterType"]');
        const currentVal = select.val();
        select.empty();

        // Built-in optgroup
        const builtInGroup = $('<optgroup label="Built-in"></optgroup>');
        for (const [key, p] of Object.entries(WATER_PRESETS)) {
            builtInGroup.append(`<option value="${key}">${p.label}</option>`);
        }
        select.append(builtInGroup);

        // Custom optgroup (only if presets exist)
        const customs = this.#getCustomPresets();
        const customKeys = Object.keys(customs);
        if (customKeys.length) {
            const customGroup = $('<optgroup label="Custom"></optgroup>');
            for (const key of customKeys) {
                customGroup.append(`<option value="${key}">${customs[key].name}</option>`);
            }
            select.append(customGroup);
        }

        // Restore previous selection if still valid
        if (currentVal && select.find(`option[value="${currentVal}"]`).length) {
            select.val(currentVal);
        } else {
            select.val('custom');
        }

        // Update delete button visibility
        const selectedKey = select.val();
        this.#toggleDeleteButton(selectedKey && !WATER_PRESETS[selectedKey] && customs[selectedKey]);
    }

    #toggleDeleteButton(show) {
        const btn = this._html.find('.wc-preset-delete');
        show ? btn.removeClass('hidden') : btn.addClass('hidden');
    }

    #showSavePrompt() {
        const prompt = this._html.find('.wc-preset-save-prompt');
        prompt.removeClass('hidden');
        prompt.find('input[name="presetName"]').val('').focus();
        this.setPosition({ height: 'auto' });
    }

    #hideSavePrompt() {
        const prompt = this._html.find('.wc-preset-save-prompt');
        prompt.addClass('hidden');
        prompt.find('input[name="presetName"]').val('');
        this.setPosition({ height: 'auto' });
    }

    #getCurrentFXValues() {
        const html = this._html;
        return {
            speed: parseFloat(html.find('input[name="speed"]').val()),
            intensity: parseFloat(html.find('input[name="intensity"]').val()),
            opacity: parseFloat(html.find('input[name="opacity"]').val()),
            distortion: parseFloat(html.find('input[name="distortion"]').val()),
            fadeWidth: parseFloat(html.find('input[name="fadeWidth"]').val()),
            scale: parseFloat(html.find('input[name="scale"]').val()),
            flowAngle: parseInt(html.find('input[name="flowAngle"]').val()),
            shoreWaves: parseFloat(html.find('input[name="shoreWaves"]').val()),
            autoColor: html.find('input[name="autoColor"]').prop('checked'),
            colorOverride: html.find('input[name="colorOverride"]').val()
        };
    }

    #applyPresetValues(preset) {
        if (preset.speed != null) this.#setSlider('speed', preset.speed);
        if (preset.intensity != null) this.#setSlider('intensity', preset.intensity);
        if (preset.opacity != null) this.#setSlider('opacity', preset.opacity);
        if (preset.distortion != null) this.#setSlider('distortion', preset.distortion);
        if (preset.fadeWidth != null) this.#setSlider('fadeWidth', preset.fadeWidth);
        if (preset.scale != null) this.#setSlider('scale', preset.scale);
        if (preset.flowAngle != null) this.#setSlider('flowAngle', preset.flowAngle);
        if (preset.shoreWaves != null) this.#setSlider('shoreWaves', preset.shoreWaves);
        this.#liveUpdateFX();
    }

    async #saveCustomPreset(name) {
        const presets = this.#getCustomPresets();
        const key = `user_${name.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '')}`;
        presets[key] = {
            name,
            ...this.#getCurrentFXValues()
        };
        await game.settings.set(MODULE_ID, 'waterCustomPresets', presets);
        this.#refreshPresetDropdown();
        this._html.find('select[name="waterType"]').val(key);
        this.#toggleDeleteButton(true);
        ui.notifications.info(`Waterline | Saved preset "${name}".`);
    }

    async #deleteCustomPreset(key) {
        const presets = this.#getCustomPresets();
        const name = presets[key]?.name ?? key;
        delete presets[key];
        await game.settings.set(MODULE_ID, 'waterCustomPresets', presets);
        this.#refreshPresetDropdown();
        this._html.find('select[name="waterType"]').val('custom');
        this.#toggleDeleteButton(false);
        ui.notifications.info(`Waterline | Deleted preset "${name}".`);
    }

    // ------------------------------------------------------------------
    // Preview Drawing
    // ------------------------------------------------------------------

    #showPolyPreview(candidate) {
        this.#clearPolyPreview();
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

    #clearPreview() {
        if (this.#previewSprite?.parent) {
            this.#previewSprite.parent.removeChild(this.#previewSprite);
        }
        this.#previewSprite?.destroy(true);
        this.#previewSprite = null;
    }

    #clearPolyPreview() {
        if (this.#polyPreview?.parent) {
            this.#polyPreview.parent.removeChild(this.#polyPreview);
        }
        this.#polyPreview?.destroy();
        this.#polyPreview = null;
    }

    #clearCurrentFill() {
        this.#currentCandidate = null;
        this.#currentMaskData = null;
        this.#undoStack.length = 0;
        this.#seedPoint = null;
        this.#clearPreview();
        this.#clearPolyPreview();
        this._html?.find('.wc-candidate').addClass('hidden');
    }

    // ------------------------------------------------------------------
    // Cleanup
    // ------------------------------------------------------------------

    close(options) {
        this.#stopPickMode();
        this.#clearCurrentFill();
        if (this.#debounceTimer) clearTimeout(this.#debounceTimer);
        WaterDetector.clearCache();
        WaterConfigDialog._instance = null;
        return super.close(options);
    }
}
