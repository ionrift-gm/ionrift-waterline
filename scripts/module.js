import { BorderControls } from './border/BorderControls.js';
import { WaterManager } from './water/WaterManager.js';
import { WaterConfigDialog } from './water/WaterConfigDialog.js';
import { WakeManager } from './water/WakeManager.js';
import { WakeTuningDialog } from './water/WakeTuningDialog.js';
import { WAKE_TUNING_DEFAULTS } from './water/WakeTuning.js';

const MODULE_ID = 'ionrift-waterline';

// ---------------------------------------------------------------
// Init: Register the Water FX behavior type
// ---------------------------------------------------------------
Hooks.once('init', async () => {
    console.log('Ionrift Waterline | Initializing...');
    WaterManager.registerBehavior();

    // ── Hidden / world settings ──────────────────────────────────────────────
    game.settings.register(MODULE_ID, 'borderConfig', {
        scope: 'world',
        config: false,
        type: Object,
        default: {
            totalVertices: 29,
            amplitude: 244,
            jitter: 0.5,
            inset: 7
        }
    });

    game.settings.register(MODULE_ID, 'waterCustomPresets', {
        scope: 'world',
        config: false,
        type: Object,
        default: {}
    });

    // world-scope: GM sets tuning once; Foundry broadcasts to all connected clients automatically
    game.settings.register(MODULE_ID, 'wakeTuning', {
        scope: 'world',
        config: false,
        type: Object,
        default: foundry.utils.deepClone(WAKE_TUNING_DEFAULTS)
    });

    // ── Body: module-specific config ─────────────────────────────────────────
    game.settings.register(MODULE_ID, 'enableTokenWake', {
        name: 'IonriftWaterline.SettingsEnableTokenWake',
        hint: 'IonriftWaterline.SettingsEnableTokenWakeHint',
        scope: 'client',
        config: true,
        type: Boolean,
        default: true
    });

    game.settings.registerMenu(MODULE_ID, 'rippleTuning', {
        name: 'IonriftWaterline.SettingsRippleTuning',
        label: 'IonriftWaterline.SettingsRippleTuningLabel',
        hint: 'IonriftWaterline.SettingsRippleTuningHint',
        icon: 'fas fa-sliders-h',
        type: class extends FormApplication {
            render() { WakeTuningDialog.show(); return this; }
            async _updateObject() {}
            get template() { return ''; }
        },
        restricted: true   // GM only -- players see the effect but cannot adjust it
    });

    // ── Footer: SettingsLayout wires Discord, Wiki, and places debug last ─────
    const SettingsLayout = game.ionrift?.library?.SettingsLayout;
    if (SettingsLayout) {
        SettingsLayout.registerFooter(MODULE_ID, {
            wiki: 'https://github.com/ionrift-gm/ionrift-waterline/wiki'
        });
    }

    // debug must be registered after registerFooter so injectLayout places it in the footer zone
    game.settings.register(MODULE_ID, 'debug', {
        name: 'IonriftWaterline.SettingsDebug',
        hint: 'IonriftWaterline.SettingsDebugHint',
        scope: 'client',
        config: true,
        type: Boolean,
        default: false
    });
});

// GM-local change (dialog fires this hook after every slider adjustment)
Hooks.on('ionrift-waterline.wakeTuningChanged', () => WakeManager.onWakeTuningChanged());

