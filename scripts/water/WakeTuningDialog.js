import { WaterlineStudioApp } from '../apps/WaterlineStudioApp.js';

/**
 * Backward-compatible facade for legacy WakeTuningDialog calls.
 * Delegates to the unified WaterlineStudioApp on the 'wake' tab.
 */
export class WakeTuningDialog {

    static get _instance() {
        return WaterlineStudioApp._instance;
    }

    /**
     * Show the unified Waterline dialog on the wake tab.
     * @param {object} [options]
     */
    static show(options = {}) {
        return WaterlineStudioApp.show({ tab: 'wake', ...options });
    }

    /**
     * Close the studio if currently open.
     */
    static closeIfOpen() {
        WaterlineStudioApp.closeIfOpen();
    }
}
