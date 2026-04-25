import { WakeTuning } from './WakeTuning.js';

/**
 * GM-only ripple tuning panel (ApplicationV2).
 * Scrollable body, collapsible sections, save/load custom presets.
 *
 * Wake (V-chevron) sections are hidden for now while that strategy is WIP.
 */
export class WakeTuningDialog extends foundry.applications.api.ApplicationV2 {

    /** @type {WakeTuningDialog|null} */
    static _instance = null;

    /** Name of the last preset selected/loaded -- restored after re-render so delete still works. */
    static _activePreset = null;

    static DEFAULT_OPTIONS = {
        id: 'ionrift-waterline-wake-tuning',
        tag: 'div',
        window: {
            title: 'Token ripple tuning',
            icon: 'fas fa-sliders-h',
            resizable: true
        },
        position: { width: 560, height: 560 },
        classes: ['ionrift-window', 'wake-tuning-dialog']
    };

    constructor() {
        super({});
        WakeTuningDialog._instance = this;
    }

    /** @override */
    async _prepareContext() {
        const t = WakeTuning.get();
        return {
            t,
            L: (key) => game.i18n.localize(`IonriftWaterline.${key}`)
        };
    }

    /** @override */
    async _renderHTML(context) {
        const { t, L } = context;
        const el = document.createElement('div');
        el.className = 'wake-tg-root';
        el.innerHTML = WakeTuningDialog.#buildInnerHtml(t, L);
        WakeTuningDialog.#wireElement(el, this);
        return el;
    }

    /** @override */
    _replaceHTML(result, content, options) {
        content.replaceChildren(result);
    }

    /** @override */
    async close(options = {}) {
        WakeTuningDialog._instance = null;
        WakeTuningDialog._activePreset = null;
        return super.close(options);
    }

    static show() {
        if (!game.user.isGM) return;
        WakeTuningDialog.closeIfOpen();
        WakeTuningDialog._instance = new WakeTuningDialog();
        return WakeTuningDialog._instance.render({ force: true });
    }

    static closeIfOpen() {
        const inst = foundry.applications.instances.get('ionrift-waterline-wake-tuning')
            ?? WakeTuningDialog._instance;
        if (inst) {
            try { inst.close({ force: true }); } catch { /* ignore */ }
        }
        WakeTuningDialog._instance = null;
    }

    /**
     * @param {Record<string, unknown>} t
     * @param {(k: string) => string} L
     */
    static #buildInnerHtml(t, L) {
        const row = (key, label, min, max, step, type = 'range') => {
            const v = t[key];
            const valAttr = type === 'range' ? `value="${v}"` : `value="${String(v).replace(/"/g, '&quot;')}"`;
            return `
                <div class="form-group wake-tg-row" data-key="${key}">
                    <label title="${key}">${label}</label>
                    <input type="${type}" data-wake-key="${key}" min="${min}" max="${max}" step="${step}" ${valAttr} />
                    <span class="wake-tg-val">${type === 'color' ? '' : Number(v).toFixed(step < 1 ? 2 : 0)}</span>
                </div>`;
        };

        const presetNames = WakeTuning.listPresets();
        const activePreset = WakeTuningDialog._activePreset;
        const presetOpts = presetNames.map(n => {
            const sel = n === activePreset ? ' selected' : '';
            return `<option value="${n.replace(/"/g, '&quot;')}"${sel}>${n}</option>`;
        }).join('');

