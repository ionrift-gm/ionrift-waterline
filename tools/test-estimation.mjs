#!/usr/bin/env node
// tools/test-estimation.mjs
// Regression test suite for water direction estimation and override persistence:
// Ensures estimation serves as a silent initial default, does not leak angles to UI,
// and preserves all manual overrides permanently.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Stub minimal Foundry global namespace for Node testing environment
globalThis.foundry = {
  data: {
    regionBehaviors: {
      RegionBehaviorType: class {}
    },
    fields: {
      NumberField: class {},
      StringField: class {},
      BooleanField: class {},
      ColorField: class {},
      SchemaField: class {}
    }
  }
};

const { WaterShapeEstimator } = await import('../scripts/water/WaterShapeEstimator.js');
const studioTemplate = readFileSync(join(__dirname, '../templates/studio.hbs'), 'utf8');
const studioJs = readFileSync(join(__dirname, '../scripts/apps/WaterlineStudioApp.js'), 'utf8');
const moduleJs = readFileSync(join(__dirname, '../scripts/module.js'), 'utf8');
const waterManagerJs = readFileSync(join(__dirname, '../scripts/water/WaterManager.js'), 'utf8');
const waterMeshJs = readFileSync(join(__dirname, '../scripts/water/WaterMesh.js'), 'utf8');

describe('Water Direction Estimation Contract', () => {
  it('estimates flow angle along longitudinal axis for elongated river polygons', () => {
    // Horizontal river strip: width 1000, height 100
    const riverPoints = [
      100, 500,
      1100, 500,
      1100, 600,
      100, 600
    ];
    const est = WaterShapeEstimator.estimate({
      points: riverPoints,
      vertexCount: 4
    }, { sceneX: 0, sceneY: 0, sceneWidth: 2000, sceneHeight: 2000 });

    assert.equal(est.archetype, 'river');
    // Horizontal elongation aligns close to 0° or 180°
    const isHorizontal = (est.flowAngle >= 350 || est.flowAngle <= 10) || (est.flowAngle >= 170 && est.flowAngle <= 190);
    assert.ok(isHorizontal, `Expected horizontal river flow angle near 0° or 180°, got ${est.flowAngle}°`);
  });

  it('estimates onshore wave heading for coastal strip cutting across map border', () => {
    // Coastline along right border (x=4000) with inland shoreline
    const coastalPoints = [
      4000, 0,
      4000, 3000,
      3200, 3000,
      3000, 2200,
      3100, 1500,
      2900, 800,
      3200, 0
    ];
    const est = WaterShapeEstimator.estimate({
      points: coastalPoints,
      vertexCount: 7
    }, { sceneX: 0, sceneY: 0, sceneWidth: 4000, sceneHeight: 3000 });

    assert.equal(est.archetype, 'coast');
    assert.equal(typeof est.flowAngle, 'number');
  });

  it('classifies compact circular battlemap waterbody as a pond', () => {
    // Regular 21-vertex circular pond with radius ~320px (~6 grid squares across, ~320k px² area)
    const pondPoints = [];
    const steps = 21;
    const cx = 1500, cy = 500, r = 320;
    for (let i = 0; i < steps; i++) {
      const a = (i / steps) * Math.PI * 2;
      pondPoints.push(Math.round(cx + Math.cos(a) * r), Math.round(cy + Math.sin(a) * r));
    }
    const est = WaterShapeEstimator.estimate({
      points: pondPoints,
      vertexCount: steps
    }, { sceneX: 0, sceneY: 0, sceneWidth: 2048, sceneHeight: 2048, size: 100 });

    assert.equal(est.archetype, 'pond');
    assert.equal(est.preset, 'pond_woodland');
  });

  it('classifies small standing water under 3.5 grid cells as a puddle', () => {
    // 1-square rain puddle
    const puddlePoints = [100, 100, 180, 100, 180, 180, 100, 180];
    const est = WaterShapeEstimator.estimate({
      points: puddlePoints,
      vertexCount: 4
    }, { sceneX: 0, sceneY: 0, sceneWidth: 2000, sceneHeight: 2000, size: 100 });

    assert.equal(est.archetype, 'puddle');
    assert.equal(est.preset, 'puddle_rain');
  });

  it('classifies large inland water basin over 60 grid cells and 15% coverage as a lake', () => {
    // Large lake covering 30% of map
    const lakePoints = [200, 200, 1800, 200, 1800, 1200, 200, 1200];
    const est = WaterShapeEstimator.estimate({
      points: lakePoints,
      vertexCount: 4
    }, { sceneX: 0, sceneY: 0, sceneWidth: 2000, sceneHeight: 2000, size: 100 });

    assert.equal(est.archetype, 'lake');
    assert.equal(est.preset, 'lake');
  });

  it('guarantees estimation banner and manual apply button are removed from UI template', () => {
    assert.ok(!studioTemplate.includes('wc-estimation-banner'), 'Found obsolete wc-estimation-banner in studio.hbs');
    assert.ok(!studioTemplate.includes('applyEstimation'), 'Found obsolete applyEstimation action in studio.hbs');
    assert.ok(!studioTemplate.includes('Apply Estimate'), 'Found obsolete "Apply Estimate" text in studio.hbs');
  });

  it('guarantees candidate and zone tags do not expose raw estimation angles in UI', () => {
    assert.ok(!studioTemplate.includes('candidate.estimation.flowAngle'), 'Candidate tag exposes estimated flow angle');
    assert.ok(!studioTemplate.includes('z.estimation.flowAngle'), 'Zone tag exposes estimated flow angle');
  });

  it('guarantees studio app does not expose applyEstimation handler', () => {
    assert.ok(!studioJs.includes('[data-action="applyEstimation"]'), 'Studio still registers applyEstimation click handler');
  });
});

