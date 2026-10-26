import { WATER_ARCHETYPES, WATER_PRESETS } from './WaterPresets.js';

/**
 * Custom RegionBehaviorType for animated water overlay.
 */
export class WaterBehaviorType extends foundry.data.regionBehaviors.RegionBehaviorType {

    static defineSchema() {
        const fields = foundry.data.fields;
        return {
            archetype:     new fields.StringField({
                initial: 'river',
                label: game.i18n.localize('IonriftWaterline.behavior.archetype'),
                choices: Object.fromEntries(
                    Object.entries(WATER_ARCHETYPES).map(([k, v]) => [k, v.label])
                )
            }),
            intensity:     new fields.NumberField({ initial: 0.25,    min: 0.0,  max: 2.0,   step: 0.05,  label: game.i18n.localize('IonriftWaterline.behavior.intensity') }),
            speed:         new fields.NumberField({ initial: 1.40,    min: 0.05, max: 3.0,   step: 0.05,  label: game.i18n.localize('IonriftWaterline.behavior.speed') }),
            opacity:       new fields.NumberField({ initial: 0.15,    min: 0.05, max: 0.5,   step: 0.01,  label: game.i18n.localize('IonriftWaterline.behavior.opacity') }),
            distortion:    new fields.NumberField({ initial: 0.035,   min: 0.0,  max: 0.05,  step: 0.001, label: game.i18n.localize('IonriftWaterline.behavior.distortion') }),
            fadeWidth:     new fields.NumberField({ initial: 60,      min: 0,    max: 200,   step: 5,     label: game.i18n.localize('IonriftWaterline.behavior.fadeWidth') }),
            scale:         new fields.NumberField({ initial: 90,      min: 30,   max: 400,   step: 5,     label: game.i18n.localize('IonriftWaterline.behavior.scale') }),
            flowAngle:     new fields.NumberField({ initial: 90,      min: 0,    max: 359,   step: 5,     label: game.i18n.localize('IonriftWaterline.behavior.flowAngle') }),
            shoreWaves:    new fields.NumberField({ initial: 0.15,    min: 0.0,  max: 1.0,   step: 0.05,  label: game.i18n.localize('IonriftWaterline.behavior.shoreWaves') }),
            waveCount:     new fields.NumberField({ initial: 4,       min: 1,    max: 8,     step: 1,     label: game.i18n.localize('IonriftWaterline.behavior.waveCount') }),
            waveSegment:   new fields.NumberField({ initial: 0.85,    min: 0.0,  max: 1.0,   step: 0.05,  label: game.i18n.localize('IonriftWaterline.behavior.waveSegment') }),
            waveRegularity: new fields.NumberField({ initial: 0.60,   min: 0.0,  max: 1.0,   step: 0.05,  label: game.i18n.localize('IonriftWaterline.behavior.waveRegularity') }),
            swashSurge:    new fields.NumberField({ initial: 24.0,    min: 0.0,  max: 60.0,  step: 1.0,   label: game.i18n.localize('IonriftWaterline.behavior.swashSurge') }),
            surfFoam:      new fields.NumberField({ initial: 0.70,    min: 0.0,  max: 1.0,   step: 0.05,  label: game.i18n.localize('IonriftWaterline.behavior.surfFoam') }),
            choppySeas:    new fields.NumberField({ initial: 0.0,     min: 0.0,  max: 1.5,   step: 0.05,  label: game.i18n.localize('IonriftWaterline.behavior.choppySeas') }),
            riverWaves:    new fields.NumberField({ initial: 0.0,     min: 0.0,  max: 1.5,   step: 0.05,  label: game.i18n.localize('IonriftWaterline.behavior.riverWaves') }),
            lakeWaves:     new fields.NumberField({ initial: 0.0,     min: 0.0,  max: 1.5,   step: 0.05,  label: game.i18n.localize('IonriftWaterline.behavior.lakeWaves') }),
            lakeRings:     new fields.NumberField({ initial: 0.0,     min: 0.0,  max: 2.0,   step: 0.05,  label: game.i18n.localize('IonriftWaterline.behavior.lakeRings') }),
            whitecaps:     new fields.NumberField({ initial: 0.5,     min: 0.0,  max: 1.5,   step: 0.05,  label: game.i18n.localize('IonriftWaterline.behavior.whitecaps') }),
            sunGlint:      new fields.NumberField({ initial: 0.6,     min: 0.0,  max: 2.0,   step: 0.05,  label: game.i18n.localize('IonriftWaterline.behavior.sunGlint') }),
            spindriftWake: new fields.BooleanField({ initial: false,   label: game.i18n.localize('IonriftWaterline.behavior.spindriftWake') }),
            crestBound:    new fields.BooleanField({ initial: false,   label: game.i18n.localize('IonriftWaterline.behavior.crestBound') }),
            waterType:     new fields.StringField({
                initial: 'river',
                label: game.i18n.localize('IonriftWaterline.behavior.waterType'),
                choices: Object.fromEntries(
                    Object.entries(WATER_PRESETS).map(([k, v]) => [k, v.label])
                )
            }),
            colorOverride: new fields.StringField({ initial: '',       label: game.i18n.localize('IonriftWaterline.behavior.colorOverride') })
        };
    }

    static events = {};
}
