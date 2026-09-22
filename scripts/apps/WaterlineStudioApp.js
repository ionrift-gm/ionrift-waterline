import { WaterSamplingController } from '../controllers/WaterSamplingController.js';
import { WATER_PRESETS } from '../water/WaterManager.js';
import { WakeTuning } from '../water/WakeTuning.js';
import { BorderGenerator } from '../border/BorderGenerator.js';

const MODULE_ID = 'ionrift-waterline';

/**
 * Unified Waterline UI (ApplicationV2).
 * Consolidates Water Zones & Animation FX, Wake & Ripples, and Shoreline Borders
 * into a single cohesive, tabbed workspace.
 */
export class WaterlineStudioApp extends foundry.applications.api.ApplicationV2 {

    /** @type {WaterlineStudioApp|null} */
    static _instance = null;

    /** @type {string} Current active tab: 'water' | 'wake' | 'borders' */
    activeTab = 'water';

    /** @type {WaterSamplingController} */
    sampler = null;

    /** @type {boolean} Track unsaved water FX changes */
    hasUnsavedChanges = false;

    /** @type {string} Active water preset key */
    activePreset = 'river';

    /** @type {string|null} Active wake preset name */
    activeWakePreset = null;

    /** @type {boolean} Show water preset save prompt */
    showPresetPrompt = false;

    /** @type {boolean} Show wake preset save prompt */
    showWakePresetPrompt = false;

    /** @type {number|null} RequestAnimationFrame id for live uniform updates */
    #rafId = null;

    /** @type {object} Current water animation FX parameters */
    fx = {
        speed: 1.40,
        intensity: 0.25,
        opacity: 0.15,
        distortion: 0.035,
        fadeWidth: 60,
        scale: 90,
        flowAngle: 90,
        shoreWaves: 0.15,
        colorOverride: '#0d2e4d',
        autoColor: true
    };

    /** @type {object} Current border generator configuration */
    borderConfig = {
        totalVertices: 29,
        amplitude: 244,
        jitter: 0.5,
        inset: 7
    };

    static DEFAULT_OPTIONS = {
        id: 'ionrift-waterline-studio',
        tag: 'div',
        window: {
            title: 'Waterline',
            icon: 'fas fa-water',
            resizable: true
        },
        position: {
            width: 480,
            height: 'auto'
        },
        classes: ['ionrift-window', 'waterline-studio-dialog']
    };

    constructor(options = {}) {
        super(options);
        WaterlineStudioApp._instance = this;
        this.activeTab = options.tab ?? 'water';

        // Load saved border configuration
        const savedBorder = game.settings.get(MODULE_ID, 'borderConfig');
        if (savedBorder) this.borderConfig = { ...this.borderConfig, ...savedBorder };

        // Initialize sampling controller
        this.sampler = new WaterSamplingController();

        // Load existing scene parameters into local fx
        this.#loadSceneFX();
    }

    /**
     * Primary entry point to launch or focus Waterline.
     * @param {object} [options]
     * @param {string} [options.tab='water']
     */
    static show(options = {}) {
        if (!game.user.isGM) return;

        let app = foundry.applications.instances.get('ionrift-waterline-studio')
            ?? WaterlineStudioApp._instance;

        if (!app) {
            app = new WaterlineStudioApp(options);
        } else if (options.tab) {
            app.activeTab = options.tab;
        }

        app.render({ force: true });
        return app;
    }

    /**
     * Close Waterline if open.
     */
    static closeIfOpen() {
        const app = foundry.applications.instances.get('ionrift-waterline-studio')
            ?? WaterlineStudioApp._instance;
        if (app) {
            try { app.close({ force: true }); } catch { /* ignore */ }
        }
        WaterlineStudioApp._instance = null;
    }

    // ------------------------------------------------------------------
    // Context Preparation
    // ------------------------------------------------------------------

