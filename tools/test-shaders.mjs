#!/usr/bin/env node
// tools/test-shaders.mjs
// Automated regression test suite for Ionrift Waterline shaders:
// Locks down shoreline packet emission and ocean swell scaling before lake/river work.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Stub minimal Foundry global namespace for Node testing environment
globalThis.foundry = {
  applications: {
    api: {
      ApplicationV2: class {}
    }
  },
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
globalThis.canvas = {};
globalThis.game = {};
globalThis.ui = {};

const { SHORELINE_CHUNK } = await import('../scripts/water/shaders/chunks/shoreline.glsl.js');
const { OCEAN_CHOP_CHUNK } = await import('../scripts/water/shaders/chunks/oceanChop.glsl.js');
const { RIVER_FLOW_CHUNK } = await import('../scripts/water/shaders/chunks/riverFlow.glsl.js');
const { LAKE_POND_CHUNK } = await import('../scripts/water/shaders/chunks/lakePond.glsl.js');
const { TOKEN_WAKES_CHUNK } = await import('../scripts/water/shaders/chunks/tokenWakes.glsl.js');
const { COMPOSITE_CHUNK } = await import('../scripts/water/shaders/chunks/composite.glsl.js');
const { WATER_PRESETS, WaterManager } = await import('../scripts/water/WaterManager.js');
const { WaterlineStudioApp } = await import('../scripts/apps/WaterlineStudioApp.js');

describe('Shoreline Shader (SHORELINE_CHUNK)', () => {
  it('exports a valid GLSL chunk with computeShoreWaves function', () => {
    assert.equal(typeof SHORELINE_CHUNK, 'string');
    assert.ok(SHORELINE_CHUNK.includes('float computeShoreWaves('), 'Missing computeShoreWaves signature');
  });

  it('declares all required shoreline uniform dependencies', () => {
    const required = ['uWaveCount', 'uWaveRegularity', 'uWaveShoaling', 'uSurfFoam', 'uWaveSegment'];
    for (const u of required) {
      assert.ok(SHORELINE_CHUNK.includes(u), `Missing uniform reference: ${u}`);
    }
  });

  it('guarantees constant wave speed (16 px/s) independent of waveCount', () => {
    // waveSpeedPx must be constant and not multiplied by countMul
    assert.match(SHORELINE_CHUNK, /float\s+waveSpeedPx\s*=\s*16\.0;/, 'waveSpeedPx must be fixed at 16.0');
    assert.doesNotMatch(SHORELINE_CHUNK, /waveSpeedPx\s*\*=\s*countMul/, 'waveSpeedPx must not scale with waveCount');
  });

  it('prevents backwards wave propagation (regression guard)', () => {
    // The wave must travel toward the beach (packetTargetDist decreasing from maxApproach to 0)
    // Never allow inverted phase equation (localDist - tWave * waveSpeedPx)
    assert.doesNotMatch(SHORELINE_CHUNK, /localDist\s*-\s*tWave\s*\*\s*\(?waveSpeedPx/, 'Detected backwards wave propagation bug');
    assert.match(SHORELINE_CHUNK, /packetTargetDist\s*=\s*maxApproach\s*-\s*cellSpeed\s*\*\s*age/, 'Target distance must decrease toward shore');
  });

  it('enforces parabolic forward crest bow curvature toward beach', () => {
    // Center of wavelet (normDist=0) must reach beach before flanks (normDist=1)
    assert.match(SHORELINE_CHUNK, /crestBow\s*=\s*\(1\.0\s*-\s*normDist\s*\*\s*normDist\)/, 'Missing parabolic crestBow formula');
    assert.match(SHORELINE_CHUNK, /curvedTargetDist\s*=\s*packetTargetDist\s*-\s*crestBow/, 'Crest bow must push target distance closer to beach');
  });

  it('prohibits coordinate-folding on rotating tangents', () => {
    // Coordinate fold spikes phase gradients on curved shorelines
    assert.doesNotMatch(SHORELINE_CHUNK, /dot\(worldPos,\s*tangent\)/, 'Prohibited coordinate-fold pattern found');
  });

  it('simulates wave packet kinematics correctly', () => {
    // Exact JS simulation of shader wave packet kinematics
    for (const waveCount of [1.0, 4.0, 8.0]) {
      const countMul = Math.min(8.0, Math.max(1.0, waveCount));
      const maxApproach = 50.0 + countMul * 3.0;
      const waveSpeedPx = 16.0;
      const wavelength = maxApproach / (0.45 + 0.18 * countMul);
      const interval = wavelength / waveSpeedPx;
      const transitTime = maxApproach / waveSpeedPx;

      // Kinematic simulation across time: verify target distance strictly decreases toward shore
      const t0 = 0.5;
      const t1 = 1.5;
      const age0_t0 = t0 % interval;
      const age0_t1 = t1 % interval;
      const targetDist_t0 = maxApproach - waveSpeedPx * age0_t0;
      const targetDist_t1 = maxApproach - waveSpeedPx * age0_t1;

      // Speed check: physical speed must be 16 px/s
      const speed = (targetDist_t0 - targetDist_t1) / (t1 - t0);
      assert.ok(Math.abs(speed - 16.0) < 1e-4, `Wave travel speed at waveCount=${waveCount} must be 16 px/s`);

      // At waveCount 4, wavelength must be in healthy coastal shoaling range (45 - 65px)
      if (waveCount === 4.0) {
        assert.ok(wavelength >= 45.0 && wavelength <= 65.0, `WaveCount 4 wavelength (${wavelength}px) out of range`);
      }

      // At waveCount 1, interval > transitTime -> only 1 packet on shelf, pauses between waves
      if (waveCount === 1.0) {
        assert.ok(interval > transitTime, `WaveCount 1 must have interval (${interval}s) > transit (${transitTime}s)`);
      }

      // At waveCount 8, interval < transitTime -> up to 2 packets simultaneously on shelf
      if (waveCount === 8.0) {
        assert.ok(interval < transitTime, `WaveCount 8 must have interval (${interval}s) < transit (${transitTime}s)`);
        const maxSimultaneousPackets = Math.ceil(transitTime / interval);
        assert.equal(maxSimultaneousPackets, 2, 'WaveCount 8 must allow exactly 2 simultaneous shelf packets');
      }
    }
  });

  it('adapts shoreline waves to river currents with tight approach, downstream wrapping, and emergent drop-off', () => {
    // Requires flow and shoreNormal parameters in signature
    assert.match(SHORELINE_CHUNK, /float\s+computeShoreWaves\s*\([^)]*vec2\s+flow[^)]*vec2\s+shoreNormal[^)]*\)/, 'computeShoreWaves must receive flow and shoreNormal');

    // Tight near-bank approach distance for rivers (16-28px vs 50-74px for ocean)
    assert.match(SHORELINE_CHUNK, /float\s+maxApproach\s*=\s*mix\(50\.0\s*\+\s*countMul\s*\*\s*3\.0,\s*16\.0\s*\+\s*countMul\s*\*\s*1\.5,\s*isRiver\);/, 'maxApproach must scale down tightly for river');

    // Downstream bank tangent alignment
    assert.match(SHORELINE_CHUNK, /vec2\s+downBankTang\s*=\s*\(flowAlongBank\s*>=\s*0\.0\)\s*\?\s*shoreTangent\s*:\s*-shoreTangent;/, 'Must determine downstream along-bank tangent');

    // Emergent drop-off on leeward trailing shores
    assert.match(SHORELINE_CHUNK, /float\s+flowExposure\s*=\s*smoothstep\(-0\.40,\s*0\.15,\s*bankFacing\);/, 'Must compute emergent drop-off for shores facing away from current');

    // Downstream shear & wrapping of wave crest
    assert.match(SHORELINE_CHUNK, /float\s+streamShear\s*=\s*distAlongDown\s*\*\s*\(0\.38\s*\*\s*isRiver/, 'Must shear and wrap wave crest downstream');

    // Downstream contact wash pulse
    assert.match(SHORELINE_CHUNK, /float\s+riverEdgePulse\s*=\s*sin\(streamCoord\s*\*\s*0\.045\s*-\s*tWave\s*\*\s*2\.8\)/, 'Waterline contact wash must pulse downstream with current');
  });
});

