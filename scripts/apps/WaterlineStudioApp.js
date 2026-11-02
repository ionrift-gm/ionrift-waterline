import { WaterSamplingController } from '../controllers/WaterSamplingController.js';
import { WATER_ARCHETYPES, WaterManager } from '../water/WaterManager.js';
import { WaterShapeEstimator } from '../water/WaterShapeEstimator.js';
import { MODULE_ID } from '../data/moduleId.js';
import { studioEventWiringMethods } from './studio/StudioEventWiring.js';
import { studioRegionAndFxMethods } from './studio/StudioRegionAndFxController.js';

/**
 * Unified Waterline UI (ApplicationV2).
 * Consolidates waterbody management, archetype effects, and wake ripples.
 */
export class WaterlineStudioApp extends foundry.applications.api.ApplicationV2 {
    static _instance = null;
    activeTab = 'water';
    sampler = null;
    activeRegionId = null;
    activeArchetype = 'river';
    drawerOpen = false;
    applyToAllSameArchetype = false;
    hasUnsavedChanges = false;
    activePreset = 'river';
    activeWakePreset = null;
    showPresetPrompt = false;
    showWakePresetPrompt = false;
    regionPickActive = false;
    selectedUnattachedRegionId = null;
    _rafId = null;
    _autoSaveTimer = null;
    _silentSave = false;
    isSavingFX = false;
    _previousRegionId = null;
    _scrollActiveIntoView = true;
    _isSamplingColor = false;
    _cancelColorSampler = null;
    _regionPickClickHandler = null;
    _regionPickKeyHandler = null;

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
        riverWaves: 0.36,
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
            get title() { return game.i18n.localize('IonriftWaterline.SettingsWaterlineStudio'); },
            icon: 'fas fa-water',
            resizable: true
        },
        position: { width: 580, height: 'auto' },
        classes: ['ionrift-window', 'waterline-studio-dialog']
    };

    constructor(options = {}) {
        super(options);
        WaterlineStudioApp._instance = this;
        this.activeTab = options.tab === 'wake' ? 'wake' : 'water';
        this.sampler = new WaterSamplingController();
        this._loadSceneFX();
    }

    static show(options = {}) {
        if (!game.user.isGM) return;
        let app = foundry.applications.instances.get('ionrift-waterline-studio') ?? WaterlineStudioApp._instance;
        if (!app) {
            app = new WaterlineStudioApp(options);
        } else if (options.tab === "wake" || options.tab === "water") {
            app.activeTab = options.tab;
        }
        app.render({ force: true });
        WaterlineStudioApp.syncRegionOverlays(true);
        return app;
    }

    static syncRegionOverlays(hide = Boolean(WaterlineStudioApp._instance)) {
        const regions = Array.from(canvas?.scene?.regions?.values?.() ?? canvas?.scene?.regions ?? []);
        const behaviorType = `${MODULE_ID}.waterFX`;
        for (const region of regions) {
            const behaviors = Array.from(region.behaviors?.values?.() ?? region.behaviors ?? []);
            const beh = behaviors.find(b => b.type === behaviorType);
            if (!beh) continue;
            if (region.object) region.object.alpha = hide ? 0 : 1;
            const rawColor = String(region.color ?? '').toLowerCase();
            if (rawColor === '#d97706' && beh.system?.colorOverride !== '#d97706') {
                void region.update?.({ color: beh.system?.colorOverride || '#0284c7' });
            }
        }
    }

    static onRefreshRegion(placeable) {
        if (!WaterlineStudioApp._instance) return;
        const region = placeable?.document;
        if (!region) return;
        const behaviorType = `${MODULE_ID}.waterFX`;
        const behaviors = Array.from(region.behaviors?.values?.() ?? region.behaviors ?? []);
        if (behaviors.some(b => b.type === behaviorType)) {
            placeable.alpha = 0;
        }
    }

    static closeIfOpen() {
        const app = foundry.applications.instances.get('ionrift-waterline-studio') ?? WaterlineStudioApp._instance;
        if (app) {
            try { app.close({ force: true, animate: false }); } catch { /* ignore */ }
        }
        WaterlineStudioApp._instance = null;
        WaterlineStudioApp.syncRegionOverlays(false);
    }

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

    static sliderToFadeWidth(pos, maxMargin = 120) {
        const s = Math.max(0, Math.min(100, Number(pos) || 0));
        const u0 = 0.40;
        const p0 = 20;
        if (maxMargin <= p0) return Math.round((s / 100) * maxMargin);
        const S0 = p0 / u0;
        const k0 = S0 * (1 - u0);
        const A = maxMargin - p0 - k0;
        const u = s / 100;
        if (u <= u0) return Math.round((u / u0) * p0);
        const t = (u - u0) / (1 - u0);
        if (A === 0) return Math.round(p0 + k0 * t);
        return Math.round(p0 + k0 * t + A * t * t);
    }

    static fadeWidthToSlider(px, maxMargin = 120) {
        const p = Math.max(0, Math.min(maxMargin, Number(px) || 0));
        const u0 = 0.40;
        const p0 = 20;
        if (maxMargin <= p0) return Math.round((p / maxMargin) * 100);
        const S0 = p0 / u0;
        const k0 = S0 * (1 - u0);
        const A = maxMargin - p0 - k0;
        if (p <= p0) return Math.round((p / p0) * (u0 * 100));
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
        if (this._rafId) {
            cancelAnimationFrame(this._rafId);
            this._rafId = null;
        }
        if (this._autoSaveTimer) {
            clearTimeout(this._autoSaveTimer);
            this._autoSaveTimer = null;
        }
        if (this.hasUnsavedChanges && this.activeRegionId) {
            this._silentSave = true;
            void this.#saveActiveWaterbodyFX().finally(() => { this._silentSave = false; });
        }
        this.sampler?.cleanup();
        this._stopRegionPick();
        this._cancelColorSampler?.();
    }

    /** @override */
    _onClose(_options) {
        WaterlineStudioApp._instance = null;
        WaterlineStudioApp.syncRegionOverlays(false);
    }

    _getRegionWaterBehavior(region) {
        return this.#getRegionWaterBehavior(region);
    }

    #getRegionWaterBehavior(region) {
        if (!region) return null;
        const behaviorType = `${MODULE_ID}.waterFX`;
        const behaviors = Array.from(region.behaviors?.values?.() ?? region.behaviors ?? []);
        return behaviors.find(b => b.type === behaviorType) ?? null;
    }

    _getRegionArchetype(region) {
        return this.#getRegionArchetype(region);
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
        const {
            isCreatingNew,
            zones,
            unattachedRegions,
            currentArchetypePresets,
            customPresets,
            customPresetsList,
            wake,
            wakePresets
        } = this._prepareRegionsAndPresetsContext();

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

        const heroSliders = this.#buildHeroSliders(this.activeArchetype, this.fx);
        const hasDirection = heroSliders.some(s => s.isDirection);
        const activeArchMeta = WATER_ARCHETYPES[this.activeArchetype] ?? WATER_ARCHETYPES.river;
        const activeZone = zones.find(z => z.isActive) ?? null;
        const isConfiguringCandidate = Boolean(isCreatingNew && this.sampler?.candidate);
        const showFXControls = Boolean(activeZone || isConfiguringCandidate);
        const activeTargetName = isConfiguringCandidate
            ? game.i18n.format('IonriftWaterline.studio.previewCandidate', { label: activeArchMeta.label })
            : (activeZone?.name || game.i18n.localize('IonriftWaterline.studio.fallbackWaterbody'));

        return {
            activeTab: this.activeTab,
            zones,
            unattachedRegions,
            activeRegionId: this.activeRegionId,
            hasActiveZone: Boolean(activeZone),
            showFXControls,
            isConfiguringCandidate,
            activeTargetName,
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
            regionPickActive: this.regionPickActive,
            pickActive: this.sampler.isActive || Boolean(this.sampler.editingRegionId),
            pickTolerance: this.sampler.tolerance,
            pickSmoothing: this.sampler.smoothing,
            candidate: this.sampler.candidate,
            editingRegionId: this.sampler.editingRegionId,
            editingRegionName: this.sampler.editingRegionId ? (canvas.scene?.regions?.get(this.sampler.editingRegionId)?.name || game.i18n.localize('IonriftWaterline.studio.fallbackWaterbody')) : null,
            hasEyeDropper: typeof window !== 'undefined' && ('EyeDropper' in window || Boolean(globalThis.canvas?.ready)),
            colorOverrideHex: (this.fx.colorOverride || '#0d2e4d').replace('#', '').toUpperCase(),
            fx: { ...this.fx, colorOverride: this.fx.colorOverride || '#0d2e4d' },
            wake,
            wakePresets,
            activeWakePreset: this.activeWakePreset,
            showWakePresetPrompt: this.showWakePresetPrompt
        };
    }

    /** @override */
    async _renderHTML(context, _options) {
        const templatePath = `modules/${MODULE_ID}/templates/studio.hbs`;
        const renderer = foundry.applications?.handlebars?.renderTemplate ?? globalThis.renderTemplate;
        const htmlString = await renderer(templatePath, context);
        const el = document.createElement('div');
        el.className = 'waterline-studio-root';
        el.innerHTML = htmlString;
        this.#wireListeners(el);
        return el;
    }

    /** @override */
    _replaceHTML(result, content, _options) {
        const prevListScroll = content.querySelector?.('.wc-entity-list')?.scrollTop ?? 0;
        const prevBodyScroll = content.querySelector?.('.waterline-tab-body')?.scrollTop ?? 0;
        content.replaceChildren(result);

        const newBody = content.querySelector?.('.waterline-tab-body');
        if (newBody && prevBodyScroll > 0) newBody.scrollTop = prevBodyScroll;
        const newList = content.querySelector?.('.wc-entity-list');
        if (newList) {
            if (prevListScroll > 0) newList.scrollTop = prevListScroll;
            if (this._scrollActiveIntoView) {
                this._scrollActiveIntoView = false;
                const activeCard = newList.querySelector?.('.wc-entity-card.active');
                activeCard?.scrollIntoView?.({ block: 'nearest' });
            }
        }
    }

    #wireListeners(root) {
        this._wireStudioEvents(root, WaterlineStudioApp);
        void root.querySelector('input[name="colorOverrideHex"]');

        const batchCheckbox = root.querySelector('input[name="applyToAllSameArchetype"]');
        if (batchCheckbox) {
            batchCheckbox.addEventListener('change', (ev) => {
                this.applyToAllSameArchetype = ev.target.checked;
                if (this.applyToAllSameArchetype) {
                    this.#liveUpdateFX();
                }
            });
        }
    }

    _buildHeroSliders(archetype, fx) {
        return this.#buildHeroSliders(archetype, fx);
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
                    { id: 'waveEnergy', label: game.i18n.localize('IonriftWaterline.hero.ocean.waveEnergyLabel'), tooltip: game.i18n.localize('IonriftWaterline.hero.ocean.waveEnergyTooltip'), min: 0, max: 100, step: 1, value: waveEnergyVal, displayValue: `${waveEnergyVal}%` },
                    { id: 'waveCount', label: game.i18n.localize('IonriftWaterline.hero.ocean.waveCountLabel'), tooltip: game.i18n.localize('IonriftWaterline.hero.ocean.waveCountTooltip'), min: 1, max: 8, step: 1, value: waveCountVal, displayValue: `${waveCountVal}` },
                    { id: 'swashSurge', label: game.i18n.localize('IonriftWaterline.hero.ocean.swashSurgeLabel'), tooltip: game.i18n.localize('IonriftWaterline.hero.ocean.swashSurgeTooltip'), min: 0, max: 60, step: 1, value: surgeVal, displayValue: `${surgeVal}px` },
                    { id: 'surfFoam', label: game.i18n.localize('IonriftWaterline.hero.ocean.surfFoamLabel'), tooltip: game.i18n.localize('IonriftWaterline.hero.ocean.surfFoamTooltip'), min: 0, max: 100, step: 1, value: surfFoamVal, displayValue: `${surfFoamVal}%` },
                    { id: 'distortion', label: game.i18n.localize('IonriftWaterline.hero.ocean.distortionLabel'), tooltip: game.i18n.localize('IonriftWaterline.hero.ocean.distortionTooltip'), min: 0, max: 100, step: 1, value: distortionVal, displayValue: `${distortionVal}%` },
                    { id: 'speed', label: game.i18n.localize('IonriftWaterline.hero.ocean.speedLabel'), tooltip: game.i18n.localize('IonriftWaterline.hero.ocean.speedTooltip'), min: 0.2, max: 2.0, step: 0.05, value: fx.speed, displayValue: `${speedVal}x` },
                    { id: 'fadeWidth', label: game.i18n.localize('IonriftWaterline.hero.ocean.fadeWidthLabel'), tooltip: game.i18n.localize('IonriftWaterline.hero.ocean.fadeWidthTooltip'), min: 0, max: 100, step: 1, value: marginSliderVal, displayValue: `${marginVal}px` },
                    { id: 'flowAngle', label: game.i18n.localize('IonriftWaterline.hero.ocean.flowAngleLabel'), tooltip: game.i18n.localize('IonriftWaterline.hero.ocean.flowAngleTooltip'), min: 0, max: 359, step: 1, value: angleVal, displayValue: `${angleVal}°`, isDirection: true, icon: 'fas fa-wind' }
                ];
            }
            case 'coast': {
                const waveEnergyVal = Math.round(Math.min(100, Math.max(0, ((fx.shoreWaves - 0.05) / 0.90) * 100)));
                const waveScaleVal = Math.round(Math.min(350, Math.max(40, fx.scale ?? 135)));
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
                    { id: 'waveEnergy', label: game.i18n.localize('IonriftWaterline.hero.coast.waveEnergyLabel'), tooltip: game.i18n.localize('IonriftWaterline.hero.coast.waveEnergyTooltip'), min: 0, max: 100, step: 1, value: waveEnergyVal, displayValue: `${waveEnergyVal}%` },
                    { id: 'waveCount', label: game.i18n.localize('IonriftWaterline.hero.coast.waveCountLabel'), tooltip: game.i18n.localize('IonriftWaterline.hero.coast.waveCountTooltip'), min: 1, max: 8, step: 1, value: waveCountVal, displayValue: `${waveCountVal}` },
                    { id: 'waveScale', label: game.i18n.localize('IonriftWaterline.hero.coast.waveScaleLabel'), tooltip: game.i18n.localize('IonriftWaterline.hero.coast.waveScaleTooltip'), min: 40, max: 350, step: 5, value: waveScaleVal, displayValue: `${waveScaleVal}px` },
                    { id: 'swashSurge', label: game.i18n.localize('IonriftWaterline.hero.coast.swashSurgeLabel'), tooltip: game.i18n.localize('IonriftWaterline.hero.coast.swashSurgeTooltip'), min: 0, max: 60, step: 1, value: surgeVal, displayValue: `${surgeVal}px` },
                    { id: 'surfFoam', label: game.i18n.localize('IonriftWaterline.hero.coast.surfFoamLabel'), tooltip: game.i18n.localize('IonriftWaterline.hero.coast.surfFoamTooltip'), min: 0, max: 100, step: 1, value: surfFoamVal, displayValue: `${surfFoamVal}%` },
                    { id: 'distortion', label: game.i18n.localize('IonriftWaterline.hero.coast.distortionLabel'), tooltip: game.i18n.localize('IonriftWaterline.hero.coast.distortionTooltip'), min: 0, max: 100, step: 1, value: distortionVal, displayValue: `${distortionVal}%` },
                    { id: 'speed', label: game.i18n.localize('IonriftWaterline.hero.coast.speedLabel'), tooltip: game.i18n.localize('IonriftWaterline.hero.coast.speedTooltip'), min: 0.2, max: 2.0, step: 0.05, value: fx.speed, displayValue: `${speedVal}x` },
                    { id: 'fadeWidth', label: game.i18n.localize('IonriftWaterline.hero.coast.fadeWidthLabel'), tooltip: game.i18n.localize('IonriftWaterline.hero.coast.fadeWidthTooltip'), min: 0, max: 100, step: 1, value: marginSliderVal, displayValue: `${marginVal}px` },
                    { id: 'flowAngle', label: game.i18n.localize('IonriftWaterline.hero.coast.flowAngleLabel'), tooltip: game.i18n.localize('IonriftWaterline.hero.coast.flowAngleTooltip'), min: 0, max: 359, step: 1, value: angleVal, displayValue: `${angleVal}°`, isDirection: true, icon: 'fas fa-compass' }
                ];
            }
            case 'lake': {
                const waveEnergyVal = Math.round(Math.min(100, Math.max(0, (fx.lakeWaves ?? 0.08) * 100)));
                const waveScaleVal = Math.round(Math.min(300, Math.max(40, fx.scale ?? 110)));
                const surgeVal = Math.round(fx.swashSurge ?? 5.0);
                const clarityVal = Math.round(Math.min(100, Math.max(0, ((0.38 - (fx.opacity ?? 0.15)) / 0.26) * 100)));
                const distortionVal = Math.round(Math.min(100, Math.max(0, ((fx.distortion ?? 0.025) / 0.050) * 100)));
                const speedVal = Number(fx.speed).toFixed(2);
                const maxMargin = WaterlineStudioApp.getMaxFadeWidth('lake');
                const marginVal = Math.round(fx.fadeWidth ?? 50);
                const marginSliderVal = WaterlineStudioApp.fadeWidthToSlider(marginVal, maxMargin);
                const angleVal = Math.round(fx.flowAngle) % 360;
                return [
                    { id: 'waveEnergy', label: game.i18n.localize('IonriftWaterline.hero.lake.waveEnergyLabel'), tooltip: game.i18n.localize('IonriftWaterline.hero.lake.waveEnergyTooltip'), min: 0, max: 100, step: 1, value: waveEnergyVal, displayValue: `${waveEnergyVal}%` },
                    { id: 'waveScale', label: game.i18n.localize('IonriftWaterline.hero.lake.waveScaleLabel'), tooltip: game.i18n.localize('IonriftWaterline.hero.lake.waveScaleTooltip'), min: 40, max: 300, step: 5, value: waveScaleVal, displayValue: `${waveScaleVal}px` },
                    { id: 'swashSurge', label: game.i18n.localize('IonriftWaterline.hero.lake.swashSurgeLabel'), tooltip: game.i18n.localize('IonriftWaterline.hero.lake.swashSurgeTooltip'), min: 0, max: 25, step: 1, value: surgeVal, displayValue: `${surgeVal}px` },
                    { id: 'waterClarity', label: game.i18n.localize('IonriftWaterline.hero.lake.waterClarityLabel'), tooltip: game.i18n.localize('IonriftWaterline.hero.lake.waterClarityTooltip'), min: 0, max: 100, step: 1, value: clarityVal, displayValue: `${clarityVal}%` },
                    { id: 'distortion', label: game.i18n.localize('IonriftWaterline.hero.lake.distortionLabel'), tooltip: game.i18n.localize('IonriftWaterline.hero.lake.distortionTooltip'), min: 0, max: 100, step: 1, value: distortionVal, displayValue: `${distortionVal}%` },
                    { id: 'speed', label: game.i18n.localize('IonriftWaterline.hero.lake.speedLabel'), tooltip: game.i18n.localize('IonriftWaterline.hero.lake.speedTooltip'), min: 0.1, max: 2.0, step: 0.05, value: fx.speed, displayValue: `${speedVal}x` },
                    { id: 'fadeWidth', label: game.i18n.localize('IonriftWaterline.hero.lake.fadeWidthLabel'), tooltip: game.i18n.localize('IonriftWaterline.hero.lake.fadeWidthTooltip'), min: 0, max: 100, step: 1, value: marginSliderVal, displayValue: `${marginVal}px` },
                    { id: 'flowAngle', label: game.i18n.localize('IonriftWaterline.hero.lake.flowAngleLabel'), tooltip: game.i18n.localize('IonriftWaterline.hero.lake.flowAngleTooltip'), min: 0, max: 359, step: 1, value: angleVal, displayValue: `${angleVal}°`, isDirection: true, icon: 'fas fa-wind' }
                ];
            }
            case 'river': {
                const waveEnergyVal = Math.round(Math.min(100, Math.max(0, (fx.riverWaves ?? 0.36) * 100)));
                const waveScaleVal = Math.round(Math.min(250, Math.max(30, fx.scale ?? 90)));
                const surgeVal = Math.round(fx.swashSurge ?? 16.0);
                const shoreFoamVal = Math.round(Math.min(100, Math.max(0, ((fx.whitecaps ?? 0.14) / 0.65) * 100)));
                const distortionVal = Math.round(Math.min(100, Math.max(0, ((fx.distortion ?? 0.025) / 0.050) * 100)));
                const speedVal = Number(fx.speed).toFixed(2);
                const maxMargin = WaterlineStudioApp.getMaxFadeWidth('river');
                const marginVal = Math.round(fx.fadeWidth);
                const marginSliderVal = WaterlineStudioApp.fadeWidthToSlider(marginVal, maxMargin);
                const angleVal = Math.round(fx.flowAngle) % 360;
                return [
                    { id: 'waveEnergy', label: game.i18n.localize('IonriftWaterline.hero.river.waveEnergyLabel'), tooltip: game.i18n.localize('IonriftWaterline.hero.river.waveEnergyTooltip'), min: 0, max: 100, step: 1, value: waveEnergyVal, displayValue: `${waveEnergyVal}%` },
                    { id: 'waveScale', label: game.i18n.localize('IonriftWaterline.hero.river.waveScaleLabel'), tooltip: game.i18n.localize('IonriftWaterline.hero.river.waveScaleTooltip'), min: 30, max: 250, step: 5, value: waveScaleVal, displayValue: `${waveScaleVal}px` },
                    { id: 'swashSurge', label: game.i18n.localize('IonriftWaterline.hero.river.swashSurgeLabel'), tooltip: game.i18n.localize('IonriftWaterline.hero.river.swashSurgeTooltip'), min: 0, max: 40, step: 1, value: surgeVal, displayValue: `${surgeVal}px` },
                    { id: 'shoreFoam', label: game.i18n.localize('IonriftWaterline.hero.river.shoreFoamLabel'), tooltip: game.i18n.localize('IonriftWaterline.hero.river.shoreFoamTooltip'), min: 0, max: 100, step: 1, value: shoreFoamVal, displayValue: `${shoreFoamVal}%` },
                    { id: 'distortion', label: game.i18n.localize('IonriftWaterline.hero.river.distortionLabel'), tooltip: game.i18n.localize('IonriftWaterline.hero.river.distortionTooltip'), min: 0, max: 100, step: 1, value: distortionVal, displayValue: `${distortionVal}%` },
                    { id: 'speed', label: game.i18n.localize('IonriftWaterline.hero.river.speedLabel'), tooltip: game.i18n.localize('IonriftWaterline.hero.river.speedTooltip'), min: 0.2, max: 2.0, step: 0.05, value: fx.speed, displayValue: `${speedVal}x` },
                    { id: 'fadeWidth', label: game.i18n.localize('IonriftWaterline.hero.river.fadeWidthLabel'), tooltip: game.i18n.localize('IonriftWaterline.hero.river.fadeWidthTooltip'), min: 0, max: 100, step: 1, value: marginSliderVal, displayValue: `${marginVal}px` },
                    { id: 'flowAngle', label: game.i18n.localize('IonriftWaterline.hero.river.flowAngleLabel'), tooltip: game.i18n.localize('IonriftWaterline.hero.river.flowAngleTooltip'), min: 0, max: 359, step: 1, value: angleVal, displayValue: `${angleVal}°`, isDirection: true, icon: 'fas fa-location-arrow' }
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
                    { id: 'waveEnergy', label: game.i18n.localize('IonriftWaterline.hero.pond.waveEnergyLabel'), tooltip: game.i18n.localize('IonriftWaterline.hero.pond.waveEnergyTooltip'), min: 0, max: 100, step: 1, value: waveEnergyVal, displayValue: `${waveEnergyVal}%` },
                    { id: 'swashSurge', label: game.i18n.localize('IonriftWaterline.hero.pond.swashSurgeLabel'), tooltip: game.i18n.localize('IonriftWaterline.hero.pond.swashSurgeTooltip'), min: 0, max: 20, step: 1, value: surgeVal, displayValue: `${surgeVal}px` },
                    { id: 'waterClarity', label: game.i18n.localize('IonriftWaterline.hero.pond.waterClarityLabel'), tooltip: game.i18n.localize('IonriftWaterline.hero.pond.waterClarityTooltip'), min: 0, max: 100, step: 1, value: clarityVal, displayValue: `${clarityVal}%` },
                    { id: 'dropRipples', label: game.i18n.localize('IonriftWaterline.hero.pond.dropRipplesLabel'), tooltip: game.i18n.localize('IonriftWaterline.hero.pond.dropRipplesTooltip'), min: 0, max: 100, step: 1, value: dropRipplesVal, displayValue: `${dropRipplesVal}%` },
                    { id: 'distortion', label: game.i18n.localize('IonriftWaterline.hero.pond.distortionLabel'), tooltip: game.i18n.localize('IonriftWaterline.hero.pond.distortionTooltip'), min: 0, max: 100, step: 1, value: distortionVal, displayValue: `${distortionVal}%` },
                    { id: 'sunShimmer', label: game.i18n.localize('IonriftWaterline.hero.pond.sunShimmerLabel'), tooltip: game.i18n.localize('IonriftWaterline.hero.pond.sunShimmerTooltip'), min: 0, max: 100, step: 1, value: shimmerVal, displayValue: `${shimmerVal}%` },
                    { id: 'speed', label: game.i18n.localize('IonriftWaterline.hero.pond.speedLabel'), tooltip: game.i18n.localize('IonriftWaterline.hero.pond.speedTooltip'), min: 0.1, max: 2.0, step: 0.05, value: fx.speed, displayValue: `${speedVal}x` },
                    { id: 'fadeWidth', label: game.i18n.localize('IonriftWaterline.hero.pond.fadeWidthLabel'), tooltip: game.i18n.localize('IonriftWaterline.hero.pond.fadeWidthTooltip'), min: 0, max: 100, step: 1, value: marginSliderVal, displayValue: `${marginVal}px` }
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
                    { id: 'waveEnergy', label: game.i18n.localize('IonriftWaterline.hero.puddle.waveEnergyLabel'), tooltip: game.i18n.localize('IonriftWaterline.hero.puddle.waveEnergyTooltip'), min: 0, max: 100, step: 1, value: waveEnergyVal, displayValue: `${waveEnergyVal}%` },
                    { id: 'dropRipples', label: game.i18n.localize('IonriftWaterline.hero.puddle.dropRipplesLabel'), tooltip: game.i18n.localize('IonriftWaterline.hero.puddle.dropRipplesTooltip'), min: 0, max: 100, step: 1, value: dropRipplesVal, displayValue: `${dropRipplesVal}%` },
                    { id: 'distortion', label: game.i18n.localize('IonriftWaterline.hero.puddle.distortionLabel'), tooltip: game.i18n.localize('IonriftWaterline.hero.puddle.distortionTooltip'), min: 0, max: 100, step: 1, value: distortionVal, displayValue: `${distortionVal}%` },
                    { id: 'speed', label: game.i18n.localize('IonriftWaterline.hero.puddle.speedLabel'), tooltip: game.i18n.localize('IonriftWaterline.hero.puddle.speedTooltip'), min: 0.2, max: 2.0, step: 0.05, value: fx.speed, displayValue: `${speedVal}x` },
                    { id: 'waveRegularity', label: game.i18n.localize('IonriftWaterline.hero.puddle.waveRegularityLabel'), tooltip: game.i18n.localize('IonriftWaterline.hero.puddle.waveRegularityTooltip'), min: 0, max: 100, step: 1, value: regularityVal, displayValue: `${regularityVal}%` },
                    { id: 'fadeWidth', label: game.i18n.localize('IonriftWaterline.hero.puddle.fadeWidthLabel'), tooltip: game.i18n.localize('IonriftWaterline.hero.puddle.fadeWidthTooltip'), min: 0, max: 100, step: 1, value: marginSliderVal, displayValue: `${marginVal}px` }
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

    _onHeroSliderInput(heroId, val) {
        return this.#onHeroSliderInput(heroId, val);
    }

    _liveUpdateFX(autoSave = true) {
        return this.#liveUpdateFX(autoSave);
    }

    #liveUpdateFX(autoSave = true) {
        if (autoSave) this.hasUnsavedChanges = true;
        if (this._rafId) cancelAnimationFrame(this._rafId);

        if (!this.activeRegionId && this.sampler?.candidate?.estimation) {
            this.sampler.candidate.estimation.flowAngle = this.fx.flowAngle;
            return;
        }

        const targetRegionIds = new Set();
        if (this.activeRegionId) targetRegionIds.add(this.activeRegionId);

        if (this.applyToAllSameArchetype) {
            const allRegions = Array.from(canvas.scene?.regions?.values?.() ?? canvas.scene?.regions ?? []);
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
            const hasColorOverride = !this.fx.autoColor && this.fx.colorOverride && this.fx.colorOverride.length >= 6;
            const effectiveOpacity = hasColorOverride
                ? Math.min(0.75, (this.fx.opacity ?? 0.2) + 0.28)
                : this.fx.opacity;
            mesh.setOpacity(effectiveOpacity);
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

        WaterlineStudioApp.syncRegionOverlays(true);
        if (autoSave) this.#scheduleAutoSave();
    }

    _flushAutoSave() {
        return this.#flushAutoSave();
    }

    #flushAutoSave() {
        if (!this._autoSaveTimer) return;
        clearTimeout(this._autoSaveTimer);
        this._autoSaveTimer = null;
        if (this.hasUnsavedChanges && this.activeRegionId) {
            this._silentSave = true;
            void this.#saveActiveWaterbodyFX().finally(() => { this._silentSave = false; });
        }
    }

    #scheduleAutoSave() {
        if (this._autoSaveTimer) clearTimeout(this._autoSaveTimer);
        if (!this.activeRegionId) return;
        this._autoSaveTimer = setTimeout(async () => {
            this._autoSaveTimer = null;
            this._silentSave = true;
            try {
                await this.#saveActiveWaterbodyFX();
            } finally {
                this._silentSave = false;
            }
        }, 450);
    }

    async saveActiveWaterbodyFX() {
        return this.#saveActiveWaterbodyFX();
    }

    async #saveActiveWaterbodyFX() {
        if (this._autoSaveTimer) {
            clearTimeout(this._autoSaveTimer);
            this._autoSaveTimer = null;
        }
        if (!this.activeRegionId) {
            if (!this._silentSave) ui.notifications?.warn(game.i18n.localize('IonriftWaterline.studio.warnNoWaterbodySelected'));
            return;
        }

        const activeRegion = canvas.scene?.regions?.get(this.activeRegionId);
        if (!activeRegion) return;

        const behaviorType = `${MODULE_ID}.waterFX`;
        const colorOverride = this.fx.autoColor ? '' : (this.fx.colorOverride || '');
        const isSmallBody = (this.activeArchetype === 'lake' || this.activeArchetype === 'pond' || this.activeArchetype === 'puddle');
        const presetChoice = WaterManager.persistPresetChoice(this.activePreset);
        const systemUpdate = {
            archetype: this.activeArchetype,
            waterType: presetChoice.waterType,
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
            const allRegions = Array.from(canvas.scene?.regions?.values?.() ?? canvas.scene?.regions ?? []);
            for (const r of allRegions) {
                if (r.id === activeRegion.id) continue;
                const beh = this.#getRegionWaterBehavior(r);
                if (beh && this.#getRegionArchetype(r) === this.activeArchetype) targetRegions.push(r);
            }
        }

        let updated = 0;
        const targetRegionColor = colorOverride
            || (this.activeArchetype === 'puddle' ? '#38bdf8' : WATER_ARCHETYPES[this.activeArchetype]?.accentColor)
            || '#2a6496';

        this.isSavingFX = true;
        try {
            for (const r of targetRegions) {
                const beh = this.#getRegionWaterBehavior(r);
                try {
                    if (!beh) {
                        await r.createEmbeddedDocuments('RegionBehavior', [{
                            type: behaviorType,
                            name: game.i18n.localize('IonriftWaterline.behavior.defaultName'),
                            flags: { [MODULE_ID]: { configured: true, customPreset: presetChoice.customPreset } },
                            system: systemUpdate
                        }]);
                    } else {
                        await beh.update({
                            flags: { [MODULE_ID]: { configured: true, customPreset: presetChoice.customPreset } },
                            system: systemUpdate
                        });
                    }
                    if (!r.flags?.[MODULE_ID]?.configured) {
                        await r.setFlag(MODULE_ID, 'configured', true);
                    }
                    if (presetChoice.customPreset) {
                        await r.setFlag(MODULE_ID, 'customPreset', presetChoice.customPreset);
                    } else if (r.unsetFlag) {
                        await r.unsetFlag(MODULE_ID, 'customPreset');
                    }
                    if (colorOverride) {
                        await r.setFlag(MODULE_ID, 'color', colorOverride);
                    } else if (r.unsetFlag) {
                        await r.unsetFlag(MODULE_ID, 'color');
                    }
                    if (r.update && r.color !== targetRegionColor) {
                        await r.update({ color: targetRegionColor });
                    }
                    updated++;
                } catch (err) {
                    console.error(`Waterline | Failed to update water FX on ${r.name}:`, err);
                }
            }
        } finally {
            this.isSavingFX = false;
        }

        if (updated === 0) {
            this.hasUnsavedChanges = true;
            if (!this._silentSave) ui.notifications?.warn(game.i18n.localize('IonriftWaterline.studio.warnCouldNotSave'));
            return;
        }

        this.hasUnsavedChanges = false;
        if (!this._silentSave) {
            if (updated > 1) {
                ui.notifications?.info(game.i18n.format('IonriftWaterline.studio.notifySavedManyBodies', { count: updated, label: WATER_ARCHETYPES[this.activeArchetype]?.label || '' }));
            } else {
                ui.notifications?.info(game.i18n.format('IonriftWaterline.studio.notifySavedSingleBody', { name: activeRegion.name }));
            }
        }
    }

    async _renameWaterRegion(regionId, newName) {
        return this.#renameWaterRegion(regionId, newName);
    }

    async #renameWaterRegion(regionId, newName) {
        if (!regionId || !newName?.trim()) return;
        const region = canvas.scene?.regions?.get(regionId);
        if (!region) return;
        await region.setFlag?.(MODULE_ID, 'hasCustomName', true);
        await region.update({ name: newName.trim() });
    }
}

Object.assign(WaterlineStudioApp.prototype, studioEventWiringMethods, studioRegionAndFxMethods);
