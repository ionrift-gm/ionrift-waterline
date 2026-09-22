import { WaterlineStudioApp } from '../apps/WaterlineStudioApp.js';
import { BorderGenerator } from './BorderGenerator.js';

/**
 * Backward-compatible facade for legacy BorderControls calls.
 * Delegates showDialog() to the unified WaterlineStudioApp on the 'borders' tab.
 */
export class BorderControls {

    /**
     * Opens Waterline on the borders tab.
     */
    static showDialog() {
        if (!game.user.isGM) return;
        return WaterlineStudioApp.show({ tab: 'borders' });
    }

    /**
     * Prompts before clearing border walls.
     */
    static confirmClear() {
        if (!game.user.isGM) return;

        Dialog.confirm({
            title: 'Waterline: Clear Borders',
            content: '<p>Remove all generated border walls from this scene?</p>',
            yes: () => BorderGenerator.clearBorder(),
            no: () => {},
            defaultYes: false
        });
    }
}
