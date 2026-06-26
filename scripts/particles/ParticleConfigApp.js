const MODULE_ID = 'ionrift-waterline';

/** Default configs for new emitters */
const SMOKE_DEFAULTS = {
    density: 1.0,
    spread: 10,
    sizeStart: 0.4,
    sizeEnd: 2.5,
    speedStart: 40,
    speedEnd: 15,
    maxAlpha: 0.7,
    blendMode: 'NORMAL'
};

const WATERFALL_DEFAULTS = {
    density: 1.5,
    spread: 30,
    particleSize: 0.3,
    intensity: 1.0
};

/**
 * Floating panel for placing and configuring particle emitters.
 *
 * Features:
 *  - Scene-level shared wind direction / strength (all smoke stacks read this)
 *  - Tab bar (Smoke Plume, Waterfall Spray, Active Emitters) with live sliders
 *  - Active Emitters list: click Edit to load an existing emitter into the
 *    appropriate section and save changes back to its drawing flags
 */
export class ParticlePlacementPanel extends Application {

    constructor(options = {}) {
        super(options);
        // Pending "new placement" configs
        this._pending = {
            smoke: { ...SMOKE_DEFAULTS },
            waterfall: { ...WATERFALL_DEFAULTS }
        };
        this._activeSection = 'smoke';
        // When editing an existing emitter, this holds its DrawingDocument
        this._editTarget = null;
    }

    static get defaultOptions() {
        return foundry.utils.mergeObject(super.defaultOptions, {
            id: 'waterline-particle-panel',
            title: 'Particle FX',
            template: `modules/${MODULE_ID}/scripts/particles/placement-panel.html`,
            width: 320,
            height: 'auto',
            resizable: false,
            // ionrift-window provides glass background, brand CSS variables, and scrollbar styling.
            // glass-ui provides the glassmorphism backdrop-filter treatment.
            // The tab pane scroll area is capped at 380px via CSS so the panel height stays fixed.
            classes: ['ionrift-window', 'glass-ui', 'waterline-particle-panel']
        });
    }

    getData() {
        const windDir        = canvas.scene?.getFlag(MODULE_ID, 'windDir')         ?? 90;
        const windStrength   = canvas.scene?.getFlag(MODULE_ID, 'windStrength')    ?? 0.5;
        const windTurbulence = canvas.scene?.getFlag(MODULE_ID, 'windTurbulence')  ?? 0.3;
        const emitters = this._getSceneEmitters();
        return {
            smoke: this._pending.smoke,
            waterfall: this._pending.waterfall,
            windDir,
            windStrength,
            windTurbulence,
            activeSection: this._activeSection,
            emitters,
            editTargetId: this._editTarget?.id ?? null
        };
    }

    _getSceneEmitters() {
        if (!canvas.scene) return [];
        const list = [];
        for (const doc of canvas.scene.drawings.contents) {
            const fx = doc.getFlag(MODULE_ID, 'fx');
            if (!fx || fx.type === 'none') continue;
            list.push({
                id: doc.id,
                label: `${fx.type === 'smoke' ? 'Smoke' : 'Waterfall'} #${doc.id.slice(0, 6)}`,
                icon: fx.type === 'smoke' ? 'fa-smog' : 'fa-water',
                type: fx.type,
                selected: this._editTarget?.id === doc.id
            });
        }
        return list;
    }