// World-setting sync: fires on ALL clients when the GM saves wakeTuning to the server.
// Ensures players automatically adopt the GM's tuning without any action on their part.
Hooks.on('updateSetting', (setting) => {
    if (setting?.key === `${MODULE_ID}.wakeTuning`) {
        WakeManager.onWakeTuningChanged();
    }
});
// ---------------------------------------------------------------
// Scene Controls: Add border tools to the Walls palette,
// and a "Toggle Water" button to the Regions palette
// ---------------------------------------------------------------
Hooks.on('getSceneControlButtons', (controls) => {
    if (!game.user.isGM) return;

    const isV13 = !Array.isArray(controls);

    if (isV13) {
        // Inject border tools into the walls control group
        if (controls.walls?.tools) {
            controls.walls.tools['generate-border'] = {
                name: 'generate-border',
                title: 'Generate Border Walls',
                icon: 'fas fa-mountain',
                order: 20,
                button: true,
                onClick: () => BorderControls.showDialog(),
                onChange: () => {}
            };
            controls.walls.tools['clear-border'] = {
                name: 'clear-border',
                title: 'Clear Border Walls',
                icon: 'fas fa-trash-alt',
                order: 21,
                button: true,
                onClick: () => BorderControls.confirmClear(),
                onChange: () => {}
            };
        }

        // Inject water detection into the regions control group
        if (controls.regions?.tools) {
            controls.regions.tools['water-config'] = {
                name: 'water-config',
                title: 'Water Configuration',
                icon: 'fas fa-water',
                order: 20,
                button: true,
                onClick: () => WaterConfigDialog.show(),
                onChange: () => {}
            };
            controls.regions.tools['wake-tuning'] = {
                name: 'wake-tuning',
                title: 'Wake tuning (debug)',
                icon: 'fas fa-sliders-h',
                order: 22,
                button: true,
                onClick: () => WakeTuningDialog.show(),
                onChange: () => {}
            };
        }
    } else {
        // v12: find the walls control and inject tools
        const wallsControl = controls.find(c => c.name === 'walls');
        if (wallsControl?.tools) {
            wallsControl.tools.push(
                { name: 'generate-border', title: 'Generate Border Walls',
                  icon: 'fas fa-mountain', onClick: () => BorderControls.showDialog(), button: true },
                { name: 'clear-border', title: 'Clear Border Walls',
                  icon: 'fas fa-trash-alt', onClick: () => BorderControls.confirmClear(), button: true }
            );
        }
        const regionsControl = controls.find(c => c.name === 'regions');
        if (regionsControl?.tools) {
            regionsControl.tools.push(
                { name: 'wake-tuning', title: 'Wake tuning (debug)',
                  icon: 'fas fa-sliders-h', onClick: () => WakeTuningDialog.show(), button: true }
            );
        }
    }
});

// ---------------------------------------------------------------
// Canvas Ready: Initialize water manager and render water regions
// ---------------------------------------------------------------
Hooks.on('canvasReady', async () => {
    WaterConfigDialog.closeIfOpen();
    WakeTuningDialog.closeIfOpen();
    WaterManager.init();
    await WaterManager.refreshAll();
    WakeManager.init();
});

// ---------------------------------------------------------------
// Region & Behavior Updates: Re-render water when anything changes
// ---------------------------------------------------------------
Hooks.on('updateRegion', () => WaterManager.debouncedRefresh());
Hooks.on('createRegion', () => WaterManager.debouncedRefresh());
Hooks.on('deleteRegion', () => WaterManager.debouncedRefresh());

// Behavior CRUD
Hooks.on('createRegionBehavior', () => WaterManager.debouncedRefresh());
Hooks.on('updateRegionBehavior', () => WaterManager.debouncedRefresh());
Hooks.on('deleteRegionBehavior', () => WaterManager.debouncedRefresh());

// ---------------------------------------------------------------
// Token Movement: Emit water wake ripples
// ---------------------------------------------------------------
Hooks.on('updateToken', (tokenDoc, changes) => WakeManager.onTokenUpdate(tokenDoc, changes));
Hooks.on('refreshToken', (token) => WakeManager.onTokenRefresh(token));

// ---------------------------------------------------------------
// Token Config: inject "No water ripples" toggle on Identity tab
// ---------------------------------------------------------------
Hooks.on('renderTokenConfig', (app, html) => {
    const tokenDoc = app.document ?? app.object?.document ?? app.object;
    if (!tokenDoc) return;

    // Normalise: v13 passes a plain Element; v12 passes a jQuery object
    const root = html instanceof Element ? html : html[0];
    if (!root) return;

    const checked = tokenDoc?.getFlag?.(MODULE_ID, 'noRipple') ?? false;

    const fieldHtml = `
        <div class="form-group">
            <label>No water ripples</label>
            <div class="form-fields">
                <input type="checkbox" name="flags.${MODULE_ID}.noRipple" ${checked ? 'checked' : ''} />
            </div>
            <p class="hint">Suppress water ripple effects for this token (e.g. boats, flying creatures, constructs).</p>
        </div>`;

    // .tab[data-tab="identity"] targets the content panel; nav links share data-tab but lack .tab class
    const target = root.querySelector('.tab[data-tab="identity"]')
        ?? root.querySelector('section[data-tab="identity"]')
        ?? root.querySelector('form');
    if (target) target.insertAdjacentHTML('beforeend', fieldHtml);

    app.setPosition?.({ height: 'auto' });
});

console.log('Ionrift Waterline | Module loaded.');
