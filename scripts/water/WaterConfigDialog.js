import { WaterlineStudioApp } from '../apps/WaterlineStudioApp.js';

/**
 * Backward-compatible facade for legacy WaterConfigDialog calls.
 * Delegates to the unified WaterlineStudioApp on the 'water' tab.
 */
export class WaterConfigDialog {

    static get _instance() {
        return WaterlineStudioApp._instance;
    }

    /**
     * Show the unified Waterline dialog on the water tab.
     * @param {object} [options]
     */
    static show(options = {}) {
        return WaterlineStudioApp.show({ tab: 'water', ...options });
    }

    /**
     * Close the studio if currently open.
     */
    static closeIfOpen() {
        WaterlineStudioApp.closeIfOpen();
    }
}