describe('Water Color Stability & Live Uniform Updates Contract', () => {
  it('guarantees natural water presets do not hardcode color overrides', () => {
    const naturalKeys = [
      'ocean_calm', 'ocean_swell', 'ocean_choppy',
      'coast', 'coast_gentle', 'coast_crashing', 'bay_chop',
      'lake', 'lake_windswept', 'deep',
      'river', 'torrent', 'river_forest', 'canal',
      'pond_woodland', 'pond_hotspring', 'cistern', 'swamp',
      'puddle_rain'
    ];
    for (const key of naturalKeys) {
      const regex = new RegExp(`${key}:\\s*{([^}]+)}`);
      const match = waterManagerJs.match(regex);
      assert.ok(match, `Preset ${key} not found in WaterManager.js`);
      assert.ok(!match[1].includes('colorOverride'), `Natural preset ${key} must not declare hardcoded colorOverride`);
    }
  });

  it('guarantees thematic fluid presets declare explicit color overrides', () => {
    const thematicKeys = ['puddle_mud', 'puddle_slime', 'puddle_blood'];
    for (const key of thematicKeys) {
      const regex = new RegExp(`${key}:\\s*{([^}]+)}`);
      const match = waterManagerJs.match(regex);
      assert.ok(match, `Thematic preset ${key} not found in WaterManager.js`);
      assert.ok(match[1].includes("colorOverride: '#"), `Thematic preset ${key} must declare a hex colorOverride`);
    }
  });

  it('routes updateRegionBehavior to WaterManager.onUpdateBehavior without mesh destruction', () => {
    assert.ok(
      moduleJs.includes("Hooks.on('updateRegionBehavior', (behaviorDoc, changes) => WaterManager.onUpdateBehavior(behaviorDoc, changes));"),
      'updateRegionBehavior hook must delegate to WaterManager.onUpdateBehavior'
    );
    assert.ok(waterManagerJs.includes('static async onUpdateBehavior(behaviorDoc)'), 'WaterManager must implement onUpdateBehavior');
    assert.ok(waterManagerJs.includes('clearSampledColorCache()'), 'WaterManager must implement clearSampledColorCache');
  });

  it('guarantees WaterMesh stores baseSampledColor and implements setWaterColor', () => {
    assert.ok(waterMeshJs.includes('this.baseSampledColor = config.baseSampledColor'), 'WaterMesh must store baseSampledColor');
    assert.ok(waterMeshJs.includes('setWaterColor(color)'), 'WaterMesh must implement setWaterColor');
  });

  it('guarantees liveUpdateFX updates water color in place without flicker', () => {
    assert.ok(studioJs.includes('mesh.setWaterColor(rgb)'), 'liveUpdateFX must update mesh water color for color overrides');
    assert.ok(studioJs.includes('mesh.setWaterColor(mesh.baseSampledColor'), 'liveUpdateFX must restore baseSampledColor when autoColor is enabled');
  });
});

describe('Batch Archetype Apply & Synchronization Contract', () => {
  it('guarantees liveUpdateFX targets all matching archetype meshes when batch toggle is active', () => {
    assert.ok(studioJs.includes('this.applyToAllSameArchetype'), 'Studio must track applyToAllSameArchetype');
    assert.ok(
      studioJs.includes('this.#getRegionArchetype(r) === this.activeArchetype'),
      'liveUpdateFX or save must evaluate region archetype dynamically'
    );
    assert.ok(
      studioJs.includes('targetRegionIds.add(r.id)'),
      'liveUpdateFX must collect all matching region IDs when batch toggle is active'
    );
  });

  it('guarantees batch toggle change event triggers immediate live canvas update', () => {
    const batchChangeBlock = studioJs.match(/batchCheckbox\.addEventListener\('change'[\s\S]+?\}\);/);
    assert.ok(batchChangeBlock, 'batchCheckbox change listener must exist');
    assert.ok(batchChangeBlock[0].includes('this.#liveUpdateFX()'), 'batchCheckbox must trigger liveUpdateFX on toggle');
  });

  it('guarantees saveActiveWaterbodyFX marks both behavior and region as configured', () => {
    const saveMethod = studioJs.slice(studioJs.indexOf('async #saveActiveWaterbodyFX()'), studioJs.indexOf('async #renameWaterRegion'));
    assert.ok(saveMethod.includes("configured: true"), 'saveActiveWaterbodyFX must set configured flag on behavior');
    assert.ok(saveMethod.includes("r.setFlag(MODULE_ID, 'configured', true)"), 'saveActiveWaterbodyFX must set configured flag on region');
  });

  it('guarantees lakeRings is preserved as numeric in _prepareContext', () => {
    assert.ok(!studioJs.includes('this.fx.lakeRings = Boolean(this.fx.lakeRings);'), 'lakeRings must not be cast to boolean');
    assert.ok(studioJs.includes('this.fx.lakeRings = Number.isFinite(this.fx.lakeRings)'), 'lakeRings must preserve numeric intensity');
  });
});


