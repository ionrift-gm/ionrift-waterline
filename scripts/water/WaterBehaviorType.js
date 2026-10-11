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
                label: 'Archetype',
                choices: Object.fromEntries(
                    Object.entries(WATER_ARCHETYPES).map(([k, v]) => [k, v.label])
                )
            }),
            intensity:     new fields.NumberField({ initial: 0.25,    min: 0.0,  max: 2.0,   step: 0.05,  label: 'Intensity' }),
            speed:         new fields.NumberField({ initial: 1.40,    min: 0.05, max: 3.0,   step: 0.05,  label: 'Speed' }),
            opacity:       new fields.NumberField({ initial: 0.15,    min: 0.05, max: 0.5,   step: 0.01,  label: 'Opacity' }),
            distortion:    new fields.NumberField({ initial: 0.035,   min: 0.0,  max: 0.05,  step: 0.001, label: 'Distortion' }),
            fadeWidth:     new fields.NumberField({ initial: 60,      min: 0,    max: 200,   step: 5,     label: 'Edge Fade' }),
            scale:         new fields.NumberField({ initial: 90,      min: 30,   max: 400,   step: 5,     label: 'Scale' }),
            flowAngle:     new fields.NumberField({ initial: 90,      min: 0,    max: 359,   step: 5,     label: 'Flow Direction' }),
            shoreWaves:    new fields.NumberField({ initial: 0.15,    min: 0.0,  max: 1.0,   step: 0.05,  label: 'Shore Waves' }),
            waveCount:     new fields.NumberField({ initial: 4,       min: 1,    max: 8,     step: 1,     label: 'Wave Count' }),
            waveSegment:   new fields.NumberField({ initial: 0.85,    min: 0.0,  max: 1.0,   step: 0.05,  label: 'Wave Breakup' }),
            waveRegularity: new fields.NumberField({ initial: 0.60,   min: 0.0,  max: 1.0,   step: 0.05,  label: 'Wave Regularity' }),
            swashSurge:    new fields.NumberField({ initial: 24.0,    min: 0.0,  max: 60.0,  step: 1.0,   label: 'Surge Reach' }),
            surfFoam:      new fields.NumberField({ initial: 0.70,    min: 0.0,  max: 1.0,   step: 0.05,  label: 'Shoreline Foam' }),
            choppySeas:    new fields.NumberField({ initial: 0.0,     min: 0.0,  max: 1.5,   step: 0.05,  label: 'Open Sea Chop' }),
            riverWaves:    new fields.NumberField({ initial: 0.0,     min: 0.0,  max: 1.5,   step: 0.05,  label: 'River Waves' }),
            lakeWaves:     new fields.NumberField({ initial: 0.0,     min: 0.0,  max: 1.5,   step: 0.05,  label: 'Lake Waves' }),
            lakeRings:     new fields.NumberField({ initial: 0.0,     min: 0.0,  max: 2.0,   step: 0.05,  label: 'Drop Rings' }),
            whitecaps:     new fields.NumberField({ initial: 0.5,     min: 0.0,  max: 1.5,   step: 0.05,  label: 'Whitecaps' }),
            sunGlint:      new fields.NumberField({ initial: 0.6,     min: 0.0,  max: 2.0,   step: 0.05,  label: 'Sun Glint' }),
            spindriftWake: new fields.BooleanField({ initial: false,   label: 'Trailing Wake' }),
            crestBound:    new fields.BooleanField({ initial: false,   label: 'Crest-Locked' }),
            waterType:     new fields.StringField({
                initial: 'river',
                label: 'Preset',
                choices: Object.fromEntries(
                    Object.entries(WATER_PRESETS).map(([k, v]) => [k, v.label])
                )
            }),
            colorOverride: new fields.StringField({ initial: '',       label: 'Color Override' })
        };
    }

    static events = {};
}
