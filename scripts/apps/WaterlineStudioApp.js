import { WaterSamplingController } from '../controllers/WaterSamplingController.js';
import { WATER_PRESETS, WATER_ARCHETYPES, WaterManager } from '../water/WaterManager.js';
import { WaterShapeEstimator } from '../water/WaterShapeEstimator.js';
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
    /** @type {boolean} */
    #isSamplingColor = false;
    /** @type {Function|null} */
    #cancelColorSampler = null;

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
        waveCount: 4,
        waveSegment: 0.85,
        waveRegularity: 0.60,
        swashSurge: 24.0,
        surfFoam: 0.70,
        choppySeas: 0.0,
        riverWaves: 0.65,
        lakeWaves: 0.0,
        lakeRings: 0.0,
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

    /**
     * Maximum shoreline margin (fadeWidth in px) supported per archetype.
     * @param {string} archetype
     * @returns {number}
     */
    static getMaxFadeWidth(archetype) {
        switch (archetype) {
            case 'ocean':
            case 'coast':
                return 150;
            case 'river':
                return 120;
            case 'lake':
                return 100;
            case 'pond':
                return 80;
            case 'puddle':
                return 40;
            default:
                return 120;
        }
    }

    /**
     * Map slider position (0-100) to shoreline margin (px).
     * High-resolution piecewise C1 curve: 0..40 maps linearly to 0..20px (1px resolution),
     * while 40..100 smoothly curves up to maxMargin with diminishing fidelity.
     * @param {number} pos - Slider position 0..100
     * @param {number} maxMargin - Maximum margin in px
     * @returns {number} Margin in pixels
     */
    static sliderToFadeWidth(pos, maxMargin = 120) {
        const s = Math.max(0, Math.min(100, Number(pos) || 0));
        const u0 = 0.40;
        const p0 = 20;
        if (maxMargin <= p0) {
            return Math.round((s / 100) * maxMargin);
        }
        const S0 = p0 / u0;
        const k0 = S0 * (1 - u0);
        const A = maxMargin - p0 - k0;

        const u = s / 100;
        if (u <= u0) {
            return Math.round((u / u0) * p0);
        }
        const t = (u - u0) / (1 - u0);
        if (A === 0) return Math.round(p0 + k0 * t);
        return Math.round(p0 + k0 * t + A * t * t);
    }

    /**
     * Map shoreline margin (px) to slider position (0-100).
     * Exact inverse of sliderToFadeWidth.
     * @param {number} px - Margin in px
     * @param {number} maxMargin - Maximum margin in px
     * @returns {number} Slider position 0..100
     */
    static fadeWidthToSlider(px, maxMargin = 120) {
        const p = Math.max(0, Math.min(maxMargin, Number(px) || 0));
        const u0 = 0.40;
        const p0 = 20;
        if (maxMargin <= p0) {
            return Math.round((p / maxMargin) * 100);
        }
        const S0 = p0 / u0;
        const k0 = S0 * (1 - u0);
        const A = maxMargin - p0 - k0;

        if (p <= p0) {
            return Math.round((p / p0) * (u0 * 100));
        }
        const deltaP = p - p0;
        if (A === 0) {
            const t = deltaP / k0;
            return Math.round((u0 + t * (1 - u0)) * 100);
        }
        const disc = Math.max(0, k0 * k0 + 4 * A * deltaP);
        const t = (-k0 + Math.sqrt(disc)) / (2 * A);
        return Math.round((u0 + t * (1 - u0)) * 100);
    }

    /** @override */
    async close(options = {}) {
        options.animate = false;
        return super.close(options);
    }

    /** @override */
    _preClose(_options) {
        if (this.#rafId) {
            cancelAnimationFrame(this.#rafId);
            this.#rafId = null;
        }
        this.sampler?.cleanup();
        this.#cancelColorSampler?.();
    }

    /** @override */
    _onClose(_options) {
        WaterlineStudioApp._instance = null;
    }

    // ------------------------------------------------------------------
    // Context Preparation & Helpers
    // ------------------------------------------------------------------

    #getRegionWaterBehavior(region) {
        if (!region) return null;
        const behaviorType = `${MODULE_ID}.waterFX`;
        const behaviors = region.behaviors?.contents ?? region.behaviors ?? [];
        return Array.isArray(behaviors) ? behaviors.find(b => b.type === behaviorType) : null;
    }

    #getRegionArchetype(region) {
        if (!region) return 'river';
        const behavior = this.#getRegionWaterBehavior(region);
        let archKey = behavior?.system?.archetype;
        const hasConfiguredFlag = Boolean(
            region.flags?.[MODULE_ID]?.configured ||
            behavior?.flags?.[MODULE_ID]?.configured
        );
        const isConfigured = hasConfiguredFlag || Boolean(
            behavior?.system?.waterType &&
            behavior.system.waterType !== 'custom' &&
            behavior.system.archetype &&
            behavior.system.archetype !== 'river'
        );

        if (!isConfigured) {
            const pts = WaterShapeEstimator.extractRegionPoints(region);
            if (pts && pts.length >= 6) {
                const est = WaterShapeEstimator.estimateRegion(region, canvas?.dimensions);
                if (est?.archetype) archKey = est.archetype;
            }
        }
        return archKey || WaterManager.inferArchetype(behavior?.system?.waterType) || 'river';
    }

    /** @override */
    async _prepareContext(_options) {
        const regions = canvas.scene?.regions?.contents ?? canvas.scene?.regions ?? [];
        const zones = [];
        const unattachedRegions = [];

        for (const region of regions) {
            const behavior = this.#getRegionWaterBehavior(region);
            const pts = WaterShapeEstimator.extractRegionPoints(region);
            const verts = pts ? Math.round(pts.length / 2) : 0;
            if (behavior) {
                const archKey = (region.id === this.activeRegionId && this.activeArchetype)
                    ? this.activeArchetype
                    : this.#getRegionArchetype(region);
                const archMeta = WATER_ARCHETYPES[archKey] ?? WATER_ARCHETYPES.river;

                zones.push({
                    region,
                    id: region.id,
                    name: region.name || 'Water Zone',
                    verts,
                    archetype: archKey,
                    archetypeLabel: archMeta.label,
                    archetypeIcon: archMeta.icon,
                    archetypeColor: archMeta.accentColor,
                    isActive: region.id === this.activeRegionId
                });
            } else if (verts >= 3) {
                const est = pts && pts.length >= 6 ? WaterShapeEstimator.estimate({ points: pts, vertexCount: verts }, canvas?.dimensions) : null;
                unattachedRegions.push({
                    region,
                    id: region.id,
                    name: region.name || 'Scene Region',
                    verts,
                    estimation: est
                });
            }
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
        this.fx.surfFoam = Number.isFinite(this.fx.surfFoam) ? this.fx.surfFoam : 0.70;
        this.fx.choppySeas = Number.isFinite(this.fx.choppySeas) ? this.fx.choppySeas : 0.0;
        this.fx.riverWaves = Number.isFinite(this.fx.riverWaves) ? this.fx.riverWaves : 0.0;
        this.fx.lakeWaves = Number.isFinite(this.fx.lakeWaves) ? this.fx.lakeWaves : 0.0;
        this.fx.lakeRings = Number.isFinite(this.fx.lakeRings) ? this.fx.lakeRings : (this.fx.lakeRings ? 0.70 : 0.0);
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
            unattachedRegions,
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
            hasEyeDropper: typeof window !== 'undefined' && ('EyeDropper' in window || Boolean(globalThis.canvas?.ready)),
            colorOverrideHex: (this.fx.colorOverride || '#0d2e4d').replace('#', '').toUpperCase(),
            fx: {
                ...this.fx,
                colorOverride: this.fx.colorOverride || '#0d2e4d'
            },
            wake,
            wakePresets,
            activeWakePreset: this.activeWakePreset,
            showWakePresetPrompt: this.showWakePresetPrompt
        };
    }

    /** @override */
    async _renderHTML(context, _options) {
        const templatePath = `modules/${MODULE_ID}/templates/studio.hbs`;
        const htmlString = await renderTemplate(templatePath, context);
        const el = document.createElement('div');
        el.className = 'waterline-studio-root';
        el.innerHTML = htmlString;
        this.#wireListeners(el);
        return el;
    }

    /** @override */
    _replaceHTML(result, content, _options) {
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
            cardEl.addEventListener('click', () => {
                const regionId = cardEl.dataset.regionId;
                if (!regionId || regionId === this.activeRegionId) return;
                if (this.sampler?.editingRegionId && this.sampler.editingRegionId !== regionId) {
                    this.sampler.discardCandidate();
                }
                this.applyToAllSameArchetype = false;
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

        // Adopt unattached scene region
        root.querySelector('[data-action="adoptSceneRegion"]')?.addEventListener('click', async () => {
            const select = root.querySelector('select[name="unattachedRegionSelect"]');
            const regionId = select?.value;
            if (!regionId) return;

            const region = canvas.scene?.regions?.get(regionId);
            if (!region) return;

            const est = WaterShapeEstimator.estimateRegion(region) ?? WaterShapeEstimator.estimate({ points: [], vertexCount: 0 });
            const presetKey = est.preset || 'river';
            const preset = WATER_PRESETS[presetKey] ?? {};

            const system = {
                archetype: est.archetype,
                waterType: presetKey,
                flowAngle: est.flowAngle ?? 90,
                speed: preset.speed ?? 1.0,
                intensity: preset.intensity ?? 0.3,
                opacity: preset.opacity ?? 0.2,
                distortion: preset.distortion ?? 0.02,
                fadeWidth: preset.fadeWidth ?? 50,
                scale: preset.scale ?? 90,
                shoreWaves: preset.shoreWaves ?? 0.2,
                swashSurge: preset.swashSurge ?? 16.0,
                surfFoam: preset.surfFoam ?? 0.70,
                waveSegment: preset.waveSegment ?? 0.85,
                waveRegularity: preset.waveRegularity ?? 0.60,
                choppySeas: preset.choppySeas ?? 0.0,
                riverWaves: preset.riverWaves ?? (est.archetype === 'river' ? 0.65 : 0.0),
                lakeWaves: (est.archetype === 'lake' || est.archetype === 'pond') ? (preset.lakeWaves ?? 0.25) : 0.0,
                lakeRings: (est.archetype === 'lake' || est.archetype === 'pond' || est.archetype === 'puddle') ? (typeof preset.lakeRings === 'number' ? preset.lakeRings : (preset.lakeRings ? 0.70 : 0.0)) : 0.0,
                whitecaps: preset.whitecaps ?? 0.1,
                sunGlint: preset.sunGlint ?? 0.3,
                colorOverride: preset.colorOverride || ''
            };

            await region.createEmbeddedDocuments('RegionBehavior', [{
                type: `${MODULE_ID}.waterFX`,
                name: 'Water FX',
                flags: {
                    [MODULE_ID]: { configured: true }
                },
                system
            }]);
            await region.setFlag(MODULE_ID, 'configured', true);

            this.activeRegionId = regionId;
            this.#loadActiveRegionFX(regionId);
            this.#liveUpdateFX();
            this.render();
            ui.notifications.info(`Waterline | Added "${region.name}".`);
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
                    if (heroId === 'waveCount') {
                        display.textContent = `${Math.round(val)}`;
                    } else if (heroId === 'speed' || heroId === 'swellSpeed' || heroId === 'waveRhythm' || heroId === 'driftSpeed' || heroId === 'currentSpeed' || heroId === 'lappingSpeed') {
                        display.textContent = `${val.toFixed(2)}x`;
                    } else if (heroId === 'fadeWidth' || heroId === 'shorelineSoftness' || heroId === 'bankFeathering' || heroId === 'shallowsMargin' || heroId === 'wetRimBlend') {
                        display.textContent = `${Math.round(this.fx.fadeWidth)}px`;
                    } else if (heroId === 'swashSurge' || heroId === 'waveScale') {
                        display.textContent = `${Math.round(val)}px`;
                    } else if (heroId === 'flowAngle' || heroId === 'flowHeading' || heroId === 'windDirection' || heroId === 'surfHeading') {
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
            'shoreWaves', 'waveCount', 'waveSegment', 'swashSurge', 'surfFoam', 'choppySeas',
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
                    else if (name === 'waveCount') display.textContent = String(Math.round(val));
                    else if (['speed', 'intensity', 'opacity', 'shoreWaves', 'surfFoam', 'waveSegment', 'choppySeas', 'whitecaps', 'sunGlint'].includes(name)) display.textContent = val.toFixed(2);
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

        // ── Color Override, Hex Dial, EyeDropper & Auto-Color ──────────────────
        const colorInput = root.querySelector('input[name="colorOverride"]');
        const hexInput = root.querySelector('input[name="colorOverrideHex"]');
        const autoColorCheckbox = root.querySelector('input[name="autoColor"]');
        const dropperBtn = root.querySelector('[data-action="sampleScreenColor"]');
        const statusPill = root.querySelector('.wc-color-status-pill');

        const updateColorUIState = (hexVal, isAuto) => {
            const cleanHex = hexVal.startsWith('#') ? hexVal : `#${hexVal}`;
            if (colorInput && colorInput.value !== cleanHex) colorInput.value = cleanHex;
            const pickerWrap = root.querySelector('.wc-color-picker-wrap');
            if (pickerWrap) pickerWrap.style.backgroundColor = cleanHex;
            if (hexInput && hexInput.value !== cleanHex.slice(1).toUpperCase()) {
                hexInput.value = cleanHex.slice(1).toUpperCase();
            }
            if (autoColorCheckbox) autoColorCheckbox.checked = isAuto;
            if (statusPill) {
                statusPill.className = `wc-color-status-pill ${isAuto ? 'status-auto' : 'status-override'}`;
                statusPill.innerHTML = isAuto
                    ? '<i class="fas fa-eye"></i> <span>Sampling Map</span>'
                    : '<i class="fas fa-brush"></i> <span>Custom Tint</span>';
            }
        };

        if (autoColorCheckbox) {
            autoColorCheckbox.addEventListener('change', (ev) => {
                this.fx.autoColor = ev.target.checked;
                if (!this.fx.autoColor && !this.fx.colorOverride) {
                    this.fx.colorOverride = colorInput?.value || '#0d2e4d';
                }
                updateColorUIState(this.fx.colorOverride || '#0d2e4d', this.fx.autoColor);
                this.#liveUpdateFX();
            });
        }

        if (colorInput) {
            colorInput.addEventListener('input', (ev) => {
                this.fx.colorOverride = ev.target.value;
                this.fx.autoColor = false;
                updateColorUIState(this.fx.colorOverride, false);
                this.#liveUpdateFX();
            });
        }

        if (hexInput) {
            hexInput.addEventListener('input', (ev) => {
                const text = ev.target.value.replace(/[^0-9a-fA-F]/g, '').slice(0, 6);
                ev.target.value = text.toUpperCase();
                if (text.length === 6) {
                    const fullHex = `#${text.toLowerCase()}`;
                    this.fx.colorOverride = fullHex;
                    this.fx.autoColor = false;
                    if (colorInput) colorInput.value = fullHex;
                    if (autoColorCheckbox) autoColorCheckbox.checked = false;
                    if (statusPill) {
                        statusPill.className = 'wc-color-status-pill status-override';
                        statusPill.innerHTML = '<i class="fas fa-brush"></i> <span>Custom Tint</span>';
                    }
                    this.#liveUpdateFX();
                }
            });

            hexInput.addEventListener('change', (ev) => {
                let text = ev.target.value.replace(/[^0-9a-fA-F]/g, '');
                if (text.length === 3) {
                    text = text.split('').map(c => c + c).join('');
                }
                if (text.length === 6) {
                    const fullHex = `#${text.toLowerCase()}`;
                    this.fx.colorOverride = fullHex;
                    this.fx.autoColor = false;
                    updateColorUIState(fullHex, false);
                    this.#liveUpdateFX();
                } else {
                    updateColorUIState(this.fx.colorOverride || '#0d2e4d', this.fx.autoColor);
                }
            });
        }

        if (dropperBtn) {
            dropperBtn.addEventListener('click', (ev) => {
                ev.preventDefault();
                ev.stopPropagation();
                this.#toggleCanvasColorSampler(dropperBtn, updateColorUIState);
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
                if (this.applyToAllSameArchetype) {
                    this.#liveUpdateFX();
                }
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
    // Interactive Canvas Color Sampling
    // ------------------------------------------------------------------

    /**
     * Toggles interactive canvas color sampling mode.
     * Samples the true map artwork color directly from the background canvas on click.
     * @param {HTMLElement} btn
     * @param {Function} updateColorUIState
     */
    #toggleCanvasColorSampler(btn, updateColorUIState) {
        if (this.#isSamplingColor) {
            this.#cancelColorSampler?.();
            return;
        }

        if (!canvas?.ready) {
            ui.notifications?.warn('Canvas is not ready for color sampling.');
            return;
        }

        this.#isSamplingColor = true;
        btn.classList.add('active');
        btn.setAttribute('title', 'Sampling map... Click on water or press Escape to cancel');

        const prevCursor = canvas.stage.cursor;
        canvas.stage.cursor = 'crosshair';

        const cleanup = () => {
            this.#isSamplingColor = false;
            this.#cancelColorSampler = null;
            btn.classList.remove('active');
            btn.setAttribute('title', 'Sample color directly from canvas or map');
            if (canvas?.stage) {
                canvas.stage.off('pointerdown', onCanvasClick);
                canvas.stage.cursor = prevCursor || 'default';
            }
            window.removeEventListener('keydown', onKeyDown);
            document.removeEventListener('pointerdown', onDocPointerDown, true);
        };

        this.#cancelColorSampler = cleanup;

        const onKeyDown = (e) => {
            if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                cleanup();
            }
        };

        const onDocPointerDown = (e) => {
            if (btn.contains(e.target)) return;
            if (e.target.closest?.('.waterline-studio-root')) {
                cleanup();
            }
        };

        const onCanvasClick = (event) => {
            const mouseBtn = event.data?.button ?? event.button ?? 0;
            if (mouseBtn !== 0) {
                cleanup();
                return;
            }
            event.stopPropagation();
            const worldPt = event.data?.getLocalPosition?.(canvas.stage)
                ?? event.getLocalPosition?.(canvas.stage)
                ?? (event.global ? canvas.stage.toLocal(event.global) : null)
                ?? canvas.mousePosition
                ?? { x: event.x, y: event.y };
            const hex = this.sampleColorAtWorld(worldPt.x, worldPt.y);
            if (hex) {
                this.fx.colorOverride = hex;
                this.fx.autoColor = false;
                updateColorUIState(hex, false);
                this.#liveUpdateFX();
            }
            cleanup();
        };

        setTimeout(() => {
            if (!this.#isSamplingColor) return;
            canvas.stage.once('pointerdown', onCanvasClick);
            window.addEventListener('keydown', onKeyDown, { once: true });
            document.addEventListener('pointerdown', onDocPointerDown, true);
        }, 50);
    }

    /**
     * Samples the RGB color of the scene background artwork at a given world coordinate.
     * Returns a 6-digit hex string (e.g. '#1a4b6e').
     * @param {number} worldX
     * @param {number} worldY
     * @returns {string|null}
     */
    sampleColorAtWorld(worldX, worldY) {
        // 1. Read directly from the background sprite's texture source (ImageBitmap or HTMLImageElement)
        const bg = canvas.primary?.background;
        const source = bg?.texture?.baseTexture?.resource?.source;
        const dims = canvas.dimensions;
        if (source && dims) {
            const scaleX = source.width / dims.sceneWidth;
            const scaleY = source.height / dims.sceneHeight;
            const imgX = Math.round((worldX - dims.sceneX) * scaleX);
            const imgY = Math.round((worldY - dims.sceneY) * scaleY);
            if (imgX >= 0 && imgX < source.width && imgY >= 0 && imgY < source.height) {
                const canvasEl = document.createElement('canvas');
                canvasEl.width = 1;
                canvasEl.height = 1;
                const ctx = canvasEl.getContext('2d', { willReadFrequently: true });
                ctx.drawImage(source, imgX, imgY, 1, 1, 0, 0, 1, 1);
                const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
                if (a > 0) {
                    return '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');
                }
            }
        }

        // 2. Fallback: extract from canvas.primary or canvas.stage
        try {
            const rect = new PIXI.Rectangle(worldX, worldY, 1, 1);
            const px = canvas.app?.renderer?.extract?.pixels?.(canvas.primary || canvas.stage, rect);
            if (px && px.length >= 3) {
                return '#' + [px[0], px[1], px[2]].map(v => v.toString(16).padStart(2, '0')).join('');
            }
        } catch {
            // Fallback silent ignore
        }

        return null;
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

        const hasConfiguredFlag = Boolean(
            region.flags?.[MODULE_ID]?.configured ||
            b?.flags?.[MODULE_ID]?.configured
        );

        const isConfigured = hasConfiguredFlag || Boolean(
            b?.system?.waterType &&
            b.system.waterType !== 'custom' &&
            b.system.archetype &&
            b.system.archetype !== 'river'
        );

        // One-time initial estimation for brand new or unconfigured waterbodies
        const shouldEstimate = !isConfigured;

        if (shouldEstimate) {
            const est = WaterShapeEstimator.estimateRegion(region);
            if (est) {
                this.activeArchetype = est.archetype;
                this.activePreset = est.preset;
                const preset = WATER_PRESETS[est.preset] ?? {};
                this.fx = {
                    ...this.fx,
                    speed: preset.speed ?? 1.0,
                    intensity: preset.intensity ?? 0.3,
                    opacity: preset.opacity ?? 0.2,
                    distortion: preset.distortion ?? 0.02,
                    fadeWidth: preset.fadeWidth ?? 50,
                    scale: preset.scale ?? 90,
                    flowAngle: est.flowAngle ?? preset.flowAngle ?? 90,
                    shoreWaves: preset.shoreWaves ?? 0.2,
                    waveCount: preset.waveCount ?? 4,
                    waveSegment: preset.waveSegment ?? 0.85,
                    waveRegularity: preset.waveRegularity ?? 0.60,
                    swashSurge: preset.swashSurge ?? 16.0,
                    surfFoam: preset.surfFoam ?? 0.70,
                    choppySeas: preset.choppySeas ?? 0.0,
                    riverWaves: preset.riverWaves ?? (est.archetype === 'river' ? 0.65 : 0.0),
                    lakeWaves: (est.archetype === 'lake' || est.archetype === 'pond') ? (preset.lakeWaves ?? 0.25) : 0.0,
                    lakeRings: (est.archetype === 'lake' || est.archetype === 'pond' || est.archetype === 'puddle') ? (typeof preset.lakeRings === 'number' ? preset.lakeRings : (preset.lakeRings ? 0.70 : 0.0)) : 0.0,
                    whitecaps: preset.whitecaps ?? 0.1,
                    sunGlint: preset.sunGlint ?? 0.3,
                    spindriftWake: preset.spindriftWake ?? false,
                    crestBound: preset.crestBound ?? false,
                    colorOverride: preset.colorOverride || '',
                    autoColor: !preset.colorOverride
                };
            }
        } else if (b?.system) {
            const s = b.system;
            const loadedPreset = s.waterType === 'abyssal_depths' ? 'ocean_calm' : (s.waterType || 'river');
            const loadedArchetype = s.archetype || WaterManager.inferArchetype(loadedPreset);
            const isSmallBody = (loadedArchetype === 'lake' || loadedArchetype === 'pond' || loadedArchetype === 'puddle');

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
                waveCount: Number.isFinite(s.waveCount) ? s.waveCount : (this.fx.waveCount ?? 4),
                waveSegment: Number.isFinite(s.waveSegment) ? s.waveSegment : this.fx.waveSegment,
                waveRegularity: Number.isFinite(s.waveRegularity) ? s.waveRegularity : (this.fx.waveRegularity ?? 0.60),
                swashSurge: Number.isFinite(s.swashSurge) ? s.swashSurge : this.fx.swashSurge,
                surfFoam: Number.isFinite(s.surfFoam) ? s.surfFoam : (this.fx.surfFoam ?? 0.70),
                choppySeas: Number.isFinite(s.choppySeas) ? s.choppySeas : (this.fx.choppySeas ?? 0.0),
                riverWaves: Number.isFinite(s.riverWaves) ? s.riverWaves : (this.fx.riverWaves ?? 0.0),
                lakeWaves: isSmallBody ? (Number.isFinite(s.lakeWaves) ? s.lakeWaves : (this.fx.lakeWaves ?? 0.0)) : 0.0,
                lakeRings: isSmallBody ? (Number.isFinite(s.lakeRings) ? Number(s.lakeRings) : (s.lakeRings ? 0.70 : 0.0)) : 0.0,
                whitecaps: Number.isFinite(s.whitecaps) ? s.whitecaps : (this.fx.whitecaps ?? 0.5),
                sunGlint: Number.isFinite(s.sunGlint) ? s.sunGlint : (this.fx.sunGlint ?? 0.6),
                spindriftWake: Boolean(s.spindriftWake),
                crestBound: Boolean(s.crestBound),
                colorOverride: s.colorOverride || '',
                autoColor: !s.colorOverride
            };
            this.activePreset = loadedPreset;
            this.activeArchetype = loadedArchetype;
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
            const isSmallBody = (this.activeArchetype === 'lake' || this.activeArchetype === 'pond' || this.activeArchetype === 'puddle');
            this.fx = {
                ...this.fx,
                speed: preset.speed ?? this.fx.speed,
                intensity: preset.intensity ?? this.fx.intensity,
                opacity: preset.opacity ?? this.fx.opacity,
                distortion: preset.distortion ?? this.fx.distortion,
                fadeWidth: preset.fadeWidth ?? this.fx.fadeWidth,
                scale: preset.scale ?? this.fx.scale,
                flowAngle: Number.isFinite(this.fx.flowAngle) ? this.fx.flowAngle : (preset.flowAngle ?? 90),
                shoreWaves: preset.shoreWaves ?? this.fx.shoreWaves,
                waveCount: preset.waveCount ?? this.fx.waveCount ?? 4,
                waveSegment: preset.waveSegment ?? this.fx.waveSegment,
                waveRegularity: preset.waveRegularity ?? this.fx.waveRegularity ?? 0.60,
                swashSurge: preset.swashSurge ?? this.fx.swashSurge,
                surfFoam: preset.surfFoam ?? this.fx.surfFoam,
                choppySeas: preset.choppySeas ?? this.fx.choppySeas,
                riverWaves: preset.riverWaves ?? 0.0,
                lakeWaves: isSmallBody ? (preset.lakeWaves ?? 0.0) : 0.0,
                lakeRings: isSmallBody ? (typeof preset.lakeRings === 'number' ? preset.lakeRings : (preset.lakeRings ? 0.70 : 0.0)) : 0.0,
                whitecaps: preset.whitecaps ?? this.fx.whitecaps,
                sunGlint: preset.sunGlint ?? this.fx.sunGlint,
                spindriftWake: preset.spindriftWake ?? false,
                crestBound: preset.crestBound ?? false,
                colorOverride: preset.colorOverride ?? (this.fx.autoColor ? '' : (this.fx.colorOverride || '')),
                autoColor: preset.colorOverride ? false : (key === 'custom' ? this.fx.autoColor : true)
            };
            this.#liveUpdateFX();
        }
        this.render();
    }

    #buildHeroSliders(archetype, fx) {
        switch (archetype) {
            case 'ocean': {
                const waveEnergyVal = Math.round(Math.min(100, Math.max(0, (fx.choppySeas / 1.2) * 100)));
                const waveCountVal = Math.round(fx.waveCount ?? 4);
                const surgeVal = Math.round(fx.swashSurge);
                const surfFoamVal = Math.round(Math.min(100, Math.max(0, (fx.surfFoam ?? 0.70) * 100)));
                const distortionVal = Math.round(Math.min(100, Math.max(0, ((fx.distortion ?? 0.025) / 0.050) * 100)));
                const speedVal = Number(fx.speed).toFixed(2);
                const maxMargin = WaterlineStudioApp.getMaxFadeWidth('ocean');
                const marginVal = Math.round(fx.fadeWidth ?? 60);
                const marginSliderVal = WaterlineStudioApp.fadeWidthToSlider(marginVal, maxMargin);
                const angleVal = Math.round(fx.flowAngle) % 360;
                return [
                    { id: 'waveEnergy', label: 'Wave Energy', tooltip: 'Swell height, turbulence, and whitecap churn.', min: 0, max: 100, step: 1, value: waveEnergyVal, displayValue: `${waveEnergyVal}%` },
                    { id: 'waveCount', label: 'Wave Count', tooltip: 'Density and count of rolling ocean swells.', min: 1, max: 8, step: 1, value: waveCountVal, displayValue: `${waveCountVal}` },
                    { id: 'swashSurge', label: 'Surge Reach', tooltip: 'Dynamic swash surging onto coastal banks or islands.', min: 0, max: 60, step: 1, value: surgeVal, displayValue: `${surgeVal}px` },
                    { id: 'surfFoam', label: 'Shoreline Foam', tooltip: 'Density of aerated cellular froth, surf wash, and shoreline bubbles.', min: 0, max: 100, step: 1, value: surfFoamVal, displayValue: `${surfFoamVal}%` },
                    { id: 'distortion', label: 'Lens Distortion', tooltip: 'Optical refraction and benthic lens distortion of submerged terrain.', min: 0, max: 100, step: 1, value: distortionVal, displayValue: `${distortionVal}%` },
                    { id: 'speed', label: 'Animation Speed', tooltip: 'Propagation velocity of rolling open-ocean swells.', min: 0.2, max: 2.0, step: 0.05, value: fx.speed, displayValue: `${speedVal}x` },
                    { id: 'fadeWidth', label: 'Shoreline Margin', tooltip: 'Width of the transparent fade into islands and coastlines (0px for crisp edge).', min: 0, max: 100, step: 1, value: marginSliderVal, displayValue: `${marginVal}px` },
                    { id: 'flowAngle', label: 'Flow Direction', tooltip: 'Bearing of ocean winds and traveling swells.', min: 0, max: 359, step: 1, value: angleVal, displayValue: `${angleVal}°`, isDirection: true, icon: 'fas fa-wind' }
                ];
            }
            case 'coast': {
                const waveEnergyVal = Math.round(Math.min(100, Math.max(0, ((fx.shoreWaves - 0.05) / 0.90) * 100)));
                const waveCountVal = Math.round(fx.waveCount ?? 4);
                const surgeVal = Math.round(fx.swashSurge);
                const surfFoamVal = Math.round(Math.min(100, Math.max(0, (fx.surfFoam ?? 0.85) * 100)));
                const distortionVal = Math.round(Math.min(100, Math.max(0, ((fx.distortion ?? 0.025) / 0.050) * 100)));
                const speedVal = Number(fx.speed).toFixed(2);
                const maxMargin = WaterlineStudioApp.getMaxFadeWidth('coast');
                const marginVal = Math.round(fx.fadeWidth);
                const marginSliderVal = WaterlineStudioApp.fadeWidthToSlider(marginVal, maxMargin);
                const angleVal = Math.round(fx.flowAngle) % 360;
                return [
                    { id: 'waveEnergy', label: 'Wave Energy', tooltip: 'Turbulence, swells, and foam density of incoming breakers.', min: 0, max: 100, step: 1, value: waveEnergyVal, displayValue: `${waveEnergyVal}%` },
                    { id: 'waveCount', label: 'Wave Count', tooltip: 'Number of incoming wave crests rolling and breaking toward the shore.', min: 1, max: 8, step: 1, value: waveCountVal, displayValue: `${waveCountVal}` },
                    { id: 'swashSurge', label: 'Surge Reach', tooltip: 'How far wave wash surges onto dry sand/rock.', min: 0, max: 60, step: 1, value: surgeVal, displayValue: `${surgeVal}px` },
                    { id: 'surfFoam', label: 'Shoreline Foam', tooltip: 'Density of aerated cellular froth, surf wash, and shoreline bubbles.', min: 0, max: 100, step: 1, value: surfFoamVal, displayValue: `${surfFoamVal}%` },
                    { id: 'distortion', label: 'Lens Distortion', tooltip: 'Optical refraction and benthic lens distortion of submerged terrain.', min: 0, max: 100, step: 1, value: distortionVal, displayValue: `${distortionVal}%` },
                    { id: 'speed', label: 'Animation Speed', tooltip: 'Arrival tempo of incoming shoreline sets.', min: 0.2, max: 2.0, step: 0.05, value: fx.speed, displayValue: `${speedVal}x` },
                    { id: 'fadeWidth', label: 'Shoreline Margin', tooltip: 'Width of the transparent fade into dry terrain (0px for crisp edge).', min: 0, max: 100, step: 1, value: marginSliderVal, displayValue: `${marginVal}px` },
                    { id: 'flowAngle', label: 'Flow Direction', tooltip: 'Angle of incoming coastal breakers.', min: 0, max: 359, step: 1, value: angleVal, displayValue: `${angleVal}°`, isDirection: true, icon: 'fas fa-compass' }
                ];
            }
            case 'lake': {
                const waveEnergyVal = Math.round(Math.min(100, Math.max(0, (fx.lakeWaves ?? 0.08) * 100)));
                const surgeVal = Math.round(fx.swashSurge ?? 5.0);
                const clarityVal = Math.round(Math.min(100, Math.max(0, ((0.38 - (fx.opacity ?? 0.15)) / 0.26) * 100)));
                const distortionVal = Math.round(Math.min(100, Math.max(0, ((fx.distortion ?? 0.025) / 0.050) * 100)));
                const speedVal = Number(fx.speed).toFixed(2);
                const maxMargin = WaterlineStudioApp.getMaxFadeWidth('lake');
                const marginVal = Math.round(fx.fadeWidth ?? 50);
                const marginSliderVal = WaterlineStudioApp.fadeWidthToSlider(marginVal, maxMargin);
                const angleVal = Math.round(fx.flowAngle) % 360;
                return [
                    { id: 'waveEnergy', label: 'Wave Energy', tooltip: 'Surface wave relief, wind ruffles, and edge chop.', min: 0, max: 100, step: 1, value: waveEnergyVal, displayValue: `${waveEnergyVal}%` },
                    { id: 'swashSurge', label: 'Surge Reach', tooltip: 'Dynamic swash surging onto the banks.', min: 0, max: 25, step: 1, value: surgeVal, displayValue: `${surgeVal}px` },
                    { id: 'waterClarity', label: 'Water Clarity', tooltip: 'Transparency revealing submerged lakebed and sunken terrain.', min: 0, max: 100, step: 1, value: clarityVal, displayValue: `${clarityVal}%` },
                    { id: 'distortion', label: 'Lens Distortion', tooltip: 'Optical refraction and benthic lens distortion of submerged terrain.', min: 0, max: 100, step: 1, value: distortionVal, displayValue: `${distortionVal}%` },
                    { id: 'speed', label: 'Animation Speed', tooltip: 'Pace of open-water breeze ripples and shore lapping.', min: 0.1, max: 2.0, step: 0.05, value: fx.speed, displayValue: `${speedVal}x` },
                    { id: 'fadeWidth', label: 'Shoreline Margin', tooltip: 'Width of the transparent fade into the bank (0px for crisp edge).', min: 0, max: 100, step: 1, value: marginSliderVal, displayValue: `${marginVal}px` },
                    { id: 'flowAngle', label: 'Flow Direction', tooltip: 'Surface wind drift bearing driving waves and downwind shore wash.', min: 0, max: 359, step: 1, value: angleVal, displayValue: `${angleVal}°`, isDirection: true, icon: 'fas fa-wind' }
                ];
            }
            case 'river': {
                const waveEnergyVal = Math.round(Math.min(100, Math.max(0, (fx.riverWaves ?? 0.65) * 100)));
                const surgeVal = Math.round(fx.swashSurge ?? 16.0);
                const shoreFoamVal = Math.round(Math.min(100, Math.max(0, ((fx.whitecaps ?? 0.14) / 0.65) * 100)));
                const distortionVal = Math.round(Math.min(100, Math.max(0, ((fx.distortion ?? 0.025) / 0.050) * 100)));
                const speedVal = Number(fx.speed).toFixed(2);
                const maxMargin = WaterlineStudioApp.getMaxFadeWidth('river');
                const marginVal = Math.round(fx.fadeWidth);
                const marginSliderVal = WaterlineStudioApp.fadeWidthToSlider(marginVal, maxMargin);
                const angleVal = Math.round(fx.flowAngle) % 360;
                return [
                    { id: 'waveEnergy', label: 'Wave Energy', tooltip: 'Density and presence of downstream riffles, rapids, and crest foam.', min: 0, max: 100, step: 1, value: waveEnergyVal, displayValue: `${waveEnergyVal}%` },
                    { id: 'swashSurge', label: 'Surge Reach', tooltip: 'Dynamic swash and wave wash surging onto the banks.', min: 0, max: 40, step: 1, value: surgeVal, displayValue: `${surgeVal}px` },
                    { id: 'shoreFoam', label: 'Shore Foam', tooltip: 'Density of downstream white-water riffles, crest froth, and bank wash.', min: 0, max: 100, step: 1, value: shoreFoamVal, displayValue: `${shoreFoamVal}%` },
                    { id: 'distortion', label: 'Lens Distortion', tooltip: 'Optical refraction and benthic lens distortion of submerged terrain.', min: 0, max: 100, step: 1, value: distortionVal, displayValue: `${distortionVal}%` },
                    { id: 'speed', label: 'Animation Speed', tooltip: 'Downstream flow velocity: lazy brook to roaring rapids.', min: 0.2, max: 2.0, step: 0.05, value: fx.speed, displayValue: `${speedVal}x` },
                    { id: 'fadeWidth', label: 'Shoreline Margin', tooltip: 'Feathering width where current meets riverbank (0px for crisp edge).', min: 0, max: 100, step: 1, value: marginSliderVal, displayValue: `${marginVal}px` },
                    { id: 'flowAngle', label: 'Flow Direction', tooltip: 'Bearing of water current.', min: 0, max: 359, step: 1, value: angleVal, displayValue: `${angleVal}°`, isDirection: true, icon: 'fas fa-location-arrow' }
                ];
            }
            case 'pond': {
                const waveEnergyVal = Math.round(Math.min(100, Math.max(0, (fx.lakeWaves ?? 0.25) * 100)));
                const surgeVal = Math.round(fx.swashSurge ?? 8.0);
                const clarityVal = Math.round(Math.min(100, Math.max(0, ((0.38 - (fx.opacity ?? 0.18)) / 0.26) * 100)));
                const dropRipplesVal = Math.round(Math.min(100, Math.max(0, (typeof fx.lakeRings === 'number' ? fx.lakeRings : (fx.lakeRings ? 0.70 : 0.0)) * 100)));
                const shimmerVal = Math.round(Math.min(100, Math.max(0, ((fx.sunGlint ?? 0.15) / 1.8) * 100)));
                const distortionVal = Math.round(Math.min(100, Math.max(0, ((fx.distortion ?? 0.025) / 0.050) * 100)));
                const speedVal = Number(fx.speed).toFixed(2);
                const maxMargin = WaterlineStudioApp.getMaxFadeWidth('pond');
                const marginVal = Math.round(fx.fadeWidth ?? 45);
                const marginSliderVal = WaterlineStudioApp.fadeWidthToSlider(marginVal, maxMargin);
                return [
                    { id: 'waveEnergy', label: 'Wave Energy', tooltip: 'Surface wave relief and micro-ripples across the pool.', min: 0, max: 100, step: 1, value: waveEnergyVal, displayValue: `${waveEnergyVal}%` },
                    { id: 'swashSurge', label: 'Bank Lapping', tooltip: 'Gentle water movement lapping against the pond edges.', min: 0, max: 20, step: 1, value: surgeVal, displayValue: `${surgeVal}px` },
                    { id: 'waterClarity', label: 'Water Clarity', tooltip: 'Transparency revealing submerged flora and bottom sediments.', min: 0, max: 100, step: 1, value: clarityVal, displayValue: `${clarityVal}%` },
                    { id: 'dropRipples', label: 'Drop Ripples', tooltip: 'Concentric disturbance rings from falling droplets, falling leaves, or rising fish (0% to silence).', min: 0, max: 100, step: 1, value: dropRipplesVal, displayValue: `${dropRipplesVal}%` },
                    { id: 'distortion', label: 'Lens Distortion', tooltip: 'Optical refraction and benthic lens distortion of submerged terrain.', min: 0, max: 100, step: 1, value: distortionVal, displayValue: `${distortionVal}%` },
                    { id: 'sunShimmer', label: 'Sun Shimmer', tooltip: 'Specular highlights glinting off surface tremors and ripples.', min: 0, max: 100, step: 1, value: shimmerVal, displayValue: `${shimmerVal}%` },
                    { id: 'speed', label: 'Animation Speed', tooltip: 'Pace of gentle surface ripples and shoreline lapping.', min: 0.1, max: 2.0, step: 0.05, value: fx.speed, displayValue: `${speedVal}x` },
                    { id: 'fadeWidth', label: 'Shoreline Margin', tooltip: 'Soft blend into reeds, mossy banks, or masonry (0px for crisp edge).', min: 0, max: 100, step: 1, value: marginSliderVal, displayValue: `${marginVal}px` }
                ];
            }
            case 'puddle': {
                const waveEnergyVal = Math.round(Math.min(100, Math.max(0, fx.shoreWaves * 100)));
                const dropRipplesVal = Math.round(Math.min(100, Math.max(0, (typeof fx.lakeRings === 'number' ? fx.lakeRings : (fx.lakeRings ? 0.70 : 0.0)) * 100)));
                const distortionVal = Math.round(Math.min(100, Math.max(0, ((fx.distortion ?? 0.025) / 0.050) * 100)));
                const speedVal = Number(fx.speed).toFixed(2);
                const regularityVal = Math.round(Math.min(100, Math.max(0, (fx.waveRegularity ?? 0.60) * 100)));
                const maxMargin = WaterlineStudioApp.getMaxFadeWidth('puddle');
                const marginVal = Math.round(fx.fadeWidth);
                const marginSliderVal = WaterlineStudioApp.fadeWidthToSlider(marginVal, maxMargin);
                return [
                    { id: 'waveEnergy', label: 'Wave Energy', tooltip: 'Edge micro-ripple intensity along puddle boundaries.', min: 0, max: 100, step: 1, value: waveEnergyVal, displayValue: `${waveEnergyVal}%` },
                    { id: 'dropRipples', label: 'Drop Ripples', tooltip: 'Concentric disturbance rings from falling droplets (0% to silence).', min: 0, max: 100, step: 1, value: dropRipplesVal, displayValue: `${dropRipplesVal}%` },
                    { id: 'distortion', label: 'Lens Distortion', tooltip: 'Optical refraction and benthic lens distortion of submerged terrain.', min: 0, max: 100, step: 1, value: distortionVal, displayValue: `${distortionVal}%` },
                    { id: 'speed', label: 'Animation Speed', tooltip: 'Vibration pace of surface tremors.', min: 0.2, max: 2.0, step: 0.05, value: fx.speed, displayValue: `${speedVal}x` },
                    { id: 'waveRegularity', label: 'Wave Regularity', tooltip: 'Micro-ripple regularity: organic rain jitter to crisp rings.', min: 0, max: 100, step: 1, value: regularityVal, displayValue: `${regularityVal}%` },
                    { id: 'fadeWidth', label: 'Shoreline Margin', tooltip: 'Tight damp rim blending puddle into terrain (0px for crisp edge).', min: 0, max: 100, step: 1, value: marginSliderVal, displayValue: `${marginVal}px` }
                ];
            }
            default:
                return [];
        }
    }

    #onHeroSliderInput(heroId, val) {
        const x = val / 100;
        switch (heroId) {
            case 'waveEnergy':
            case 'surfEnergy':
            case 'surfaceEnergy':
            case 'seaState':
            case 'riverWaves':
            case 'waveQuantity':
                if (this.activeArchetype === 'ocean') {
                    this.fx.choppySeas = +(0.10 + 1.25 * x).toFixed(2);
                    this.fx.whitecaps = +(1.30 * Math.pow(x, 1.2)).toFixed(2);
                    this.fx.scale = Math.round(85 + 135 * Math.pow(x, 1.1));
                    this.fx.intensity = +(0.45 + 0.45 * x).toFixed(2);
                } else if (this.activeArchetype === 'coast') {
                    this.fx.shoreWaves = +(0.05 + 0.90 * x).toFixed(2);
                    this.fx.waveSegment = +(0.65 + 0.30 * x).toFixed(2);
                    this.fx.intensity = +(0.25 + 0.60 * x).toFixed(2);
                    this.fx.choppySeas = +(0.08 + 0.62 * x).toFixed(2);
                    this.fx.whitecaps = +(0.05 + 0.65 * x).toFixed(2);
                } else if (this.activeArchetype === 'lake') {
                    this.fx.lakeWaves = +(x).toFixed(2);
                    this.fx.sunGlint = +(1.2 * x).toFixed(2);
                } else if (this.activeArchetype === 'river') {
                    this.fx.riverWaves = +(x).toFixed(2);
                    this.fx.intensity = +(0.15 + 0.45 * x).toFixed(2);
                    this.fx.sunGlint = +(0.10 + 0.70 * x).toFixed(2);
                } else if (this.activeArchetype === 'pond') {
                    this.fx.lakeWaves = +(x * 0.5).toFixed(2);
                } else if (this.activeArchetype === 'puddle') {
                    this.fx.shoreWaves = +(x).toFixed(2);
                }
                break;
            case 'speed':
            case 'swellSpeed':
            case 'waveRhythm':
            case 'driftSpeed':
            case 'currentSpeed':
            case 'lappingSpeed':
                this.fx.speed = Number(val);
                break;
            case 'distortion':
            case 'lensDistortion':
            case 'refraction':
                this.fx.distortion = +(x * 0.050).toFixed(3);
                break;
            case 'swashSurge':
                this.fx.swashSurge = Number(val);
                if (this.activeArchetype === 'river') {
                    this.fx.shoreWaves = +(Math.min(1.0, (val / 40.0) * 0.80)).toFixed(2);
                }
                break;
            case 'surfFoam':
                this.fx.surfFoam = +(x).toFixed(2);
                break;
            case 'shoreFoam':
            case 'rapidsFoam':
            case 'riverFoam':
                this.fx.whitecaps = +(0.65 * x).toFixed(2);
                this.fx.surfFoam = +(x).toFixed(2);
                break;
            case 'fadeWidth':
            case 'shorelineSoftness':
            case 'bankFeathering':
            case 'shallowsMargin':
            case 'wetRimBlend': {
                const maxMargin = WaterlineStudioApp.getMaxFadeWidth(this.activeArchetype);
                this.fx.fadeWidth = WaterlineStudioApp.sliderToFadeWidth(val, maxMargin);
                break;
            }
            case 'flowAngle':
            case 'flowHeading':
            case 'windDirection':
            case 'surfHeading':
                this.fx.flowAngle = Math.round(Number(val)) % 360;
                break;
            case 'waterClarity':
                if (this.activeArchetype === 'ocean') {
                    this.fx.opacity = +(0.45 - 0.28 * x).toFixed(2);
                } else {
                    this.fx.opacity = +(0.38 - 0.26 * x).toFixed(2);
                }
                break;
            case 'waveScale':
                this.fx.scale = Number(val);
                break;
            case 'waveRegularity':
                this.fx.waveRegularity = +(x).toFixed(2);
                break;
            case 'dropRipples':
            case 'lakeRings':
                this.fx.lakeRings = +(x).toFixed(2);
                break;
            case 'foamHint':
                this.fx.whitecaps = +(x).toFixed(2);
                break;
            case 'sunShimmer':
                this.fx.sunGlint = +(1.8 * x).toFixed(2);
                break;
            case 'surfaceBreeze':
                this.fx.intensity = +(0.08 + 0.50 * x).toFixed(2);
                this.fx.scale = Math.round(150 - 60 * x);
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
                break;
            case 'rainTremor':
                this.fx.speed = +(0.40 + 1.20 * x).toFixed(2);
                this.fx.intensity = +(0.10 + 0.40 * x).toFixed(2);
                this.fx.scale = Math.round(35 + 30 * x);
                break;
            case 'mudSilt':
                this.fx.opacity = +(0.08 + 0.35 * x).toFixed(2);
                break;
            case 'waveCount':
                this.fx.waveCount = Math.round(val);
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
        setDrawerInput('waveCount', this.fx.waveCount ?? 4, String(Math.round(this.fx.waveCount ?? 4)));
        setDrawerInput('waveSegment', this.fx.waveSegment, this.fx.waveSegment.toFixed(2));
        setDrawerInput('swashSurge', this.fx.swashSurge, `${Math.round(this.fx.swashSurge)}px`);
        setDrawerInput('surfFoam', this.fx.surfFoam, this.fx.surfFoam.toFixed(2));
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
                if (document.activeElement !== input) {
                    input.value = slider.value;
                }
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
            waveCount: this.fx.waveCount ?? 4,
            waveSegment: this.fx.waveSegment,
            waveRegularity: this.fx.waveRegularity,
            swashSurge: this.fx.swashSurge,
            surfFoam: this.fx.surfFoam,
            choppySeas: this.fx.choppySeas,
            riverWaves: this.fx.riverWaves ?? 0.0,
            lakeWaves: (this.activeArchetype === 'lake' || this.activeArchetype === 'pond' || this.activeArchetype === 'puddle') ? (this.fx.lakeWaves ?? 0.0) : 0.0,
            lakeRings: (this.activeArchetype === 'lake' || this.activeArchetype === 'pond' || this.activeArchetype === 'puddle') ? (typeof this.fx.lakeRings === 'number' ? this.fx.lakeRings : (this.fx.lakeRings ? 0.70 : 0.0)) : 0.0,
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
            const targetRegionIds = new Set();
            if (this.activeRegionId) targetRegionIds.add(this.activeRegionId);

            if (this.applyToAllSameArchetype) {
                const allRegions = canvas.scene?.regions?.contents ?? canvas.scene?.regions ?? [];
                for (const r of allRegions) {
                    if (this.#getRegionArchetype(r) === this.activeArchetype) {
                        targetRegionIds.add(r.id);
                    }
                }
            }

            const meshes = [];
            for (const rid of targetRegionIds) {
                meshes.push(...WaterManager.getMeshesForRegion(rid));
            }

            for (const mesh of meshes) {
                mesh.setSpeed(this.fx.speed);
                mesh.setIntensity(this.fx.intensity);
                mesh.setOpacity(this.fx.opacity);
                mesh.setDistortion(this.fx.distortion);
                mesh.setFadeWidth(this.fx.fadeWidth);
                mesh.setScale(this.fx.scale);
                mesh.setFlowAngle(this.fx.flowAngle);
                mesh.setShoreWaves(this.fx.shoreWaves);
                mesh.setWaveCount(this.fx.waveCount ?? 4);
                mesh.setWaveSegment(this.fx.waveSegment);
                mesh.setWaveRegularity(this.fx.waveRegularity);
                mesh.setSwashSurge(this.fx.swashSurge);
                mesh.setSurfFoam(this.fx.surfFoam);
                mesh.setChoppySeas(this.fx.choppySeas);
                const isSmallBody = (this.activeArchetype === 'lake' || this.activeArchetype === 'pond' || this.activeArchetype === 'puddle');
                mesh.setArchetype?.(this.activeArchetype);
                mesh.setRiverWaves(this.fx.riverWaves ?? 0.0);
                mesh.setLakeWaves(isSmallBody ? (this.fx.lakeWaves ?? 0.0) : 0.0);
                mesh.setLakeRings(isSmallBody ? (typeof this.fx.lakeRings === 'number' ? this.fx.lakeRings : (this.fx.lakeRings ? 0.70 : 0.0)) : 0.0);
                mesh.setWhitecaps(this.fx.whitecaps);
                mesh.setSunGlint(this.fx.sunGlint);
                mesh.setSpindriftWake(this.fx.spindriftWake);
                mesh.setCrestBound(this.fx.crestBound);
                mesh.setCoastSurf?.(this.activeArchetype === 'coast' || this.activeArchetype === 'ocean');

                if (!this.fx.autoColor && this.fx.colorOverride && this.fx.colorOverride.length >= 6) {
                    const hex = this.fx.colorOverride.replace('#', '');
                    const rgb = [
                        parseInt(hex.slice(0, 2), 16) / 255,
                        parseInt(hex.slice(2, 4), 16) / 255,
                        parseInt(hex.slice(4, 6), 16) / 255
                    ];
                    mesh.setWaterColor(rgb);
                } else if (this.fx.autoColor && (mesh.baseSampledColor || mesh.waterColor)) {
                    mesh.setWaterColor(mesh.baseSampledColor || mesh.waterColor);
                }
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
        const colorOverride = this.fx.autoColor ? '' : (this.fx.colorOverride || '');
        const isSmallBody = (this.activeArchetype === 'lake' || this.activeArchetype === 'pond' || this.activeArchetype === 'puddle');
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
            waveCount: this.fx.waveCount ?? 4,
            waveSegment: this.fx.waveSegment,
            waveRegularity: this.fx.waveRegularity,
            swashSurge: this.fx.swashSurge,
            surfFoam: this.fx.surfFoam,
            choppySeas: this.fx.choppySeas,
            riverWaves: this.fx.riverWaves ?? 0.0,
            lakeWaves: isSmallBody ? (this.fx.lakeWaves ?? 0.0) : 0.0,
            lakeRings: isSmallBody ? (typeof this.fx.lakeRings === 'number' ? this.fx.lakeRings : (this.fx.lakeRings ? 0.70 : 0.0)) : 0.0,
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
                const beh = this.#getRegionWaterBehavior(r);
                if (beh) {
                    const rArch = this.#getRegionArchetype(r);
                    if (rArch === this.activeArchetype) targetRegions.push(r);
                }
            }
        }

        let updated = 0;
        for (const r of targetRegions) {
            const beh = this.#getRegionWaterBehavior(r);
            try {
                if (!beh) {
                    await r.createEmbeddedDocuments('RegionBehavior', [{
                        type: behaviorType,
                        name: 'Water FX',
                        flags: {
                            [MODULE_ID]: { configured: true }
                        },
                        system: systemUpdate
                    }]);
                } else {
                    await beh.update({
                        flags: {
                            [MODULE_ID]: { configured: true }
                        },
                        system: systemUpdate
                    });
                }
                await r.setFlag(MODULE_ID, 'configured', true);
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
        let sumX = 0;
        let sumY = 0;
        const n = pts.length / 2;
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

    /**
     * Switch active region and re-render studio.
     * @param {string} regionId
     */
    loadRegion(regionId) {
        if (!regionId) return;
        this.activeRegionId = regionId;
        this.#loadActiveRegionFX(regionId);
        this.#liveUpdateFX();
        this.render();
    }
}
