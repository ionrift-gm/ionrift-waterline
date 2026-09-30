import { WaterManager } from './water/WaterManager.js';
import { WakeManager } from './water/WakeManager.js';
import { WAKE_TUNING_DEFAULTS } from './water/WakeTuning.js';
import { DrawingFX } from './particles/DrawingFX.js';
import { WaterlineStudioApp } from './apps/WaterlineStudioApp.js';

const MODULE_ID = 'ionrift-waterline';

// ---------------------------------------------------------------
// Register the Water FX behavior type at module load time.
// This MUST happen before Game.initializeDocuments() runs, which
// validates embedded RegionBehavior types during Scene._initialize.
// The init hook fires AFTER document initialization in v14, so
// registration inside a hook is too late - scenes with existing
// waterFX behaviors would fail validation and be purged.
// ---------------------------------------------------------------
try {
    WaterManager.registerBehavior();
} catch (err) {
    console.error('Ionrift Waterline | Behavior registration failed at module load:', err);
}

globalThis.WaterManager = WaterManager;
globalThis.WakeManager = WakeManager;

// ---------------------------------------------------------------
// Init: Register settings and remaining hooks
// ---------------------------------------------------------------
Hooks.once('init', async () => {
    DrawingFX.init();

    // Register Handlebars templates for particle FX panel and studio
    const loader = foundry.applications?.handlebars?.loadTemplates ?? globalThis.loadTemplates;
    if (loader) {
        await loader([
            `modules/${MODULE_ID}/scripts/particles/placement-panel.html`,
            `modules/${MODULE_ID}/templates/studio.hbs`
        ]);
    }

    // ── Hidden / world settings ──────────────────────────────────────────────
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
        config: false,
        type: Boolean,
        default: true
    });

    game.settings.registerMenu(MODULE_ID, 'rippleTuning', {
        name: 'IonriftWaterline.SettingsRippleTuning',
        label: 'IonriftWaterline.SettingsRippleTuningLabel',
        hint: 'IonriftWaterline.SettingsRippleTuningHint',
        icon: 'fas fa-water',
        type: class extends FormApplication {
            render() { WaterlineStudioApp.show(); return this; }
            async _updateObject() {}
            get template() { return ''; }
        },
        restricted: true   // GM only -- players see the effect but cannot adjust it
    });

    // ── Footer: SettingsLayout wires Discord, Wiki, and places debug last ─────
    const SettingsLayout = game.ionrift?.library?.SettingsLayout;
    SettingsLayout?.registerFooter(MODULE_ID, {
        wiki: 'https://github.com/ionrift-gm/ionrift-waterline/wiki'
    });

    // debug must be registered after registerFooter so injectLayout places it in the footer zone
    game.settings.register(MODULE_ID, 'debug', {
        name: 'IonriftWaterline.SettingsDebug',
        hint: 'IonriftWaterline.SettingsDebugHint',
        scope: 'client',
        config: false,
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
// Scene Controls: Waterline on the Regions palette.
// ---------------------------------------------------------------
Hooks.on('getSceneControlButtons', (controls) => {
    if (!game.user.isGM) return;

    const isV13 = !Array.isArray(controls);

    if (isV13) {
        // Inject Waterline into the regions control group
        if (controls.regions?.tools) {
            controls.regions.tools['waterline-studio'] = {
                name: 'waterline-studio',
                title: 'Waterline',
                icon: 'fas fa-water',
                order: 20,
                button: true,
                onClick: () => WaterlineStudioApp.show({ tab: 'water' }),
                onChange: () => {}
            };
        }
    } else {
        // v12: inject Waterline into the regions control
        const regionsControl = controls.find(c => c.name === 'regions');
        if (regionsControl?.tools) {
            regionsControl.tools.push(
                { name: 'waterline-studio', title: 'Waterline',
                  icon: 'fas fa-water', onClick: () => WaterlineStudioApp.show({ tab: 'water' }), button: true }
            );
        }
    }
});

// ---------------------------------------------------------------
// Canvas Ready: Initialize water manager and render water regions
// ---------------------------------------------------------------
Hooks.on('canvasReady', async () => {
    WaterlineStudioApp.closeIfOpen();
    WaterManager.clearSampledColorCache?.();
    WaterManager.init();
    await WaterManager.refreshAll();
    WakeManager.init();
    // Re-wire click handler on new canvas (debug only)
    if (game.settings?.get?.(MODULE_ID, 'debug')) {
        DrawingFX._wireCanvasClick();
    }
});

// ---------------------------------------------------------------
// Region & Behavior Updates: Re-render water when anything changes
// ---------------------------------------------------------------
Hooks.on('updateRegion', () => WaterManager.debouncedRefresh());
Hooks.on('createRegion', () => WaterManager.debouncedRefresh());
Hooks.on('deleteRegion', () => WaterManager.debouncedRefresh());

// Behavior CRUD
Hooks.on('createRegionBehavior', () => WaterManager.debouncedRefresh());
Hooks.on('updateRegionBehavior', (behaviorDoc, changes) => WaterManager.onUpdateBehavior(behaviorDoc, changes));
Hooks.on('deleteRegionBehavior', () => WaterManager.debouncedRefresh());

// ---------------------------------------------------------------
// Canvas Region Selection: Sync active region in Waterline Studio
// ---------------------------------------------------------------
Hooks.on('controlRegion', (placeable, controlled) => {
    if (!controlled || !game.user.isGM) return;
    const app = WaterlineStudioApp._instance;
    if (!app) return;
    const regionId = placeable.document?.id;
    if (regionId && regionId !== app.activeRegionId) {
        app.loadRegion(regionId);
    }
});

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