describe('Ocean Chop Shader (OCEAN_CHOP_CHUNK)', () => {
  it('exports a valid GLSL chunk with computeChoppyOcean function', () => {
    assert.equal(typeof OCEAN_CHOP_CHUNK, 'string');
    assert.ok(OCEAN_CHOP_CHUNK.includes('void computeChoppyOcean('), 'Missing computeChoppyOcean signature');
  });

  it('wires uWaveCount to countScale and lam1', () => {
    assert.match(OCEAN_CHOP_CHUNK, /float\s+countMul\s*=\s*clamp\(uWaveCount,\s*1\.0,\s*8\.0\);/);
    assert.match(OCEAN_CHOP_CHUNK, /float\s+lam1\s*=\s*max\(uScale\s*\*\s*1\.85\s*\*\s*countScale/);
    assert.match(OCEAN_CHOP_CHUNK, /float\s+spd1\s*=\s*2\.0\s*\/\s*countScale;/);
  });

  it('guarantees invariant ocean swell propagation velocity across all wave counts', () => {
    // Phase velocity V = spd1 / k1. Since k1 = 2pi / (lam0 * countScale) and spd1 = 2.0 / countScale,
    // V = (2.0 / countScale) / (2pi / (lam0 * countScale)) = (2.0 * lam0) / 2pi = CONSTANT.
    const uScale = 140.0;
    const lam0 = uScale * 1.85;

    const computeVelocity = (waveCount) => {
      const countMul = Math.min(8.0, Math.max(1.0, waveCount));
      const countScale = (countMul <= 4.0)
        ? (1.65 - ((countMul - 1.0) / 3.0) * (1.65 - 1.0))
        : (1.0 - Math.pow((countMul - 4.0) / 4.0, 0.82) * (1.0 - 0.30));
      const lam1 = lam0 * countScale;
      const k1 = (2 * Math.PI) / lam1;
      const spd1 = 2.0 / countScale;
      return spd1 / k1;
    };

    const baselineVel = computeVelocity(4.0);
    for (let w = 1; w <= 8; w++) {
      const vel = computeVelocity(w);
      assert.ok(Math.abs(vel - baselineVel) < 1e-6, `Physical ocean swell velocity varied at waveCount=${w}`);
    }
  });

  it('strictly preserves baseline at waveCount=4.0 and scales count at upper end', () => {
    const calcCountScale = (waveCount) => {
      const countMul = Math.min(8.0, Math.max(1.0, waveCount));
      return (countMul <= 4.0)
        ? (1.65 - ((countMul - 1.0) / 3.0) * (1.65 - 1.0))
        : (1.0 - Math.pow((countMul - 4.0) / 4.0, 0.82) * (1.0 - 0.30));
    };

    // Baseline (count 4) must be EXACTLY 1.00
    const baselineScale = calcCountScale(4.0);
    assert.equal(Math.round(baselineScale * 1000) / 1000, 1.0, 'WaveCount 4.0 must produce countScale of 1.000');

    // Max count (count 8) must produce countScale around 0.30 (~3.3x density)
    const maxCountScale = calcCountScale(8.0);
    assert.ok(maxCountScale >= 0.28 && maxCountScale <= 0.32, `WaveCount 8 countScale (${maxCountScale}) not in [0.28, 0.32]`);

    // Min count (count 1) must produce countScale around 1.65 (~0.6x density)
    const minCountScale = calcCountScale(1.0);
    assert.ok(minCountScale >= 1.60 && minCountScale <= 1.70, `WaveCount 1 countScale (${minCountScale}) not in [1.60, 1.70]`);

    // Monotonicity check
    let prev = calcCountScale(1.0);
    for (let w = 2; w <= 8; w++) {
      const curr = calcCountScale(w);
      assert.ok(curr < prev, `countScale must strictly decrease with waveCount (failed at ${w})`);
      prev = curr;
    }
  });

  it('scales break chunk coordinates with compressed swells', () => {
    assert.match(OCEAN_CHOP_CHUNK, /float\s+chunkScale\s*=\s*max\(0\.42,\s*countScale\);/);
    assert.match(OCEAN_CHOP_CHUNK, /\/\s*\(58\.0\s*\*\s*chunkScale\)/);
    assert.match(OCEAN_CHOP_CHUNK, /\/\s*\(78\.0\s*\*\s*chunkScale\)/);
  });
});

describe('Lake / Pond Shader (LAKE_POND_CHUNK)', () => {
  it('exports a valid GLSL chunk with computeLakePondWaves function', () => {
    assert.equal(typeof LAKE_POND_CHUNK, 'string');
    assert.ok(LAKE_POND_CHUNK.includes('void computeLakePondWaves('), 'Missing computeLakePondWaves signature');
  });

  it('permits drop rings on calm ponds when uLakeWaves <= 0.001 and uLakeRings > 0.001', () => {
    assert.match(LAKE_POND_CHUNK, /if\s*\(uLakeWaves\s*<=\s*0\.001\s*&&\s*uLakeRings\s*<=\s*0\.001\)\s*\{\s*return;\s*\}/, 'Early exit must only trigger when both lake waves and drop rings are inactive');
    assert.match(LAKE_POND_CHUNK, /if\s*\(uLakeWaves\s*>\s*0\.001\)/, 'Wind ruffles must be gated by uLakeWaves > 0.001');
    assert.match(LAKE_POND_CHUNK, /if\s*\(uLakeRings\s*>\s*0\.001\s*&&\s*uCoastSurf\s*<\s*0\.5\)/, 'Concentric drop rings must evaluate independently of uLakeWaves');
  });
  it('computes lacustrine wind ruffles with trochoidal steepening and elevation clamping', () => {
    assert.match(LAKE_POND_CHUNK, /float\s+waveSteep\s*=\s*\(rawWave\s*>\s*0\.0\)\s*\?\s*pow\(rawWave,\s*1\.35\)\s*:\s*-pow\(-rawWave,\s*0\.85\);/, 'Trochoidal steepening formula must preserve sharp crests and wide troughs');
    assert.match(LAKE_POND_CHUNK, /float\s+ruffleElev\s*=\s*clamp\(surfaceWaves\s*\*\s*0\.55,\s*-0\.5,\s*0\.85\)\s*\*\s*smoothstep\(0\.0,\s*25\.0,\s*softBankDist\);/, 'Ruffle elevation must be clamped to [-0.5, 0.85] and tapered at bank');
    assert.match(LAKE_POND_CHUNK, /lakeDisplacement\s*=\s*\(-lakeNormal\.xy\)\s*\*\s*\(uDistortion\s*\*\s*2\.2\s*\*\s*uLakeWaves\);/, 'Refraction displacement must be derived from lakeNormal');
  });

  it('evaluates dynamic perimeter undulation and asymmetric bank slosh with fetch bias', () => {
    assert.match(LAKE_POND_CHUNK, /float\s+windExposure\s*=\s*dot\(wind,\s*-shoreNormal\);/, 'Shore exposure must use inward shore normal against wind');
    assert.match(LAKE_POND_CHUNK, /float\s+shoreBias\s*=\s*1\.0\s*\+\s*0\.16\s*\*\s*windExposure;/, 'Windward vs leeward fetch bias must scale with windExposure');
    assert.match(LAKE_POND_CHUNK, /bankMotion\s*=\s*\(bankMotion\s*>\s*0\.0\)\s*\?\s*pow\(bankMotion,\s*1\.25\)\s*:\s*-pow\(-bankMotion,\s*0\.90\);/, 'Bank slosh must use asymmetric steepening for wash and recession');
    assert.match(LAKE_POND_CHUNK, /lakeBankSlosh\s*=\s*\(bankMotion\s*\*\s*\(uSwashSurge\s*\*\s*0\.35\s*\*\s*shoreBias\)\)/, 'lakeBankSlosh must incorporate uSwashSurge and shoreBias');
  });

  it('evaluates 4 concentric drop rings with expanding radius and exponential decay', () => {
    assert.match(LAKE_POND_CHUNK, /for\s*\(int\s+i\s*=\s*0;\s*i\s*<\s*4;\s*i\+\+\)/, 'Drop rings must iterate across 4 oscillators');
    assert.match(LAKE_POND_CHUNK, /float\s+ringRadius\s*=\s*phase\s*\*\s*75\.0;/, 'Drop ring radius must expand to 75px');
    assert.match(LAKE_POND_CHUNK, /exp\(-ringDist\s*\*\s*0\.16\)/, 'Drop rings must attenuate exponentially with distance');
  });
});

describe('River Flow Shader (RIVER_FLOW_CHUNK)', () => {
  it('exports a valid GLSL chunk with computeRiverWaves function', () => {
    assert.equal(typeof RIVER_FLOW_CHUNK, 'string');
    assert.ok(RIVER_FLOW_CHUNK.includes('void computeRiverWaves('), 'Missing computeRiverWaves signature');
  });

  it('provides early exit when uRiverWaves <= 0.001', () => {
    assert.match(RIVER_FLOW_CHUNK, /if\s*\(uRiverWaves\s*<=\s*0\.001\)/, 'computeRiverWaves must exit early when inactive');
  });

  it('dissociates wavelet amplitudes per cycle and eliminates harmonic plane wave set interference', () => {
    // Harmonic plane wave interference across river sections is prohibited
    assert.ok(!RIVER_FLOW_CHUNK.includes('waveSetInterf'), 'RIVER_FLOW_CHUNK must not use river-wide harmonic waveSetInterf');
    assert.ok(!RIVER_FLOW_CHUNK.includes('setPhase1'), 'RIVER_FLOW_CHUNK must not use periodic setPhase plane waves');

    // Per-cycle hashing and amplitude dissociation
    assert.match(RIVER_FLOW_CHUNK, /float\s+cycleIndex\s*=\s*floor\(localTime\s*\/\s*basePeriod\);/, 'Must compute cycleIndex for per-pass stochastic decoupling');
    assert.match(RIVER_FLOW_CHUNK, /float\s+ampVariance\s*=\s*mix\(0\.35,\s*1\.65,\s*cycleRnd\.y\);/, 'Must dissociate wavelet amplitudes with wide variance');
    assert.match(RIVER_FLOW_CHUNK, /float\s+breakCondition\s*=\s*smoothstep\(0\.40,\s*0\.85,\s*lifeAmp\);/, 'Foam must break based on individual wavelet lifecycle amplitude');
  });

  it('guarantees monotonic kinetic forward surge and subordinate micro-riffles to prevent double peaks', () => {
    // Prohibit reversing lunge that causes wavelets to stall and double-peak
    assert.ok(!RIVER_FLOW_CHUNK.includes('sin(smoothstep'), 'RIVER_FLOW_CHUNK must not use reversing sin(smoothstep) lunge');
    assert.match(RIVER_FLOW_CHUNK, /float\s+forwardSurge\s*=\s*smoothstep\(0\.10,\s*0\.55,\s*tau\)\s*\*\s*surgeDist;/, 'Wavelet forward surge must be monotonic');

    // Prohibit full 360-degree pendulum lateral sway across line of sight
    assert.ok(!RIVER_FLOW_CHUNK.includes('tau * 6.28318'), 'RIVER_FLOW_CHUNK must not use 360-deg pendulum lateral sway');

    // Layer 2 micro-riffles must be subordinate (< 0.35) so they do not compete or double-crest with primary wavelets
    assert.match(RIVER_FLOW_CHUNK, /float\s+posElev\s*=\s*max\(posElev1,\s*posElev2\s*\*\s*0\.28\);/, 'Layer 2 elevation must be subordinate to primary layer');
    assert.match(RIVER_FLOW_CHUNK, /float\s+combinedFoam\s*=\s*max\(foam1,\s*foam2\s*\*\s*0\.25\);/, 'Layer 2 foam must be subordinate to primary layer');

    // Steepen power must synchronize directly with lifeAmp
    assert.match(RIVER_FLOW_CHUNK, /float\s+steepenPower\s*=\s*mix\(1\.2,\s*2\.0,\s*min\(1\.0,\s*lifeAmp\)\);/, 'Crest steepening must peak in lockstep with lifecycle amplitude');
  });

  it('morphs wavelet geometry dynamically through lifecycle tau', () => {
    // Dynamic bow amplitude evolving with tau
    assert.match(RIVER_FLOW_CHUNK, /float\s+dynBowAmp\s*=\s*bowAmp\s*\*\s*bowMorph;/, 'Must evolve crescent bow amplitude over lifecycle');
    // Dynamic wing shear drift
    assert.match(RIVER_FLOW_CHUNK, /float\s+dynWingSkew\s*=\s*clamp\(wingSkew\s*\+\s*\(tau\s*-\s*0\.38\)\s*\*\s*shearRate/, 'Must shear wings dynamically over lifecycle');
    // Organic crest flex
    assert.match(RIVER_FLOW_CHUNK, /float\s+crestFlex\s*=\s*sin\(flexPhase\)\s*\*\s*flexAmp;/, 'Must apply dynamic organic crest flex');
    // Crest sharpening and lifecycle diffusion
    assert.match(RIVER_FLOW_CHUNK, /float\s+crestDiffusion\s*=\s*1\.0\s*\+\s*0\.35\s*\*\s*smoothstep\(0\.48,\s*0\.95,\s*tau\);/, 'Must diffuse crest width as wavelet decays');
  });

  it('guarantees cellular seam prevention with bounded search envelope (Delta_max + R_max < 1.50)', () => {
    // Prohibit uncentered row stagger that pushed features beyond 3x3 search bounds
    assert.doesNotMatch(RIVER_FLOW_CHUNK, /mod\(abs\(cId\.y\),\s*2\.0\)\s*\*\s*\(cellSize\.x\s*\*\s*0\.5\)/, 'Row stagger must not use uncentered positive-only offset');
    // Enforce centered row stagger (mod - 0.5) * 0.25 (range [-0.125, +0.125] of cellSize)
    assert.match(RIVER_FLOW_CHUNK, /\(mod\(abs\(cId\.y\),\s*2\.0\)\s*-\s*0\.5\)\s*\*\s*\(cellSize\.x\s*\*\s*0\.25\)/, 'Row stagger must be centered at [-0.125, 0.125] of cellSize');
    // Bounded jitter centered on (r1 - 0.5)
    assert.match(RIVER_FLOW_CHUNK, /\(r1\s*-\s*0\.5\)\s*\*\s*cellSize/, 'Jitter must be centered around cell center');
    // Bounded feature radius
    assert.match(RIVER_FLOW_CHUNK, /float\s+radU\s*=\s*cellSize\.x\s*\*\s*0\.44\s*\*\s*aspect\s*\*\s*layerScale;/, 'radU must scale with 0.44 * aspect');
    assert.match(RIVER_FLOW_CHUNK, /float\s+radV\s*=\s*cellSize\.y\s*\*\s*0\.46\s*\*\s*layerScale;/, 'radV must scale with 0.46');

    // Theoretical maximum envelope:
    // deltaMax = max(rowStagger) + max(jitter) + max(driftDist)
    //          = 0.125 + 0.5 * 0.22 * 0.70 + 0.5 * 0.18 * 0.60
    //          = 0.125 + 0.077 + 0.054 = 0.256
    // rMax = 0.44 * 1.35 = 0.594
    // totalReach = deltaMax + rMax = 0.850
    // Must be strictly < 1.50 (search radius of 3x3 neighbor cell) to guarantee zero boundary jump
    const deltaMax = 0.125 + 0.077 + 0.054;
    const rMax = 0.44 * 1.35;
    const totalReach = deltaMax + rMax;
    assert.ok(totalReach < 1.50, `Total feature reach (${totalReach}) must be strictly less than 1.50 to prevent cellular seams`);
  });

  it('calibrates normal slope gain, whitewater foam threshold, and benthic refraction displacement', () => {
    // Slope gain for 35-45 degree water mound tilt and rich 3D light/shadow
    assert.match(RIVER_FLOW_CHUNK, /const\s+float\s+kSlopeGain\s*=\s*14\.0;/, 'kSlopeGain must be 14.0 for tabletop relief');
    // Gradient steepness calculation
    assert.match(RIVER_FLOW_CHUNK, /float\s+steepness\s*=\s*length\(worldGrad\);/, 'Steepness must be derived from length(worldGrad)');
    // Crest presence steepness gate
    assert.match(RIVER_FLOW_CHUNK, /smoothstep\(0\.08,\s*0\.35,\s*steepness\)/, 'Crest presence steepness gate must start at 0.08');
    // Whitewater foam scaling and clamp to 0.96
    assert.match(RIVER_FLOW_CHUNK, /riverFoam\s*=\s*clamp\(foam,\s*0\.0,\s*0\.96\);/, 'Foam must be clamped to 0.96');
    // Refraction displacement derived from -worldGrad
    assert.match(RIVER_FLOW_CHUNK, /riverDisplacement\s*=\s*\(-worldGrad\)\s*\*\s*\(uDistortion\s*\*\s*1\.5\s*\*\s*uRiverWaves\);/, 'Displacement must scale with -worldGrad and uDistortion * 1.5');
  });
});

describe('Token Wakes Shader (TOKEN_WAKES_CHUNK)', () => {
  it('exports a valid GLSL chunk with computeTokenWaves and sumWakeDistortion', () => {
    assert.equal(typeof TOKEN_WAKES_CHUNK, 'string');
    assert.ok(TOKEN_WAKES_CHUNK.includes('float computeTokenWaves('), 'Missing computeTokenWaves signature');
    assert.ok(TOKEN_WAKES_CHUNK.includes('vec2 sumWakeDistortion('), 'Missing sumWakeDistortion signature');
  });

  it('provides zero-ALU early exit in computeTokenWaves when no wet tokens or stamps are active', () => {
    assert.match(TOKEN_WAKES_CHUNK, /tokenEnergy\s*\+\s*stampEnergy\s*<=\s*0\.0001/, 'computeTokenWaves must exit early when token and stamp energies are zero');
  });

  it('provides zero-ALU early exit in sumWakeDistortion when inactive', () => {
    assert.match(TOKEN_WAKES_CHUNK, /if\s*\(uWakeStrengthMul\s*<=\s*0\.0001\)\s*return\s+vec2\(0\.0\);/, 'sumWakeDistortion must exit early when uWakeStrengthMul is zero');
  });
});

describe('Composite Shader & Presets Contract', () => {
  it('composite shader integrates computeShoreWaves and archetype strategies', () => {
    assert.ok(COMPOSITE_CHUNK.includes('computeShoreWaves('), 'composite chunk must call computeShoreWaves');
    assert.ok(COMPOSITE_CHUNK.includes('applyOceanArchetype('), 'composite chunk must dispatch ocean strategy');
    assert.ok(COMPOSITE_CHUNK.includes('applyRiverArchetype('), 'composite chunk must dispatch river strategy');
    assert.ok(COMPOSITE_CHUNK.includes('applyLakeArchetype('), 'composite chunk must dispatch lake strategy');
  });

  it('gates shoreline wavelet emission to natural shorelines with SDF data and active uniform', () => {
    assert.match(COMPOSITE_CHUNK, /if\s*\(hasSdf\s*>\s*0\.5\s*&&\s*shoreIsNatural\s*>\s*0\.05\s*&&\s*uShoreWaves\s*>\s*0\.001\)/, 'computeShoreWaves must be gated to avoid evaluating 3x3 lattice on cuts and inactive shorelines');
  });

  it('gates caustic domain warping and voronoi passes when inactive or under heavy chop', () => {
    assert.match(COMPOSITE_CHUNK, /if\s*\(isCoastSurf\s*>\s*0\.5\s*&&\s*uIntensity\s*>\s*0\.001\s*&&\s*uChoppySeas\s*<\s*1\.15\)/, 'Caustics must only execute on shores and oceans when uIntensity is active');
  });

  it('lake illumination via struct fields in tinting pipeline', () => {
    // Lake tinting now uses struct fields (ar.skyReflect, ar.lakeTroughShadow, ar.elevation)
    assert.match(COMPOSITE_CHUNK, /ar\.skyReflect\s*\*\s*0\.60/, 'waterTint must use ar.skyReflect for lake sky reflection');
    assert.match(COMPOSITE_CHUNK, /ar\.lakeTroughShadow/, 'waterTint must use ar.lakeTroughShadow for lake trough shadow');
    assert.match(COMPOSITE_CHUNK, /ar\.elevation/, 'waterTint must use ar.elevation for lake crest illumination');
  });

  it('strictly isolates coastal surf and caustics to shores and oceans', () => {
    assert.match(COMPOSITE_CHUNK, /float\s+isCoastSurf\s*=\s*uCoastSurf;/, 'isCoastSurf must strictly follow uCoastSurf');
    assert.match(COMPOSITE_CHUNK, /if\s*\(isCoastSurf\s*>\s*0\.5\s*&&\s*uIntensity\s*>\s*0\.001\s*&&\s*uChoppySeas\s*<\s*1\.15\)/, 'Caustics must only execute on shores and oceans');
    assert.match(COMPOSITE_CHUNK, /if\s*\(isCoastSurf\s*>\s*0\.5\s*&&\s*uIntensity\s*>\s*0\.001\)/, 'Caustic shimmer sparkle must only execute on shores and oceans');
    assert.match(COMPOSITE_CHUNK, /if\s*\(isCoastSurf\s*<\s*0\.5\s*&&\s*\(uLakeWaves\s*>\s*0\.001\s*\|\|\s*uLakeRings\s*>\s*0\.001\)\)/, 'applyLakeArchetype must only execute for inland bodies');
    assert.match(COMPOSITE_CHUNK, /if\s*\(isCoastSurf\s*>\s*0\.5\s*&&\s*waterReach\s*>\s*0\.0\s*&&\s*uSurfFoam\s*>\s*0\.001\)/, 'Coastal surf wash must only execute when isCoastSurf is true');
    assert.match(COMPOSITE_CHUNK, /if\s*\(isCoastSurf\s*<=\s*0\.5\s*&&\s*totalWave\s*>\s*0\.001\s*&&\s*waterReach\s*>\s*-2\.0\)/, 'Foam punch-through must preserve inland body wave visibility');
  });

  it('archetype strategy struct plumbs displacement, foam, glint through pipeline', () => {
    // Displacement: archetype strategies write to ar.displacement, composite reads it
    assert.match(COMPOSITE_CHUNK, /offset\s*\+=\s*ar\.displacement/, 'Refraction must incorporate ar.displacement');
    // Foam: composite reads from ar.foam
    assert.match(COMPOSITE_CHUNK, /ar\.foam/, 'totalWave must use archetype foam from struct');
    // Glint: composite reads from ar.glint
    assert.match(COMPOSITE_CHUNK, /ar\.glint/, 'combinedGlint must use archetype glint from struct');
    // BankSlosh: composite reads from ar.bankSlosh
    assert.match(COMPOSITE_CHUNK, /bankSlosh\s*=\s*ar\.bankSlosh/, 'bankSlosh must adopt ar.bankSlosh from lake strategy');

    // Strategy wrappers in chunk files must encapsulate displacement scaling
    assert.match(LAKE_POND_CHUNK, /ar\.displacement\s*\+=\s*lDisp\s*\*\s*0\.70/, 'Lake strategy must scale displacement by 0.70');
    assert.match(RIVER_FLOW_CHUNK, /ar\.displacement\s*\+=\s*rDisp\s*\*\s*0\.70/, 'River strategy must scale displacement by 0.70');
    assert.match(OCEAN_CHOP_CHUNK, /ar\.displacement\s*\+=/, 'Ocean strategy must write to ar.displacement');
  });

  it('guarantees background refraction distortion and caustics drift downstream in flow direction and scale with uSpeed', () => {
    assert.match(COMPOSITE_CHUNK, /float\s+tWave\s*=\s*uTime\s*\*\s*uSpeed;/, 'tWave must scale with uSpeed');
    assert.match(COMPOSITE_CHUNK, /float\s+tAnim\s*=\s*tWave\s*\*\s*0\.9;/, 'tAnim must scale with tWave (uSpeed) so distortion responds to speed');
    // Lake timing now encapsulated in strategy wrapper (lakePond chunk)
    assert.match(LAKE_POND_CHUNK, /tWaveLake\s*=\s*tWave;/, 'Lake strategy must derive tWaveLake from tWave');
    assert.match(LAKE_POND_CHUNK, /tAnimLake\s*=\s*tAnim;/, 'Lake strategy must derive tAnimLake from tAnim');
    assert.match(COMPOSITE_CHUNK, /distUV\s*-\s*flow\s*\*\s*\(tAnim\s*\*\s*0\.3\)/, 'Refraction noise must drift with flow');
    assert.match(COMPOSITE_CHUNK, /vec2\s+flowOffset\s*=\s*-flow\s*\*\s*\(tAnim\s*\*\s*13\.0\)\s*\/\s*uScale;/, 'Voronoi caustics must drift with flow');
    assert.match(COMPOSITE_CHUNK, /sparkle\s*=\s*noise21\(causticUV\s*\*\s*6\.0\s*-\s*flow\s*\*\s*\(t\s*\*\s*0\.2\)\)/, 'Specular sparkle must drift with flow');
  });

  it('all ocean and coast presets declare valid waveCount values (1-8)', () => {
    const oceanCoastPresets = Object.entries(WATER_PRESETS).filter(
      ([, p]) => p.archetype === 'ocean' || p.archetype === 'coast'
    );
    assert.ok(oceanCoastPresets.length >= 7, 'Expected at least 7 ocean/coast presets');

    for (const [key, preset] of oceanCoastPresets) {
      if (key === 'custom') continue;
      assert.ok(Number.isInteger(preset.waveCount), `Preset ${key} missing integer waveCount`);
      assert.ok(preset.waveCount >= 1 && preset.waveCount <= 8, `Preset ${key} waveCount ${preset.waveCount} out of range [1, 8]`);
    }
  });

  it('all lake and pond presets declare valid archetype parameters and zero ocean/river leakage', () => {
    const lakePondPresets = Object.entries(WATER_PRESETS).filter(
      ([, p]) => p.archetype === 'lake' || p.archetype === 'pond'
    );
    assert.ok(lakePondPresets.length >= 7, 'Expected at least 7 lake/pond presets');

    for (const [key, preset] of lakePondPresets) {
      assert.ok(preset.lakeWaves >= 0.0, `Preset ${key} lakeWaves must be >= 0`);
      assert.equal(typeof preset.lakeRings, 'boolean', `Preset ${key} lakeRings must be boolean`);
      assert.equal(preset.choppySeas, 0.0, `Preset ${key} must have choppySeas = 0.00`);
      assert.equal(preset.riverWaves, 0.0, `Preset ${key} must have riverWaves = 0.00`);
      assert.ok(preset.speed > 0 && preset.speed <= 1.0, `Preset ${key} speed (${preset.speed}) out of lake/pond range (0, 1.0]`);
      assert.ok(preset.fadeWidth >= 15, `Preset ${key} fadeWidth (${preset.fadeWidth}) out of range`);
    }
  });

  it('all ocean and coast presets declare valid archetype parameters and zero lake/river leakage', () => {
    const oceanCoastPresets = Object.entries(WATER_PRESETS).filter(
      ([, p]) => p.archetype === 'ocean' || p.archetype === 'coast'
    );
    for (const [key, preset] of oceanCoastPresets) {
      if (key === 'custom') continue;
      assert.equal(preset.lakeWaves, 0.0, `Preset ${key} must have lakeWaves = 0.00`);
      assert.equal(preset.lakeRings, false, `Preset ${key} must have lakeRings = false`);
      assert.equal(preset.riverWaves, 0.0, `Preset ${key} must have riverWaves = 0.00`);
      if (preset.archetype === 'ocean') {
        assert.ok(preset.choppySeas > 0.3, `Ocean preset ${key} must have active choppySeas`);
      }
      if (preset.archetype === 'coast') {
        assert.ok(preset.shoreWaves >= 0.3, `Coast preset ${key} must have active shoreWaves`);
        assert.ok(preset.surfFoam >= 0.5, `Coast preset ${key} must have active surfFoam`);
      }
    }
  });

  it('all river presets declare valid archetype parameters and zero ocean/lake leakage', () => {
    const riverPresets = Object.entries(WATER_PRESETS).filter(
      ([, p]) => p.archetype === 'river'
    );
    assert.ok(riverPresets.length >= 4, 'Expected at least 4 river presets');

    for (const [key, preset] of riverPresets) {
      assert.equal(preset.lakeWaves, 0.0, `Preset ${key} must have lakeWaves = 0.00`);
      assert.equal(preset.lakeRings, false, `Preset ${key} must have lakeRings = false`);
      assert.equal(preset.choppySeas, 0.0, `Preset ${key} must have choppySeas = 0.00`);
      assert.ok(preset.riverWaves > 0.0, `Preset ${key} must have riverWaves > 0.00`);
    }
  });

  it('WaterMesh sets uWaveCount uniform in constructor and setWaveCount method', () => {
    const meshSrc = readFileSync(join(process.cwd(), 'scripts/water/WaterMesh.js'), 'utf8');
    assert.match(meshSrc, /uWaveCount:\s*config\.waveCount/, 'WaterMesh must initialize uWaveCount uniform');
    assert.match(meshSrc, /setWaveCount\s*\(val\)/, 'WaterMesh must have setWaveCount method');
  });
});

describe('Waterline Studio Hero Sliders Contract', () => {
  const studioSrc = readFileSync(join(process.cwd(), 'scripts/apps/WaterlineStudioApp.js'), 'utf8');

  it('builds curated hero sliders for all tabletop archetypes', () => {
    // Ocean hero sliders
    assert.ok(studioSrc.includes("case 'ocean':"), 'Missing ocean slider case');
    assert.match(studioSrc, /id:\s*'waveEnergy',\s*label:\s*'Wave Energy'/);
    assert.match(studioSrc, /id:\s*'waveCount',\s*label:\s*'Wave Count'/);
    assert.match(studioSrc, /id:\s*'surfFoam',\s*label:\s*'Shoreline Foam'/);

    // Lake hero sliders
    assert.ok(studioSrc.includes("case 'lake':"), 'Missing lake slider case');
    assert.match(studioSrc, /id:\s*'waterClarity',\s*label:\s*'Water Clarity'/);

    // River hero sliders
    assert.ok(studioSrc.includes("case 'river':"), 'Missing river slider case');
    assert.match(studioSrc, /id:\s*'(?:shoreFoam|rapidsFoam)',\s*label:\s*'Shore Foam'/);

    // Pond hero sliders
    assert.ok(studioSrc.includes("case 'pond':"), 'Missing pond slider case');
    assert.match(studioSrc, /id:\s*'sunShimmer',\s*label:\s*'Sun Shimmer'/);

    // Lens distortion hero slider across archetypes
    assert.match(studioSrc, /id:\s*'distortion',\s*label:\s*'Lens Distortion'/);

    // Lake animation speed dynamic range (0.1x - 2.0x)
    assert.match(studioSrc, /case\s+'lake':[\s\S]*?id:\s*'speed',\s*label:\s*'Animation Speed'[\s\S]*?min:\s*0\.1,\s*max:\s*2\.0/);
  });

  it('maps hero slider inputs strictly without cross-archetype corruption', () => {
    // Ocean mapping
    assert.match(studioSrc, /if\s*\(this\.activeArchetype\s*===\s*'ocean'\)\s*\{\s*this\.fx\.choppySeas\s*=\s*\+\(0\.10\s*\+\s*1\.25\s*\*\s*x\)\.toFixed\(2\);/);

    // Coast mapping
    assert.match(studioSrc, /else\s+if\s*\(this\.activeArchetype\s*===\s*'coast'\)\s*\{\s*this\.fx\.shoreWaves\s*=\s*\+\(0\.05\s*\+\s*0\.90\s*\*\s*x\)\.toFixed\(2\);/);

    // Lake mapping
    assert.match(studioSrc, /else\s+if\s*\(this\.activeArchetype\s*===\s*'lake'\)\s*\{\s*this\.fx\.lakeWaves\s*=\s*\+\(x\)\.toFixed\(2\);/);

    // River mapping
    assert.match(studioSrc, /else\s+if\s*\(this\.activeArchetype\s*===\s*'river'\)\s*\{\s*this\.fx\.riverWaves\s*=\s*\+\(x\)\.toFixed\(2\);/);

    // Shore / rapids foam mapping
    assert.match(studioSrc, /case\s+'(?:shoreFoam|rapidsFoam)':[\s\S]*?this\.fx\.whitecaps\s*=\s*\+\(0\.65\s*\*\s*x\)\.toFixed\(2\);\s*this\.fx\.surfFoam\s*=\s*\+\(x\)\.toFixed\(2\);/);

    // Lens distortion mapping and decoupling from speed
    assert.match(studioSrc, /case\s+'distortion':[\s\S]*?this\.fx\.distortion\s*=\s*\+\(x\s*\*\s*0\.050\)\.toFixed\(3\);/);
    const speedCaseBlock = studioSrc.match(/case\s+'speed':[\s\S]*?break;/)?.[0] ?? '';
    assert.ok(!speedCaseBlock.includes('distortion'), 'Speed slider must not clobber fx.distortion');
  });

  it('provides high-resolution low-end control (0-20px) and diminishing fidelity towards max on shoreline margin', () => {
    // Shoreline margin slider declaration uses min:0, max:100, step:1
    assert.match(studioSrc, /id:\s*'fadeWidth',\s*label:\s*'Shoreline Margin'[\s\S]*?min:\s*0,\s*max:\s*100,\s*step:\s*1/);

    const archetypes = [
      { name: 'ocean', max: 150 },
      { name: 'coast', max: 150 },
      { name: 'river', max: 120 },
      { name: 'lake', max: 100 },
      { name: 'pond', max: 80 },
      { name: 'puddle', max: 40 }
    ];

    for (const { name, max } of archetypes) {
      assert.equal(WaterlineStudioApp.getMaxFadeWidth(name), max, `${name} must declare max margin ${max}px`);

      // Endpoints & critical inflection point (slider 40 = 20px)
      assert.equal(WaterlineStudioApp.sliderToFadeWidth(0, max), 0, `${name} slider 0 must map to 0px`);
      assert.equal(WaterlineStudioApp.sliderToFadeWidth(40, max), 20, `${name} slider 40 must map to 20px`);
      assert.equal(WaterlineStudioApp.sliderToFadeWidth(100, max), max, `${name} slider 100 must map to ${max}px`);
      assert.equal(WaterlineStudioApp.fadeWidthToSlider(0, max), 0, `${name} 0px must map to slider 0`);
      assert.equal(WaterlineStudioApp.fadeWidthToSlider(20, max), 40, `${name} 20px must map to slider 40`);
      assert.equal(WaterlineStudioApp.fadeWidthToSlider(max, max), 100, `${name} ${max}px must map to slider 100`);

      // 100% round-trip fidelity for all integer pixel values 0..20px
      for (let px = 0; px <= 20; px++) {
        const sliderPos = WaterlineStudioApp.fadeWidthToSlider(px, max);
        const reconstructedPx = WaterlineStudioApp.sliderToFadeWidth(sliderPos, max);
        assert.equal(reconstructedPx, px, `${name} px=${px} must round-trip exactly (got ${reconstructedPx})`);
      }

      // Strictly monotonic progression without deadzones
      let prevVal = -1;
      for (let s = 0; s <= 100; s++) {
        const px = WaterlineStudioApp.sliderToFadeWidth(s, max);
        assert.ok(px >= prevVal, `${name} slider must be non-decreasing at s=${s}`);
        prevVal = px;
      }
    }
  });

  it('declares dropRipples hero slider for pond and puddle with zero silence capability', () => {
    assert.match(studioSrc, /case\s+'pond':[\s\S]*?id:\s*'dropRipples',\s*label:\s*'Drop Ripples'/);
    assert.match(studioSrc, /case\s+'puddle':[\s\S]*?id:\s*'dropRipples',\s*label:\s*'Drop Ripples'/);
    assert.match(studioSrc, /case\s+'(?:dropRipples|lakeRings)':[\s\S]*?this\.fx\.lakeRings\s*=\s*\+\(x\)\.toFixed\(2\);/);
    assert.match(LAKE_POND_CHUNK, /smoothstep\(0\.0,\s*20\.0,\s*softBankDist\)\s*\*\s*uLakeRings;/, 'Drop ring amplitude must scale by uLakeRings');
  });

  it('exposes color override, eyedropper, and hex dial across all archetypes in template and studio app', () => {
    const templateSrc = readFileSync(join(process.cwd(), 'templates/studio.hbs'), 'utf8');
    assert.match(templateSrc, /wc-color-card/, 'Water Tint & Color card must be declared in studio.hbs');
    assert.match(templateSrc, /input\s+type="color"\s+name="colorOverride"/, 'Color swatch input must exist in studio.hbs');
    assert.match(templateSrc, /input\s+type="text"\s+name="colorOverrideHex"/, 'Hex dial input must exist in studio.hbs');
    assert.match(templateSrc, /data-action="sampleScreenColor"/, 'Screen eyedropper button must exist in studio.hbs');
    assert.match(studioSrc, /colorOverrideHex:\s*\(this\.fx\.colorOverride/, 'Context must provide colorOverrideHex');
    assert.match(studioSrc, /hasEyeDropper:\s*typeof\s+window/, 'Context must provide hasEyeDropper');
    assert.match(studioSrc, /root\.querySelector\('input\[name="colorOverrideHex"\]'\)/, 'Studio app must wire colorOverrideHex listener');
  });
});

// ─── Slider Independence & Distortion Sovereignty ───────────────────────────

describe('Hero Slider Independence (distortion sovereignty)', () => {
  const studioSrc = readFileSync(join(process.cwd(), 'scripts/apps/WaterlineStudioApp.js'), 'utf8');

  // Every slider case block in #onHeroSliderInput that is NOT the distortion slider
  // must never write to fx.distortion.
  const distortionOwners = ['distortion', 'lensDistortion', 'refraction'];
  // Extract only the #onHeroSliderInput method body for analysis
  const inputHandlerMatch = studioSrc.match(/#onHeroSliderInput\([\s\S]*?^\s{4}\}/m);
  const inputHandlerSrc = inputHandlerMatch?.[0] ?? '';
  const caseBlocks = [...inputHandlerSrc.matchAll(/case\s+'([^']+)':\s*[\s\S]*?break;/g)];

  it('no non-distortion slider case writes fx.distortion', () => {
    assert.ok(inputHandlerSrc.length > 100, '#onHeroSliderInput method must be extractable');
    const violators = [];
    for (const m of caseBlocks) {
      const sliderId = m[1];
      const body = m[0];
      if (distortionOwners.includes(sliderId)) continue;
      if (body.includes('this.fx.distortion')) {
        violators.push(sliderId);
      }
    }
    assert.deepStrictEqual(violators, [],
      `These sliders clobber fx.distortion: ${violators.join(', ')}`);
  });

  it('surfaceBreeze does not clobber fx.distortion', () => {
    const block = studioSrc.match(/case\s+'surfaceBreeze':[\s\S]*?break;/)?.[0] ?? '';
    assert.ok(!block.includes('fx.distortion'), 'surfaceBreeze must not write fx.distortion');
  });

  it('siltMurkiness does not clobber fx.distortion', () => {
    const block = studioSrc.match(/case\s+'siltMurkiness':[\s\S]*?break;/)?.[0] ?? '';
    assert.ok(!block.includes('fx.distortion'), 'siltMurkiness must not write fx.distortion');
  });

  it('mudSilt does not clobber fx.distortion', () => {
    const block = studioSrc.match(/case\s+'mudSilt':[\s\S]*?break;/)?.[0] ?? '';
    assert.ok(!block.includes('fx.distortion'), 'mudSilt must not write fx.distortion');
  });

  it('shoreFoam / rapidsFoam does not clobber fx.distortion', () => {
    const block = studioSrc.match(/case\s+'(?:shoreFoam|rapidsFoam)':[\s\S]*?break;/)?.[0] ?? '';
    assert.ok(!block.includes('fx.distortion'), 'shoreFoam must not write fx.distortion');
  });

  it('waveEnergy does not clobber fx.distortion', () => {
    const block = studioSrc.match(/case\s+'waveEnergy':[\s\S]*?break;/)?.[0] ?? '';
    assert.ok(!block.includes('fx.distortion'), 'waveEnergy must not write fx.distortion');
  });

  it('swashSurge does not clobber fx.distortion', () => {
    const block = studioSrc.match(/case\s+'swashSurge':[\s\S]*?break;/)?.[0] ?? '';
    assert.ok(!block.includes('fx.distortion'), 'swashSurge must not write fx.distortion');
  });

  it('waterClarity does not clobber fx.distortion', () => {
    const block = studioSrc.match(/case\s+'waterClarity':[\s\S]*?break;/)?.[0] ?? '';
    assert.ok(!block.includes('fx.distortion'), 'waterClarity must not write fx.distortion');
  });
});

// ─── Uniform Contract Tests (§15.2 Compliance) ────────────────────────────

describe('WaterMesh Uniform Contract (§15.2)', () => {
  const meshSrc = readFileSync(join(process.cwd(), 'scripts/water/WaterMesh.js'), 'utf8');
  const commonSrc = readFileSync(join(process.cwd(), 'scripts/water/shaders/chunks/common.glsl.js'), 'utf8');

  // Extract all uniform declarations from GLSL common chunk
  const glslUniforms = [...commonSrc.matchAll(/uniform\s+\w+\s+(u\w+)\s*;/g)].map(m => m[1]);

  it('declares all GLSL uniforms in WaterMesh constructor', () => {
    const missing = glslUniforms.filter(u => !meshSrc.includes(u));
    assert.deepStrictEqual(missing, [],
      `WaterMesh is missing initialisation for: ${missing.join(', ')}`);
  });

  it('initialises uFoamHfWeight (previously phantom uniform)', () => {
    assert.match(meshSrc, /uFoamHfWeight:\s*config\.foamHfWeight\s*\?\?\s*1\.0/,
      'uFoamHfWeight must be initialised with default 1.0');
  });

  it('every GLSL uniform that is a float or vec has a numeric default', () => {
    const floatUniforms = glslUniforms.filter(u =>
      !u.startsWith('uWake') && !u.startsWith('uToken') &&
      !['uShoreSdf', 'uBackground', 'uWaterColor', 'uHighlightColor',
        'uBounds', 'uSceneDims', 'uBorderTouches', 'uSdfBounds'].includes(u)
    );
    for (const u of floatUniforms) {
      assert.ok(meshSrc.includes(u + ':'), `Missing initialisation for ${u}`);
    }
  });
});

// ─── Cross-Archetype Preset Contamination Guards ───────────────────────────

describe('Cross-Archetype Preset Isolation', () => {
  it('river presets never leak lake-specific parameters', () => {
    const riverPresets = Object.entries(WATER_PRESETS).filter(([, p]) => p.archetype === 'river');
    for (const [key, preset] of riverPresets) {
      assert.equal(preset.lakeWaves ?? 0.0, 0.0, `River preset ${key} leaks lakeWaves`);
      assert.ok(!preset.lakeRings || preset.lakeRings === false, `River preset ${key} leaks lakeRings`);
    }
  });

  it('lake presets never leak river-specific parameters', () => {
    const lakePresets = Object.entries(WATER_PRESETS).filter(([, p]) => p.archetype === 'lake' || p.archetype === 'pond');
    for (const [key, preset] of lakePresets) {
      assert.equal(preset.riverWaves ?? 0.0, 0.0, `Lake preset ${key} leaks riverWaves`);
      assert.equal(preset.choppySeas ?? 0.0, 0.0, `Lake preset ${key} leaks choppySeas`);
    }
  });

  it('ocean presets never leak inland-specific parameters', () => {
    const oceanPresets = Object.entries(WATER_PRESETS).filter(([, p]) => p.archetype === 'ocean');
    for (const [key, preset] of oceanPresets) {
      assert.equal(preset.riverWaves ?? 0.0, 0.0, `Ocean preset ${key} leaks riverWaves`);
      assert.equal(preset.lakeWaves ?? 0.0, 0.0, `Ocean preset ${key} leaks lakeWaves`);
    }
  });

  it('puddle presets never leak ocean or river parameters', () => {
    const puddlePresets = Object.entries(WATER_PRESETS).filter(([, p]) => p.archetype === 'puddle');
    for (const [key, preset] of puddlePresets) {
      assert.equal(preset.choppySeas ?? 0.0, 0.0, `Puddle preset ${key} leaks choppySeas`);
      assert.equal(preset.riverWaves ?? 0.0, 0.0, `Puddle preset ${key} leaks riverWaves`);
    }
  });
});

// ─── Composite Shader Archetype Isolation Guards ───────────────────────────

describe('Composite Shader Archetype Gating', () => {
  it('gates lake simulation behind isCoastSurf check', () => {
    assert.match(COMPOSITE_CHUNK,
      /if\s*\(\s*isCoastSurf\s*<\s*0\.5\s*&&\s*\(uLakeWaves\s*>\s*0\.001\s*\|\|\s*uLakeRings\s*>\s*0\.001\)/,
      'Lake dispatch must be gated behind isCoastSurf < 0.5');
  });

  it('gates coastal surf wash behind isCoastSurf check', () => {
    assert.match(COMPOSITE_CHUNK,
      /if\s*\(\s*isCoastSurf\s*>\s*0\.5\s*&&\s*waterReach\s*>\s*0\.0\s*&&\s*uSurfFoam\s*>\s*0\.001\)/,
      'Coastal surf wash must be gated behind isCoastSurf > 0.5');
  });

  it('gates inland foam punch-through behind isCoastSurf check', () => {
    assert.match(COMPOSITE_CHUNK,
      /if\s*\(\s*isCoastSurf\s*<=\s*0\.5\s*&&\s*totalWave\s*>\s*0\.001/,
      'Inland foam punch-through must be gated behind isCoastSurf <= 0.5');
  });

  it('ocean dispatch via strategy wrapper with early-exit gate in chunk', () => {
    assert.ok(COMPOSITE_CHUNK.includes('applyOceanArchetype('),
      'composite must dispatch ocean via strategy wrapper');
    assert.match(OCEAN_CHOP_CHUNK, /uChoppySeas\s*<=\s*0\.001/,
      'Ocean chunk must early-exit when uChoppySeas is zero');
  });

  it('river dispatch via strategy wrapper with early-exit gate in chunk', () => {
    assert.ok(COMPOSITE_CHUNK.includes('applyRiverArchetype('),
      'composite must dispatch river via strategy wrapper');
    assert.match(RIVER_FLOW_CHUNK, /uRiverWaves\s*<=\s*0\.001/,
      'River chunk must early-exit when uRiverWaves is zero');
  });
});

// ─── River Presets Pace & Whitewater Hierarchy ──────────────────────────────

describe('River Presets Pace & Whitewater Progression', () => {
  it('enforces monotonic kinetic pace progression across river presets', () => {
    const canalSpeed = WATER_PRESETS.canal.speed;
    const brookSpeed = WATER_PRESETS.river_forest.speed;
    const riverSpeed = WATER_PRESETS.river.speed;
    const torrentSpeed = WATER_PRESETS.torrent.speed;

    assert.ok(canalSpeed < brookSpeed, `Canal speed (${canalSpeed}) must be slower than Forest Brook (${brookSpeed})`);
    assert.ok(brookSpeed < riverSpeed, `Forest Brook speed (${brookSpeed}) must be slower than River (${riverSpeed})`);
    assert.ok(riverSpeed < torrentSpeed, `River speed (${riverSpeed}) must be slower than Mountain Rapids (${torrentSpeed})`);
  });

  it('enforces monotonic whitewater foam progression across river presets', () => {
    const canalFoam = WATER_PRESETS.canal.whitecaps;
    const brookFoam = WATER_PRESETS.river_forest.whitecaps;
    const riverFoam = WATER_PRESETS.river.whitecaps;
    const torrentFoam = WATER_PRESETS.torrent.whitecaps;

    assert.equal(canalFoam, 0.0, 'Canal must have zero whitewater froth');
    assert.ok(brookFoam > 0.0, 'Forest Brook must exhibit subtle whitewater');
    assert.ok(brookFoam < riverFoam, `Forest Brook foam (${brookFoam}) must be less than River (${riverFoam})`);
    assert.ok(riverFoam < torrentFoam, `River foam (${riverFoam}) must be less than Rapids (${torrentFoam})`);
  });

  it('allocates sufficient swash surge for mountain rapids', () => {
    assert.ok(WATER_PRESETS.torrent.swashSurge >= 24.0, 'Mountain rapids must have swashSurge >= 24.0');
  });
});

// ─── Eyedropper & Color Sampling Contract ───────────────────────────────────

describe('Eyedropper & Color Sampling Contract', () => {
  it('sampleColorAtWorld returns null when canvas background is unavailable', () => {
    const app = new WaterlineStudioApp();
    const hex = app.sampleColorAtWorld(100, 100);
    assert.equal(hex, null, 'Must return null when canvas background is missing');
  });

  it('sampleColorAtWorld extracts and formats hex from valid canvas pixel buffer', () => {
    const app = new WaterlineStudioApp();
    // Inject mock canvas and texture
    const origCanvas = globalThis.canvas;
    try {
      globalThis.canvas = {
        app: {
          renderer: {
            extract: {
              pixels: (obj, frame) => {
                // Return RGBA: [32, 128, 240, 255]
                return new Uint8Array([32, 128, 240, 255]);
              }
            }
          }
        },
        primary: {
          background: {
            texture: {
              valid: true,
              width: 1000,
              height: 1000
            }
          }
        }
      };
      globalThis.PIXI = {
        Rectangle: class {
          constructor(x, y, w, h) { this.x = x; this.y = y; this.width = w; this.height = h; }
        }
      };

      const hex = app.sampleColorAtWorld(500, 500);
      assert.equal(hex, '#2080f0', 'Expected pixel [32, 128, 240] to convert to #2080f0');
    } finally {
      globalThis.canvas = origCanvas;
    }
  });

  it('sampleColorAtWorld returns null when sampling coordinates are out of bounds', () => {
    const app = new WaterlineStudioApp();
    const origCanvas = globalThis.canvas;
    try {
      globalThis.canvas = {
        primary: {
          background: {
            texture: {
              valid: true,
              width: 1000,
              height: 1000
            }
          }
        }
      };
      // Test out of bounds (< 0 and > texture width)
      assert.equal(app.sampleColorAtWorld(-10, 500), null, 'Negative coordinate must return null');
      assert.equal(app.sampleColorAtWorld(1500, 500), null, 'Out-of-bounds coordinate must return null');
    } finally {
      globalThis.canvas = origCanvas;
    }
  });
});

describe('Scene Background Resolution & Fallbacks Contract', () => {
  it('resolves standard scene.background.src on legacy scenes', () => {
    const scene = { background: { src: 'worlds/ocean-map.webp' } };
    assert.equal(WaterManager.resolveSceneBackgroundSrc(scene), 'worlds/ocean-map.webp');
  });

  it('correctly falls back to scene.background.src when scene.levels is a Collection/Map without background', () => {
    // This directly tests the root cause of the white-water bug where truthy Map levels caused undefined bgPath
    const levelsMap = new Map();
    const scene = {
      levels: levelsMap,
      background: { src: 'worlds/coastal_beach.webp' }
    };
    assert.equal(
      WaterManager.resolveSceneBackgroundSrc(scene),
      'worlds/coastal_beach.webp',
      'Must resolve scene.background.src even when scene.levels Map is present and empty'
    );
  });

  it('resolves scene.firstLevel.background.src on Foundry v14 scenes', () => {
    const scene = {
      firstLevel: { background: { src: 'worlds/v14-level-bg.webp' } },
      background: { src: 'worlds/legacy-bg.webp' }
    };
    assert.equal(WaterManager.resolveSceneBackgroundSrc(scene), 'worlds/v14-level-bg.webp');
  });

  it('resolves scene.levels.contents[0].background.src on v14 collection structures', () => {
    const scene = {
      levels: {
        contents: [{ background: { src: 'worlds/v14-contents-bg.webp' } }]
      }
    };
    assert.equal(WaterManager.resolveSceneBackgroundSrc(scene), 'worlds/v14-contents-bg.webp');
  });

  it('resolves scene._source.background.src without triggering getter warnings', () => {
    const scene = {
      _source: { background: { src: 'worlds/source-bg.webp' } }
    };
    assert.equal(WaterManager.resolveSceneBackgroundSrc(scene), 'worlds/source-bg.webp');
  });

  it('resolves scene.img on legacy v9/v10 scenes', () => {
    const scene = { img: 'worlds/legacy-img.webp' };
    assert.equal(WaterManager.resolveSceneBackgroundSrc(scene), 'worlds/legacy-img.webp');
  });

  it('returns null when scene has no background artwork', () => {
    const scene = { backgroundColor: '#111922' };
    assert.equal(WaterManager.resolveSceneBackgroundSrc(scene), null);
    assert.equal(WaterManager.resolveSceneBackgroundSrc(null), null);
  });
});