    /** @override */
    async _prepareContext(options) {
        // Collect current scene water zones
        const behaviorType = `${MODULE_ID}.waterFX`;
        const regions = canvas.scene?.regions?.contents ?? canvas.scene?.regions ?? [];
        const zones = [];

        for (const region of regions) {
            const behaviors = region.behaviors?.contents ?? region.behaviors ?? [];
            const hasWater = Array.isArray(behaviors) ? behaviors.some(b => b.type === behaviorType) : false;
            if (!hasWater) continue;
            zones.push({
                region,
                name: region.name || 'Water Zone',
                verts: region.shapes?.[0]?.points?.length ? Math.round(region.shapes[0].points.length / 2) : 0
            });
        }

        // Water presets
        const customPresets = game.settings.get(MODULE_ID, 'waterCustomPresets') ?? {};
        const customPresetsList = Object.entries(customPresets).map(([key, data]) => ({
            key,
            name: data.name ?? key
        }));

        // Wake settings and presets
        const wake = WakeTuning.get();
        const wakePresets = WakeTuning.listPresets();

        return {
            activeTab: this.activeTab,
            zones,
            pickActive: this.sampler.isActive,
            pickTolerance: this.sampler.tolerance,
            pickSmoothing: this.sampler.smoothing,
            candidate: this.sampler.candidate,
            builtInPresets: WATER_PRESETS,
            customPresetsList,
            activePreset: this.activePreset,
            isCustomPresetSelected: Boolean(customPresets[this.activePreset]),
            showPresetPrompt: this.showPresetPrompt,
            fx: this.fx,
            wake,
            wakePresets,
            activeWakePreset: this.activeWakePreset,
            showWakePresetPrompt: this.showWakePresetPrompt,
            border: this.borderConfig
        };
    }

    /** @override */
    async _renderHTML(context, options) {
        const templatePath = `modules/${MODULE_ID}/templates/studio.hbs`;
        const htmlString = await renderTemplate(templatePath, context);
        const el = document.createElement('div');
        el.className = 'waterline-studio-root';
        el.innerHTML = htmlString;
        this.#wireListeners(el);
        return el;
    }

    /** @override */
    _replaceHTML(result, content, options) {
        content.replaceChildren(result);
    }

    // ------------------------------------------------------------------
    // Event Wiring
    // ------------------------------------------------------------------

    #wireListeners(root) {
        // Navigation tab switching
        root.querySelectorAll('.waterline-tabs [data-tab]').forEach(tabEl => {
            tabEl.addEventListener('click', (ev) => {
                ev.preventDefault();
                this.activeTab = tabEl.dataset.tab;
                this.render();
            });
        });

        // Pick mode toggle
        root.querySelector('[data-action="togglePick"]')?.addEventListener('click', () => {
            if (this.sampler.isActive) {
                this.sampler.stop();
                this.render();
            } else {
                this.sampler.start(
                    { tolerance: this.sampler.tolerance, smoothing: this.sampler.smoothing },
                    {
                        onCandidate: () => this.render(),
                        onClear: () => this.render(),
                        onStatus: (msg) => ui.notifications.info(`Waterline | ${msg}`)
                    }
                );
                this.render();
            }
        });

        // Pick mode tolerance / smoothing sliders
        const tolInput = root.querySelector('input[name="pickTolerance"]');
        if (tolInput) {
            tolInput.addEventListener('input', (ev) => {
                ev.target.nextElementSibling.textContent = ev.target.value;
                this.sampler.setTolerance(Number(ev.target.value));
            });
        }
        const smoothInput = root.querySelector('input[name="pickSmoothing"]');
        if (smoothInput) {
            smoothInput.addEventListener('input', (ev) => {
                ev.target.nextElementSibling.textContent = Number(ev.target.value).toFixed(1);
                this.sampler.setSmoothing(Number(ev.target.value));
            });
        }

        // Candidate actions
        root.querySelector('[data-action="acceptCandidate"]')?.addEventListener('click', async () => {
            const count = (canvas.scene?.regions?.contents?.length ?? 0) + 1;
            const name = `Water ${count}`;
            const created = await this.sampler.acceptCandidate(name);
            if (created) ui.notifications.info(`Waterline | Created ${name}.`);
            this.render();
        });

        root.querySelector('[data-action="discardCandidate"]')?.addEventListener('click', () => {
            this.sampler.discardCandidate();
            this.render();
        });

        root.querySelector('[data-action="undoCandidate"]')?.addEventListener('click', () => {
            this.sampler.undo();
        });

        // Zone deletion with confirmation
        root.querySelectorAll('[data-action="deleteZone"]').forEach(btn => {
            btn.addEventListener('click', (ev) => {
                ev.preventDefault();
                const idx = Number(btn.dataset.index);
                const regions = canvas.scene?.regions ?? [];
                const behaviorType = `${MODULE_ID}.waterFX`;
                const waterRegions = regions.filter(r => r.behaviors?.some(b => b.type === behaviorType));
                const targetRegion = waterRegions[idx];
                if (!targetRegion) return;

                Dialog.confirm({
                    title: 'Delete Water Zone',
                    content: `<p>Delete <strong>${targetRegion.name}</strong> from this scene?</p>`,
                    yes: async () => {
                        await targetRegion.delete();
                        ui.notifications.info(`Waterline | Removed ${targetRegion.name}.`);
                        this.render();
                    },
                    defaultYes: false
                });
            });
        });

