/**
 * Tabletop Fluid Archetypes with distinct visual identities and fantasy roles.
 */
export const WATER_ARCHETYPES = {
    ocean: {
        key: 'ocean',
        label: 'Ocean',
        icon: 'fas fa-sailboat',
        accentColor: '#3b82f6',
        defaultPreset: 'ocean_choppy',
        description: 'Vast rolling swells, deep ocean chop, and seafoam whitecaps.'
    },
    coast: {
        key: 'coast',
        label: 'Coastline',
        icon: 'fas fa-umbrella-beach',
        accentColor: '#0d9488',
        defaultPreset: 'coast',
        description: 'Breaking coastal surf, tidal swash surges, and shallow reefs.'
    },
    lake: {
        key: 'lake',
        label: 'Lake',
        icon: 'fas fa-compass',
        accentColor: '#0284c7',
        defaultPreset: 'lake',
        description: 'Placid mirror glass, gentle wind ruffles, and bottomless tarns.'
    },
    river: {
        key: 'river',
        label: 'River',
        icon: 'fas fa-water',
        accentColor: '#06b6d4',
        defaultPreset: 'river',
        description: 'Directional current, tumbling white-water rapids, and forest creeks.'
    },
    pond: {
        key: 'pond',
        label: 'Pond',
        icon: 'fas fa-spa',
        accentColor: '#059669',
        defaultPreset: 'pond_woodland',
        description: 'Small inland pools, garden springs, hot springs, and cavern grottos.'
    },
    puddle: {
        key: 'puddle',
        label: 'Puddle',
        icon: 'fas fa-tint',
        accentColor: '#d97706',
        defaultPreset: 'puddle_rain',
        description: 'Rain ruts, shallow damp cobblestones, murky slimes, and spilled liquid.'
    }
};

/**
 * Water body type presets organized by Tabletop Archetype.
 */
