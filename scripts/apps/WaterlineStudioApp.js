import { WaterSamplingController } from '../controllers/WaterSamplingController.js';
import { WATER_PRESETS, WATER_ARCHETYPES, WaterManager } from '../water/WaterManager.js';
import { WakeTuning } from '../water/WakeTuning.js';
const MODULE_ID = 'ionrift-waterline';

/**
 * Unified Waterline UI (ApplicationV2).
 * Consolidates waterbody management, archetype effects, and wake ripples.
 */
export class WaterlineStudioApp extends foundry.applications.api.ApplicationV2 {

    /** @type {WaterlineStudioApp|null} */
    static _instance = null;

    /** @type {string} Current active tab: 'water' | 'wake' */
    activeTab = 'water';

    /** @type {WaterSamplingController} */
    sampler = null;

    /** @type {string|null} ID of currently selected water region */
    activeRegionId = null;

    /** @type {string} Active water archetype: 'ocean' | 'coast' | 'lake' | 'river' | 'pond' | 'puddle' */
    activeArchetype = 'river';

    /** @type {boolean} State of expandable advanced FX drawer */
    drawerOpen = false;

    /** @type {boolean} Toggle to batch-apply FX to all same-archetype waterbodies */
    applyToAllSameArchetype = false;

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
        waveSegment: 0.85,
        waveRegularity: 0.60,
        swashSurge: 24.0,
        choppySeas: 0.0,
        riverWaves: 0.65,
        lakeWaves: 0.0,
        lakeRings: true,
        whitecaps: 0.5,
        sunGlint: 0.6,
        spindriftWake: false,
        crestBound: false,
        colorOverride: '#0d2e4d',
        autoColor: true
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
            width: 580,
            height: 'auto'
        },
        classes: ['ionrift-window', 'waterline-studio-dialog']
    };

    constructor(options = {}) {
        super(options);
        WaterlineStudioApp._instance = this;
        this.activeTab = options.tab === 'wake' ? 'wake' : 'water';

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
        } else if (options.tab === "wake" || options.tab === "water") {
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
            try { app.close({ force: true, animate: false }); } catch { /* ignore */ }
        }
        WaterlineStudioApp._instance = null;
    }

    /** @override */
    async close(options = {}) {
        options.animate = false;
        return super.close(options);
    }

    /** @override */
    _preClose(options) {
        if (this.#rafId) {
            cancelAnimationFrame(this.#rafId);
            this.#rafId = null;
        }
        this.sampler?.cleanup();
    }

    /** @override */
    _onClose(options) {
        WaterlineStudioApp._instance = null;
    }

    // ------------------------------------------------------------------
    // Context Preparation
    // ------------------------------------------------------------------

    /** @override */
    async _prepareContext(options) {
        const behaviorType = `${MODULE_ID}.waterFX`;
        const regions = canvas.scene?.regions?.contents ?? canvas.scene?.regions ?? [];
        const zones = [];

        for (const region of regions) {
            const behaviors = region.behaviors?.contents ?? region.behaviors ?? [];
            const behavior = Array.isArray(behaviors) ? behaviors.find(b => b.type === behaviorType) : null;
            if (!behavior) continue;

            const archKey = behavior.system?.archetype || WaterManager.inferArchetype(behavior.system?.waterType);
            const archMeta = WATER_ARCHETYPES[archKey] ?? WATER_ARCHETYPES.river;

            zones.push({
                region,
                id: region.id,
                name: region.name || 'Water Zone',
                verts: region.shapes?.[0]?.points?.length ? Math.round(region.shapes[0].points.length / 2) : 0,
                archetype: archKey,
                archetypeLabel: archMeta.label,
                archetypeIcon: archMeta.icon,
                archetypeColor: archMeta.accentColor,
                isActive: region.id === this.activeRegionId
            });
        }

        // Auto-select first zone if activeRegionId is invalid or not yet set
        if ((!this.activeRegionId || !zones.some(z => z.id === this.activeRegionId)) && zones.length > 0) {
            this.activeRegionId = zones[0].id;
            this.#loadActiveRegionFX(this.activeRegionId);
            // Update isActive flag
            for (const z of zones) {
                z.isActive = z.id === this.activeRegionId;
            }
        }

        // Filter built-in presets by active archetype
        const currentArchetypePresets = Object.fromEntries(
            Object.entries(WATER_PRESETS).filter(([, p]) => p.archetype === this.activeArchetype)
        );

        // Filter custom presets by active archetype
        const customPresets = game.settings.get(MODULE_ID, 'waterCustomPresets') ?? {};
        const customPresetsList = Object.entries(customPresets)
            .filter(([, data]) => (data.archetype || WaterManager.inferArchetype(data.waterType)) === this.activeArchetype)
            .map(([key, data]) => ({
                key,
                name: data.name ?? key
            }));

        // Wake settings and presets
        const wake = WakeTuning.get();
        const wakePresets = WakeTuning.listPresets();

        // Ensure numeric safety for fx values to prevent NaN in template rendering
        this.fx.speed = Number.isFinite(this.fx.speed) ? this.fx.speed : 1.40;
        this.fx.intensity = Number.isFinite(this.fx.intensity) ? this.fx.intensity : 0.25;
        this.fx.opacity = Number.isFinite(this.fx.opacity) ? this.fx.opacity : 0.15;
        this.fx.distortion = Number.isFinite(this.fx.distortion) ? this.fx.distortion : 0.035;
        this.fx.fadeWidth = Number.isFinite(this.fx.fadeWidth) ? this.fx.fadeWidth : 60;
        this.fx.scale = Number.isFinite(this.fx.scale) ? this.fx.scale : 90;
        this.fx.flowAngle = Number.isFinite(this.fx.flowAngle) ? this.fx.flowAngle : 90;
        this.fx.shoreWaves = Number.isFinite(this.fx.shoreWaves) ? this.fx.shoreWaves : 0.15;
        this.fx.waveSegment = Number.isFinite(this.fx.waveSegment) ? this.fx.waveSegment : 0.85;
        this.fx.swashSurge = Number.isFinite(this.fx.swashSurge) ? this.fx.swashSurge : 24.0;
        this.fx.choppySeas = Number.isFinite(this.fx.choppySeas) ? this.fx.choppySeas : 0.0;
        this.fx.riverWaves = Number.isFinite(this.fx.riverWaves) ? this.fx.riverWaves : 0.0;
        this.fx.lakeWaves = Number.isFinite(this.fx.lakeWaves) ? this.fx.lakeWaves : 0.0;
        this.fx.lakeRings = Boolean(this.fx.lakeRings);
        this.fx.whitecaps = Number.isFinite(this.fx.whitecaps) ? this.fx.whitecaps : 0.5;
        this.fx.sunGlint = Number.isFinite(this.fx.sunGlint) ? this.fx.sunGlint : 0.6;
        this.fx.spindriftWake = Boolean(this.fx.spindriftWake);
        this.fx.crestBound = Boolean(this.fx.crestBound);

        // Build Curated Hero Sliders for active archetype
        const heroSliders = this.#buildHeroSliders(this.activeArchetype, this.fx);
        const hasDirection = heroSliders.some(s => s.isDirection);
        const activeArchMeta = WATER_ARCHETYPES[this.activeArchetype] ?? WATER_ARCHETYPES.river;

        return {
            activeTab: this.activeTab,
            zones,
            activeRegionId: this.activeRegionId,
            archetypes: WATER_ARCHETYPES,
            activeArchetype: this.activeArchetype,
            activeArchetypeMeta: activeArchMeta,
            currentArchetypePresets,
            customPresetsList,
            activePreset: this.activePreset,
            isCustomPresetSelected: Boolean(customPresets[this.activePreset]),
            showPresetPrompt: this.showPresetPrompt,
            heroSliders,
            hasDirection,
            drawerOpen: this.drawerOpen,
            applyToAllSameArchetype: this.applyToAllSameArchetype,
            pickActive: this.sampler.isActive || Boolean(this.sampler.editingRegionId),
            pickTolerance: this.sampler.tolerance,
            pickSmoothing: this.sampler.smoothing,
            candidate: this.sampler.candidate,
            editingRegionId: this.sampler.editingRegionId,
            editingRegionName: this.sampler.editingRegionId ? (canvas.scene?.regions?.get(this.sampler.editingRegionId)?.name || 'Waterbody') : null,
            fx: this.fx,
            wake,
            wakePresets,
            activeWakePreset: this.activeWakePreset,
            showWakePresetPrompt: this.showWakePresetPrompt
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
            if (this.sampler.isActive || this.sampler.editingRegionId) {
                this.sampler.discardCandidate();
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
            const region = await this.sampler.acceptCandidate();
            if (region) {
                this.activeRegionId = region.id;
                this.#loadActiveRegionFX(region.id);
                this.#liveUpdateFX();
            }
            this.render();
        });
        root.querySelector('[data-action="discardCandidate"]')?.addEventListener('click', () => {
            this.sampler.discardCandidate();
            this.render();
        });
        root.querySelector('[data-action="undoCandidate"]')?.addEventListener('click', () => {
            this.sampler.undo();
            this.render();
        });
        root.querySelector('[data-action="pullBackCandidate"]')?.addEventListener('click', () => {
            this.sampler.pullBack();
            this.render();
        });
        root.querySelector('[data-action="expandCandidate"]')?.addEventListener('click', () => {
            this.sampler.expand();
            this.render();
        });
        root.querySelector('[data-action="smoothCandidate"]')?.addEventListener('click', () => {
            this.sampler.smooth();
            this.render();
        });

        // ── Entity Deck: Waterbody Selection & Management ─────────────────────
        root.querySelectorAll('[data-action="selectZone"]').forEach(cardEl => {
            cardEl.addEventListener('click', (ev) => {
                const regionId = cardEl.dataset.regionId;
                if (!regionId || regionId === this.activeRegionId) return;
                if (this.sampler?.editingRegionId && this.sampler.editingRegionId !== regionId) {
                    this.sampler.discardCandidate();
                }
                this.activeRegionId = regionId;
                this.#loadActiveRegionFX(regionId);
                this.#liveUpdateFX();
                this.render();
            });
        });

        // Refine boundary with sampler (add/remove water)
        root.querySelectorAll('[data-action="editZoneBoundary"]').forEach(btn => {
            btn.addEventListener('click', async (ev) => {
                ev.stopPropagation();
                const regionId = btn.dataset.regionId;
                if (!regionId) return;

                // Toggle off if already editing this region
                if (this.sampler.editingRegionId === regionId) {
                    this.sampler.discardCandidate();
                    this.render();
                    return;
                }

                await this.#editRegionBoundary(regionId);
            });
        });

        // Focus waterbody on canvas
        root.querySelectorAll('[data-action="focusZone"]').forEach(btn => {
            btn.addEventListener('click', (ev) => {
                ev.stopPropagation();
                const regionId = btn.dataset.regionId;
                this.#focusRegionOnCanvas(regionId);
            });
        });

        // Delete waterbody
        root.querySelectorAll('[data-action="deleteZone"]').forEach(btn => {
            btn.addEventListener('click', (ev) => {
                ev.stopPropagation();
                const regionId = btn.dataset.regionId;
                const region = canvas.scene?.regions?.get(regionId);
                if (!region) return;
                Dialog.confirm({
                    title: 'Delete Waterbody',
                    content: `<p>Delete waterbody <strong>${region.name}</strong> from the scene?</p>`,
                    yes: async () => {
                        if (this.sampler?.editingRegionId === regionId) {
                            this.sampler.discardCandidate();
                        }
                        await region.delete();
                        if (this.activeRegionId === regionId) this.activeRegionId = null;
                        this.render();
                    },
                    defaultYes: false
                });
            });
        });

        // In-place inline renaming on double click
        root.querySelectorAll('.wc-zone-name').forEach(nameSpan => {
            nameSpan.addEventListener('dblclick', (ev) => {
                ev.stopPropagation();
                const regionId = nameSpan.dataset.regionId;
                const currentName = nameSpan.textContent.trim();
                const input = document.createElement('input');
                input.type = 'text';
                input.className = 'wc-zone-name-input';
                input.value = currentName;

                const commit = async () => {
                    const newName = input.value.trim();
                    if (newName && newName !== currentName) {
                        await this.#renameWaterRegion(regionId, newName);
                        nameSpan.textContent = newName;
                    }
                    input.replaceWith(nameSpan);
                };

                input.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter') { e.preventDefault(); commit(); }
                    else if (e.key === 'Escape') { e.preventDefault(); input.replaceWith(nameSpan); }
                });
                input.addEventListener('blur', commit);

                nameSpan.replaceWith(input);
                input.focus();
                input.select();
            });
        });

        // ── Archetype & Preset Selectors ──────────────────────────────────────
        const archetypeSelect = root.querySelector('select[name="waterArchetype"]');
        if (archetypeSelect) {
            archetypeSelect.addEventListener('change', (ev) => {
                this.#onSelectArchetype(ev.target.value);
            });
        }

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

        // ── Curated Hero Sliders ──────────────────────────────────────────────
        root.querySelectorAll('input[name^="hero_"]').forEach(input => {
            input.addEventListener('input', (ev) => {
                const heroId = input.dataset.heroId;
                const val = Number(ev.target.value);
                this.#onHeroSliderInput(heroId, val);

                // Update hero slider display value in DOM
                const display = ev.target.nextElementSibling;
                if (display) {
                    if (heroId === 'swellSpeed' || heroId === 'waveRhythm' || heroId === 'driftSpeed' || heroId === 'currentSpeed') {
                        display.textContent = `${val.toFixed(2)}x`;
                    } else if (heroId === 'swashSurge' || heroId === 'shorelineSoftness' || heroId === 'bankFeathering' || heroId === 'shallowsMargin' || heroId === 'wetRimBlend') {
                        display.textContent = `${Math.round(val)}px`;
                    } else if (heroId === 'flowHeading' || heroId === 'windDirection' || heroId === 'surfHeading') {
                        display.textContent = `${Math.round(val)}°`;
                    } else {
                        display.textContent = `${Math.round(val)}%`;
                    }
                }
                this.#syncHeroSlidersFromFX(root);
                this.#syncAdvancedDrawerFromFX(root);
                this.#liveUpdateFX();
            });
        });

        // ── Directional Arrow Dial Widget ─────────────────────────────────────
        const dirDial = root.querySelector('.direction-dial');
        const arrowPivot = root.querySelector('.direction-arrow-pivot');
        const dirDisplay = root.querySelector('.direction-angle-badge');
        if (dirDial) {
            let isDraggingDir = false;

            const updateDirection = (clientX, clientY) => {
                const rect = dirDial.getBoundingClientRect();
                const cx = rect.left + rect.width / 2;
                const cy = rect.top + rect.height / 2;
                const dx = clientX - cx;
                const dy = clientY - cy;
                let deg = Math.round(Math.atan2(dy, dx) * 180 / Math.PI);
                if (deg < 0) deg += 360;

                this.fx.flowAngle = deg;
                if (arrowPivot) arrowPivot.style.transform = `rotate(${deg}deg)`;
                if (dirDisplay) dirDisplay.textContent = `${deg}°`;

                // Sync drawer flow angle slider and hero sliders
                this.#syncAdvancedDrawerFromFX(root);
                this.#syncHeroSlidersFromFX(root);
                this.#liveUpdateFX();
            };

            dirDial.addEventListener('pointerdown', (e) => {
                isDraggingDir = true;
                dirDial.setPointerCapture(e.pointerId);
                updateDirection(e.clientX, e.clientY);
            });
            dirDial.addEventListener('pointermove', (e) => {
                if (isDraggingDir) updateDirection(e.clientX, e.clientY);
            });
            dirDial.addEventListener('pointerup', (e) => {
                isDraggingDir = false;
                try { dirDial.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
            });
        }

        // ── Advanced Drawer: Progressive Disclosure & Sliders ─────────────────
        const advancedDrawer = root.querySelector('details.wc-advanced-drawer');
        if (advancedDrawer) {
            advancedDrawer.addEventListener('toggle', () => {
                this.drawerOpen = advancedDrawer.open;
            });
        }

        const sliderNames = [
            'speed', 'intensity', 'opacity', 'distortion', 'fadeWidth',
            'shoreWaves', 'waveSegment', 'swashSurge', 'choppySeas',
            'whitecaps', 'sunGlint', 'scale', 'flowAngle'
        ];

        for (const name of sliderNames) {
            const input = root.querySelector(`.wc-drawer-content input[name="${name}"]`);
            if (!input) continue;
            input.addEventListener('input', (ev) => {
                const val = Number(ev.target.value);
                this.fx[name] = val;
                const display = ev.target.nextElementSibling;
                if (display) {
                    if (name === 'flowAngle') display.innerHTML = `${Math.round(val)}&deg;`;
                    else if (name === 'distortion') display.textContent = val.toFixed(3);
                    else if (name === 'swashSurge' || name === 'fadeWidth') display.textContent = `${Math.round(val)}px`;
                    else if (['speed', 'intensity', 'opacity', 'shoreWaves', 'waveSegment', 'choppySeas', 'whitecaps', 'sunGlint'].includes(name)) display.textContent = val.toFixed(2);
                    else display.textContent = String(val);
                }

                // If flow angle changed, update directional dial
                if (name === 'flowAngle') {
                    if (arrowPivot) arrowPivot.style.transform = `rotate(${val}deg)`;
                    if (dirDisplay) dirDisplay.textContent = `${Math.round(val)}°`;
                }

                this.#syncHeroSlidersFromFX(root);
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

        // Foam toggle checkboxes: Spindrift Wake and Crest-Locked foam
        for (const name of ['spindriftWake', 'crestBound']) {
            const cb = root.querySelector(`input[name="${name}"]`);
            if (cb) {
                cb.addEventListener('change', (ev) => {
                    this.fx[name] = ev.target.checked;
                    this.#liveUpdateFX();
                });
            }
        }

        // Batch apply toggle checkbox in footer
        const batchCheckbox = root.querySelector('input[name="applyToAllSameArchetype"]');
        if (batchCheckbox) {
            batchCheckbox.addEventListener('change', (ev) => {
                this.applyToAllSameArchetype = ev.target.checked;
            });
        }

        // Save FX to active waterbody
        root.querySelector('[data-action="saveWaterFX"]')?.addEventListener('click', async () => {
            await this.#saveActiveWaterbodyFX();
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

        const visualModeSelect = root.querySelector('select[name="wakeVisualMode"]');
        if (visualModeSelect) {
            visualModeSelect.addEventListener('change', (ev) => {
                WakeTuning.set('visualMode', ev.target.value);
            });
        }

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
                this.activeRegionId = region.id;
                this.#loadActiveRegionFX(region.id);
                break;
            }
        }
    }

    #loadActiveRegionFX(regionId) {
        if (!regionId) return;
        const region = canvas.scene?.regions?.get(regionId);
        if (!region) return;
        const behaviorType = `${MODULE_ID}.waterFX`;
        const behaviors = region.behaviors?.contents ?? region.behaviors ?? [];
        const b = Array.isArray(behaviors) ? behaviors.find(beh => beh.type === behaviorType) : null;
        if (b?.system) {
            const s = b.system;
            this.fx = {
                ...this.fx,
                speed: Number.isFinite(s.speed) ? s.speed : this.fx.speed,
                intensity: Number.isFinite(s.intensity) ? s.intensity : this.fx.intensity,
                opacity: Number.isFinite(s.opacity) ? s.opacity : this.fx.opacity,
                distortion: Number.isFinite(s.distortion) ? s.distortion : this.fx.distortion,
                fadeWidth: Number.isFinite(s.fadeWidth) ? s.fadeWidth : this.fx.fadeWidth,
                scale: Number.isFinite(s.scale) ? s.scale : this.fx.scale,
                flowAngle: Number.isFinite(s.flowAngle) ? s.flowAngle : this.fx.flowAngle,
                shoreWaves: Number.isFinite(s.shoreWaves) ? s.shoreWaves : this.fx.shoreWaves,
                waveSegment: Number.isFinite(s.waveSegment) ? s.waveSegment : this.fx.waveSegment,
                waveRegularity: Number.isFinite(s.waveRegularity) ? s.waveRegularity : (this.fx.waveRegularity ?? 0.60),
                swashSurge: Number.isFinite(s.swashSurge) ? s.swashSurge : this.fx.swashSurge,
                choppySeas: Number.isFinite(s.choppySeas) ? s.choppySeas : (this.fx.choppySeas ?? 0.0),
                riverWaves: Number.isFinite(s.riverWaves) ? s.riverWaves : (this.fx.riverWaves ?? 0.0),
                lakeWaves: Number.isFinite(s.lakeWaves) ? s.lakeWaves : (this.fx.lakeWaves ?? 0.0),
                lakeRings: s.lakeRings !== undefined ? Boolean(s.lakeRings) : (this.fx.lakeRings !== false),
                whitecaps: Number.isFinite(s.whitecaps) ? s.whitecaps : (this.fx.whitecaps ?? 0.5),
                sunGlint: Number.isFinite(s.sunGlint) ? s.sunGlint : (this.fx.sunGlint ?? 0.6),
                spindriftWake: Boolean(s.spindriftWake),
                crestBound: Boolean(s.crestBound),
                colorOverride: s.colorOverride || this.fx.colorOverride,
                autoColor: !s.colorOverride
            };
            this.activePreset = s.waterType === 'abyssal_depths' ? 'ocean_calm' : (s.waterType || 'river');
            this.activeArchetype = s.archetype || WaterManager.inferArchetype(this.activePreset);
        }
    }

    #onSelectArchetype(archetypeKey) {
        if (!WATER_ARCHETYPES[archetypeKey]) return;
        this.activeArchetype = archetypeKey;
        const defaultPresetKey = WATER_ARCHETYPES[archetypeKey].defaultPreset;
        this.#onSelectWaterPreset(defaultPresetKey);
    }

    #onSelectWaterPreset(key) {
        if (key === 'abyssal_depths') key = 'ocean_calm';
        this.activePreset = key;
        const customPresets = game.settings.get(MODULE_ID, 'waterCustomPresets') ?? {};
        const preset = WATER_PRESETS[key] ?? customPresets[key];
        if (preset) {
            if (preset.archetype) this.activeArchetype = preset.archetype;
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
                waveSegment: preset.waveSegment ?? this.fx.waveSegment,
                waveRegularity: preset.waveRegularity ?? this.fx.waveRegularity ?? 0.60,
                swashSurge: preset.swashSurge ?? this.fx.swashSurge,
                choppySeas: preset.choppySeas ?? this.fx.choppySeas,
                riverWaves: preset.riverWaves ?? 0.0,
                lakeWaves: preset.lakeWaves ?? 0.0,
                lakeRings: preset.lakeRings ?? true,
                whitecaps: preset.whitecaps ?? this.fx.whitecaps,
                sunGlint: preset.sunGlint ?? this.fx.sunGlint,
                spindriftWake: preset.spindriftWake ?? false,
                crestBound: preset.crestBound ?? false,
                colorOverride: preset.colorOverride ?? this.fx.colorOverride,
                autoColor: preset.colorOverride ? false : (key === 'custom' ? this.fx.autoColor : true)
            };
            this.#liveUpdateFX();
        }
        this.render();
    }

    #buildHeroSliders(archetype, fx) {
        switch (archetype) {
            case 'ocean': {
                const seaStateVal = Math.round(Math.min(100, Math.max(0, (fx.choppySeas / 1.2) * 100)));
                const swellSpeedVal = Number(fx.speed).toFixed(2);
                const clarityVal = Math.round(Math.min(100, Math.max(0, ((0.45 - fx.opacity) / 0.28) * 100)));
                const sunGlintVal = Math.round(Math.min(100, Math.max(0, (fx.sunGlint / 1.8) * 100)));
                const angleVal = Math.round(fx.flowAngle) % 360;
                return [
                    { id: 'seaState', label: 'Sea State (Gale)', tooltip: 'Beaufort wind scale: from calm swells to tempestuous whitecap storm surges.', min: 0, max: 100, step: 1, value: seaStateVal, displayValue: `${seaStateVal}%` },
                    { id: 'swellSpeed', label: 'Swell Speed', tooltip: 'Propagation velocity of rolling open-ocean swells.', min: 0.2, max: 2.5, step: 0.05, value: fx.speed, displayValue: `${swellSpeedVal}x` },
                    { id: 'waterClarity', label: 'Water Clarity', tooltip: 'Optical transparency revealing seabed depths.', min: 0, max: 100, step: 1, value: clarityVal, displayValue: `${clarityVal}%` },
                    { id: 'sunShimmer', label: 'Sun Shimmer', tooltip: 'Glinting sunlight catching crest facets.', min: 0, max: 100, step: 1, value: sunGlintVal, displayValue: `${sunGlintVal}%` },
                    { id: 'windDirection', label: 'Wind Direction', tooltip: 'Bearing of ocean winds and traveling swells.', min: 0, max: 359, step: 1, value: angleVal, displayValue: `${angleVal}°`, isDirection: true, icon: 'fas fa-wind' }
                ];
            }
            case 'coast': {
                const surfEnergyVal = Math.round(Math.min(100, Math.max(0, ((fx.shoreWaves - 0.05) / 0.90) * 100)));
                const surgeVal = Math.round(fx.swashSurge);
                const rhythmVal = Number(fx.speed).toFixed(2);
                const softnessVal = Math.round(fx.fadeWidth);
                const angleVal = Math.round(fx.flowAngle) % 360;
                return [
                    { id: 'surfEnergy', label: 'Surf Energy', tooltip: 'Turbulence and foam density of incoming breakers.', min: 0, max: 100, step: 1, value: surfEnergyVal, displayValue: `${surfEnergyVal}%` },
                    { id: 'swashSurge', label: 'Surge Reach', tooltip: 'How far wave wash surges onto dry sand/rock.', min: 0, max: 60, step: 1, value: surgeVal, displayValue: `${surgeVal}px` },
                    { id: 'waveRhythm', label: 'Wave Rhythm', tooltip: 'Arrival tempo of incoming shoreline sets.', min: 0.2, max: 2.0, step: 0.05, value: fx.speed, displayValue: `${rhythmVal}x` },
                    { id: 'shorelineSoftness', label: 'Shoreline Margin', tooltip: 'Width of the transparent fade into dry terrain.', min: 10, max: 150, step: 5, value: softnessVal, displayValue: `${softnessVal}px` },
                    { id: 'surfHeading', label: 'Surf Heading', tooltip: 'Angle of incoming coastal breakers.', min: 0, max: 359, step: 1, value: angleVal, displayValue: `${angleVal}°`, isDirection: true, icon: 'fas fa-compass' }
                ];
            }
            case 'lake': {
                const surfaceEnergyVal = Math.round(Math.min(100, Math.max(0, (fx.lakeWaves ?? 0.08) * 100)));
                const speedVal = Number(Math.min(1.0, fx.speed)).toFixed(2);
                const clarityVal = Math.round(Math.min(100, Math.max(0, ((0.38 - fx.opacity) / 0.26) * 100)));
                const scaleVal = Math.round(fx.scale ?? 140);
                const lappingVal = Math.round(fx.swashSurge ?? 5.0);
                const angleVal = Math.round(fx.flowAngle) % 360;
                return [
                    { id: 'surfaceEnergy', label: 'Surface Wave Energy', tooltip: '3D wave relief, caustics refraction, glint & edge chop.', min: 0, max: 100, step: 1, value: surfaceEnergyVal, displayValue: `${surfaceEnergyVal}%` },
                    { id: 'lappingSpeed', label: 'Animation Speed', tooltip: 'Pace of open-water breeze ripples and shore lapping.', min: 0.05, max: 1.0, step: 0.05, value: Math.min(1.0, fx.speed), displayValue: `${speedVal}x` },
                    { id: 'waterClarity', label: 'Water Clarity', tooltip: 'Depth transparency revealing submerged terrain and caustics.', min: 0, max: 100, step: 1, value: clarityVal, displayValue: `${clarityVal}%` },
                    { id: 'waveScale', label: 'Wave Scale', tooltip: 'Wavelength of surface ripples across the basin.', min: 40, max: 200, step: 5, value: scaleVal, displayValue: `${scaleVal}px` },
                    { id: 'swashSurge', label: 'Shoreline Lapping', tooltip: 'Dynamic swash surging onto the banks.', min: 0, max: 25, step: 1, value: lappingVal, displayValue: `${lappingVal}px` },
                    { id: 'windDirection', label: 'Wind Direction', tooltip: 'Surface wind drift bearing driving waves and downwind shore wash.', min: 0, max: 359, step: 1, value: angleVal, displayValue: `${angleVal}°`, isDirection: true, icon: 'fas fa-wind' }
                ];
            }
            case 'river': {
                const speedVal = Number(fx.speed).toFixed(2);
                const riverWavesVal = Math.round(Math.min(100, Math.max(0, (fx.riverWaves ?? 0.65) * 100)));
                const lappingVal = Math.round(fx.swashSurge ?? 16.0);
                const foamVal = Math.round(Math.min(60, Math.max(0, (fx.whitecaps ?? 0.14) * 100)));
                const featherVal = Math.round(fx.fadeWidth);
                const angleVal = Math.round(fx.flowAngle) % 360;
                return [
                    { id: 'currentSpeed', label: 'Current Speed', tooltip: 'Downstream flow velocity: lazy brook to roaring rapids.', min: 0.2, max: 3.0, step: 0.05, value: fx.speed, displayValue: `${speedVal}x` },
                    { id: 'riverWaves', label: 'River Waves', tooltip: 'Density and presence of downstream traveling riffles and rapids.', min: 0, max: 100, step: 1, value: riverWavesVal, displayValue: `${riverWavesVal}%` },
                    { id: 'swashSurge', label: 'Shoreline Lapping', tooltip: 'Dynamic swash and wave wash surging onto the banks.', min: 0, max: 40, step: 1, value: lappingVal, displayValue: `${lappingVal}px` },
                    { id: 'foamHint', label: 'Foam Hint', tooltip: 'Subtle crest froth: barely a hint of foam on the wave peaks.', min: 0, max: 60, step: 1, value: foamVal, displayValue: `${foamVal}%` },
                    { id: 'bankFeathering', label: 'Bank Feathering', tooltip: 'Feathering width where current meets riverbank.', min: 10, max: 120, step: 5, value: featherVal, displayValue: `${featherVal}px` },
                    { id: 'flowHeading', label: 'Flow Heading', tooltip: 'Bearing of water current.', min: 0, max: 359, step: 1, value: angleVal, displayValue: `${angleVal}°`, isDirection: true, icon: 'fas fa-location-arrow' }
                ];
            }
            case 'pond': {
                const surfaceEnergyVal = Math.round(Math.min(100, Math.max(0, (fx.lakeWaves ?? 0.25) * 100)));
                const speedVal = Number(Math.min(1.0, fx.speed)).toFixed(2);
                const clarityVal = Math.round(Math.min(100, Math.max(0, ((0.38 - fx.opacity) / 0.26) * 100)));
                const scaleVal = Math.round(fx.scale ?? 90);
                const marginVal = Math.round(fx.fadeWidth ?? 45);
                return [
                    { id: 'surfaceEnergy', label: 'Surface Wave Energy', tooltip: 'Surface wave relief and micro-ripples across the pool.', min: 0, max: 100, step: 1, value: surfaceEnergyVal, displayValue: `${surfaceEnergyVal}%` },
                    { id: 'lappingSpeed', label: 'Animation Speed', tooltip: 'Pace of gentle surface ripples and shoreline lapping.', min: 0.05, max: 1.0, step: 0.05, value: Math.min(1.0, fx.speed), displayValue: `${speedVal}x` },
                    { id: 'waterClarity', label: 'Water Clarity', tooltip: 'Transparency revealing submerged flora and bottom sediments.', min: 0, max: 100, step: 1, value: clarityVal, displayValue: `${clarityVal}%` },
                    { id: 'waveScale', label: 'Wave Scale', tooltip: 'Scale of surface ripples across the pond.', min: 30, max: 150, step: 5, value: scaleVal, displayValue: `${scaleVal}px` },
                    { id: 'shallowsMargin', label: 'Shallows Margin', tooltip: 'Soft blend into reeds, mossy banks, or masonry.', min: 10, max: 80, step: 2, value: marginVal, displayValue: `${marginVal}px` }
                ];
            }
            case 'puddle': {
                const speedVal = Number(fx.speed).toFixed(2);
                const waveQuantityVal = Math.round(Math.min(100, Math.max(0, fx.shoreWaves * 100)));
                const regularityVal = Math.round(Math.min(100, Math.max(0, (fx.waveRegularity ?? 0.60) * 100)));
                const rimVal = Math.round(fx.fadeWidth);
                return [
                    { id: 'lappingSpeed', label: 'Tremor Speed', tooltip: 'Vibration pace of surface tremors.', min: 0.2, max: 2.0, step: 0.05, value: fx.speed, displayValue: `${speedVal}x` },
                    { id: 'waveQuantity', label: 'Wave Quantity', tooltip: 'Edge micro-ripple intensity along puddle boundaries.', min: 0, max: 100, step: 1, value: waveQuantityVal, displayValue: `${waveQuantityVal}%` },
                    { id: 'waveRegularity', label: 'Wave Regularity', tooltip: 'Micro-ripple regularity: organic rain jitter to crisp rings.', min: 0, max: 100, step: 1, value: regularityVal, displayValue: `${regularityVal}%` },
                    { id: 'wetRimBlend', label: 'Wet Rim Margin', tooltip: 'Tight damp rim blending puddle into cobblestones.', min: 5, max: 40, step: 1, value: rimVal, displayValue: `${rimVal}px` }
                ];
            }
            default:
                return [];
        }
    }

    #onHeroSliderInput(heroId, val) {
        const x = val / 100;
        switch (heroId) {
            case 'surfaceEnergy':
                this.fx.lakeWaves = +(x).toFixed(2);
                this.fx.sunGlint = +(1.2 * x).toFixed(2);
                break;
            case 'waveScale':
                this.fx.scale = Number(val);
                break;
            case 'seaState':
                this.fx.choppySeas = +(0.10 + 1.25 * x).toFixed(2);
                this.fx.whitecaps = +(1.30 * Math.pow(x, 1.2)).toFixed(2);
                // Physical wave wavelength & scale: calm ripples (85px) to towering storm swells (220px)
                this.fx.scale = Math.round(85 + 135 * Math.pow(x, 1.1));
                // Spatial propagation velocity of wave crests (particle effects stay decoupled at steady timescale)
                this.fx.speed = +(0.45 + 0.80 * x).toFixed(2);
                this.fx.swashSurge = Math.round(14 + 30 * x);
                this.fx.distortion = +(0.015 + 0.023 * x).toFixed(3);
                this.fx.intensity = +(0.45 + 0.45 * x).toFixed(2);
                this.fx.opacity = +(0.30 + 0.06 * x).toFixed(2);
                break;
            case 'swellSpeed':
            case 'waveRhythm':
            case 'driftSpeed':
            case 'currentSpeed':
            case 'lappingSpeed':
                this.fx.speed = Number(val);
                if (heroId === 'currentSpeed') {
                    this.fx.distortion = +(0.015 + 0.030 * (val / 3.0)).toFixed(3);
                }
                break;
            case 'waveQuantity':
                this.fx.shoreWaves = +(x).toFixed(2);
                break;
            case 'riverWaves':
                this.fx.riverWaves = +(x).toFixed(2);
                break;
            case 'foamHint':
                this.fx.whitecaps = +(x).toFixed(2);
                break;
            case 'waveRegularity':
                this.fx.waveRegularity = +(x).toFixed(2);
                break;
            case 'waterClarity':
                if (this.activeArchetype === 'ocean') {
                    this.fx.opacity = +(0.45 - 0.28 * x).toFixed(2);
                    this.fx.fadeWidth = Math.round(60 + 60 * x);
                } else if (this.activeArchetype === 'lake' || this.activeArchetype === 'pond') {
                    this.fx.opacity = +(0.38 - 0.26 * x).toFixed(2);
                    this.fx.fadeWidth = Math.round(30 + 50 * x);
                }
                break;
            case 'sunShimmer':
                this.fx.sunGlint = +(1.8 * x).toFixed(2);
                break;
            case 'surfEnergy':
                this.fx.shoreWaves = +(0.05 + 0.90 * x).toFixed(2);
                this.fx.waveSegment = +(0.65 + 0.30 * x).toFixed(2);
                this.fx.intensity = +(0.25 + 0.60 * x).toFixed(2);
                break;
            case 'swashSurge':
                this.fx.swashSurge = Number(val);
                if (this.activeArchetype === 'river') {
                    this.fx.shoreWaves = +(Math.min(1.0, (val / 40.0) * 0.80)).toFixed(2);
                }
                break;
            case 'shorelineSoftness':
            case 'bankFeathering':
            case 'shallowsMargin':
            case 'wetRimBlend':
                this.fx.fadeWidth = Math.round(Number(val));
                break;
            case 'surfaceBreeze':
                this.fx.intensity = +(0.08 + 0.50 * x).toFixed(2);
                this.fx.distortion = +(0.005 + 0.022 * x).toFixed(3);
                this.fx.scale = Math.round(150 - 60 * x);
                break;
            case 'flowHeading':
            case 'windDirection':
            case 'surfHeading':
                this.fx.flowAngle = Math.round(Number(val)) % 360;
                break;
            case 'whiteWaterChurn':
                this.fx.shoreWaves = +(0.05 + 0.65 * x).toFixed(2);
                this.fx.waveSegment = +(0.60 + 0.35 * x).toFixed(2);
                this.fx.scale = Math.round(120 - 45 * x);
                break;
            case 'surfaceAgitation':
                this.fx.speed = +(0.20 + 0.90 * x).toFixed(2);
                this.fx.intensity = +(0.10 + 0.45 * x).toFixed(2);
                break;
            case 'siltMurkiness':
                this.fx.opacity = +(0.10 + 0.32 * x).toFixed(2);
                this.fx.distortion = +(0.008 + 0.025 * x).toFixed(3);
                break;
            case 'rainTremor':
                this.fx.speed = +(0.40 + 1.20 * x).toFixed(2);
                this.fx.intensity = +(0.10 + 0.40 * x).toFixed(2);
                this.fx.scale = Math.round(35 + 30 * x);
                break;
            case 'mudSilt':
                this.fx.opacity = +(0.08 + 0.35 * x).toFixed(2);
                this.fx.distortion = +(0.010 + 0.025 * x).toFixed(3);
                break;
        }
        this.#liveUpdateFX();
    }

    #syncAdvancedDrawerFromFX(root) {
        const setDrawerInput = (name, val, formatted) => {
            const el = root.querySelector(`.wc-drawer-content input[name="${name}"]`);
            if (el) {
                el.value = val;
                if (el.nextElementSibling) el.nextElementSibling.innerHTML = formatted;
            }
        };

        setDrawerInput('speed', this.fx.speed, this.fx.speed.toFixed(2));
        setDrawerInput('intensity', this.fx.intensity, this.fx.intensity.toFixed(2));
        setDrawerInput('opacity', this.fx.opacity, this.fx.opacity.toFixed(2));
        setDrawerInput('distortion', this.fx.distortion, this.fx.distortion.toFixed(3));
        setDrawerInput('fadeWidth', this.fx.fadeWidth, `${Math.round(this.fx.fadeWidth)}px`);
        setDrawerInput('scale', this.fx.scale, String(this.fx.scale));
        setDrawerInput('shoreWaves', this.fx.shoreWaves, this.fx.shoreWaves.toFixed(2));
        setDrawerInput('waveSegment', this.fx.waveSegment, this.fx.waveSegment.toFixed(2));
        setDrawerInput('swashSurge', this.fx.swashSurge, `${Math.round(this.fx.swashSurge)}px`);
        setDrawerInput('choppySeas', this.fx.choppySeas, this.fx.choppySeas.toFixed(2));
        setDrawerInput('whitecaps', this.fx.whitecaps, this.fx.whitecaps.toFixed(2));
        setDrawerInput('sunGlint', this.fx.sunGlint, this.fx.sunGlint.toFixed(2));
        setDrawerInput('flowAngle', this.fx.flowAngle, `${Math.round(this.fx.flowAngle)}&deg;`);
    }

    #syncHeroSlidersFromFX(root) {
        const heroSliders = this.#buildHeroSliders(this.activeArchetype, this.fx);
        for (const slider of heroSliders) {
            const input = root.querySelector(`input[name="hero_${slider.id}"]`);
            if (input) {
                input.value = slider.value;
                if (input.nextElementSibling) input.nextElementSibling.textContent = slider.displayValue;
            }
            if (slider.isDirection) {
                const arrowPivot = root.querySelector('.direction-arrow-pivot');
                if (arrowPivot) arrowPivot.style.transform = `rotate(${slider.value}deg)`;
                const badge = root.querySelector('.direction-angle-badge');
                if (badge) badge.textContent = slider.displayValue;
            }
        }
    }

    async #saveCustomWaterPreset(name) {
        const presets = game.settings.get(MODULE_ID, 'waterCustomPresets') ?? {};
        const key = `user_${this.activeArchetype}_${name.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '')}`;
        presets[key] = {
            name,
            archetype: this.activeArchetype,
            speed: this.fx.speed,
            intensity: this.fx.intensity,
            opacity: this.fx.opacity,
            distortion: this.fx.distortion,
            fadeWidth: this.fx.fadeWidth,
            scale: this.fx.scale,
            flowAngle: this.fx.flowAngle,
            shoreWaves: this.fx.shoreWaves,
            waveSegment: this.fx.waveSegment,
            waveRegularity: this.fx.waveRegularity,
            swashSurge: this.fx.swashSurge,
            choppySeas: this.fx.choppySeas,
            riverWaves: this.fx.riverWaves ?? 0.0,
            lakeWaves: this.fx.lakeWaves ?? 0.0,
            lakeRings: this.fx.lakeRings !== false,
            whitecaps: this.fx.whitecaps,
            sunGlint: this.fx.sunGlint,
            spindriftWake: this.fx.spindriftWake,
            crestBound: this.fx.crestBound,
            colorOverride: this.fx.autoColor ? '' : this.fx.colorOverride
        };
        await game.settings.set(MODULE_ID, 'waterCustomPresets', presets);
        this.activePreset = key;
        this.showPresetPrompt = false;
        this.render();
        ui.notifications.info(`Waterline | Saved ${WATER_ARCHETYPES[this.activeArchetype]?.label || ''} preset "${name}".`);
    }

    #deleteCustomWaterPreset(key) {
        const presets = game.settings.get(MODULE_ID, 'waterCustomPresets') ?? {};
        if (!presets[key]) return;
        delete presets[key];
        game.settings.set(MODULE_ID, 'waterCustomPresets', presets);
        const defaultPresetKey = WATER_ARCHETYPES[this.activeArchetype]?.defaultPreset || 'river';
        this.#onSelectWaterPreset(defaultPresetKey);
    }

    #liveUpdateFX() {
        this.hasUnsavedChanges = true;
        if (this.#rafId) cancelAnimationFrame(this.#rafId);
        this.#rafId = requestAnimationFrame(() => {
            const meshes = WaterManager.getMeshesForRegion(this.activeRegionId);
            for (const mesh of meshes) {
                mesh.setSpeed(this.fx.speed);
                mesh.setIntensity(this.fx.intensity);
                mesh.setOpacity(this.fx.opacity);
                mesh.setDistortion(this.fx.distortion);
                mesh.setFadeWidth(this.fx.fadeWidth);
                mesh.setScale(this.fx.scale);
                mesh.setFlowAngle(this.fx.flowAngle);
                mesh.setShoreWaves(this.fx.shoreWaves);
                mesh.setWaveSegment(this.fx.waveSegment);
                mesh.setWaveRegularity(this.fx.waveRegularity);
                mesh.setSwashSurge(this.fx.swashSurge);
                mesh.setChoppySeas(this.fx.choppySeas);
                mesh.setRiverWaves(this.fx.riverWaves ?? 0.0);
                mesh.setLakeWaves(this.fx.lakeWaves ?? 0.0);
                mesh.setLakeRings(this.fx.lakeRings !== false);
                mesh.setWhitecaps(this.fx.whitecaps);
                mesh.setSunGlint(this.fx.sunGlint);
                mesh.setSpindriftWake(this.fx.spindriftWake);
                mesh.setCrestBound(this.fx.crestBound);
            }
        });
    }

    async #saveActiveWaterbodyFX() {
        if (!this.activeRegionId) {
            ui.notifications.warn('Waterline | No waterbody selected.');
            return;
        }

        const activeRegion = canvas.scene?.regions?.get(this.activeRegionId);
        if (!activeRegion) return;

        const behaviorType = `${MODULE_ID}.waterFX`;
        const colorOverride = this.fx.autoColor ? '' : this.fx.colorOverride;
        const systemUpdate = {
            archetype: this.activeArchetype,
            waterType: this.activePreset,
            speed: this.fx.speed,
            intensity: this.fx.intensity,
            opacity: this.fx.opacity,
            distortion: this.fx.distortion,
            fadeWidth: this.fx.fadeWidth,
            scale: this.fx.scale,
            flowAngle: this.fx.flowAngle,
            shoreWaves: this.fx.shoreWaves,
            waveSegment: this.fx.waveSegment,
            waveRegularity: this.fx.waveRegularity,
            swashSurge: this.fx.swashSurge,
            choppySeas: this.fx.choppySeas,
            riverWaves: this.fx.riverWaves ?? 0.0,
            lakeWaves: this.fx.lakeWaves ?? 0.0,
            lakeRings: this.fx.lakeRings !== false,
            whitecaps: this.fx.whitecaps,
            sunGlint: this.fx.sunGlint,
            spindriftWake: this.fx.spindriftWake,
            crestBound: this.fx.crestBound,
            colorOverride
        };

        const targetRegions = [activeRegion];
        if (this.applyToAllSameArchetype) {
            const allRegions = canvas.scene?.regions?.contents ?? canvas.scene?.regions ?? [];
            for (const r of allRegions) {
                if (r.id === activeRegion.id) continue;
                const beh = r.behaviors?.find(b => b.type === behaviorType);
                if (beh) {
                    const rArch = beh.system?.archetype || WaterManager.inferArchetype(beh.system?.waterType);
                    if (rArch === this.activeArchetype) targetRegions.push(r);
                }
            }
        }

        let updated = 0;
        for (const r of targetRegions) {
            const beh = r.behaviors?.find(b => b.type === behaviorType);
            if (!beh) continue;
            try {
                await beh.update({ system: systemUpdate });
                updated++;
            } catch (err) {
                console.error(`Waterline | Failed to update water FX on ${r.name}:`, err);
            }
        }

        this.hasUnsavedChanges = false;
        if (updated > 1) {
            ui.notifications.info(`Waterline | Saved settings to ${updated} ${WATER_ARCHETYPES[this.activeArchetype]?.label || ''} bodies.`);
        } else {
            ui.notifications.info(`Waterline | Saved settings for "${activeRegion.name}".`);
        }
    }

    async #renameWaterRegion(regionId, newName) {
        if (!regionId || !newName?.trim()) return;
        const region = canvas.scene?.regions?.get(regionId);
        if (!region) return;
        await region.update({ name: newName.trim() });
    }

    #focusRegionOnCanvas(regionId) {
        if (!regionId) return;
        const region = canvas.scene?.regions?.get(regionId);
        if (!region) return;
        const pts = region.shapes?.[0]?.points;
        if (!pts || !pts.length) return;
        let sumX = 0, sumY = 0, n = pts.length / 2;
        for (let i = 0; i < pts.length; i += 2) {
            sumX += pts[i];
            sumY += pts[i + 1];
        }
        const cx = sumX / n;
        const cy = sumY / n;
        canvas.animatePan({ x: cx, y: cy, duration: 400 });
    }

    async #editRegionBoundary(regionId) {
        const region = canvas.scene?.regions?.get(regionId);
        if (!region) return;

        this.activeRegionId = regionId;
        this.#loadActiveRegionFX(regionId);
        this.#focusRegionOnCanvas(regionId);

        const loaded = await this.sampler.loadRegionForEditing(regionId, {
            onCandidate: () => this.render(),
            onClear: () => this.render(),
            onStatus: (msg) => ui.notifications.info(`Waterline | ${msg}`)
        });

        if (loaded) {
            this.render();
        }
    }
}