        // Water preset selection
        const presetSelect = root.querySelector('select[name="waterPreset"]');
        if (presetSelect) {
            presetSelect.addEventListener('change', (ev) => {
                this.#onSelectWaterPreset(ev.target.value);
            });
        }

        // Water preset save prompts
        root.querySelector('[data-action="promptSavePreset"]')?.addEventListener('click', () => {
            this.showPresetPrompt = true;
            this.render();
        });
        root.querySelector('[data-action="cancelSavePreset"]')?.addEventListener('click', () => {
            this.showPresetPrompt = false;
            this.render();
        });
        root.querySelector('[data-action="confirmSavePreset"]')?.addEventListener('click', () => {
            const nameInput = root.querySelector('input[name="newPresetName"]');
            const name = nameInput?.value?.trim();
            if (name) this.#saveCustomWaterPreset(name);
        });
        root.querySelector('[data-action="deleteWaterPreset"]')?.addEventListener('click', () => {
            this.#deleteCustomWaterPreset(this.activePreset);
        });

        // Water animation slider listeners
        const sliderNames = ['speed', 'intensity', 'opacity', 'distortion', 'fadeWidth', 'shoreWaves', 'scale', 'flowAngle'];
        for (const name of sliderNames) {
            const input = root.querySelector(`input[name="${name}"]`);
            if (!input) continue;
            input.addEventListener('input', (ev) => {
                const val = Number(ev.target.value);
                this.fx[name] = val;
                const display = ev.target.nextElementSibling;
                if (display) {
                    if (name === 'flowAngle') display.innerHTML = `${Math.round(val)}&deg;`;
                    else if (name === 'distortion') display.textContent = val.toFixed(3);
                    else if (['speed', 'intensity', 'opacity', 'shoreWaves'].includes(name)) display.textContent = val.toFixed(2);
                    else display.textContent = String(val);
                }
                this.#liveUpdateFX();
            });
        }

        // Color override and Auto color checkbox
        const colorInput = root.querySelector('input[name="colorOverride"]');
        const autoColorCheckbox = root.querySelector('input[name="autoColor"]');
        if (colorInput && autoColorCheckbox) {
            autoColorCheckbox.addEventListener('change', (ev) => {
                this.fx.autoColor = ev.target.checked;
                colorInput.disabled = ev.target.checked;
                this.#liveUpdateFX();
            });
            colorInput.addEventListener('input', (ev) => {
                this.fx.colorOverride = ev.target.value;
                this.#liveUpdateFX();
            });
        }

        // Preview mode (switch to token layer)
        root.querySelector('[data-action="previewLayer"]')?.addEventListener('click', () => {
            this.sampler.stop();
            if (ui.controls) {
                const tc = ui.controls.controls.find(c => c.name === 'token');
                if (tc) {
                    ui.controls.activeControl = 'token';
                    canvas.tokens?.activate();
                    ui.controls.render();
                }
            }
        });

        // Save FX to scene region behaviors
        root.querySelector('[data-action="saveWaterFX"]')?.addEventListener('click', async () => {
            await this.#saveFXToSceneRegions();
        });

        // ── Wake & Ripples Listeners ──────────────────────────────────────────
        const wakePresetSelect = root.querySelector('select[name="wakePresetSelect"]');
        if (wakePresetSelect) {
            wakePresetSelect.addEventListener('change', (ev) => {
                const name = ev.target.value;
                if (name) {
                    WakeTuning.loadPreset(name);
                    this.activeWakePreset = name;
                    this.render();
                }
            });
        }