        return `
<div class="wake-tg-presets">
    <label class="wake-tg-presets-label"><i class="fas fa-bookmark"></i> Preset</label>
    <select class="wake-tg-preset-select">
        <option value="" disabled ${activePreset ? '' : 'selected'}>${presetNames.length ? 'Select preset...' : 'No presets saved'}</option>
        ${presetOpts}
    </select>
    <button type="button" class="wake-tg-preset-save wc-preset-btn" title="${L('WakeTuningPresetSave')}"><i class="fas fa-save"></i></button>
    <button type="button" class="wake-tg-preset-del wc-preset-btn wc-preset-delete" title="${L('WakeTuningPresetDelete')}"><i class="fas fa-trash"></i></button>
</div>
<div class="wake-tg-save-prompt" hidden>
    <input type="text" class="wake-tg-preset-name wc-preset-name" placeholder="${L('WakeTuningPresetNamePlaceholder')}" />
    <button type="button" class="wake-tg-preset-confirm cartograph-btn wc-preset-confirm" title="${L('WakeTuningPresetConfirm')}"><i class="fas fa-check"></i></button>
    <button type="button" class="wake-tg-preset-cancel cartograph-btn wc-preset-cancel" title="${L('WakeTuningPresetCancel')}"><i class="fas fa-times"></i></button>
</div>

<div class="wake-tg-scroll">
    <p class="wake-tg-hint">${L('WakeTuningHint')}</p>

    <details class="wake-tg-details" open>
        <summary>${L('WakeTuningPreview')}</summary>
        <div class="wake-tg-details-body">
            <div class="form-group wake-tg-row">
                <label>${L('WakeTuningVisualMode')}</label>
                <select data-wake-key="visualMode">
                    <option value="shader" ${t.visualMode === 'shader' ? 'selected' : ''}>Shader only</option>
                    <option value="sprites" ${t.visualMode === 'sprites' ? 'selected' : ''}>Sprites only (overlay)</option>
                    <option value="both" ${t.visualMode === 'both' ? 'selected' : ''}>Both</option>
                </select>
                <span class="wake-tg-val"></span>
            </div>
        </div>
    </details>

    <details class="wake-tg-details" open>
        <summary>${L('WakeTuningRippleTiming')}</summary>
        <div class="wake-tg-details-body">
            ${row('duration', 'Lifetime (s)', 0.35, 4, 0.05)}
            ${row('rippleStartMul', 'Start radius (x token)', 0.2, 2.0, 0.05)}
            ${row('rippleMaxMul', 'Max radius (x token)', 1.0, 5.0, 0.1)}
            ${row('ringCount', 'Ring count', 1, 6, 1)}
            ${row('baseAlpha', 'Strength', 0.1, 1, 0.05)}
            ${row('rippleVariance', 'Variance / randomness', 0, 2, 0.05)}
        </div>
    </details>

    <details class="wake-tg-details">
        <summary>${L('WakeTuningRippleSpawnTrail')}</summary>
        <div class="wake-tg-details-body">
            ${row('rippleLeadPx', 'Lead ahead of token (px)', 0, 30, 1)}
            ${row('minMoveDist', 'Min move for burst (px)', 0, 80, 1)}
            ${row('spawnCooldownPx', 'Spawn cooldown radius (px)', 5, 100, 1)}
            ${row('maxRipplesPool', 'Total ripple budget (all tokens)', 10, 120, 1)}
            ${row('refreshDuration', 'Trail ripple lifetime (s)', 0.4, 3, 0.05)}
            ${row('refreshBaseAlpha', 'Trail ripple strength', 0.1, 1, 0.05)}
        </div>
    </details>

    <details class="wake-tg-details">
        <summary>Idle ripples</summary>
        <div class="wake-tg-details-body">
            ${row('idleRippleStrength', 'Strength (0 = off)', 0, 1, 0.05)}
            ${row('idleShaderSpeedMul', 'Shader wave speed (fraction of global)', 0.05, 1, 0.05)}
            ${row('idleRippleMinSec', 'Interval min (s)', 0.2, 5, 0.1)}
            ${row('idleRippleMaxSec', 'Interval max (s)', 0.5, 10, 0.1)}
        </div>
    </details>

    <details class="wake-tg-details">
        <summary>${L('WakeTuningShader')}</summary>
        <div class="wake-tg-details-body">
            ${row('shaderBandPx', 'Ring band width (px)', 6, 48, 1)}
            ${row('shaderPhaseScale', 'Wave density', 0.06, 0.45, 0.01)}
            ${row('shaderRippleSpeed', 'Wave speed', 0, 18, 0.25)}
            ${row('shaderStrengthMul', 'Refraction strength', 1, 14, 0.25)}
        </div>
    </details>

    <details class="wake-tg-details">
        <summary>Advanced</summary>
        <div class="wake-tg-details-body">
            ${row('expandEasePower', 'Grow ease power', 1, 5, 0.1)}
            ${row('fadeStartT', 'Fade starts at t', 0, 0.95, 0.05)}
            ${row('shaderAmpBoost', 'Shader amp boost', 0.5, 3, 0.05)}
            ${row('longMoveMidPx', 'Extra burst after move (px)', 40, 400, 5)}
            ${row('moveRadiusScale', 'Move-radius scale', 80, 400, 5)}
            ${row('refreshMinDist', 'Trail min step (px)', 1, 25, 0.5)}
            ${row('refreshMaxDist', 'Trail max step (px)', 40, 400, 5)}
            ${row('rippleOriginJitterPx', 'Origin jitter (px)', 0, 24, 1)}
            ${row('rippleDurationJitter', 'Duration jitter', 0, 0.5, 0.01)}
            ${row('rippleRadiusJitter', 'Radius jitter', 0, 0.5, 0.01)}
            ${row('rippleAlphaJitter', 'Alpha jitter', 0, 0.5, 0.01)}
            ${row('rippleRingCountJitter', 'Ring count jitter', 0, 3, 1)}
        </div>
    </details>

    <details class="wake-tg-details">
        <summary>${L('WakeTuningSprites')}</summary>
        <div class="wake-tg-details-body">
            <div class="form-group wake-tg-row">
                <label>${L('WakeTuningSpriteColor')}</label>
                <input type="color" data-wake-key="spriteColor" value="${String(t.spriteColor)}" />
                <span class="wake-tg-val"></span>
            </div>
            ${row('spriteLineWidthMax', 'Line width max', 1, 10, 0.25)}
        </div>
    </details>
</div>

<div class="wake-tg-footer">
    <button type="button" class="wake-tg-reset"><i class="fas fa-undo"></i> ${L('WakeTuningReset')}</button>
    <button type="button" class="wake-tg-done"><i class="fas fa-times"></i> ${L('WakeTuningClose')}</button>
</div>`;
    }

    /**
     * @param {HTMLElement} el
     * @param {WakeTuningDialog} app
     */
    static #wireElement(el, app) {
        const updateVal = (input) => {
            const row = input.closest('.wake-tg-row');
            const span = row?.querySelector('.wake-tg-val');
            if (!span) return;
            if (input.tagName === 'SELECT') { span.textContent = ''; return; }
            if (input.type === 'color') span.textContent = '';
            else span.textContent = Number(input.value).toFixed(
                Number(input.step) < 1 ? 2 : 0
            );
        };

        el.querySelectorAll('[data-wake-key]').forEach((input) => {
            const evName = input.tagName === 'SELECT' ? 'change' : 'input';
            input.addEventListener(evName, async () => {
                const key = input.dataset.wakeKey;
                let val = input.value;
                if (input.type === 'range' || input.type === 'number') val = Number(val);
                if (key === 'ringCount' || key === 'maxRipplesPool' || key === 'wakeStampPoolMax' || key === 'rippleRingCountJitter') {
                    val = Math.round(Number(val));
                }
                await WakeTuning.setPartial({ [key]: val });
                updateVal(input);
                Hooks.callAll('ionrift-waterline.wakeTuningChanged');
            });
            updateVal(input);
        });

        // ── Presets ───────────────────────────────────────────────────────────
        const presetSelect  = el.querySelector('.wake-tg-preset-select');
        const savePrompt    = el.querySelector('.wake-tg-save-prompt');
        const presetNameIn  = el.querySelector('.wake-tg-preset-name');

        // Auto-load when a preset is selected from the dropdown
        presetSelect?.addEventListener('change', async () => {
            const name = presetSelect.value;
            if (!name) return;
            WakeTuningDialog._activePreset = name;
            await WakeTuning.loadPreset(name);
            Hooks.callAll('ionrift-waterline.wakeTuningChanged');
            await app.render({ force: true });
            ui.notifications?.info(`Loaded preset: ${name}`);
        });

        // Save button: reveal inline name prompt
        el.querySelector('.wake-tg-preset-save')?.addEventListener('click', () => {
            if (!savePrompt) return;
            savePrompt.hidden = !savePrompt.hidden;
            if (!savePrompt.hidden) presetNameIn?.focus();
        });

        // Confirm save
        el.querySelector('.wake-tg-preset-confirm')?.addEventListener('click', async () => {
            const name = presetNameIn?.value?.trim();
            if (!name) { ui.notifications?.warn('Enter a preset name first'); return; }
            WakeTuningDialog._activePreset = name;
            await WakeTuning.savePreset(name);
            await app.render({ force: true });
            ui.notifications?.info(`Saved preset: ${name}`);
        });

        // Cancel save prompt
        el.querySelector('.wake-tg-preset-cancel')?.addEventListener('click', () => {
            if (savePrompt) savePrompt.hidden = true;
        });

        // Delete selected preset (with branded modal confirm)
        el.querySelector('.wake-tg-preset-del')?.addEventListener('click', async () => {
            const name = presetSelect?.value;
            if (!name) { ui.notifications?.warn('Select a preset to delete'); return; }
            const confirmed = await game.ionrift.library.confirm({
                title: 'Delete preset',
                content: `<p>Delete preset <strong>${name}</strong>?<br>This cannot be undone.</p>`,
                yesLabel: 'Delete', yesIcon: 'fas fa-trash',
                noLabel: 'Cancel',  noIcon:  'fas fa-times',
                defaultYes: false
            });
            if (!confirmed) return;
            WakeTuningDialog._activePreset = null;
            await WakeTuning.deletePreset(name);
            await app.render({ force: true });
            ui.notifications?.info(`Deleted preset: ${name}`);
        });

        el.querySelector('.wake-tg-reset')?.addEventListener('click', async () => {
            WakeTuningDialog._activePreset = null;
            await WakeTuning.reset();
            Hooks.callAll('ionrift-waterline.wakeTuningChanged');
            await app.render({ force: true });
        });

        el.querySelector('.wake-tg-done')?.addEventListener('click', () => {
            app.close();
        });
    }
}
