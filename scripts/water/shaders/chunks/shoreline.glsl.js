export const SHORELINE_CHUNK = `
    // Shoreline boundary wavelets and gentle foam wash
    float computeShoreWaves(float smoothDist, float cornerness, vec2 worldPos, float tWave, float tAnim) {
        if (smoothDist > 55.0) return 0.0;

        float reg = clamp(uWaveRegularity, 0.0, 1.0);

        // 1. Dynamic 2D stretch and shear vector field
        float shearMul = mix(1.0, 0.35, reg);
        vec2 waveStretchVec = vec2(
            sin(worldPos.y * 0.022 + tAnim * 0.45) * 8.5 + cos(worldPos.x * 0.016 - tAnim * 0.35) * 6.5,
            cos(worldPos.x * 0.020 + tAnim * 0.40) * 8.5 - sin(worldPos.y * 0.018 + tAnim * 0.30) * 6.5
        ) * shearMul;
        vec2 stretchedPos = worldPos + waveStretchVec;

        // 2. 2D domain warping
        float warp1 = noise21(stretchedPos / 55.0 + vec2(tAnim * 0.28, -tAnim * 0.22)) - 0.5;
        float warp2 = noise21(stretchedPos / 110.0 - vec2(tAnim * 0.14, tAnim * 0.11) + 23.4) - 0.5;
        float distWarp = (warp1 * 8.0 + warp2 * 13.0) * mix(1.0, 0.40, reg);
        float warpedDist = max(0.0, smoothDist + distWarp);

        // 3. Corner softening: suppresses harsh angles
        float cornerBreak = 1.0 - smoothstep(0.20, 0.70, cornerness) * 0.65;
        float crestTight1 = mix(7.5, 3.8, cornerness);
        float crestTight2 = mix(8.0, 4.0, cornerness);

        // 4. 2D spatial phase offsets: suppresses phase jitter when regularity is high
        float phaseJitterMul = (1.0 - reg * 0.85);
        float pOffset1 = (noise21(stretchedPos / 220.0 + vec2(tAnim * 0.06, -tAnim * 0.04)) - 0.5) * (4.5 * phaseJitterMul);
        float pOffset2 = (noise21(stretchedPos / 150.0 - vec2(tAnim * 0.04, tAnim * 0.07) + 37.8) - 0.5) * (4.5 * phaseJitterMul);

        // Along-shore desynchronization: medium-frequency phase jitter so adjacent
        // wavelet fragments on small bodies lap independently at staggered times
        float lapJitter1 = (noise21(stretchedPos / 55.0 + vec2(-tAnim * 0.06, tAnim * 0.05) + 91.4) - 0.5) * (1.8 * phaseJitterMul);
        float lapJitter2 = (noise21(stretchedPos / 40.0 + vec2(tAnim * 0.07, -tAnim * 0.05) + 57.6) - 0.5) * (1.5 * phaseJitterMul);
        pOffset1 += lapJitter1;
        pOffset2 += lapJitter2;

        // 5. Chunking and tearing: opens gate for continuous bands as regularity increases
        // Breathing oscillation causes emission points to ebb and flow along the shore
        float chunkBreath = sin(tAnim * 0.18) * 0.6;
        float maskNoise1 = noise21((stretchedPos + waveStretchVec * 0.8) / 95.0 + vec2(tAnim * 0.22 + chunkBreath, tAnim * 0.15));
        float mask1 = smoothstep(0.46, 0.74, maskNoise1);

        float chunkNoise1 = noise21((stretchedPos + waveStretchVec * 1.2) / 42.0 + vec2(-tAnim * 0.38 - chunkBreath * 0.7, tAnim * 0.30) + 15.7);
        float chunk1 = smoothstep(0.38, 0.68, chunkNoise1);

        float tearNoise1 = noise21((stretchedPos - waveStretchVec) / 28.0 + vec2(tAnim * 0.45 + chunkBreath * 0.5, -tAnim * 0.35) + 63.1);
        float tear1 = smoothstep(0.32, 0.65, tearNoise1);

        float rawGate1 = mask1 * chunk1 * tear1;
        float regGate = smoothstep(0.65, 0.95, reg) * 0.90;
        float waveGate1 = mix(rawGate1, 1.0, regGate);

        // 6. Wave Set 1: Primary swell packets
        float crestSurge1 = waveGate1 * 0.38;
        float phase1 = warpedDist * 0.042 + tWave * 0.65 + pOffset1 + crestSurge1;
        float s1 = fract(phase1);

        // Crestline travel meander
        float maturity1 = sin(s1 * 3.14159);
        float meander1 = sin(worldPos.x * 0.035 + worldPos.y * 0.028 + tAnim * 1.2 + phase1 * 2.5) * (6.0 * (1.0 - reg * 0.75)) * maturity1;
        float dynamicDist1 = warpedDist + meander1;
        float s1D = fract(dynamicDist1 * 0.042 + tWave * 0.65 + pOffset1 + crestSurge1);

        // Dynamic crest thickness modulation
        float stretchFactor1 = noise21(stretchedPos / 55.0 + vec2(tAnim * 0.16, -tAnim * 0.12));
        float dynTight1 = mix(mix(crestTight1 * 0.65, crestTight1 * 1.35, stretchFactor1), crestTight1, regGate);

        // Aerated crest profile with cellular wash
        float shoreLace1 = 1.0 - smoothstep(0.0, 0.22, voronoiBubbles(stretchedPos * 0.075, tAnim));
        float core1 = pow(max(0.0, 1.0 - abs(s1D - 0.5) * dynTight1), 2.2);
        float wash1 = pow(max(0.0, 1.0 - abs(s1D - 0.5) * 3.2), 1.6) * 0.35 * mix(0.65, 1.35, shoreLace1);
        float microFoam1 = mix(0.70, 1.0, noise21(stretchedPos / 16.0 + tAnim * 0.35));
        float crest1 = (core1 + wash1) * microFoam1 * waveGate1 * cornerBreak;

        // 7. Wave Set 2: Secondary lapping wavelets
        float chunkBreath2 = sin(tAnim * 0.22 + 2.1) * 0.5;
        float maskNoise2 = noise21((stretchedPos - waveStretchVec * 0.6) / 65.0 - vec2(tAnim * 0.18 + chunkBreath2, -tAnim * 0.24) + 47.1);
        float mask2 = smoothstep(0.48, 0.76, maskNoise2);

        float chunkNoise2 = noise21((stretchedPos - waveStretchVec * 1.0) / 36.0 + vec2(tAnim * 0.35 - chunkBreath2 * 0.6, -tAnim * 0.40) + 82.4);
        float chunk2 = smoothstep(0.36, 0.66, chunkNoise2);

        float tearNoise2 = noise21((stretchedPos + waveStretchVec) / 24.0 - vec2(tAnim * 0.42 + chunkBreath2 * 0.4, tAnim * 0.45) + 39.8);
        float tear2 = smoothstep(0.30, 0.62, tearNoise2);

        float rawGate2 = mask2 * chunk2 * tear2;
        float waveGate2 = mix(rawGate2, 1.0, regGate);

        float crestSurge2 = waveGate2 * 0.30;
        float phase2 = (warpedDist + warp1 * 4.0) * 0.065 + tWave * 0.95 + pOffset2 + crestSurge2 + 1.7;
        float s2 = fract(phase2);

        float maturity2 = sin(s2 * 3.14159);
        float meander2 = cos(worldPos.x * 0.040 - worldPos.y * 0.032 - tAnim * 1.4 + phase2 * 2.5) * (4.5 * (1.0 - reg * 0.75)) * maturity2;
        float dynamicDist2 = warpedDist + meander2;
        float s2D = fract((dynamicDist2 + warp1 * 4.0) * 0.065 + tWave * 0.95 + pOffset2 + crestSurge2 + 1.7);

        float stretchFactor2 = noise21(stretchedPos / 45.0 - vec2(tAnim * 0.14, tAnim * 0.18) + 19.3);
        float dynTight2 = mix(mix(crestTight2 * 0.70, crestTight2 * 1.35, stretchFactor2), crestTight2, regGate);

        float shoreLace2 = 1.0 - smoothstep(0.0, 0.22, voronoiBubbles(stretchedPos * 0.085 + 24.3, tAnim));
        float core2 = pow(max(0.0, 1.0 - abs(s2D - 0.5) * dynTight2), 2.2);
        float wash2 = pow(max(0.0, 1.0 - abs(s2D - 0.5) * 3.4), 1.6) * 0.28 * mix(0.65, 1.35, shoreLace2);
        float microFoam2 = mix(0.70, 1.0, noise21(stretchedPos / 15.0 - tAnim * 0.40 + 51.2));
        float crest2 = (core2 + wash2) * microFoam2 * 0.75 * waveGate2 * cornerBreak;

        // 8. Wave Set 3: High-frequency surface ripples
        float phase3 = warpedDist * 0.095 + tWave * 1.20 + pOffset1 * 0.5 + 3.4;
        float s3 = fract(phase3);
        float core3 = pow(max(0.0, 1.0 - abs(s3 - 0.5) * 8.5), 2.2) * 0.16;
        float crest3 = core3 * (waveGate1 * 0.35 + waveGate2 * 0.35) * cornerBreak;

        // 9. Soft constructive combination
        float merged = crest1 + crest2 - crest1 * crest2 * 0.45;
        merged = merged + crest3 * (1.0 - merged * 0.5);

        // 10. Shoaling and depth envelope
        float shoal = 1.0 + (1.0 - smoothstep(4.0, 28.0, smoothDist)) * uWaveShoaling;
        float shoreZone = smoothstep(3.0, 9.0, smoothDist) * (1.0 - smoothstep(14.0, 48.0, smoothDist));

        float waveFoam = merged * shoreZone * shoal * uWaveSegment;

        // 11. Waterline contact wash
        float edgeNoise = noise21(stretchedPos / 70.0 - vec2(tAnim * 0.07, -tAnim * 0.05));
        float edgeChunk = smoothstep(0.35, 0.65, noise21(stretchedPos / 30.0 + vec2(tAnim * 0.12, -tAnim * 0.10) + 77.3));
        float edgeMask = smoothstep(0.40, 0.72, edgeNoise) * edgeChunk;
        float edgeWash = (1.0 - smoothstep(0.0, 6.0, smoothDist)) * edgeMask * 0.35;
        float edgePulse = sin(stretchedPos.x * 0.018 + stretchedPos.y * 0.022 - tAnim * 1.6) * 0.5 + 0.5;
        float edgeFoam = edgeWash * (0.5 + 0.5 * edgePulse) * mix(1.0, 0.5, cornerness);

        return waveFoam + edgeFoam;
    }
`;
