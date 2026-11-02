import { WakeTuning } from '../../water/WakeTuning.js';
import { MODULE_ID } from '../../data/moduleId.js';

/**
 * DOM event listener wiring for WaterlineStudioApp.
 * Mixed into WaterlineStudioApp.prototype.
 */
export const studioEventWiringMethods = {
    _wireStudioEvents(root, WaterlineStudioApp) {
        // Navigation tab switching
        root.querySelectorAll('.waterline-tabs [data-tab]').forEach(tabEl => {
            tabEl.addEventListener('click', (ev) => {
                ev.preventDefault();
                this.activeTab = tabEl.dataset.tab;
                this.render();
            });
        });

        // Region pick mode toggle ("From Region")
        root.querySelector('[data-action="toggleRegionPick"]')?.addEventListener('click', async () => {
            if (this.regionPickActive) {
                this._stopRegionPick();
                this.render();
                return;
            }
            const controlled = this._getControlledUnattachedRegion();
            if (controlled) {
                await this.adoptRegion(controlled.id);
                return;
            }
            this._startRegionPick();
            this.render();
        });

        // Pick mode toggle ("New Waterbody")
        root.querySelector('[data-action="togglePick"]')?.addEventListener('click', () => {
            if (this.sampler.isActive || this.sampler.editingRegionId) {
                this.sampler.discardCandidate();
                this.sampler.stop();
                if (!this.activeRegionId && this._previousRegionId) {
                    this.activeRegionId = this._previousRegionId;
                    this._previousRegionId = null;
                    this.hasUnsavedChanges = false;
                    this._scrollActiveIntoView = true;
                    this._loadActiveRegionFX(this.activeRegionId);
                }
                this.render();
            } else {
                this._stopRegionPick();
                this._flushAutoSave();
                this._previousRegionId = this.activeRegionId;
                this.activeRegionId = null;
                this.hasUnsavedChanges = false;
                this.applyToAllSameArchetype = false;
                this.sampler.start(
                    { tolerance: this.sampler.tolerance, smoothing: this.sampler.smoothing },
                    {
                        onCandidate: (cand) => {
                            this._applyCandidateEstimation(cand);
                            this.render();
                        },
                        onClear: () => this.render(),
                        onStatus: (msg) => ui.notifications.info(game.i18n.format('IonriftWaterline.studio.notifyStatus', { message: msg }))
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
            const isEditing = Boolean(this.sampler.editingRegionId);
            const creationOverrides = !isEditing ? {
                archetype: this.activeArchetype,
                preset: this.activePreset,
                fx: { ...this.fx }
            } : null;
            const region = await this.sampler.acceptCandidate(undefined, creationOverrides);
            this.sampler.stop();
            this._previousRegionId = null;
            if (region) {
                this.activeRegionId = region.id;
                this._scrollActiveIntoView = true;
                if (isEditing && this.hasUnsavedChanges) {
                    this._silentSave = true;
                    try { await this.saveActiveWaterbodyFX(); } finally { this._silentSave = false; }
                } else {
                    this.hasUnsavedChanges = false;
                    this._loadActiveRegionFX(region.id);
                }
                this._liveUpdateFX(false);
                WaterlineStudioApp.syncRegionOverlays(true);
            }
            this.render();
        });
        root.querySelector('[data-action="discardCandidate"]')?.addEventListener('click', () => {
            const wasEditing = Boolean(this.sampler.editingRegionId);
            this.sampler.discardCandidate();
            if (wasEditing) {
                this.sampler.stop();
            }
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
                if (!regionId) return;
                this._stopRegionPick();
                const wasPickActive = Boolean(this.sampler?.isActive || this.sampler?.editingRegionId);
                if (wasPickActive) {
                    this.sampler.discardCandidate();
                    this.sampler.stop();
                    this._previousRegionId = null;
                } else if (regionId === this.activeRegionId) {
                    return;
                }
                this._flushAutoSave();
                this.applyToAllSameArchetype = false;
                this.activeRegionId = regionId;
                this.hasUnsavedChanges = false;
                this._scrollActiveIntoView = true;
                this._loadActiveRegionFX(regionId);
                this.render();
            });
        });

        // Refine boundary with sampler (add/remove water)
        root.querySelectorAll('[data-action="editZoneBoundary"]').forEach(btn => {
            btn.addEventListener('click', async (ev) => {
                ev.stopPropagation();
                const regionId = btn.dataset.regionId;
                if (!regionId) return;

                if (this.sampler.editingRegionId === regionId) {
                    this.sampler.discardCandidate();
                    this.sampler.stop();
                    this.render();
                    return;
                }

                await this._editRegionBoundary(regionId);
            });
        });

        // Focus waterbody on canvas
        root.querySelectorAll('[data-action="focusZone"]').forEach(btn => {
            btn.addEventListener('click', (ev) => {
                ev.stopPropagation();
                const regionId = btn.dataset.regionId;
                if (regionId && regionId !== this.activeRegionId && !this.sampler?.isActive) {
                    this._flushAutoSave();
                    this.applyToAllSameArchetype = false;
                    this.activeRegionId = regionId;
                    this.hasUnsavedChanges = false;
                    this._scrollActiveIntoView = true;
                    this._loadActiveRegionFX(regionId);
                    this.render();
                }
                this._focusRegionOnCanvas(regionId);
            });
        });

        // Delete waterbody (or detach Waterline FX if region was adopted / has other behaviors)
        root.querySelectorAll('[data-action="deleteZone"]').forEach(btn => {
            btn.addEventListener('click', (ev) => {
                ev.stopPropagation();
                const regionId = btn.dataset.regionId;
                const region = canvas.scene?.regions?.get(regionId);
                if (!region) return;

                const allBehaviors = Array.from(region.behaviors?.values?.() ?? region.behaviors?.contents ?? region.behaviors ?? []);
                const waterBehaviors = allBehaviors.filter(b => b.type === `${MODULE_ID}.waterFX`);
                const otherBehaviors = allBehaviors.filter(b => b.type !== `${MODULE_ID}.waterFX`);
                const isAdoptedOrShared = Boolean(otherBehaviors.length > 0 || region.flags?.[MODULE_ID]?.adoptedRegion);

                Dialog.confirm({
                    title: isAdoptedOrShared ? game.i18n.localize('IonriftWaterline.studio.dialogRemoveFxTitle') : game.i18n.localize('IonriftWaterline.studio.dialogDeleteWaterbodyTitle'),
                    content: isAdoptedOrShared
                        ? game.i18n.format('IonriftWaterline.studio.dialogRemoveFxContent', { name: region.name })
                        : game.i18n.format('IonriftWaterline.studio.dialogDeleteWaterbodyContent', { name: region.name }),
                    yes: async () => {
                        if (this.sampler?.editingRegionId === regionId) {
                            this.sampler.discardCandidate();
                        }
                        if (isAdoptedOrShared && waterBehaviors.length > 0 && region.deleteEmbeddedDocuments) {
                            const ids = waterBehaviors.map(b => b.id ?? b._id).filter(Boolean);
                            if (ids.length) {
                                await region.deleteEmbeddedDocuments('RegionBehavior', ids);
                            }
                            const origColor = region.flags?.[MODULE_ID]?.originalColor;
                            if (origColor && region.update) {
                                await region.update({ color: origColor });
                            }
                            if (region.unsetFlag) {
                                await region.unsetFlag(MODULE_ID, 'configured');
                                await region.unsetFlag(MODULE_ID, 'customPreset');
                                await region.unsetFlag(MODULE_ID, 'color');
                            }
                            if (region.object) {
                                region.object.alpha = 1;
                            }
                        } else {
                            await region.delete();
                        }
                        if (this.activeRegionId === regionId) this.activeRegionId = null;
                        this.render();
                    },
                    defaultYes: false
                });
            });
        });

        // Unattached scene region selector & adoption
        root.querySelectorAll('select[name="unattachedRegionSelect"]').forEach(sel => {
            sel.addEventListener('change', (ev) => {
                this.selectedUnattachedRegionId = ev.target.value;
            });
        });

        root.querySelectorAll('[data-action="adoptSceneRegion"]').forEach(btn => {
            btn.addEventListener('click', async () => {
                const select = root.querySelector('select[name="unattachedRegionSelect"]');
                const regionId = select?.value || this.selectedUnattachedRegionId;
                if (!regionId) return;
                await this.adoptRegion(regionId);
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
                        await this._renameWaterRegion(regionId, newName);
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
                this._onSelectArchetype(ev.target.value);
            });
        }

        const presetSelect = root.querySelector('select[name="waterPreset"]');
        if (presetSelect) {
            presetSelect.addEventListener('change', (ev) => {
                this._onSelectWaterPreset(ev.target.value);
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
            if (name) this._saveCustomWaterPreset(name);
        });
        root.querySelector('[data-action="deleteWaterPreset"]')?.addEventListener('click', () => {
            this._deleteCustomWaterPreset(this.activePreset);
        });

        // ── Curated Hero Sliders ──────────────────────────────────────────────
        root.querySelectorAll('input[name^="hero_"]').forEach(input => {
            input.addEventListener('input', (ev) => {
                const heroId = input.dataset.heroId;
                const val = Number(ev.target.value);
                this._onHeroSliderInput(heroId, val);

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
                this._syncHeroSlidersFromFX(root);
                this._syncAdvancedDrawerFromFX(root);
                this._liveUpdateFX();
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

                this._syncAdvancedDrawerFromFX(root);
                this._syncHeroSlidersFromFX(root);
                this._liveUpdateFX();
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

                if (name === 'flowAngle') {
                    if (arrowPivot) arrowPivot.style.transform = `rotate(${val}deg)`;
                    if (dirDisplay) dirDisplay.textContent = `${Math.round(val)}°`;
                }

                this._syncHeroSlidersFromFX(root);
                this._liveUpdateFX();
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
                    ? `<i class="fas fa-eye"></i> <span>${game.i18n.localize('IonriftWaterline.studio.samplingMap')}</span>`
                    : `<i class="fas fa-brush"></i> <span>${game.i18n.localize('IonriftWaterline.studio.customTint')}</span>`;
            }
        };

        if (autoColorCheckbox) {
            autoColorCheckbox.addEventListener('change', (ev) => {
                this.fx.autoColor = ev.target.checked;
                if (!this.fx.autoColor && !this.fx.colorOverride) {
                    this.fx.colorOverride = colorInput?.value || '#0d2e4d';
                }
                updateColorUIState(this.fx.colorOverride || '#0d2e4d', this.fx.autoColor);
                this._liveUpdateFX();
            });
        }

        if (colorInput) {
            const applyColorInput = (ev) => {
                this.fx.colorOverride = ev.target.value || '#0d2e4d';
                this.fx.autoColor = false;
                updateColorUIState(this.fx.colorOverride, false);
                this._liveUpdateFX();
            };
            colorInput.addEventListener('input', (ev) => {
                if (this._autoSaveTimer) {
                    clearTimeout(this._autoSaveTimer);
                    this._autoSaveTimer = null;
                }
                this.fx.colorOverride = ev.target.value || '#0d2e4d';
                this.fx.autoColor = false;
                this.hasUnsavedChanges = true;
                updateColorUIState(this.fx.colorOverride, false);
                this._liveUpdateFX(false);
            });
            colorInput.addEventListener('change', applyColorInput);
            colorInput.addEventListener('click', () => {
                if (this._autoSaveTimer) {
                    clearTimeout(this._autoSaveTimer);
                    this._autoSaveTimer = null;
                }
                if (this.fx.autoColor) {
                    this.fx.colorOverride = colorInput.value || '#0d2e4d';
                    this.fx.autoColor = false;
                    updateColorUIState(this.fx.colorOverride, false);
                    this._liveUpdateFX();
                }
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
                        statusPill.innerHTML = `<i class="fas fa-brush"></i> <span>${game.i18n.localize('IonriftWaterline.studio.customTint')}</span>`;
                    }
                    this._liveUpdateFX();
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
                    this._liveUpdateFX();
                } else {
                    updateColorUIState(this.fx.colorOverride || '#0d2e4d', this.fx.autoColor);
                }
            });
        }

        if (dropperBtn) {
            dropperBtn.addEventListener('click', (ev) => {
                ev.preventDefault();
                ev.stopPropagation();
                this._toggleCanvasColorSampler(dropperBtn, updateColorUIState);
            });
        }

        // Foam toggle checkboxes: Spindrift Wake and Crest-Locked foam
        for (const name of ['spindriftWake', 'crestBound']) {
            const cb = root.querySelector(`input[name="${name}"]`);
            if (cb) {
                cb.addEventListener('change', (ev) => {
                    this.fx[name] = ev.target.checked;
                    this._liveUpdateFX();
                });
            }
        }

        // Save FX to active waterbody
        root.querySelector('[data-action="saveWaterFX"]')?.addEventListener('click', async () => {
            await this.saveActiveWaterbodyFX();
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
                ui.notifications.info(game.i18n.format('IonriftWaterline.studio.notifyRipplePresetSaved', { name }));
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
            ui.notifications.info(game.i18n.localize('IonriftWaterline.studio.notifyRippleDefaultsReset'));
        });
    }
};