export const WATER_PRESETS = {
    // Custom fallback
    custom:         { label: 'Custom',            archetype: 'ocean',  opacity: 0.20, speed: 0.80, distortion: 0.020, intensity: 0.50, fadeWidth: 50, scale: 110, flowAngle: 0,   shoreWaves: 0.10, waveSegment: 0.85, waveRegularity: 0.60, swashSurge: 24.0, surfFoam: 0.70, choppySeas: 0.00, riverWaves: 0.00, lakeWaves: 0.00, lakeRings: false, whitecaps: 0.00, sunGlint: 0.00 },

    // 1. Open Sea / Ocean
    ocean_choppy:   { label: 'Choppy Sea',        archetype: 'ocean',  opacity: 0.34, speed: 0.85, distortion: 0.026, intensity: 0.75, fadeWidth: 85, scale: 130, flowAngle: 45,  shoreWaves: 0.15, waveCount: 4, waveSegment: 0.85, waveRegularity: 0.50, swashSurge: 28.0, surfFoam: 0.75, choppySeas: 0.90, riverWaves: 0.00, lakeWaves: 0.00, lakeRings: false, whitecaps: 0.75, sunGlint: 0.80 },
    ocean_swell:    { label: 'Ocean Swells',      archetype: 'ocean',  opacity: 0.32, speed: 0.70, distortion: 0.022, intensity: 0.75, fadeWidth: 85, scale: 160, flowAngle: 30,  shoreWaves: 0.12, waveCount: 4, waveSegment: 0.85, waveRegularity: 0.70, swashSurge: 26.0, surfFoam: 0.65, choppySeas: 0.65, riverWaves: 0.00, lakeWaves: 0.00, lakeRings: false, whitecaps: 0.35, sunGlint: 0.75 },
    ocean_storm:    { label: 'Stormy Sea',        archetype: 'ocean',  opacity: 0.36, speed: 1.20, distortion: 0.035, intensity: 0.85, fadeWidth: 90, scale: 220, flowAngle: 60,  shoreWaves: 0.25, waveCount: 5, waveSegment: 0.90, waveRegularity: 0.35, swashSurge: 42.0, surfFoam: 0.90, choppySeas: 1.35, riverWaves: 0.00, lakeWaves: 0.00, lakeRings: false, whitecaps: 1.25, sunGlint: 0.90 },
    ocean_calm:     { label: 'Calm Sea',          archetype: 'ocean',  opacity: 0.40, speed: 0.45, distortion: 0.018, intensity: 0.60, fadeWidth: 100, scale: 190, flowAngle: 45, shoreWaves: 0.05, waveCount: 3, waveSegment: 0.85, waveRegularity: 0.80, swashSurge: 20.0, surfFoam: 0.40, choppySeas: 0.50, riverWaves: 0.00, lakeWaves: 0.00, lakeRings: false, whitecaps: 0.20, sunGlint: 0.40 },

    // 2. Shoreline / Coast
    coast:          { label: 'Coastal Surf',      archetype: 'coast',  opacity: 0.20, speed: 0.85, distortion: 0.020, intensity: 0.65, fadeWidth: 65, scale: 135, flowAngle: 270, shoreWaves: 0.55, waveCount: 4, waveSegment: 0.90, waveRegularity: 0.60, swashSurge: 34.0, surfFoam: 0.85, choppySeas: 0.35, riverWaves: 0.00, lakeWaves: 0.00, lakeRings: false, whitecaps: 0.30, sunGlint: 0.50 },
    coast_gentle:   { label: 'Gentle Tide',       archetype: 'coast',  opacity: 0.18, speed: 0.55, distortion: 0.016, intensity: 0.45, fadeWidth: 55, scale: 110, flowAngle: 270, shoreWaves: 0.30, waveCount: 3, waveSegment: 0.85, waveRegularity: 0.75, swashSurge: 20.0, surfFoam: 0.55, choppySeas: 0.15, riverWaves: 0.00, lakeWaves: 0.00, lakeRings: false, whitecaps: 0.10, sunGlint: 0.45 },
    bay_chop:       { label: 'Bay Chop',          archetype: 'coast',  opacity: 0.22, speed: 0.90, distortion: 0.018, intensity: 0.60, fadeWidth: 55, scale: 75,  flowAngle: 120, shoreWaves: 0.30, waveCount: 4, waveSegment: 0.80, waveRegularity: 0.40, swashSurge: 18.0, surfFoam: 0.70, choppySeas: 0.65, riverWaves: 0.00, lakeWaves: 0.00, lakeRings: false, whitecaps: 0.40, sunGlint: 0.60 },
    coast_crashing: { label: 'Crashing Surf',     archetype: 'coast',  opacity: 0.26, speed: 1.15, distortion: 0.028, intensity: 0.85, fadeWidth: 75, scale: 145, flowAngle: 270, shoreWaves: 0.85, waveCount: 6, waveSegment: 0.92, waveRegularity: 0.30, swashSurge: 46.0, surfFoam: 0.95, choppySeas: 0.60, riverWaves: 0.00, lakeWaves: 0.00, lakeRings: false, whitecaps: 0.65, sunGlint: 0.70 },

    // 3. Lake / Deep Water
    lake:           { label: 'Calm Lake',         archetype: 'lake',   opacity: 0.15, speed: 0.28, distortion: 0.014, intensity: 0.35, fadeWidth: 35, scale: 140, flowAngle: 0,   shoreWaves: 0.12, waveSegment: 0.70, waveRegularity: 0.85, swashSurge: 14.0, surfFoam: 0.30, choppySeas: 0.00, riverWaves: 0.00, lakeWaves: 0.12, lakeRings: true,  whitecaps: 0.00, sunGlint: 0.25 },
    lake_windswept: { label: 'Windy Lake',        archetype: 'lake',   opacity: 0.22, speed: 0.65, distortion: 0.022, intensity: 0.55, fadeWidth: 40, scale: 105, flowAngle: 60,  shoreWaves: 0.35, waveSegment: 0.75, waveRegularity: 0.45, swashSurge: 22.0, surfFoam: 0.55, choppySeas: 0.00, riverWaves: 0.00, lakeWaves: 0.65, lakeRings: true,  whitecaps: 0.10, sunGlint: 0.50 },
    deep:           { label: 'Deep Lake',         archetype: 'lake',   opacity: 0.30, speed: 0.45, distortion: 0.018, intensity: 0.50, fadeWidth: 50, scale: 150, flowAngle: 45,  shoreWaves: 0.20, waveSegment: 0.80, waveRegularity: 0.65, swashSurge: 16.0, surfFoam: 0.25, choppySeas: 0.00, riverWaves: 0.00, lakeWaves: 0.35, lakeRings: false, whitecaps: 0.05, sunGlint: 0.40 },

    // 4. River / Stream
    river:          { label: 'Meandering Stream', archetype: 'river',  opacity: 0.15, speed: 1.25, distortion: 0.032, intensity: 0.25, fadeWidth: 60, scale: 90,  flowAngle: 90,  shoreWaves: 0.20, waveSegment: 0.85, waveRegularity: 0.60, swashSurge: 16.0, surfFoam: 0.35, choppySeas: 0.00, riverWaves: 0.65, lakeWaves: 0.00, lakeRings: false, whitecaps: 0.15, sunGlint: 0.35 },
    torrent:        { label: 'Mountain Rapids',   archetype: 'river',  opacity: 0.12, speed: 1.85, distortion: 0.038, intensity: 0.30, fadeWidth: 45, scale: 72,  flowAngle: 90,  shoreWaves: 0.50, waveSegment: 0.80, waveRegularity: 0.15, swashSurge: 26.0, surfFoam: 0.60, choppySeas: 0.00, riverWaves: 0.95, lakeWaves: 0.00, lakeRings: false, whitecaps: 0.48, sunGlint: 0.55 },
    river_forest:   { label: 'Forest Brook',      archetype: 'river',  opacity: 0.14, speed: 0.95, distortion: 0.025, intensity: 0.20, fadeWidth: 50, scale: 80,  flowAngle: 90,  shoreWaves: 0.12, waveSegment: 0.75, waveRegularity: 0.70, swashSurge: 10.0, surfFoam: 0.30, choppySeas: 0.00, riverWaves: 0.45, lakeWaves: 0.00, lakeRings: false, whitecaps: 0.08, sunGlint: 0.25 },
    canal:          { label: 'Calm Canal',        archetype: 'river',  opacity: 0.18, speed: 0.55, distortion: 0.015, intensity: 0.25, fadeWidth: 20, scale: 85,  flowAngle: 90,  shoreWaves: 0.04, waveSegment: 0.80, waveRegularity: 0.85, swashSurge: 4.0,  surfFoam: 0.15, choppySeas: 0.00, riverWaves: 0.20, lakeWaves: 0.00, lakeRings: false, whitecaps: 0.00, sunGlint: 0.20 },

    // 5. Pond / Small Body
    pond_woodland:  { label: 'Woodland Pond',     archetype: 'pond',   opacity: 0.18, speed: 0.35, distortion: 0.012, intensity: 0.30, fadeWidth: 45, scale: 90,  flowAngle: 30,  shoreWaves: 0.08, waveSegment: 0.70, waveRegularity: 0.65, swashSurge: 8.0,  surfFoam: 0.20, choppySeas: 0.00, riverWaves: 0.00, lakeWaves: 0.25, lakeRings: true,  whitecaps: 0.00, sunGlint: 0.15 },
    pond_hotspring: { label: 'Hot Springs',       archetype: 'pond',   opacity: 0.22, speed: 0.45, distortion: 0.020, intensity: 0.40, fadeWidth: 35, scale: 85,  flowAngle: 90,  shoreWaves: 0.06, waveSegment: 0.70, waveRegularity: 0.50, swashSurge: 9.0,  surfFoam: 0.25, choppySeas: 0.00, riverWaves: 0.00, lakeWaves: 0.35, lakeRings: true,  whitecaps: 0.00, sunGlint: 0.30 },
    cistern:        { label: 'Cavern Pool',       archetype: 'pond',   opacity: 0.16, speed: 0.25, distortion: 0.010, intensity: 0.35, fadeWidth: 30, scale: 80,  flowAngle: 0,   shoreWaves: 0.06, waveSegment: 0.85, waveRegularity: 0.80, swashSurge: 4.0,  surfFoam: 0.10, choppySeas: 0.00, riverWaves: 0.00, lakeWaves: 0.15, lakeRings: true,  whitecaps: 0.00, sunGlint: 0.00 },
    swamp:          { label: 'Murky Swamp',       archetype: 'pond',   opacity: 0.28, speed: 0.30, distortion: 0.015, intensity: 0.15, fadeWidth: 40, scale: 100, flowAngle: 180, shoreWaves: 0.05, waveSegment: 0.85, waveRegularity: 0.40, swashSurge: 8.0,  surfFoam: 0.15, choppySeas: 0.00, riverWaves: 0.00, lakeWaves: 0.10, lakeRings: true,  whitecaps: 0.00, sunGlint: 0.00 },

    // 6. Puddle / Standing Water
    puddle_rain:    { label: 'Rain Puddle',       archetype: 'puddle', opacity: 0.14, speed: 0.85, distortion: 0.025, intensity: 0.25, fadeWidth: 20, scale: 50,  flowAngle: 0,   shoreWaves: 0.06, waveSegment: 0.85, waveRegularity: 0.40, swashSurge: 8.0,  surfFoam: 0.10, choppySeas: 0.00, riverWaves: 0.00, lakeWaves: 0.05, lakeRings: true,  whitecaps: 0.00, sunGlint: 0.00 },
    puddle_mud:     { label: 'Muddy Puddle',      archetype: 'puddle', opacity: 0.30, speed: 0.50, distortion: 0.015, intensity: 0.15, fadeWidth: 15, scale: 45,  flowAngle: 0,   shoreWaves: 0.02, waveSegment: 0.85, waveRegularity: 0.50, swashSurge: 6.0,  surfFoam: 0.05, choppySeas: 0.00, riverWaves: 0.00, lakeWaves: 0.00, lakeRings: false, whitecaps: 0.00, sunGlint: 0.00, colorOverride: '#3d3020' },
    puddle_slime:   { label: 'Slime Pool',        archetype: 'puddle', opacity: 0.35, speed: 0.65, distortion: 0.030, intensity: 0.35, fadeWidth: 15, scale: 55,  flowAngle: 0,   shoreWaves: 0.04, waveSegment: 0.85, waveRegularity: 0.30, swashSurge: 8.0,  surfFoam: 0.10, choppySeas: 0.00, riverWaves: 0.00, lakeWaves: 0.00, lakeRings: false, whitecaps: 0.00, sunGlint: 0.20, colorOverride: '#235914' },
    puddle_blood:   { label: 'Crimson Pool',      archetype: 'puddle', opacity: 0.38, speed: 0.55, distortion: 0.020, intensity: 0.25, fadeWidth: 18, scale: 50,  flowAngle: 0,   shoreWaves: 0.03, waveSegment: 0.85, waveRegularity: 0.60, swashSurge: 8.0,  surfFoam: 0.10, choppySeas: 0.00, riverWaves: 0.00, lakeWaves: 0.00, lakeRings: false, whitecaps: 0.00, sunGlint: 0.35, colorOverride: '#540c11' },

    // Legacy alias
    puddle:         { label: 'Rain Puddle',       archetype: 'puddle', opacity: 0.14, speed: 0.85, distortion: 0.025, intensity: 0.25, fadeWidth: 20, scale: 50,  flowAngle: 0,   shoreWaves: 0.06, waveSegment: 0.85, waveRegularity: 0.40, swashSurge: 8.0,  surfFoam: 0.10, choppySeas: 0.00, riverWaves: 0.00, lakeWaves: 0.05, lakeRings: true,  whitecaps: 0.00, sunGlint: 0.00 }
};
