import { WATER_PRESETS, WATER_ARCHETYPES, WaterManager } from '../../water/WaterManager.js';
import { WaterShapeEstimator } from '../../water/WaterShapeEstimator.js';
import { RasterContourTracer } from '../../water/detection/RasterContourTracer.js';
import { WakeTuning } from '../../water/WakeTuning.js';
import { MODULE_ID } from '../../data/moduleId.js';

/**
 * Interactive canvas color sampling, preset/FX state loading, context assembly, and region
 * adoption/pick controllers for WaterlineStudioApp. Mixed into WaterlineStudioApp.prototype.
 */
export const studioRegionAndFxMethods = {
    _prepareRegionsAndPresetsContext() {
        const regions = Array.from(canvas.scene?.regions?.values?.() ?? canvas.scene?.regions ?? []);
        const isCreatingNew = Boolean(this.sampler?.isActive && !this.sampler?.editingRegionId);
        const waterRegions = regions.filter(r => Boolean(this._getRegionWaterBehavior(r)));

        if (!isCreatingNew) {
            if ((!this.activeRegionId || !waterRegions.some(r => r.id === this.activeRegionId)) && waterRegions.length > 0) {
                this.activeRegionId = waterRegions[0].id;
                this.hasUnsavedChanges = false;
                this._loadActiveRegionFX(this.activeRegionId);
            } else if (this.activeRegionId && !this.hasUnsavedChanges) {
                this._loadActiveRegionFX(this.activeRegionId);
            }
        }

        const zones = [];
        const unattachedRegions = [];

        for (const region of regions) {
            const behavior = this._getRegionWaterBehavior(region);
            const pts = WaterShapeEstimator.extractRegionPoints(region);
            const verts = pts ? Math.round(pts.length / 2) : 0;
            if (behavior) {
                const isActive = !isCreatingNew && region.id === this.activeRegionId;
                const archKey = (isActive && this.activeArchetype)
                    ? this.activeArchetype
                    : this._getRegionArchetype(region);
                const archMeta = WATER_ARCHETYPES[archKey] ?? WATER_ARCHETYPES.river;

                zones.push({
                    region,
                    id: region.id,
                    name: region.name || game.i18n.localize('IonriftWaterline.studio.fallbackWaterZone'),
                    verts,
                    archetype: archKey,
                    archetypeLabel: archMeta.label,
                    archetypeIcon: archMeta.icon,
                    archetypeColor: archMeta.accentColor,
                    isActive
                });
            } else if (verts >= 3) {
                const est = pts && pts.length >= 6 ? WaterShapeEstimator.estimate({ points: pts, vertexCount: verts }, canvas?.dimensions) : null;
                unattachedRegions.push({
                    region,
                    id: region.id,
                    name: region.name || game.i18n.localize('IonriftWaterline.studio.fallbackSceneRegion'),
                    verts,
                    estimation: est,
                    isSelected: false
                });
            }
        }

        if (unattachedRegions.length > 0) {
            const controlledUnattached = this._getControlledUnattachedRegion();
            let selectedId = controlledUnattached?.id ?? this.selectedUnattachedRegionId;
            if (!selectedId || !unattachedRegions.some(ur => ur.id === selectedId)) {
                selectedId = unattachedRegions[unattachedRegions.length - 1].id;
            }
            this.selectedUnattachedRegionId = selectedId;
            for (const ur of unattachedRegions) {
                ur.isSelected = ur.id === selectedId;
            }
        } else {
            this.selectedUnattachedRegionId = null;
        }

        const currentArchetypePresets = Object.fromEntries(
            Object.entries(WATER_PRESETS).filter(([, p]) => p.archetype === this.activeArchetype)
        );

        const customPresets = game.settings.get(MODULE_ID, 'waterCustomPresets') ?? {};
        const customPresetsList = Object.entries(customPresets)
            .filter(([, data]) => (data.archetype || WaterManager.inferArchetype(data.waterType)) === this.activeArchetype)
            .map(([key, data]) => ({
                key,
                name: data.name ?? key
            }));

        const wake = WakeTuning.get();
        const wakePresets = WakeTuning.listPresets();

        return {
            isCreatingNew,
            zones,
            unattachedRegions,
            currentArchetypePresets,
            customPresets,
            customPresetsList,
            wake,
            wakePresets
        };
    },

    /**
     * Toggles interactive canvas color sampling mode.
     * Samples the true map artwork color directly from the background canvas on click.
     * @param {HTMLElement} btn
     * @param {Function} updateColorUIState
     */
    _toggleCanvasColorSampler(btn, updateColorUIState) {
        if (this._isSamplingColor) {
            this._cancelColorSampler?.();
            return;
        }

        if (!canvas?.ready) {
            ui.notifications?.warn(game.i18n.localize('IonriftWaterline.studio.warnCanvasNotReady'));
            return;
        }

        if (this.sampler?.isActive || this.sampler?.editingRegionId) {
            this.sampler.discardCandidate();
            this.sampler.stop();
        }

        this._isSamplingColor = true;
        btn.classList.add('active');
        btn.setAttribute('title', game.i18n.localize('IonriftWaterline.studio.samplerBtnSampling'));

        const prevCursor = canvas.stage.cursor;
        canvas.stage.cursor = 'crosshair';

        const cleanup = () => {
            this._isSamplingColor = false;
            this._cancelColorSampler = null;
            btn.classList.remove('active');
            btn.setAttribute('title', game.i18n.localize('IonriftWaterline.studio.samplerBtnIdle'));
            if (canvas?.stage) {
                canvas.stage.off('pointerdown', onCanvasClick);
                canvas.stage.cursor = prevCursor || 'default';
            }
            window.removeEventListener('keydown', onKeyDown);
            document.removeEventListener('pointerdown', onDocPointerDown, true);
        };

        this._cancelColorSampler = cleanup;

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
                this._liveUpdateFX();
            }
            cleanup();
        };

        setTimeout(() => {
            if (!this._isSamplingColor) return;
            canvas.stage.once('pointerdown', onCanvasClick);
            window.addEventListener('keydown', onKeyDown, { once: true });
            document.addEventListener('pointerdown', onDocPointerDown, true);
        }, 50);
    },

    /**
     * Samples the RGB color of the scene background artwork at a given world coordinate.
     * Returns a 6-digit hex string (e.g. '#1a4b6e').
     * @param {number} worldX
     * @param {number} worldY
     * @returns {string|null}
     */
    sampleColorAtWorld(worldX, worldY) {
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
    },

    _loadSceneFX() {
        const regions = Array.from(canvas.scene?.regions?.values?.() ?? canvas.scene?.regions ?? []);
        for (const region of regions) {
            const b = this._getRegionWaterBehavior(region);
            if (b?.system) {
                this.activeRegionId = region.id;
                this._loadActiveRegionFX(region.id);
                break;
            }
        }
    },

    _applyCandidateEstimation(candidate) {
        const est = candidate?.estimation;
        if (!est) return;
        this.activeArchetype = est.archetype || 'river';
        this.activePreset = est.preset || WATER_ARCHETYPES[this.activeArchetype]?.defaultPreset || 'river';
        const preset = WATER_PRESETS[this.activePreset] ?? {};
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
            riverWaves: preset.riverWaves ?? (this.activeArchetype === 'river' ? 0.36 : 0.0),
            lakeWaves: (this.activeArchetype === 'lake' || this.activeArchetype === 'pond') ? (preset.lakeWaves ?? 0.25) : 0.0,
            lakeRings: (this.activeArchetype === 'lake' || this.activeArchetype === 'pond' || this.activeArchetype === 'puddle') ? (typeof preset.lakeRings === 'number' ? preset.lakeRings : (preset.lakeRings ? 0.70 : 0.0)) : 0.0,
            whitecaps: preset.whitecaps ?? 0.1,
            sunGlint: preset.sunGlint ?? 0.3,
            spindriftWake: preset.spindriftWake ?? false,
            crestBound: preset.crestBound ?? false,
            colorOverride: preset.colorOverride || '',
            autoColor: !preset.colorOverride
        };
    },

    _loadActiveRegionFX(regionId) {
        if (!regionId) return;
        const region = canvas.scene?.regions?.get(regionId);
        if (!region) return;
        const b = this._getRegionWaterBehavior(region);

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

        const shouldEstimate = !isConfigured || !b?.system;

        if (shouldEstimate) {
            const est = WaterShapeEstimator.estimateRegion(region, canvas?.dimensions);
            if (est) {
                this._applyCandidateEstimation({ estimation: est });
            }
        } else if (b?.system) {
            const s = b.system;
            const loadedPreset = WaterManager.readPresetChoice(s, b.flags?.[MODULE_ID], region.flags?.[MODULE_ID]);
            const loadedArchetype = s.archetype || WaterManager.inferArchetype(loadedPreset);
            const customPresets = game.settings?.get?.(MODULE_ID, 'waterCustomPresets') ?? {};
            const p = WATER_PRESETS[loadedPreset] ?? customPresets[loadedPreset] ?? WATER_PRESETS[WATER_ARCHETYPES[loadedArchetype]?.defaultPreset] ?? {};
            const isSmallBody = (loadedArchetype === 'lake' || loadedArchetype === 'pond' || loadedArchetype === 'puddle');

            this.fx = {
                ...this.fx,
                speed: Number.isFinite(s.speed) ? s.speed : (p.speed ?? 1.0),
                intensity: Number.isFinite(s.intensity) ? s.intensity : (p.intensity ?? 0.3),
                opacity: Number.isFinite(s.opacity) ? s.opacity : (p.opacity ?? 0.2),
                distortion: Number.isFinite(s.distortion) ? s.distortion : (p.distortion ?? 0.02),
                fadeWidth: Number.isFinite(s.fadeWidth) ? s.fadeWidth : (p.fadeWidth ?? 50),
                scale: Number.isFinite(s.scale) ? s.scale : (p.scale ?? 90),
                flowAngle: Number.isFinite(s.flowAngle) ? s.flowAngle : (p.flowAngle ?? 90),
                shoreWaves: Number.isFinite(s.shoreWaves) ? s.shoreWaves : (p.shoreWaves ?? 0.2),
                waveCount: Number.isFinite(s.waveCount) ? s.waveCount : (p.waveCount ?? 4),
                waveSegment: Number.isFinite(s.waveSegment) ? s.waveSegment : (p.waveSegment ?? 0.85),
                waveRegularity: Number.isFinite(s.waveRegularity) ? s.waveRegularity : (p.waveRegularity ?? 0.60),
                swashSurge: Number.isFinite(s.swashSurge) ? s.swashSurge : (p.swashSurge ?? 16.0),
                surfFoam: Number.isFinite(s.surfFoam) ? s.surfFoam : (p.surfFoam ?? 0.70),
                choppySeas: Number.isFinite(s.choppySeas) ? s.choppySeas : (p.choppySeas ?? 0.0),
                riverWaves: Number.isFinite(s.riverWaves) ? s.riverWaves : (p.riverWaves ?? (loadedArchetype === 'river' ? 0.36 : 0.0)),
                lakeWaves: isSmallBody ? (Number.isFinite(s.lakeWaves) ? s.lakeWaves : (p.lakeWaves ?? 0.0)) : 0.0,
                lakeRings: isSmallBody ? (Number.isFinite(s.lakeRings) ? Number(s.lakeRings) : (s.lakeRings ? 0.70 : 0.0)) : 0.0,
                whitecaps: Number.isFinite(s.whitecaps) ? s.whitecaps : (p.whitecaps ?? 0.1),
                sunGlint: Number.isFinite(s.sunGlint) ? s.sunGlint : (p.sunGlint ?? 0.3),
                spindriftWake: Boolean(s.spindriftWake ?? p.spindriftWake),
                crestBound: Boolean(s.crestBound ?? p.crestBound),
                colorOverride: s.colorOverride || region.flags?.[MODULE_ID]?.color || '',
                autoColor: !(s.colorOverride || region.flags?.[MODULE_ID]?.color)
            };
            this.activePreset = loadedPreset;
            this.activeArchetype = loadedArchetype;
        }
    },

    _isAutoGeneratedRegionName(region) {
        if (!region) return false;
        const customFlag = region.getFlag?.(MODULE_ID, 'hasCustomName') ?? region.flags?.[MODULE_ID]?.hasCustomName;
        if (customFlag === true) return false;
        if (customFlag === false) return true;
        const currentName = (region.name || '').trim();
        if (!currentName) return true;
        if (/^(Ocean|Coastline|Coastal Surf|Lake|River|Pond|Puddle|Water|Water Zone)\s+\d+$/i.test(currentName)) {
            return true;
        }
        const localizedPrefixes = [
            ...Object.values(WATER_ARCHETYPES).map(a => a.label),
            game.i18n.localize('IonriftWaterline.detector.defaultWaterName'),
            game.i18n.localize('IonriftWaterline.studio.defaultZoneName'),
            game.i18n.localize('IonriftWaterline.studio.fallbackWaterZone'),
            game.i18n?.has?.('TYPES.Region') ? game.i18n.localize('TYPES.Region') : ''
        ].filter(Boolean).map(s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
        if (localizedPrefixes.length) {
            const re = new RegExp(`^(?:${localizedPrefixes.join('|')})(?:\\s+\\d+)?$`, 'i');
            if (re.test(currentName)) return true;
        }
        return false;
    },

    _onSelectArchetype(archetypeKey) {
        if (!WATER_ARCHETYPES[archetypeKey]) return;
        this.activeArchetype = archetypeKey;
        const archMeta = WATER_ARCHETYPES[archetypeKey];
        const defaultPresetKey = archMeta.defaultPreset;
        if (this.sampler?.candidate?.estimation) {
            this.sampler.candidate.estimation = {
                ...this.sampler.candidate.estimation,
                archetype: archetypeKey,
                archetypeLabel: archMeta.label,
                icon: archMeta.icon,
                accentColor: archMeta.accentColor,
                preset: defaultPresetKey
            };
        }
        if (this.activeRegionId) {
            const region = canvas.scene?.regions?.get(this.activeRegionId);
            const currentName = (region?.name || '').trim();
            if (region && this._isAutoGeneratedRegionName(region)) {
                const allRegions = Array.from(canvas.scene?.regions?.values?.() ?? canvas.scene?.regions ?? []);
                const otherNames = new Set(allRegions.filter(r => r.id !== region.id).map(r => (r.name || '').trim().toLowerCase()));
                let nextIdx = 1;
                while (otherNames.has(`${archMeta.label} ${nextIdx}`.toLowerCase())) {
                    nextIdx++;
                }
                const newName = `${archMeta.label} ${nextIdx}`;
                if (newName !== currentName) {
                    void region.update?.({ name: newName });
                }
            }
        }
        this._onSelectWaterPreset(defaultPresetKey);
    },

    _onSelectWaterPreset(key) {
        if (key === 'abyssal_depths') key = 'ocean_calm';
        const prevPresetKey = this.activePreset;
        this.activePreset = key;
        const customPresets = game.settings.get(MODULE_ID, 'waterCustomPresets') ?? {};
        const prevPreset = WATER_PRESETS[prevPresetKey] ?? customPresets[prevPresetKey];
        const preset = WATER_PRESETS[key] ?? customPresets[key];
        if (preset) {
            if (preset.archetype) this.activeArchetype = preset.archetype;
            const isSmallBody = (this.activeArchetype === 'lake' || this.activeArchetype === 'pond' || this.activeArchetype === 'puddle');
            const hadPresetColor = Boolean(prevPreset?.colorOverride);
            const preserveManualColor = !this.fx.autoColor && this.fx.colorOverride && !hadPresetColor;
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
                colorOverride: preset.colorOverride ?? (preserveManualColor ? this.fx.colorOverride : ''),
                autoColor: preset.colorOverride ? false : (preserveManualColor ? false : (key === 'custom' ? this.fx.autoColor : true))
            };
            if (this.sampler?.candidate?.estimation) {
                const archMeta = WATER_ARCHETYPES[this.activeArchetype] ?? WATER_ARCHETYPES.river;
                this.sampler.candidate.estimation = {
                    ...this.sampler.candidate.estimation,
                    archetype: this.activeArchetype,
                    archetypeLabel: archMeta.label,
                    icon: archMeta.icon,
                    accentColor: archMeta.accentColor,
                    preset: key
                };
            }
            this._liveUpdateFX();
        }
        this.render();
    },

    _syncAdvancedDrawerFromFX(root) {
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
    },

    _syncHeroSlidersFromFX(root) {
        const heroSliders = this._buildHeroSliders(this.activeArchetype, this.fx);
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
    },

    async _saveCustomWaterPreset(name) {
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
        ui.notifications.info(game.i18n.format('IonriftWaterline.studio.notifyWaterPresetSaved', { label: WATER_ARCHETYPES[this.activeArchetype]?.label || '', name }));
    },

    _deleteCustomWaterPreset(key) {
        const presets = game.settings.get(MODULE_ID, 'waterCustomPresets') ?? {};
        if (!presets[key]) return;
        delete presets[key];
        game.settings.set(MODULE_ID, 'waterCustomPresets', presets);
        const defaultPresetKey = WATER_ARCHETYPES[this.activeArchetype]?.defaultPreset || 'river';
        this._onSelectWaterPreset(defaultPresetKey);
    },

    _focusRegionOnCanvas(regionId) {
        if (!regionId) return;
        const region = canvas.scene?.regions?.get(regionId);
        if (!region) return;
        const pts = WaterShapeEstimator.extractRegionPoints(region);
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
    },

    _getControlledUnattachedRegion() {
        const controlled = Array.from(canvas?.regions?.controlled ?? []);
        for (const placeable of controlled) {
            const doc = placeable?.document ?? placeable;
            if (!doc || this._getRegionWaterBehavior(doc)) continue;
            const pts = WaterShapeEstimator.extractRegionPoints(doc);
            if (pts && pts.length >= 6) return doc;
        }
        return null;
    },

    _startRegionPick() {
        if (this.sampler?.isActive || this.sampler?.editingRegionId) {
            this.sampler.discardCandidate();
            this.sampler.stop();
        }
        this._stopRegionPick();
        this.regionPickActive = true;

        const regions = Array.from(canvas?.scene?.regions?.values?.() ?? canvas?.scene?.regions ?? []);
        for (const region of regions) {
            if (!this._getRegionWaterBehavior(region) && region.object) {
                region.object.visible = true;
                region.object.alpha = 1;
            }
        }

        this._regionPickClickHandler = async (event) => {
            if (!this.regionPickActive) return;
            const button = event.data?.button ?? event.button ?? 0;
            if (button !== 0) return;

            const pos = event.data?.getLocalPosition
                ? event.data.getLocalPosition(canvas.app.stage)
                : canvas.stage.toLocal(event.global);
            if (!pos) return;

            const allRegions = Array.from(canvas?.scene?.regions?.values?.() ?? canvas?.scene?.regions ?? []);
            let bestUnattached = null;
            let bestArea = Infinity;
            let matchedWater = null;

            for (const region of allRegions) {
                const pts = WaterShapeEstimator.extractRegionPoints(region);
                if (!pts || pts.length < 6) continue;
                if (!RasterContourTracer.pointInPolygon(pos.x, pos.y, pts, pts.holes)) continue;

                if (this._getRegionWaterBehavior(region)) {
                    matchedWater = region;
                } else {
                    const est = WaterShapeEstimator.estimate({ points: pts, vertexCount: Math.round(pts.length / 2) }, canvas?.dimensions);
                    const area = est?.area || Infinity;
                    if (!bestUnattached || area < bestArea) {
                        bestUnattached = region;
                        bestArea = area;
                    }
                }
            }

            if (bestUnattached) {
                await this.adoptRegion(bestUnattached.id);
            } else if (matchedWater) {
                this._stopRegionPick();
                this.loadRegion(matchedWater.id);
                ui.notifications?.info(game.i18n.format('IonriftWaterline.studio.notifySelectedExisting', { name: matchedWater.name }));
            } else {
                ui.notifications?.warn(game.i18n.localize('IonriftWaterline.studio.warnNoRegionAtPoint'));
            }
        };

        this._regionPickKeyHandler = (event) => {
            if (event.key === 'Escape' && this.regionPickActive) {
                this._stopRegionPick();
                this.render();
            }
        };

        canvas.stage?.on?.('pointerdown', this._regionPickClickHandler);
        document.addEventListener('keydown', this._regionPickKeyHandler);
        ui.notifications?.info(game.i18n.localize('IonriftWaterline.studio.notifyPickRegionHint'));
    },

    _stopRegionPick() {
        this.regionPickActive = false;
        if (this._regionPickClickHandler) {
            canvas?.stage?.off?.('pointerdown', this._regionPickClickHandler);
            this._regionPickClickHandler = null;
        }
        if (this._regionPickKeyHandler) {
            document.removeEventListener('keydown', this._regionPickKeyHandler);
            this._regionPickKeyHandler = null;
        }
    },

    /**
     * Convert an existing unattached RegionDocument into a Waterline waterbody.
     * @param {string} regionId
     * @returns {Promise<RegionDocument|null>}
     */
    async adoptRegion(regionId) {
        if (!regionId) return null;
        const region = canvas.scene?.regions?.get(regionId);
        if (!region) return null;

        this._stopRegionPick();
        this._flushAutoSave();

        if (this._getRegionWaterBehavior(region)) {
            this.loadRegion(regionId);
            return region;
        }

        const pts = WaterShapeEstimator.extractRegionPoints(region);
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
            waveCount: preset.waveCount ?? 4,
            swashSurge: preset.swashSurge ?? 16.0,
            surfFoam: preset.surfFoam ?? 0.70,
            waveSegment: preset.waveSegment ?? 0.85,
            waveRegularity: preset.waveRegularity ?? 0.60,
            choppySeas: preset.choppySeas ?? 0.0,
            riverWaves: preset.riverWaves ?? (est.archetype === 'river' ? 0.36 : 0.0),
            lakeWaves: (est.archetype === 'lake' || est.archetype === 'pond') ? (preset.lakeWaves ?? 0.25) : 0.0,
            lakeRings: (est.archetype === 'lake' || est.archetype === 'pond' || est.archetype === 'puddle') ? (typeof preset.lakeRings === 'number' ? preset.lakeRings : (preset.lakeRings ? 0.70 : 0.0)) : 0.0,
            whitecaps: preset.whitecaps ?? 0.1,
            sunGlint: preset.sunGlint ?? 0.3,
            spindriftWake: Boolean(preset.spindriftWake),
            crestBound: Boolean(preset.crestBound),
            colorOverride: preset.colorOverride || ''
        };

        await region.createEmbeddedDocuments('RegionBehavior', [{
            type: `${MODULE_ID}.waterFX`,
            name: game.i18n.localize('IonriftWaterline.behavior.defaultName'),
            flags: {
                [MODULE_ID]: { configured: true }
            },
            system
        }]);
        await region.setFlag(MODULE_ID, 'configured', true);
        await region.setFlag(MODULE_ID, 'adoptedRegion', true);
        if (region.color) {
            await region.setFlag(MODULE_ID, 'originalColor', region.color);
        }
        if (region.locked && region.update) {
            await region.update({ locked: false });
        }
        if (pts?.holes?.length) {
            await region.setFlag(MODULE_ID, 'holes', pts.holes);
        }

        this.activeRegionId = regionId;
        this.hasUnsavedChanges = false;
        this._scrollActiveIntoView = true;
        this._loadActiveRegionFX(regionId);
        this._liveUpdateFX(false);
        this.constructor.syncRegionOverlays(true);
        this.render();
        ui.notifications?.info(game.i18n.format('IonriftWaterline.studio.notifyAddedRegion', { name: region.name }));
        return region;
    },

    async _editRegionBoundary(regionId) {
        const region = canvas.scene?.regions?.get(regionId);
        if (!region) return;

        if (this.activeRegionId !== regionId) {
            this._flushAutoSave();
        }
        this._previousRegionId = null;
        this.activeRegionId = regionId;
        this.hasUnsavedChanges = false;
        this._scrollActiveIntoView = true;
        this._loadActiveRegionFX(regionId);
        this._focusRegionOnCanvas(regionId);

        const loaded = await this.sampler.loadRegionForEditing(regionId, {
            onCandidate: () => this.render(),
            onClear: () => this.render(),
            onStatus: (msg) => ui.notifications.info(game.i18n.format('IonriftWaterline.studio.notifyStatus', { message: msg }))
        });

        if (loaded) {
            this.render();
        }
    },

    /**
     * Switch active region and re-render studio.
     * @param {string} regionId
     */
    loadRegion(regionId) {
        if (!regionId) return;
        if (this.activeRegionId !== regionId) {
            this._flushAutoSave();
        }
        this.applyToAllSameArchetype = false;
        this.activeRegionId = regionId;
        this.hasUnsavedChanges = false;
        this._scrollActiveIntoView = true;
        this._loadActiveRegionFX(regionId);
        this.render();
    }
};
