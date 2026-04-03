import { BorderControls } from './border/BorderControls.js';
import { WaterManager } from './water/WaterManager.js';
import { WaterDetector } from './water/WaterDetector.js';
import { WaterConfigDialog } from './water/WaterConfigDialog.js';

const MODULE_ID = 'ionrift-waterline';

// ---------------------------------------------------------------
// Init: Register the Water FX behavior type
// ---------------------------------------------------------------
Hooks.once('init', () => {
    console.log('Ionrift Waterline | Initializing...');
    WaterManager.registerBehavior();

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
    }
});

// ---------------------------------------------------------------
// Canvas Ready: Initialize water manager and render water regions
// ---------------------------------------------------------------
Hooks.on('canvasReady', () => {
    WaterConfigDialog.closeIfOpen();
    WaterManager.init();
    WaterManager.refreshAll();
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

console.log('Ionrift Waterline | Module loaded.');