        root.querySelector('[data-action="promptSaveWakePreset"]')?.addEventListener('click', () => {
            this.showWakePresetPrompt = true;
            this.render();
        });
        root.querySelector('[data-action="cancelSaveWakePreset"]')?.addEventListener('click', () => {
            this.showWakePresetPrompt = false;
            this.render();
        });
        root.querySelector('[data-action="confirmSaveWakePreset"]')?.addEventListener('click', () => {
            const nameInput = root.querySelector('input[name="newWakePresetName"]');
            const name = nameInput?.value?.trim();
            if (name) {
                WakeTuning.savePreset(name);
                this.activeWakePreset = name;
                this.showWakePresetPrompt = false;
                this.render();
                ui.notifications.info(`Waterline | Saved ripple preset "${name}".`);
            }
        });
        root.querySelector('[data-action="deleteWakePreset"]')?.addEventListener('click', () => {
            if (this.activeWakePreset) {
                WakeTuning.deletePreset(this.activeWakePreset);
                this.activeWakePreset = null;
                this.render();
            }
        });

        // Wake Visual mode dropdown
        const visualModeSelect = root.querySelector('select[name="wakeVisualMode"]');
        if (visualModeSelect) {
            visualModeSelect.addEventListener('change', (ev) => {
                WakeTuning.set('visualMode', ev.target.value);
            });
        }

        // Wake sliders
        root.querySelectorAll('[name^="wake_"]').forEach(input => {
            input.addEventListener('input', (ev) => {
                const key = input.name.replace('wake_', '');
                const val = Number(ev.target.value);
                WakeTuning.set(key, val);
                const display = ev.target.nextElementSibling;
                if (display) {
                    const step = Number(input.step || 1);
                    display.textContent = step < 1 ? val.toFixed(2) : String(val);
                }
            });
        });

        root.querySelector('[data-action="resetWakeDefaults"]')?.addEventListener('click', () => {
            WakeTuning.resetDefaults();
            this.activeWakePreset = null;
            this.render();
            ui.notifications.info('Waterline | Reset ripple settings to default physics.');
        });

        // ── Shoreline Borders Listeners ───────────────────────────────────────
        root.querySelectorAll('[name^="border_"]').forEach(input => {
            input.addEventListener('input', (ev) => {
                const key = input.name.replace('border_', '');
                const val = Number(ev.target.value);
                this.borderConfig[key] = val;
                game.settings.set(MODULE_ID, 'borderConfig', this.borderConfig);
                const display = ev.target.nextElementSibling;
                if (display) {
                    const step = Number(input.step || 1);
                    display.textContent = step < 1 ? val.toFixed(1) : String(val);
                }
            });
        });

        root.querySelector('[data-action="generateOrganicBorder"]')?.addEventListener('click', async () => {
            await BorderGenerator.createBorder(this.borderConfig);
        });

        root.querySelector('[data-action="generateStraightBorder"]')?.addEventListener('click', async () => {
            await BorderGenerator.createStraightBorder(this.borderConfig.inset);
        });