    activateListeners(html) {
        super.activateListeners(html);
        const root = html instanceof HTMLElement ? html : html[0];
        if (!root) return;

        // ── Scene wind sliders ────────────────────────────────
        const windDir = root.querySelector('#pfx-wind-dir');
        const windStr = root.querySelector('#pfx-wind-str');

        if (windDir) {
            windDir.addEventListener('input', () => {
                root.querySelector('#pfx-wind-dir-val').textContent = windDir.value + '°';
            });
            windDir.addEventListener('change', () => this._saveSceneWind(root));
        }
        if (windStr) {
            windStr.addEventListener('input', () => {
                root.querySelector('#pfx-wind-str-val').textContent = windStr.value;
            });
            windStr.addEventListener('change', () => this._saveSceneWind(root));
        }
        const windTurb = root.querySelector('#pfx-wind-turb');
        if (windTurb) {
            windTurb.addEventListener('input', () => {
                root.querySelector('#pfx-wind-turb-val').textContent = windTurb.value;
            });
            windTurb.addEventListener('change', () => this._saveSceneWind(root));
        }

        // ── Per-type sliders ──────────────────────────────────────────────
        root.querySelectorAll('input[type="range"][data-type]').forEach(range => {
            const valueEl = range.parentElement.querySelector('.pfx-value');
            if (valueEl) valueEl.textContent = range.value;
            range.addEventListener('input', () => {
                if (valueEl) valueEl.textContent = range.value;
                const type = range.dataset.type;
                const param = range.dataset.param;
                if (type && param) this._pending[type][param] = Number(range.value);
            });
        });

        // ── Select dropdowns (blend mode, etc.) ──────────────────────────────
        root.querySelectorAll('select[data-type]').forEach(sel => {
            sel.addEventListener('change', () => {
                const type = sel.dataset.type;
                const param = sel.dataset.param;
                if (type && param) this._pending[type][param] = sel.value;
            });
        });

        if (this._editTarget) {
            const pane = root.querySelector(`#pfx-pane-${this._editTarget._fxType}`);
            const btn  = pane?.querySelector('.pfx-place-btn');
            if (btn) {
                btn.innerHTML = '<i class="fas fa-save"></i> Update Emitter';
                btn.classList.add('pfx-place-btn-update');
            }
        }
        // ── Tab bar ───────────────────────────────────────────
        root.querySelectorAll('.pfx-tab').forEach(tab => {
            tab.addEventListener('click', () => {
                const section = tab.dataset.tab;
                this._activeSection = section;
                this._switchTab(root, section);
            });
        });

        // ── Place buttons ─────────────────────────────────────
        root.querySelectorAll('.pfx-place-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                const type = btn.dataset.type;
                // If we were editing an existing emitter, save instead of placing
                if (this._editTarget && this._editTarget._fxType === type) {
                    this._saveEditTarget(type, root);
                } else {
                    this._activatePlacement(type, root);
                }
            });
        });

        // ── Emitter list: Edit ────────────────────────────────
        root.querySelectorAll('.pfx-emitter-edit').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                const id = btn.dataset.id;
                this._loadEmitterForEdit(id, root);
            });
        });

        // ── Emitter list: Delete ──────────────────────────────
        root.querySelectorAll('.pfx-emitter-delete').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.preventDefault();
                e.stopPropagation();
                const id = btn.dataset.id;
                const doc = canvas.scene.drawings.get(id);
                if (doc) await doc.delete();
                this.render(false); // Re-render to refresh list
            });
        });

        // ── Refresh button ────────────────────────────────────
        root.querySelector('.pfx-refresh-btn')?.addEventListener('click', (e) => {
            e.preventDefault();
            this.render(false);
        });

        // Highlight the currently edited emitter row if any
        if (this._editTarget) {
            root.querySelector(`.pfx-emitter-item[data-id="${this._editTarget.id}"]`)
                ?.classList.add('pfx-emitter-editing');
        }
    }

    // ── Scene wind ────────────────────────────────────────────────────────────

    async _saveSceneWind(root) {
        if (!canvas.scene) return;
        const dir  = Number(root.querySelector('#pfx-wind-dir')?.value  ?? 90);
        const str  = Number(root.querySelector('#pfx-wind-str')?.value  ?? 0.5);
        const turb = Number(root.querySelector('#pfx-wind-turb')?.value ?? 0.3);
        await canvas.scene.setFlag(MODULE_ID, 'windDir',         dir);
        await canvas.scene.setFlag(MODULE_ID, 'windStrength',    str);
        await canvas.scene.setFlag(MODULE_ID, 'windTurbulence',  turb);
        // _onUpdateScene in DrawingFX picks up the flag change and updates the simulator live
    }

    // ── Edit existing emitter ─────────────────────────────────────────────────

    _loadEmitterForEdit(drawingId, root) {
        const doc = canvas.scene.drawings.get(drawingId);
        if (!doc) return;
        const fx = doc.getFlag(MODULE_ID, 'fx');
        if (!fx) return;

        this._editTarget = doc;
        this._editTarget._fxType = fx.type;

        // Load config into pending for that type, excluding wind (controlled at scene level)
        const { windDir, windStrength, ...rest } = fx;
        this._pending[fx.type] = { ...this._pending[fx.type], ...rest };

        this._activeSection = fx.type;
        this.render(false);

        // Highlight canvas marker
        import('./DrawingFX.js').then(({ DrawingFX }) => DrawingFX._highlightMarker(drawingId));

        ui.notifications.info(`Editing ${fx.type} emitter — adjust sliders then click "Update Emitter".`);
    }

    async _saveEditTarget(type, root) {
        if (!this._editTarget) return;
        const newConfig = { type, ...this._pending[type] };
        await this._editTarget.setFlag(MODULE_ID, 'fx', newConfig);
        this._editTarget = null;
        ui.notifications.info('Emitter updated.');
        this.render(false);
    }

    _cancelEdit(root) {
        this._editTarget = null;
        root.querySelectorAll('.pfx-place-btn').forEach(btn => {
            btn.innerHTML = '<i class="fas fa-map-pin"></i> Click to Place';
            btn.classList.remove('pfx-place-btn-update');
        });
        root.querySelectorAll('.pfx-emitter-item').forEach(el => el.classList.remove('pfx-emitter-editing'));
    }

    // ── Tab bar ───────────────────────────────────────────────────────────────

    _switchTab(root, activeTab) {
        // Update pane visibility
        root.querySelectorAll('.pfx-tab-pane').forEach(pane => {
            pane.classList.toggle('pfx-pane-hidden', pane.id !== `pfx-pane-${activeTab}`);
        });
        // Update tab active state
        root.querySelectorAll('.pfx-tab').forEach(tab => {
            const isActive = tab.dataset.tab === activeTab;
            tab.classList.toggle('pfx-tab-active', isActive);
            tab.setAttribute('aria-selected', String(isActive));
        });
    }

    // ── Placement ─────────────────────────────────────────────────────────────

    _activatePlacement(type, root) {
        this._editTarget = null;
        const config = { ...this._pending[type], type };

        root.querySelectorAll('.pfx-place-btn').forEach(b => b.classList.remove('pfx-placing'));
        // Each pane has exactly one .pfx-place-btn; find it via the pane id
        const pane = root.querySelector(`#pfx-pane-${type}`);
        const btn  = pane?.querySelector('.pfx-place-btn');
        if (btn) btn.classList.add('pfx-placing');

        import('./DrawingFX.js').then(({ DrawingFX }) => {
            DrawingFX.activatePlacement(type, config, () => {
                btn?.classList.remove('pfx-placing');
                // Refresh emitter list after placement
                setTimeout(() => this.render(false), 300);
            });
        });
    }

    // ── Singleton ─────────────────────────────────────────────────────────────
    /** Singleton show helper */
    static show() {
        if (!ParticlePlacementPanel._instance) {
            ParticlePlacementPanel._instance = new ParticlePlacementPanel();
        }
        ParticlePlacementPanel._instance.render(true);
        // Show pulsing markers over emitters after panel renders
        setTimeout(() => {
            import('./DrawingFX.js').then(({ DrawingFX }) => DrawingFX.showMarkers());
        }, 150);
    }

    static closeIfOpen() {
        import('./DrawingFX.js').then(({ DrawingFX }) => DrawingFX.hideMarkers());
        ParticlePlacementPanel._instance?.close({ force: true });
        ParticlePlacementPanel._instance = null;
    }
}
