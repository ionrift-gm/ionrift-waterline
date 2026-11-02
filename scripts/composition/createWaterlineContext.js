import { MODULE_ID, MODULE_LABEL } from '../data/moduleId.js';
import { WaterManager } from '../water/WaterManager.js';
import { WakeManager } from '../water/WakeManager.js';
import { WaterlineStudioApp } from '../apps/WaterlineStudioApp.js';
import { WaterConfigDialog } from '../water/WaterConfigDialog.js';
import { WakeTuningDialog } from '../water/WakeTuningDialog.js';

export function createWaterlineContext() {
    const ctx = {
        MODULE_ID,
        MODULE_LABEL,
        water: WaterManager,
        wake: WakeManager,
        dialogs: {
            WaterlineStudioApp,
            WaterConfigDialog,
            WakeTuningDialog
        }
    };

    exposeWaterlineApi(ctx);
    return ctx;
}

export function exposeWaterlineApi(ctx) {
    game.ionrift = game.ionrift ?? {};
    game.ionrift.waterline = {
        ...(game.ionrift.waterline || {}),
        MODULE_ID: ctx.MODULE_ID,
        MODULE_LABEL: ctx.MODULE_LABEL,
        water: ctx.water,
        wake: ctx.wake,
        dialogs: ctx.dialogs
    };
}

export function getWaterline() {
    return game.ionrift?.waterline ?? null;
}