        root.querySelector('[data-action="clearBorders"]')?.addEventListener('click', async () => {
            Dialog.confirm({
                title: 'Waterline: Clear Borders',
                content: '<p>Remove all generated border walls from this scene?</p>',
                yes: () => BorderGenerator.clearBorder(),
                defaultYes: false
            });
        });
    }

    // ------------------------------------------------------------------
    // Preset & FX Management
    // ------------------------------------------------------------------

    #loadSceneFX() {
        const behaviorType = `${MODULE_ID}.waterFX`;
        const regions = canvas.scene?.regions?.contents ?? canvas.scene?.regions ?? [];
        for (const region of regions) {
            const behaviors = region.behaviors?.contents ?? region.behaviors ?? [];
            const b = Array.isArray(behaviors) ? behaviors.find(beh => beh.type === behaviorType) : null;
            if (b?.system) {
                const s = b.system;
                this.fx = {
                    speed: s.speed ?? this.fx.speed,
                    intensity: s.intensity ?? this.fx.intensity,
                    opacity: s.opacity ?? this.fx.opacity,
                    distortion: s.distortion ?? this.fx.distortion,
                    fadeWidth: s.fadeWidth ?? this.fx.fadeWidth,
                    scale: s.scale ?? this.fx.scale,
                    flowAngle: s.flowAngle ?? this.fx.flowAngle,
                    shoreWaves: s.shoreWaves ?? this.fx.shoreWaves,
                    colorOverride: s.colorOverride || this.fx.colorOverride,
                    autoColor: !s.colorOverride
                };
                if (s.waterType) this.activePreset = s.waterType;
                break;
            }
        }
    }

    #onSelectWaterPreset(key) {
        this.activePreset = key;
        const customPresets = game.settings.get(MODULE_ID, 'waterCustomPresets') ?? {};
        const preset = WATER_PRESETS[key] ?? customPresets[key];
        if (preset) {
            this.fx = {
                ...this.fx,
                speed: preset.speed ?? this.fx.speed,
                intensity: preset.intensity ?? this.fx.intensity,
                opacity: preset.opacity ?? this.fx.opacity,
                distortion: preset.distortion ?? this.fx.distortion,
                fadeWidth: preset.fadeWidth ?? this.fx.fadeWidth,
                scale: preset.scale ?? this.fx.scale,
                flowAngle: preset.flowAngle ?? this.fx.flowAngle,
                shoreWaves: preset.shoreWaves ?? this.fx.shoreWaves,
                colorOverride: preset.colorOverride ?? this.fx.colorOverride,
                autoColor: preset.colorOverride ? false : (key === 'custom' ? this.fx.autoColor : true)
            };
            this.#liveUpdateFX();
        }
        this.render();
    }

    async #saveCustomWaterPreset(name) {
        const presets = game.settings.get(MODULE_ID, 'waterCustomPresets') ?? {};
        const key = `user_${name.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '')}`;
        presets[key] = {
            name,
            ...this.fx
        };
        await game.settings.set(MODULE_ID, 'waterCustomPresets', presets);
        this.activePreset = key;
        this.showPresetPrompt = false;
        this.render();
        ui.notifications.info(`Waterline | Saved preset "${name}".`);
    }

    async #deleteCustomWaterPreset(key) {
        const presets = game.settings.get(MODULE_ID, 'waterCustomPresets') ?? {};
        const name = presets[key]?.name ?? key;
        delete presets[key];
        await game.settings.set(MODULE_ID, 'waterCustomPresets', presets);
        this.activePreset = 'custom';
        this.render();
        ui.notifications.info(`Waterline | Deleted preset "${name}".`);
    }

    #liveUpdateFX() {
        this.hasUnsavedChanges = true;
        if (this.#rafId) cancelAnimationFrame(this.#rafId);
        this.#rafId = requestAnimationFrame(() => {
            const tune = game.ionrift?.waterTune;
            if (!tune) return;
            tune.speed(this.fx.speed);
            tune.intensity(this.fx.intensity);
            tune.opacity(this.fx.opacity);
            if (tune.distortion) tune.distortion(this.fx.distortion);
            if (tune.fadeWidth) tune.fadeWidth(this.fx.fadeWidth);
            if (tune.scale) tune.scale(this.fx.scale);
            if (tune.flowAngle) tune.flowAngle(this.fx.flowAngle);
            if (tune.shoreWaves) tune.shoreWaves(this.fx.shoreWaves);
        });
    }

    async #saveFXToSceneRegions() {
        const behaviorType = `${MODULE_ID}.waterFX`;
        const regions = canvas.scene?.regions ?? [];
        let updated = 0;

        const colorOverride = this.fx.autoColor ? '' : this.fx.colorOverride;
        const systemUpdate = {
            waterType: this.activePreset,
            speed: this.fx.speed,
            intensity: this.fx.intensity,
            opacity: this.fx.opacity,
            distortion: this.fx.distortion,
            fadeWidth: this.fx.fadeWidth,
            scale: this.fx.scale,
            flowAngle: this.fx.flowAngle,
            shoreWaves: this.fx.shoreWaves,
            colorOverride
        };

        for (const region of regions) {
            const behavior = region.behaviors?.find(b => b.type === behaviorType);
            if (!behavior) continue;
            try {
                await behavior.update({ system: systemUpdate });
                updated++;
            } catch (err) {
                console.error(`Waterline | Failed to update ${region.name}:`, err);
            }
        }

        this.hasUnsavedChanges = false;
        ui.notifications.info(`Waterline | Saved FX settings to ${updated} water zone(s).`);
    }

    // ------------------------------------------------------------------
    // Cleanup
    // ------------------------------------------------------------------

    /** @override */
    async close(options = {}) {
        if (this.hasUnsavedChanges && !options.force) {
            const confirmed = await Dialog.confirm({
                title: 'Unsaved Changes',
                content: '<p>You have unsaved water animation adjustments. Close without saving?</p>',
                defaultYes: false
            });
            if (!confirmed) return;
        }

        if (this.sampler) this.sampler.cleanup();
        if (this.#rafId) cancelAnimationFrame(this.#rafId);

        WaterlineStudioApp._instance = null;
        return super.close(options);
    }
}
