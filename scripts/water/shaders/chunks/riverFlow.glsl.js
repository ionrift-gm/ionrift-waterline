export const RIVER_FLOW_CHUNK = `
    // ═══════════════════════════════════════════════════════════════════════════════
    // RIVER SHADER STRATEGIES
    // ═══════════════════════════════════════════════════════════════════════════════
    // STRATEGY 1 (ACTIVE): Babbling River Bumps & Dips
    // ═══════════════════════════════════════════════════════════════════════════════

    void evalBumpDipLayer(
        vec2 streamPos, vec2 cellSize, float tVal, float layerScale,
        float regularity, float speedMult, float seedOffset,
        inout float sumElev, inout vec2 sumGrad
    ) {
        vec2 cellId = floor(streamPos / cellSize);

        for (int dy = -1; dy <= 1; dy++) {
            for (int dx = -1; dx <= 1; dx++) {
                vec2 cId = cellId + vec2(float(dx), float(dy));

                // Stable per-cell clock so lifecycle boundaries are continuous, but re-seed shape/position every cycle
                vec2 r0 = hash22(cId * 23.17 + vec2(11.3 + seedOffset, 67.9));
                float period = mix(1.05, 2.15, r0.x);
                float phase = r0.y * 6.28318;
                float clockTime = tVal * mix(0.82, 1.24, r0.y) * speedMult + phase;
                float cycleIdx = floor(clockTime / period);
                float tau = fract(clockTime / period);

                // Brief active wave-boil lifespan with rest gap so no wavelet persists across the screen
                float lifeEnv = smoothstep(0.02, 0.28, tau) * (1.0 - smoothstep(0.44, 0.78, tau));
                if (lifeEnv <= 0.001) continue;

                // Cycle-indexed seeds: every new boil in this cell respawns at a fresh anchor, angle, and polarity
                vec2 cSeed = cId + vec2(cycleIdx * 7.13, cycleIdx * 13.79);
                vec2 r1 = hash22(cSeed * 19.37 + vec2(17.1 + seedOffset, 73.3));
                vec2 r2 = hash22(cSeed * 37.81 + vec2(53.2, 19.7 + seedOffset));
                vec2 r3 = hash22(cSeed * 41.13 + vec2(31.4 + seedOffset, 89.1));

                // Stagger alternate rows to eliminate Cartesian grid alignment (centered to prevent asymmetric reach)
                float rowStagger = (mod(abs(cId.y), 2.0) - 0.5) * (cellSize.x * 0.25);

                // Jittered anchor inside cell (strictly bounded to ensure 3x3 search coverage)
                vec2 jitter = (r1 - 0.5) * cellSize * (0.22 * mix(0.70, 0.20, regularity));
                vec2 anchor = (cId + 0.5) * cellSize + vec2(rowStagger + jitter.x, jitter.y);

                // Independent drift velocity: each bump drifts at its own speed (no rigid conveyor)
                float driftSpeed = mix(0.78, 1.22, r2.x) * speedMult;

                // Individual boil surge & lateral eddy wander during its brief lifespan (bounded within 3x3 search)
                float driftDist = (tau - 0.40) * cellSize.x * (0.22 * mix(0.35, 0.70, r2.y));
                float latWander = (tau - 0.40) * (r2.x - 0.5) * cellSize.y * 0.20;
                vec2 center = anchor + vec2(driftDist, latWander);

                // Polarity & Variance: positive = bump (mound), negative = dip (depression)
                float polarity = (r2.y > 0.44) ? 1.0 : -0.85;
                float amp = mix(0.55, 1.10, r3.y) * polarity * lifeEnv;

                // Streamline aspect ratio
                float aspect = mix(1.05, 1.42, r1.x);
                float radU = cellSize.x * 0.44 * aspect * layerScale;
                float radV = cellSize.y * 0.46 * layerScale;

                // Organic diagonal/chevron tilt angle
                float tilt = (r3.x - 0.5) * 0.62 * (1.0 - regularity * 0.4);
                float cT = cos(tilt);
                float sT = sin(tilt);

                vec2 dPos = streamPos - center;
                float du = dPos.x * cT - dPos.y * sT;
                float dv = dPos.x * sT + dPos.y * cT;

                // Smooth asymmetric streamline profile: C1 smooth transition across du = 0
                float wakeMask = smoothstep(-0.25 * radU, 0.25 * radU, du);
                float uScaleSide = radU * mix(0.84, 1.18, wakeMask);

                // Chevron V-wake curvature so boils form fluid crescents/tongues rather than round buttons
                float parabolicWake = mix(0.24, 0.46, r2.x) * wakeMask * ((dv * dv) / max(1.0, radV));
                float duCurved = du - parabolicWake;

                float uNorm = duCurved / max(1.0, uScaleSide);
                float vNorm = dv / max(1.0, radV);
                float r2Val = uNorm * uNorm + vNorm * vNorm;

                if (r2Val < 1.0) {
                    // Smooth Mexican-hat style bump-and-dip kernel
                    // K(r) = (1 - 2.0 * r^2) * (1 - r^2)^2
                    float om_r2 = 1.0 - r2Val;
                    float kernel = (1.0 - 2.0 * r2Val) * om_r2 * om_r2;

                    float dK_dr2 = om_r2 * (-4.0 + 6.0 * r2Val);

                    float dr2_du = 2.0 * uNorm / uScaleSide;
                    float dr2_dv = 2.0 * vNorm / radV;

                    float dk_du = dK_dr2 * dr2_du;
                    float dk_dv = dK_dr2 * dr2_dv;

                    float dK_dx = dk_du * cT + dk_dv * sT;
                    float dK_dy = -dk_du * sT + dk_dv * cT;

                    sumElev += amp * kernel;
                    sumGrad += amp * vec2(dK_dx, dK_dy);
                }
            }
        }
    }

    void computeBabblingRiverWaves(
        vec2 worldPos, vec2 flow, float signedDist, float tWave, float tAnim,
        out float riverFoam,
        out vec2 riverDisplacement,
        out vec3 riverNormal,
        out float riverGlint
    ) {
        vec2 flowPerp = vec2(-flow.y, flow.x);

        // 1. Bank Boundary Friction & Velocity Drag
        float bankDragDist = max(uBankDrag, 25.0);
        float bankDistNorm = clamp(signedDist / bankDragDist, 0.0, 1.0);
        float bankFactor = mix(0.30, 1.0, smoothstep(0.0, 1.0, bankDistNorm));

        // Parabolic mid-channel velocity bowing (static spatial offset, no runaway time shear)
        float centerDrift = (1.0 - bankDistNorm * bankDistNorm) * 9.0;

        // Organic fluid eddy warp (breaks up global linear uniformity)
        vec2 eddyWarp = vec2(
            sin(worldPos.y * 0.030 + tAnim * 0.35) + cos(worldPos.x * 0.020 - tAnim * 0.28),
            cos(worldPos.x * 0.026 + tAnim * 0.32) - sin(worldPos.y * 0.020 + tAnim * 0.28)
        ) * (6.5 * (1.0 - uWaveRegularity * 0.5));
        vec2 warpedPos = worldPos + eddyWarp;

        // Stream coordinates: u along flow, v perpendicular
        float uProg = dot(warpedPos, flow) - centerDrift;
        float vLat  = dot(warpedPos, flowPerp);

        // Differential layer advection: each scale travels at a distinct speed with cross-stream meander
        // so layers continuously shear through one another rather than riding a single conveyor belt
        float baseDrift = tWave * 36.0;
        float uDrift = uProg - baseDrift;
        float vMeander1 = sin(uProg * 0.018 - tAnim * 0.65) * 4.5;
        vec2 streamPos = vec2(uDrift, vLat + vMeander1);

        float scaleFactor = clamp(uScale / 45.0, 0.5, 2.0);

        // ─── BABBLING RIVER BUMPS & DIPS DENSE MULTI-SCALE EVALUATION ───
        float sumElev = 0.0;
        vec2 sumGrad = vec2(0.0);

        // LAYER 1: Macro Bumps & Dips (Broad water mounds and stone boils, 36 px/s)
        vec2 cell1 = vec2(42.0, 28.0) * scaleFactor;
        evalBumpDipLayer(
            streamPos, cell1, tWave, scaleFactor,
            uWaveRegularity, 1.0, 0.0,
            sumElev, sumGrad
        );

        // LAYER 2: Meso Babbling Ripples (Faster 52 px/s + opposing lateral meander, rotated +24 deg)
        float rotA = 0.42;
        float cA = cos(rotA); float sA = sin(rotA);
        vec2 mesoBase = vec2(uProg - tWave * 52.0, vLat - cos(uProg * 0.024 + tAnim * 0.85) * 4.0);
        vec2 streamPos2 = vec2(mesoBase.x * cA - mesoBase.y * sA, mesoBase.x * sA + mesoBase.y * cA);
        vec2 cell2 = vec2(26.0, 18.0) * scaleFactor;
        float mesoElev = 0.0;
        vec2 mesoGradRot = vec2(0.0);
        evalBumpDipLayer(
            streamPos2, cell2, tWave, scaleFactor * 0.85,
            uWaveRegularity, 1.25, 37.19,
            mesoElev, mesoGradRot
        );
        vec2 mesoGrad = vec2(mesoGradRot.x * cA + mesoGradRot.y * sA, -mesoGradRot.x * sA + mesoGradRot.y * cA);

        sumElev += mesoElev * 0.65;
        sumGrad += mesoGrad * 0.65;

        // LAYER 3: High-frequency capillary ripples (Brisk 66 px/s surface chatter, rotated -18 deg)
        float rotB = -0.31;
        float cB = cos(rotB); float sB = sin(rotB);
        vec2 microBase = vec2(uProg - tWave * 66.0, vLat + sin(uProg * 0.032 + tAnim * 1.10) * 3.2);
        vec2 streamPos3 = vec2(microBase.x * cB - microBase.y * sB, microBase.x * sB + microBase.y * cB);
        vec2 cell3 = vec2(16.0, 12.0) * scaleFactor;
        float microElev = 0.0;
        vec2 microGradRot = vec2(0.0);
        evalBumpDipLayer(
            streamPos3 + vec2(17.3, 43.1), cell3, tWave, scaleFactor * 0.70,
            uWaveRegularity, 1.45, 83.41,
            microElev, microGradRot
        );
        vec2 microGrad = vec2(microGradRot.x * cB + microGradRot.y * sB, -microGradRot.x * sB + microGradRot.y * cB);

        sumElev += microElev * 0.35;
        sumGrad += microGrad * 0.35;

        // ─── AMBIENT STREAM UNDULATION & BABBLING CROSS-RIPPLES ───
        vec2 crossDir1 = normalize(flow + flowPerp * 0.32);
        vec2 crossDir2 = normalize(flow - flowPerp * 0.32);
        float ambPhase1 = dot(warpedPos, crossDir1) * 0.085 - tWave * 2.4;
        float ambPhase2 = dot(warpedPos, crossDir2) * 0.095 - tWave * 2.6 + 1.7;
        float ambPhase3 = dot(warpedPos, flow) * 0.160 - tWave * 3.2;

        float ambRipple = sin(ambPhase1) * 0.14 + cos(ambPhase2) * 0.12 + sin(ambPhase3) * 0.06;
        vec2 ambRippleGrad = (
            crossDir1 * cos(ambPhase1) * (0.14 * 0.085) -
            crossDir2 * sin(ambPhase2) * (0.12 * 0.095) +
            flow * cos(ambPhase3) * (0.06 * 0.160)
        );
        sumElev += ambRipple;
        sumGrad += ambRippleGrad;

        // ─── NON-ADDITIVE BOUNDED SATURATION (NO AMPLITUDE DOUBLING) ───
        float kSat = 0.80;
        float denom = sqrt(1.0 + kSat * sumElev * sumElev);
        float riverElevation = sumElev / denom;

        // Analytical gradient dampening via chain rule: dH/dx = dS/dx / denom^3
        float denom3 = denom * denom * denom;
        vec2 boundedGrad = sumGrad / denom3;

        // Map gradient to world space and modulate by bankFactor
        const float kSlopeGain = 14.0;
        vec2 worldGrad = (flow * boundedGrad.x + flowPerp * boundedGrad.y) * (kSlopeGain * uRiverWaves * bankFactor);

        // Surface normal: smooth, stable, physically bounded
        riverNormal = normalize(vec3(-clamp(worldGrad, vec2(-0.75), vec2(0.75)) * 1.8, 1.0));

        // ─── SUN SPECULAR GLINTS (pinpoint facet sparkles on tilted slopes, never flat glossy caps) ───
        float steepness = length(worldGrad);
        vec3 sunDir = normalize(vec3(flow * 0.35 + vec2(-0.25, 0.45), 0.88));
        vec3 halfVec = normalize(sunDir + vec3(0.0, 0.0, 1.0));
        float NdotH = max(0.0, dot(riverNormal, halfVec));
        float facetSlopeMask = smoothstep(0.16, 0.48, steepness);
        float glintSparkle = smoothstep(0.42, 0.82, noise21(vec2(uProg - tWave * 40.0, vLat) * 0.14 + vec2(tAnim * 0.7, -tAnim * 0.5)));

        riverGlint = (pow(NdotH, 64.0) * 0.90 + pow(NdotH, 28.0) * 0.22 * glintSparkle)
            * facetSlopeMask
            * smoothstep(0.04, 0.36, riverElevation)
            * (1.15 * uSunGlint * uRiverWaves);

        // ─── ORGANIC EMERGENT RIFFLE & FLUID WHITEWATER WISPS ───
        // Combine slope gate with hydraulic pitching face & crest cap so bumps never form hollow rings
        float slopeGate = smoothstep(0.08, 0.35, steepness);
        float hydraulicPitch = dot(-worldGrad, flow);
        float directionalFace = smoothstep(-0.08, 0.28, hydraulicPitch + riverElevation * 0.36);
        float crestCap = smoothstep(0.20, 0.50, riverElevation);
        float crestPresence = smoothstep(0.18, 0.48, riverElevation) * mix(slopeGate, max(slopeGate, crestCap * 0.85), 0.68) * directionalFace;
        float rifflePresence = smoothstep(0.24, 0.58, steepness) * smoothstep(0.08, 0.38, riverElevation) * directionalFace;

        // Emergent macro riffle clustering: calm water dominates, whitewater emerges in intermittent rapid pockets
        vec2 riffleZoneUv = (vec2(uProg - tWave * 28.0, vLat * 1.30) + eddyWarp * 1.2) / (58.0 * scaleFactor);
        float rz1 = noise21(riffleZoneUv + vec2(tAnim * 0.14, -tAnim * 0.11));
        float rz2 = noise21(riffleZoneUv * 2.15 - vec2(tAnim * 0.19, tAnim * 0.15) + 31.7);
        float zoneEnergy = rz1 * 0.60 + rz2 * 0.40;
        float riffleCluster = mix(0.08, 1.02, smoothstep(0.36, 0.78, zoneEnergy));

        float rawFoamEnv = max(crestPresence, rifflePresence * 0.45) * riffleCluster;
        float baseFoam = 0.0;
        if (rawFoamEnv > 0.005 && uWhitecaps > 0.001) {
            // Purely fluid, non-cellular whitewater wisps warped by the local wave slope and eddy swirl
            // Differential advection and rapid temporal churn prevent any fixed or regular pattern
            vec2 slopeWarp = vec2(dot(worldGrad, flow), dot(worldGrad, flowPerp)) * 16.0;
            vec2 wispCoord1 = vec2((uProg - tWave * 52.0) * 0.055, vLat * 0.19) + eddyWarp * 0.06 + slopeWarp * 0.08;
            vec2 wispCoord2 = vec2((uProg - tWave * 34.0) * 0.115, vLat * 0.34) - eddyWarp * 0.05 - slopeWarp * 0.10;
            float streak1 = noise21(wispCoord1 + vec2(tAnim * 0.42, -tAnim * 0.31));
            float streak2 = noise21(wispCoord2 - vec2(tAnim * 0.55, tAnim * 0.38) + 19.4);
            float churnFlicker = noise21(vec2((uProg - tWave * 44.0) * 0.18, vLat * 0.24) + slopeWarp * 0.12 + vec2(-tAnim * 0.75, tAnim * 0.62) + 47.1);

            float filamentWeb = smoothstep(0.28, 0.76, streak1 * 0.48 + streak2 * 0.32 + churnFlicker * 0.20);
            float fluidWisp = mix(0.28, 0.86, filamentWeb) * (0.65 + 0.35 * smoothstep(0.25, 0.80, churnFlicker));

            baseFoam = rawFoamEnv * fluidWisp * 0.76;
        }

        float foam = baseFoam * (0.22 + 1.55 * uWhitecaps) * uRiverWaves;
        riverFoam = clamp(foam, 0.0, 0.96);

        // Suppress abruptly at the exact waterline so waves do not spill awkwardly onto dry bank
        riverFoam *= smoothstep(3.0, 20.0, signedDist);

        // Micro-refraction displacement
        riverDisplacement = (-worldGrad) * (uDistortion * 1.5 * uRiverWaves);
    }

    // Active River Wave Dispatch
    void computeRiverWaves(
        vec2 worldPos, vec2 flow, float signedDist, float tWave, float tAnim,
        out float riverFoam,
        out vec2 riverDisplacement,
        out vec3 riverNormal,
        out float riverGlint
    ) {
        if (uRiverWaves <= 0.001) {
            riverFoam = 0.0;
            riverDisplacement = vec2(0.0);
            riverNormal = vec3(0.0, 0.0, 1.0);
            riverGlint = 0.0;
            return;
        }

        // Active Strategy: Babbling River (Bumps & Dips)
        computeBabblingRiverWaves(
            worldPos, flow, signedDist, tWave, tAnim,
            riverFoam, riverDisplacement, riverNormal, riverGlint
        );
    }

    // Strategy wrapper: populates ArchetypeResult from river wave physics
    void applyRiverArchetype(vec2 pos, vec2 flow, float waterReach, float tWave, float tAnim, inout ArchetypeResult ar) {
        float rFoam; vec2 rDisp; vec3 rNorm; float rGlint;
        computeRiverWaves(pos, flow, waterReach, tWave, tAnim,
            rFoam, rDisp, rNorm, rGlint);
        ar.foam = max(ar.foam, rFoam);
        ar.displacement += rDisp * 0.70;
        ar.glint += rGlint;
        ar.normal = rNorm;
        float slopeMag = length(vec2(rNorm.x, rNorm.y));
        ar.elevation = max(ar.elevation, rFoam * 0.22 + slopeMag * 0.14);
    }
`;
