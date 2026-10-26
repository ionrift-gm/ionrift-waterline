export const OCEAN_CHOP_CHUNK = `
    // Evaluates localized wave breaker energy and foam patch morphology
    vec2 evalPatchCoreEnergy(
        vec2 p, vec2 center, float age, float patchScale,
        float expandRate, float pinchRate, vec4 clumpSeed, float t,
        vec2 waveDir, float waveAtClump
    ) {
        float a = clamp(age, 0.0, 1.0);

        // Lifecycle envelopes: advancing front forms crisply first; trailing wake unspools behind it
        float frontBirth = smoothstep(0.0, 0.08, a);
        float bodyBirth = smoothstep(0.05, 0.22, a);
        float bodyDeath = 1.0 - smoothstep(0.68, 0.98, a);
        float bodyLife = bodyBirth * bodyDeath;

        float expandSpeed = max(0.0, 1.0 - a / 0.58);
        float crestSpeed = max(expandSpeed, waveAtClump * 0.85);

        // Subside active surge as wave completes its forward roll
        float speedFactor = smoothstep(0.10, 0.45, crestSpeed);
        float lateDeathStart = mix(0.42, 0.68, speedFactor);
        float lateDeathEnd = mix(0.58, 0.90, speedFactor);
        float activeCrest = 1.0 - smoothstep(lateDeathStart, lateDeathEnd, a);

        float minimalFloor = 0.14 * bodyDeath;
        float speedGatedDeath = mix(minimalFloor, 1.0, activeCrest);

        float lateStage = smoothstep(0.38, 0.55, a);
        float normalDeath = 1.0 - smoothstep(0.58, 0.90, a);
        float frontDeath = mix(normalDeath, speedGatedDeath, lateStage);
        float frontLife = frontBirth * frontDeath;

        float crestActivity = frontLife * mix(1.0, speedFactor, lateStage);

        if (frontLife <= 0.0001 && bodyLife <= 0.0001) return vec2(0.0);

        float cohesionRelax = 1.0 + 0.28 * smoothstep(0.28, 0.88, a);
        float scaleMul = clamp(patchScale / 75.0, 0.60, 2.50);

        // Wave crest ridge alignment with static per-wave aspect ratio (no periodic fattening/thinning)
        vec2 waveTan = vec2(-waveDir.y, waveDir.x);
        vec2 deltaP = p - center;
        float acrossDist = dot(deltaP, waveDir);
        float alongDist = dot(deltaP, waveTan);

        float waveAspect = mix(0.85, 1.18, clumpSeed.w);
        vec2 waveShapedP = center + waveDir * acrossDist + waveTan * (alongDist / waveAspect);

        float distToCluster = length(waveShapedP - center);
        float clusterFade = 1.0 - smoothstep(patchScale * 2.1, patchScale * 2.8, distToCluster);
        if (clusterFade <= 0.001) return vec2(0.0);

        // Fluid domain perturbation
        vec2 turbWarp = vec2(
            noise21((waveShapedP - center) * 0.016 + vec2(t * 0.03, -t * 0.02)) - 0.5,
            noise21((waveShapedP - center) * 0.016 - vec2(-t * 0.02, t * 0.03) + 41.3) - 0.5
        ) * 3.0;
        vec2 warpedP = waveShapedP + turbWarp;

        float bNoise = (noise21(warpedP * 0.020 + clumpSeed.xy * 23.7 + vec2(a * 0.10, -a * 0.06)) - 0.5) * 0.15;
        vec2 dpStart = warpedP - center;
        float xProg = dot(dpStart, waveDir);
        float yLat = dot(dpStart, waveTan);

        float lateralGrowth = mix(0.76, 1.0, smoothstep(0.0, 0.25, a));
        float crestWidth = patchScale * mix(0.55, 0.88, clumpSeed.z) * lateralGrowth;
        float bowAmp = crestWidth * mix(0.18, 0.28, clumpSeed.x);

        // Continuous, effortless forward roll: breaking crest advances while trailing foam wake lingers behind
        float rollProgress = mix(a, pow(a, 0.74), 0.55);
        float frontDist = patchScale * mix(1.25, 1.85, clumpSeed.z) * rollProgress;

        float w0 = 6.0 * scaleMul;
        float rearFollow = patchScale * mix(0.0, 0.30, smoothstep(0.22, 0.92, a));
        float xRear = rearFollow - w0;

        float lipWiggle = (noise21(vec2(yLat * 0.08, t * 0.18) + clumpSeed.xy * 17.1) - 0.5) * 2.4;
        float totalSpan = max(frontDist - xRear, 8.0);
        float wakeT = clamp((frontDist - xProg) / totalSpan, 0.0, 1.0);
        float localWidth = crestWidth * mix(0.88, 1.12, wakeT);
        float sY = clamp(abs(yLat) / max(localWidth, 0.001), 0.0, 1.0);
        float lateralMask = pow(max(0.0, 1.0 - sY * sY), 1.35);

        float xLip = frontDist - (sY * sY) * bowAmp + lipWiggle;
        float distAhead = xProg - xLip;

        float frontWarp = (noise21(warpedP * 0.045 + vec2(t * 0.02, -t * 0.015) + clumpSeed.xy * 19.3) - 0.5) * 2.8;
        float frontMicro = (noise21(warpedP * 0.11 + clumpSeed.zw * 31.7) - 0.5) * 1.4;
        float effDistAhead = distAhead + frontWarp + frontMicro;

        // Advancing wave front lip: crisp asymmetric leading edge + O(1) dripping spray droplets
        float frontLip = 0.0;
        if (frontLife > 0.001) {
            float crestPower = clamp(mix(speedFactor, 1.0, 1.0 - lateStage), 0.0, 1.0);
            float lipAhead = mix(2.8, 5.2, clumpSeed.z) * scaleMul * mix(0.65, 1.0, crestPower);
            float lipBehind = mix(7.5, 13.5, clumpSeed.z) * scaleMul * mix(0.55, 1.0, crestPower);
            float lipThick = (effDistAhead >= 0.0) ? lipAhead : lipBehind;
            float distToLip = abs(effDistAhead);

            float lipBand = smoothstep(lipThick, 0.3, distToLip);
            if (lipBand > 0.001) {
                float solidCore = smoothstep(lipThick * 0.58, 0.0, distToLip) * mix(0.45, 0.98, crestPower);
                float crestTex = noise21(warpedP * 0.14 + clumpSeed.xy * 13.7 + t * 0.06) * 0.60
                    + noise21(warpedP * 0.30 - clumpSeed.zw * 19.1 - t * 0.08) * 0.40;
                float crestBeads = smoothstep(0.28, 0.76, crestTex);
                frontLip = lipBand * (solidCore * (0.68 + 0.32 * crestBeads) + crestBeads * 0.72);
            }

            // Fast O(1) 3-layer lane-indexed spray droplets: proportional to wave speed & scale, gentle detachment
            float sprayParticles = 0.0;
            float sprayAgeEnv = smoothstep(0.03, 0.12, a) * (1.0 - smoothstep(0.36, 0.60, a));
            float scaleFactor = smoothstep(36.0, 130.0, patchScale);
            float speedNorm = clamp(expandRate * mix(0.55, 1.30, clamp(uSpeed, 0.0, 2.0)) * mix(0.65, 1.15, waveAtClump), 0.20, 1.65);
            float sprayBudget = clamp(scaleFactor * mix(0.30, 1.15, speedNorm), 0.04, 1.0);

            if (distAhead > -9.0 * scaleMul && distAhead < 14.0 * scaleMul && abs(yLat) < crestWidth * 1.18 && sprayAgeEnv > 0.01 && sprayBudget > 0.05) {
                for (int layer = 0; layer < 3; layer++) {
                    float fl = float(layer);
                    float layerGate = smoothstep(fl * 0.22 + 0.04, fl * 0.26 + 0.28, sprayBudget);
                    if (layerGate <= 0.01) continue;

                    float laneSpacing = mix(9.0, 13.5, fl * 0.5) * scaleMul;
                    float yShifted = yLat + fl * 4.3 * scaleMul + clumpSeed.x * 29.0;
                    float laneIdx = floor(yShifted / laneSpacing);
                    float laneLocalY = (fract(yShifted / laneSpacing) - 0.5) * laneSpacing;

                    vec2 laneHash = hash22(vec2(laneIdx * 13.37 + fl * 29.1, clumpSeed.y * 53.7 + clumpSeed.z * 19.3));
                    float dropFreq = mix(0.85, 1.45, laneHash.x) * mix(0.75, 1.15, speedNorm);
                    float pTime = t * dropFreq + laneHash.y * 6.28318 + a * 0.65;
                    float cycle = floor(pTime);
                    float tau = fract(pTime);

                    vec2 cHash = hash22(vec2(laneIdx * 23.1 + cycle * 41.7, fl * 17.9 - cycle * 13.3 + clumpSeed.w * 37.0));
                    vec2 cHash2 = hash22(vec2(cycle * 31.3 - laneIdx * 19.7, fl * 43.1 + clumpSeed.x * 61.7));

                    // Brief indicative visibility window without accelerating particle velocity
                    float liveSpan = mix(0.45, 0.65, cHash2.y);
                    if (tau > liveSpan) continue;

                    // Spawn density proportional to wave scale and speed
                    float spawnProb = mix(0.10, 0.78, sprayBudget) * mix(1.0, 0.65, fl * 0.5);
                    float activeMask = step(1.0 - spawnProb, cHash.x) * layerGate;

                    // Majority (~66%) pitch forward with angular jitter; ~34% scatter any which way (sideways/diagonal/back)
                    float isWild = step(0.66, cHash2.x);
                    float fwdAngle = (cHash2.y - 0.5) * 1.65;
                    float wildAngle = (cHash2.y - 0.5) * 6.28318;
                    float ejectAngle = mix(fwdAngle, wildAngle, isWild);
                    vec2 ejectDir = vec2(cos(ejectAngle), sin(ejectAngle));

                    // Gentle, short-range drip/pop proportional to wave speed (never shoots off like bullets)
                    float maxThrow = mix(2.0, mix(5.0, 7.8, step(0.5, fl)), cHash.y) * scaleMul * mix(0.45, 1.0, speedNorm) * mix(0.55, 1.0, crestActivity) * mix(1.0, 0.58, isWild);
                    float driftProgress = smoothstep(0.0, 0.82, tau);
                    float pDist = maxThrow * driftProgress;

                    float originFwd = (fract(cHash2.x * 7.3) - 0.55) * 2.4 * scaleMul;
                    float originLat = (fract(cHash.x * 9.1) - 0.5) * laneSpacing * 0.35;
                    float pFwd = originFwd + ejectDir.x * pDist;
                    float pLat = clamp(originLat + ejectDir.y * pDist, -laneSpacing * 0.42, laneSpacing * 0.42);

                    vec2 relP = vec2(distAhead - pFwd, laneLocalY - pLat);
                    float dx = dot(relP, ejectDir) / (1.08 * scaleMul);
                    float dy = dot(relP, vec2(-ejectDir.y, ejectDir.x)) / (0.92 * scaleMul);
                    float d2 = dx * dx + dy * dy;

                    float pLife = smoothstep(0.0, 0.12, tau) * (1.0 - smoothstep(liveSpan * 0.45, liveSpan, tau));
                    float dropR2 = mix(0.38, 0.68, fl * 0.5);
                    float pDrop = exp(-d2 * dropR2) * pLife * activeMask;
                    sprayParticles += pDrop * mix(1.15, 0.85, fl * 0.5);
                }
            }
            frontLip += sprayParticles * 1.35 * sprayAgeEnv * mix(0.55, 1.0, sprayBudget);
            frontLip *= lateralMask * frontLife;
        }

        // Trailing wake foam body: unspools behind the advancing lip
        float e0_body = 0.0;
        if (bodyLife > 0.001) {
            if (effDistAhead <= 0.0) {
                float dBehind = -effDistAhead;
                float rearSkirt = mix(38.0, 58.0, clumpSeed.w) * scaleMul;
                float rearStart = max(totalSpan * 0.55, totalSpan - 20.0 * scaleMul);
                float rearFade = 1.0;
                if (dBehind > rearStart - 16.0) {
                    float rearWarp = (noise21(warpedP * 0.032 + vec2(t * 0.025, -t * 0.02) + clumpSeed.xy * 29.1) - 0.5) * 12.0;
                    float microFringe = (noise21(warpedP * 0.095 + clumpSeed.zw * 13.5 + vec2(-t * 0.01, t * 0.015)) - 0.5) * 4.0;
                    float effectiveDBehind = dBehind + rearWarp + microFringe;
                    if (effectiveDBehind > rearStart) {
                        float sRear = clamp((effectiveDBehind - rearStart) / max(rearSkirt, 1.0), 0.0, 1.0);
                        rearFade = pow(max(0.0, 1.0 - sRear), 2.0);
                    }
                }
                float wakeAging = mix(1.0, 0.28, smoothstep(0.08, 0.85, wakeT)) * mix(1.0, 0.60, smoothstep(0.42, 0.90, a));
                e0_body = rearFade * wakeAging * lateralMask * bodyLife;
            } else {
                float frontSkirt = mix(3.2, 5.5, clumpSeed.z) * scaleMul;
                float sFront = clamp(effDistAhead / max(frontSkirt, 0.5), 0.0, 1.0);
                float frontSlope = pow(max(0.0, 1.0 - sFront), 2.2);
                e0_body = frontSlope * lateralMask * bodyLife * 0.65;
            }
        }

        // Satellite breakaways: rare, late-stage, elongated/curved wake wisps (never regular circles)
        vec2 satSeed = hash22(clumpSeed.xy * 41.3 + clumpSeed.zw * 19.7);
        float satLife = smoothstep(0.24, 0.46, a) * (1.0 - smoothstep(0.66, 0.94, a));
        float sat1Active = step(0.74, satSeed.x);
        float sat2Active = step(0.80, satSeed.y);
        float sat3Active = step(0.84, fract(satSeed.x * 3.7 + satSeed.y * 5.3));

        float e1 = 0.0;
        float e2 = 0.0;
        float e3 = 0.0;
        if (satLife > 0.001 && (sat1Active + sat2Active + sat3Active) > 0.5) {
            float satCarve = (noise21(warpedP * 0.048 + clumpSeed.zw * 17.3 + t * 0.02) - 0.5) * 0.48
                + (noise21(warpedP * 0.115 - clumpSeed.xy * 29.1 - t * 0.03) - 0.5) * 0.28;
            float satSpread = 1.0 + 0.22 * smoothstep(0.32, 0.88, a);

            if (sat1Active > 0.5) {
                float dist1 = crestWidth * mix(0.38, 0.78, satSeed.y) * satSpread;
                float alongWake1 = frontDist * mix(0.18, 0.58, clumpSeed.w);
                vec2 c1 = center + waveDir * alongWake1 + waveTan * dist1;
                vec2 dp1 = warpedP - c1;
                float ang1 = (satSeed.x - 0.5) * 1.25;
                vec2 sDir1 = waveTan * cos(ang1) + waveDir * sin(ang1);
                vec2 sPerp1 = vec2(-sDir1.y, sDir1.x);
                float u1 = dot(dp1, sDir1) / (patchScale * mix(0.26, 0.40, clumpSeed.z) * cohesionRelax);
                float v1 = (dot(dp1, sPerp1) - (u1 * u1) * patchScale * 0.09) / (patchScale * mix(0.10, 0.16, satSeed.y));
                float d1 = sqrt(u1 * u1 + v1 * v1) + satCarve;
                e1 = pow(clamp(1.0 - d1, 0.0, 1.0), 2.1) * 0.58 * satLife;
            }

            if (sat2Active > 0.5) {
                float dist2 = -crestWidth * mix(0.36, 0.76, satSeed.x) * satSpread;
                float alongWake2 = frontDist * mix(0.22, 0.62, clumpSeed.z);
                vec2 c2 = center + waveDir * alongWake2 + waveTan * dist2;
                vec2 dp2 = warpedP - c2;
                float ang2 = (satSeed.y - 0.5) * 1.25;
                vec2 sDir2 = waveTan * cos(ang2) - waveDir * sin(ang2);
                vec2 sPerp2 = vec2(-sDir2.y, sDir2.x);
                float u2 = dot(dp2, sDir2) / (patchScale * mix(0.24, 0.38, clumpSeed.w) * cohesionRelax);
                float v2 = (dot(dp2, sPerp2) + (u2 * u2) * patchScale * 0.08) / (patchScale * mix(0.09, 0.15, satSeed.x));
                float d2 = sqrt(u2 * u2 + v2 * v2) + satCarve;
                e2 = pow(clamp(1.0 - d2, 0.0, 1.0), 2.1) * 0.55 * satLife;
            }

            if (sat3Active > 0.5) {
                float dist3 = (satSeed.x - 0.5) * crestWidth * 0.85;
                vec2 c3 = center + waveDir * (rearFollow * 0.6 + frontDist * 0.15) + waveTan * dist3;
                vec2 dp3 = warpedP - c3;
                float u3 = dot(dp3, waveTan) / (patchScale * mix(0.22, 0.34, clumpSeed.x) * cohesionRelax);
                float v3 = (dot(dp3, waveDir) - (u3 * u3) * patchScale * 0.07) / (patchScale * mix(0.09, 0.14, clumpSeed.y));
                float d3 = sqrt(u3 * u3 + v3 * v3) + satCarve * 1.1;
                e3 = pow(clamp(1.0 - d3, 0.0, 1.0), 2.1) * 0.52 * satLife;
            }
        }

        float coreEnergy = (max(e0_body, frontLip * 0.55) + (e1 + e2 + e3)) * clusterFade;
        return vec2(coreEnergy, frontLip * clusterFade);
    }

    // Open sea swell simulation, cross-chop, normals, whitecaps, and cellular foam clumps
    void computeChoppyOcean(
        vec2 worldPos, vec2 flow, float tWave, float tAnim,
        out float oceanFoam,
        out float undercurrentFoam,
        out float aeratedBase,
        out float crestBody,
        out vec2 waveDisplacement,
        out vec3 oceanNormal,
        out float oceanGlint,
        out float troughShadow
    ) {
        if (uChoppySeas <= 0.001) {
            oceanFoam = 0.0;
            undercurrentFoam = 0.0;
            aeratedBase = 0.0;
            crestBody = 0.0;
            waveDisplacement = vec2(0.0);
            oceanNormal = vec3(0.0, 0.0, 1.0);
            oceanGlint = 0.0;
            troughShadow = 1.0;
            return;
        }

        vec2 flowPerp = vec2(-flow.y, flow.x);

        // 1. Dynamic direction curvature field
        float dirNoise = noise21(worldPos / 380.0 + vec2(tAnim * 0.04, -tAnim * 0.03) + 71.5) - 0.5;
        float steerAngle = dirNoise * 1.35;
        float cSt = cos(steerAngle);
        float sSt = sin(steerAngle);
        vec2 localFlow = vec2(flow.x * cSt - flow.y * sSt, flow.x * sSt + flow.y * cSt);
        vec2 localPerp = vec2(-localFlow.y, localFlow.x);

        vec2 eddyWarpA = vec2(
            sin(worldPos.y * 0.0035 + tAnim * 0.14) + cos(worldPos.x * 0.0028 - tAnim * 0.09),
            cos(worldPos.x * 0.0038 - tAnim * 0.12) - sin(worldPos.y * 0.0031 + tAnim * 0.11)
        ) * 36.0;
        vec2 warpNoise = vec2(
            noise21((worldPos + eddyWarpA * 0.4) / 140.0 + vec2(tAnim * 0.16, -tAnim * 0.12)) - 0.5,
            noise21((worldPos + eddyWarpA * 0.4) / 140.0 - vec2(tAnim * 0.14, tAnim * 0.18) + 43.1) - 0.5
        );
        vec2 warpNoise2 = vec2(
            noise21((worldPos + warpNoise * 55.0) / 85.0 + vec2(-tAnim * 0.22, tAnim * 0.19) + 18.7) - 0.5,
            noise21((worldPos + warpNoise * 55.0) / 85.0 + vec2(tAnim * 0.18, tAnim * 0.21) + 63.4) - 0.5
        );
        vec2 warpedPos = worldPos + eddyWarpA * 0.45 + warpNoise * 36.0 + warpNoise2 * 20.0;

        // 2. Three interacting wave trains
        vec2 dir1 = localFlow;
        vec2 tan1 = localPerp;
        float countMul = clamp(uWaveCount, 1.0, 8.0);
        float countScale = (countMul <= 4.0)
            ? mix(1.65, 1.0, (countMul - 1.0) / 3.0)
            : mix(1.0, 0.30, pow((countMul - 4.0) / 4.0, 0.82));
        float lam1 = max(uScale * 1.85 * countScale, 36.0);
        float k1 = 6.28318 / lam1;
        float spd1 = 2.0 / countScale;

        // Train 2: Oblique swell (+24 deg)
        float ca2 = cos(0.42); float sa2 = sin(0.42);
        vec2 dir2 = vec2(localFlow.x * ca2 - localFlow.y * sa2, localFlow.x * sa2 + localFlow.y * ca2);
        vec2 tan2 = vec2(-dir2.y, dir2.x);
        float lam2 = lam1 * 0.62;
        float k2 = 6.28318 / lam2;
        float spd2 = 1.65 / countScale;

        // Train 3: Dispersive counter-chop (-22 deg)
        float ca3 = cos(-0.38); float sa3 = sin(-0.38);
        vec2 dir3 = vec2(localFlow.x * ca3 - localFlow.y * sa3, localFlow.x * sa3 + localFlow.y * ca3);
        vec2 tan3 = vec2(-dir3.y, dir3.x);
        float lam3 = lam1 * 0.36;
        float k3 = 6.28318 / lam3;
        float spd3 = 2.45 / countScale;

        // Swell set envelope groups
        float setPhase1 = dot(warpedPos, dir1) * (k1 * 0.08) - tWave * (spd1 * 0.18);
        float setPhase2 = dot(warpedPos, dir2) * (k2 * 0.09) - tWave * (spd2 * 0.16) + 19.3;
        float setInterference = sin(setPhase1) * cos(setPhase2);
        float energyNoise1 = noise21(warpedPos / 850.0 + localFlow * (tAnim * 0.03) + setInterference * 0.30);
        float energyNoise2 = noise21(warpedPos / 520.0 - localPerp * (tAnim * 0.02) + 38.2);
        float setPulse = sin(setPhase1 + setInterference * 1.2) * 0.5 + 0.5;
        float macroEnergy = smoothstep(0.18, 0.78, energyNoise1 * 0.45 + energyNoise2 * 0.25 + setPulse * 0.30);
        float highCountBoost = clamp((countMul - 4.0) / 4.0, 0.0, 1.0);
        float swellSetGate = mix(mix(0.55, 0.72, highCountBoost), 1.0, macroEnergy);

        // 3. Wave packet envelopes
        vec2 envCoord1 = vec2(
            dot(warpedPos, tan1) / (lam1 * 1.5) + tAnim * 0.04,
            (dot(warpedPos, dir1) - tWave * (spd1 * 0.48) / k1) / (lam1 * 2.2)
        );
        float env1 = mix(0.50, 1.0, smoothstep(0.18, 0.68, noise21(envCoord1 + warpNoise2 * 0.25))) * swellSetGate;

        vec2 envCoord2 = vec2(
            dot(warpedPos, tan2) / (lam2 * 1.4) - tAnim * 0.05,
            (dot(warpedPos, dir2) - tWave * (spd2 * 0.48) / k2) / (lam2 * 2.0) + 51.7
        );
        float env2 = mix(0.40, 1.0, smoothstep(0.16, 0.66, noise21(envCoord2 - warpNoise2 * 0.20))) * mix(0.55, 1.0, macroEnergy);

        vec2 envCoord3 = vec2(
            dot(warpedPos, tan3) / (lam3 * 1.3) + tAnim * 0.06,
            (dot(warpedPos, dir3) - tWave * (spd3 * 0.48) / k3) / (lam3 * 1.8) + 83.4
        );
        float env3 = mix(0.35, 1.0, smoothstep(0.15, 0.65, noise21(envCoord3))) * (1.1 - macroEnergy * 0.3);

        // Train 1 stretch and shear
        vec2 waveStretchVec1 = vec2(
            sin(dot(warpedPos, tan1) * 0.024 + tAnim * 0.45) * 12.0 + cos(dot(warpedPos, dir1) * 0.018 - tAnim * 0.35) * 8.0,
            cos(dot(warpedPos, dir1) * 0.022 + tAnim * 0.40) * 12.0 - sin(dot(warpedPos, tan1) * 0.020 + tAnim * 0.30) * 8.0
        );
        vec2 stretchedPos1 = warpedPos + waveStretchVec1;
        float along1 = dot(stretchedPos1, tan1);
        float across1 = dot(stretchedPos1, dir1);

        float waveWarp1 = (noise21(stretchedPos1 / 65.0 + vec2(tAnim * 0.22, -tAnim * 0.18)) - 0.5) * 14.0;
        float crestMeander1 = sin(along1 * 0.026 + tAnim * 1.5) * 8.0;
        float pOffset1 = (noise21(stretchedPos1 / 180.0 + vec2(tAnim * 0.07, -tAnim * 0.05)) - 0.5) * 3.5;

        float chunkScale = max(0.42, countScale);
        vec2 chunkCoord1 = vec2(
            (along1 + waveStretchVec1.x * 0.8) / (58.0 * chunkScale) + tAnim * 0.05,
            (across1 - tWave * (spd1 * 0.48) / k1 + waveStretchVec1.y * 0.8) / (78.0 * chunkScale) + 17.4
        );
        float chunk1 = smoothstep(0.32, 0.72, noise21(chunkCoord1));

        vec2 tearCoord1 = vec2(
            (along1 - waveStretchVec1.x * 0.6) / (36.0 * chunkScale) - tAnim * 0.04,
            (across1 - tWave * (spd1 * 0.52) / k1 - waveStretchVec1.y * 0.6) / (48.0 * chunkScale) + 61.2
        );
        float tear1 = smoothstep(0.28, 0.68, noise21(tearCoord1));
        float packetEnvelope1 = env1 * mix(0.42, 1.0, chunk1) * mix(0.45, 1.0, tear1);

        float basePhase1 = (across1 + waveWarp1 + crestMeander1) * k1 - tWave * spd1 + pOffset1;

        // Train 2 stretch and shear
        vec2 waveStretchVec2 = vec2(
            sin(dot(warpedPos, tan2) * 0.028 - tAnim * 0.40) * 10.0 + cos(dot(warpedPos, dir2) * 0.020 + tAnim * 0.32) * 7.0,
            cos(dot(warpedPos, dir2) * 0.025 - tAnim * 0.36) * 10.0 - sin(dot(warpedPos, tan2) * 0.022 - tAnim * 0.28) * 7.0
        );
        vec2 stretchedPos2 = warpedPos + waveStretchVec2;
        float along2 = dot(stretchedPos2, tan2);
        float across2 = dot(stretchedPos2, dir2);

        float waveWarp2 = (noise21(stretchedPos2 / 55.0 - vec2(tAnim * 0.20, tAnim * 0.16) + 33.1) - 0.5) * 12.0;
        float crestMeander2 = cos(along2 * 0.032 - tAnim * 1.7) * 7.0;
        float pOffset2 = (noise21(stretchedPos2 / 160.0 - vec2(tAnim * 0.05, -tAnim * 0.07) + 52.6) - 0.5) * 3.5;

        vec2 chunkCoord2 = vec2(
            (along2 + waveStretchVec2.x * 0.7) / (48.0 * chunkScale) - tAnim * 0.04,
            (across2 - tWave * (spd2 * 0.48) / k2 + waveStretchVec2.y * 0.7) / (68.0 * chunkScale) + 43.8
        );
        float chunk2 = smoothstep(0.32, 0.70, noise21(chunkCoord2));

        vec2 tearCoord2 = vec2(
            (along2 - waveStretchVec2.x * 0.5) / (32.0 * chunkScale) + tAnim * 0.05,
            (across2 - tWave * (spd2 * 0.52) / k2 - waveStretchVec2.y * 0.5) / (42.0 * chunkScale) + 79.4
        );
        float tear2 = smoothstep(0.28, 0.66, noise21(tearCoord2));
        float packetEnvelope2 = env2 * mix(0.40, 1.0, chunk2) * mix(0.45, 1.0, tear2);

        float basePhase2 = (across2 + waveWarp2 + crestMeander2) * k2 - tWave * spd2 + pOffset2 + 27.3;

        // Train 3 wind chop
        float chopSteer = (noise21(warpedPos / 140.0 + vec2(-tAnim * 0.12, tAnim * 0.10) + 81.2) - 0.5) * 0.62;
        float cChop = cos(chopSteer); float sChop = sin(chopSteer);
        vec2 localDir3 = vec2(dir3.x * cChop - dir3.y * sChop, dir3.x * sChop + dir3.y * cChop);
        vec2 localTan3 = vec2(-localDir3.y, localDir3.x);

        float gustNoise1 = noise21(warpedPos / 190.0 + localDir3 * (tAnim * 0.35) + vec2(tAnim * 0.08, -tAnim * 0.06));
        float gustNoise2 = noise21(warpedPos / 110.0 - localTan3 * (tAnim * 0.25) + 47.3);
        float gustEnvelope = smoothstep(0.38, 0.76, gustNoise1 * 0.65 + gustNoise2 * 0.35);

        vec2 chopStretch = vec2(
            sin(dot(warpedPos, localTan3) * 0.042 + tAnim * 0.65) * 7.0 + cos(dot(warpedPos, localDir3) * 0.035 - tAnim * 0.50) * 4.5,
            cos(dot(warpedPos, localDir3) * 0.038 + tAnim * 0.55) * 7.0 - sin(dot(warpedPos, localTan3) * 0.032 + tAnim * 0.45) * 4.5
        );
        vec2 stretchedPos3 = warpedPos + chopStretch;
        float along3 = dot(stretchedPos3, localTan3);
        float across3 = dot(stretchedPos3, localDir3);

        vec2 chunkCoord3 = vec2(along3 / 42.0 + tAnim * 0.06, (across3 - tWave * (spd3 * 0.48) / k3) / 54.0 + 29.5);
        float chopChunk = smoothstep(0.32, 0.70, noise21(chunkCoord3));

        vec2 tearCoord3 = vec2(along3 / 26.0 - tAnim * 0.06, (across3 - tWave * (spd3 * 0.52) / k3) / 36.0 + 63.1);
        float chopTear = smoothstep(0.28, 0.66, noise21(tearCoord3));

        float chopGate = gustEnvelope * mix(0.40, 1.0, chopChunk) * mix(0.45, 1.0, chopTear) * (1.15 - macroEnergy * 0.35);
        float chopMeander = sin(along3 * 0.060 + tAnim * 2.2) * 4.5;
        float pOffset3 = (noise21(stretchedPos3 / 120.0 + vec2(tAnim * 0.08, -tAnim * 0.06) + 71.9) - 0.5) * 3.0;
        float basePhase3 = (across3 + chopMeander) * k3 - tWave * spd3 + pOffset3 + 61.8;

        // Wave triad cross-coupling
        float waveCrossCouple1 = sin(basePhase2) * (0.20 * env2) + cos(basePhase3) * (0.10 * chopGate);
        float waveCrossCouple2 = cos(basePhase1) * (0.18 * env1) - sin(basePhase3) * (0.09 * chopGate);
        float waveCrossCouple3 = (sin(basePhase1) + cos(basePhase2)) * 0.15 * (env1 * 0.6 + env2 * 0.4);

        float phase1 = basePhase1 + waveCrossCouple1;
        float s1 = sin(phase1) * 0.5 + 0.5;
        float w1 = pow(s1, 1.85) * packetEnvelope1;
        vec2 g1 = dir1 * (cos(phase1) * k1 * mix(0.35, 1.0, w1) * 1.15);

        float phase2 = basePhase2 + waveCrossCouple2;
        float s2 = sin(phase2) * 0.5 + 0.5;
        float chopThresh2 = mix(0.12, 0.08, highCountBoost);
        float w2 = pow(s2, 1.75) * packetEnvelope2 * smoothstep(chopThresh2, 0.65, uChoppySeas);
        vec2 g2 = dir2 * (cos(phase2) * k2 * mix(0.35, 1.0, w2) * 1.15);

        float phase3A = basePhase3 + waveCrossCouple3;
        float s3A = sin(phase3A) * 0.5 + 0.5;
        float k3B = k3 * 1.65;
        float spd3B = spd3 * 1.30;
        float phase3B = (across3 * 1.08 - along3 * 0.22) * k3B - tWave * spd3B + 14.7;
        float s3B = sin(phase3B) * 0.5 + 0.5;

        float combinedChop = pow(s3A * 0.72 + s3B * 0.28, 1.75);
        float w3 = combinedChop * chopGate * smoothstep(0.20, 0.85, uChoppySeas);
        vec2 g3 = localDir3 * (cos(phase3A) * k3 * mix(0.30, 1.0, w3) * 0.85);

        // 4. Non-linear Stokes elevation
        float waveInterference = w1 * w2;
        float chopIntensityMul = clamp(uChoppySeas * 1.15, 0.20, 1.40);
        float countElevationBoost = 1.0 + highCountBoost * 0.15;
        float baseElevation = (w1 * 0.50 + w2 * 0.32 + w3 * 0.14 + waveInterference * 0.55) * (chopIntensityMul * countElevationBoost);
        float steepening = pow(baseElevation, 2.0) * (0.35 * swellSetGate * chopIntensityMul);
        float macroElevation = clamp(baseElevation + steepening, 0.0, 1.0);
        vec2 macroGrad = (g1 * 0.52 + g2 * 0.34 + g3 * 0.14) * (1.0 + baseElevation * 0.7) * uChoppySeas;

        // 5. Capillary wavelets
        vec2 capCoord = (worldPos + warpNoise * 10.0) / 80.0;
        vec2 capPos = warpedPos + flow * (tAnim * 6.0);

        float caCapA = cos(0.24); float saCapA = sin(0.24);
        vec2 dirCapA = vec2(localFlow.x * caCapA - localFlow.y * saCapA, localFlow.x * saCapA + localFlow.y * caCapA);
        vec2 tanCapA = vec2(-dirCapA.y, dirCapA.x);
        float kCapA = 6.28318 / 28.0;
        float phaseCapA = dot(capPos, dirCapA) * kCapA - tAnim * 4.2 + sin(dot(capPos, tanCapA) * 0.075) * 1.8;
        vec2 gCapA = dirCapA * (cos(phaseCapA) * 0.35);

        float caCapB = cos(-0.63); float saCapB = sin(-0.63);
        vec2 dirCapB = vec2(localFlow.x * caCapB - localFlow.y * saCapB, localFlow.x * saCapB + localFlow.y * caCapB);
        vec2 tanCapB = vec2(-dirCapB.y, dirCapB.x);
        float kCapB = 6.28318 / 19.0;
        float phaseCapB = dot(capPos, dirCapB) * kCapB - tAnim * 5.6 + cos(dot(capPos, tanCapB) * 0.11) * 1.4;
        vec2 gCapB = dirCapB * (cos(phaseCapB) * 0.28);

        float caCapC = cos(1.19); float saCapC = sin(1.19);
        vec2 dirCapC = vec2(localFlow.x * caCapC - localFlow.y * saCapC, localFlow.x * saCapC + localFlow.y * caCapC);
        float kCapC = 6.28318 / 12.0;
        float phaseCapC = dot(capPos, dirCapC) * kCapC - tAnim * 7.1;
        vec2 gCapC = dirCapC * (cos(phaseCapC) * 0.20);
        vec2 capGrad = (gCapA + gCapB + gCapC) * (0.09 * uChoppySeas);

        // 6. Surface normals and specular glints
        oceanNormal = normalize(vec3(-clamp(macroGrad, vec2(-0.75), vec2(0.75)) * 2.2, 1.0));
        vec3 N_micro = normalize(vec3(-clamp(macroGrad, vec2(-0.75), vec2(0.75)) * 2.2 - capGrad * 1.15, 1.0));

        vec3 L = normalize(vec3(dir1 * 0.35 + vec2(-0.25, 0.45), 0.88));
        vec3 Hhalf = normalize(L + vec3(0.0, 0.0, 1.0));

        float NdotH = max(0.0, dot(N_micro, Hhalf));
        float broadSheen = pow(NdotH, 16.0) * 0.22;
        float sharpGlint = pow(NdotH, 24.0) * 0.55;
        float crestAffinity = smoothstep(0.35, 0.75, macroElevation) * mix(0.75, 1.0, swellSetGate);
        oceanGlint = (broadSheen + sharpGlint) * crestAffinity * (0.72 * uSunGlint * uChoppySeas);

        // 7. Seafoam patches across open sea
        float cellSize = max(160.0, uScale * 2.15);
        vec2 waterDriftPos = worldPos - flow * (tAnim * 10.0);
        vec2 bodyDriftPos = waterDriftPos;
        vec2 cellBase = floor(bodyDriftPos / cellSize);
        float rawEnergy = 0.0;
        float rawFront = 0.0;
        float weightedAge = 0.0;

        for (int dy = -1; dy <= 1; dy++) {
            for (int dx = -1; dx <= 1; dx++) {
                vec2 cId = cellBase + vec2(float(dx), float(dy));
                vec2 rnd  = hash22(cId * 19.17 + 23.41);
                vec2 rnd2 = hash22(cId * 37.89 + 67.13);
                vec2 rnd3 = hash22(cId * 53.31 + 91.07);

                float patchLife = 5.4 + (rnd2.y * 2.8);
                float localTime = (tAnim * 0.95) + rnd.y * patchLife;
                float cycleIdx = floor(localTime / patchLife);
                float gridAge = fract(localTime / patchLife);

                float syncStrength = max(uSpindriftWake, uCrestBound) * 1.0;
                float tBirth = (cycleIdx - rnd.y) * (patchLife / 0.95);
                float tSetAnim = mix(tBirth, tAnim, syncStrength);
                float tSetWave = mix(tBirth * 1.11111, tWave, syncStrength);

                vec2 cycleRnd = hash22(cId * 19.17 + vec2(cycleIdx * 7.31, cycleIdx * 13.19) + 23.41);
                vec2 cellJitter = (mix(cycleRnd, rnd, syncStrength) - 0.5) * 0.35 * cellSize;
                vec2 rawCellCenter = (cId + 0.5) * cellSize + cellJitter;

                // Per-wave constant heading with individual angular variation (no per-pixel or mid-life lurching)
                float headingJitter = (cycleRnd.x - 0.5) * 0.48;
                float clumpDirNoise = (noise21(rawCellCenter / 380.0 + 71.5) - 0.5) * 0.40 + headingJitter;
                float cClump = cos(clumpDirNoise);
                float sClump = sin(clumpDirNoise);
                vec2 clumpDir1 = vec2(flow.x * cClump - flow.y * sClump, flow.x * sClump + flow.y * cClump);
                vec2 clumpTan1 = vec2(-clumpDir1.y, clumpDir1.x);
                vec2 clumpDir2 = vec2(clumpDir1.x * ca2 - clumpDir1.y * sa2, clumpDir1.x * sa2 + clumpDir1.y * ca2);
                vec2 clumpDir3 = vec2(clumpDir1.x * ca3 - clumpDir1.y * sa3, clumpDir1.x * sa3 + clumpDir1.y * ca3);
                vec2 clumpWorldPos = rawCellCenter + flow * (tAnim * 10.0) + clumpDir1 * (mix(0.0, 20.0, uCrestBound));

                vec2 clumpTurbWarp = vec2(
                    noise21(rawCellCenter / 160.0 + vec2(tSetAnim * 0.08, -tSetAnim * 0.06)) - 0.5,
                    noise21(rawCellCenter / 160.0 - vec2(tSetAnim * 0.07, tSetAnim * 0.09) + 39.4) - 0.5
                ) * 24.0;

                vec2 setBirthPos = rawCellCenter + flow * (tSetAnim * 10.0) + clumpDir1 * (mix(0.0, 20.0, uCrestBound)) + clumpTurbWarp;
                float clumpSetPhase1 = dot(setBirthPos, clumpDir1) * (k1 * 0.08) - tSetWave * (spd1 * 0.18);
                float clumpSetPhase2 = dot(setBirthPos, clumpDir2) * (k2 * 0.09) - tSetWave * (spd2 * 0.16) + 19.3;
                float clumpSetInterf = sin(clumpSetPhase1) * cos(clumpSetPhase2);
                float setNoiseA = noise21(setBirthPos / 750.0 + flow * (tSetAnim * 0.03) + clumpSetInterf * 0.25);
                float setPulseClump = sin(clumpSetPhase1 + clumpSetInterf * 1.2) * 0.5 + 0.5;
                float dynamicSetEnergy = smoothstep(0.18, 0.75, setNoiseA * 0.50 + setPulseClump * 0.50);

                float cellThreshold = mix(0.15, 0.85, rnd.x);
                float setActivation = smoothstep(cellThreshold - 0.18, cellThreshold + 0.18, dynamicSetEnergy * uWhitecaps * (1.15 + highCountBoost * 0.15));
                if (setActivation <= 0.001) continue;

                vec2 warpedClumpPos = clumpWorldPos + clumpTurbWarp;
                float phiClump1 = dot(warpedClumpPos, clumpDir1) * k1 - tWave * (spd1 * 1.05);
                float phiClump2 = dot(warpedClumpPos, clumpDir2) * k2 - tWave * (spd2 * 1.05) + 27.3;
                float phiClump3 = dot(warpedClumpPos, clumpDir3) * k3 - tWave * (spd3 * 1.05) + 61.8;

                float clumpCrossMod = sin(phiClump2) * 0.20 + cos(phiClump3) * 0.10;
                float coupledPhaseAtClump = phiClump1 + clumpCrossMod - 1.5708;

                float stochasticDelay = (rnd2.x - 0.5) * 0.80;
                float waveAge = fract((-coupledPhaseAtClump + stochasticDelay) / 6.28318);
                float pAge = mix(gridAge, waveAge, syncStrength);

                vec2 cellCenter = rawCellCenter + clumpTurbWarp;
                float instSpeedMul = mix(0.75, 1.35, cycleRnd.y);

                float swayFreq = mix(0.25, 0.48, rnd2.x);
                float instSway = sin(tAnim * swayFreq + cycleRnd.x * 6.28318) * mix(2.0, 5.0, rnd2.y);
                vec2 instMeander = clumpTan1 * instSway;

                // Gentle patch origin drift while frontDist rolls the breaking crest forward across the water
                float forwardSurge = pAge * mix(18.0, 32.0, instSpeedMul) * clamp(uScale / 100.0, 0.55, 2.20);
                vec2 center = cellCenter + clumpDir1 * forwardSurge + instMeander;

                float pScale = (uScale * 0.48 + 30.0) * mix(0.72, 1.25, fract(cycleRnd.x * 3.1 + rnd2.x));
                float wavePower = mix(0.45, 1.0, fract(cycleRnd.y * 5.3 + rnd3.x)) * uChoppySeas;
                vec2 patchSeed = mix(cycleRnd, rnd, 0.35);
                vec2 patchRes = evalPatchCoreEnergy(bodyDriftPos, center, pAge, pScale, instSpeedMul, 1.2, vec4(patchSeed, rnd2), tAnim, clumpDir1, wavePower);
                float e = patchRes.x;
                float fLip = patchRes.y;

                float cycleEnvelope = smoothstep(0.0, 0.07, pAge) * (1.0 - smoothstep(0.70, 0.88, pAge));
                e *= cycleEnvelope * setActivation;
                fLip *= cycleEnvelope * setActivation;

                if (uCrestBound > 0.5 && uSpindriftWake < 0.5) {
                    float crestLifeEnvelope = 1.0 - smoothstep(0.35, 0.65, pAge);
                    e *= crestLifeEnvelope;
                    fLip *= crestLifeEnvelope;
                }

                rawEnergy += e;
                rawFront += fLip;
                weightedAge += e * pAge;
            }
        }

        oceanFoam = 0.0;
        undercurrentFoam = 0.0;
        aeratedBase = 0.0;
        float outerEnvelope = 0.0;
        float voroMacro = 0.5;

        if (rawEnergy > 0.001 || rawFront > 0.001) {
            float blendedAge = rawEnergy > 0.001 ? (weightedAge / rawEnergy) : 0.0;
            float channelNoise = noise21(bodyDriftPos / 140.0 + flow * (tAnim * 0.05));
            float convergence = (channelNoise - 0.5) * 0.25;
            float depthModulator = mix(0.85, 1.15, clamp(convergence + 0.5, 0.0, 1.0));

            float waveInfluence = 1.0;
            float modulatedEnergy = rawEnergy * depthModulator * waveInfluence;

            vec2 tendrilCoord = bodyDriftPos / 75.0 + vec2(tAnim * 0.02, -tAnim * 0.015);
            float tNoise = noise21(tendrilCoord) * 0.65 + noise21(tendrilCoord * 1.8 + 23.4) * 0.35;
            float softTendril = smoothstep(0.36, 0.82, tNoise);
            float tendrilSprout = smoothstep(0.12, 0.38, modulatedEnergy) * (1.0 - smoothstep(0.55, 0.85, modulatedEnergy));
            float tendrilProjection = softTendril * tendrilSprout * 0.45;

            float breakupNoise = noise21(bodyDriftPos / 32.0 + vec2(tAnim * 0.025, -tAnim * 0.02));
            float breakupFissure = smoothstep(0.36, 0.72, breakupNoise) * smoothstep(0.38, 0.85, blendedAge) * 0.42;

            float totalEnergy = clamp(modulatedEnergy + tendrilProjection - breakupFissure, 0.0, 2.5);
            outerEnvelope = smoothstep(0.04, 0.28, totalEnergy);

            float foamScale = pow(clamp(uScale / 80.0, 0.5, 4.5), 0.35);
            vec2 texturePos = bodyDriftPos - localFlow * (tAnim * 1.5);

            const float BUBBLE_FREQ = 0.094;
            vec2 foamUv = (texturePos * BUBBLE_FREQ) / foamScale;
            vec2 foamSwirl = vec2(
                sin(foamUv.y * 1.1 + tAnim * 0.16) * 0.04 + cos(foamUv.x * 0.9 - tAnim * 0.13) * 0.03,
                cos(foamUv.x * 1.1 - tAnim * 0.15) * 0.04 + sin(foamUv.y * 0.9 + tAnim * 0.12) * 0.03
            );
            vec2 foamWarp = (vec2(
                noise21(foamUv * 1.3 + vec2(tAnim * 0.04, -tAnim * 0.03)),
                noise21(foamUv * 1.3 - vec2(tAnim * 0.03, tAnim * 0.035) + 27.4)
            ) - 0.5) * 0.045;

            vec2 voroField = voronoiBubbleField(foamUv + foamSwirl + foamWarp, tAnim * 0.45);
            float voroDist = voroField.x;
            float voroMeso = voroField.y;
            voroMacro = noise21(foamUv * 0.45 + vec2(tAnim * 0.015, -tAnim * 0.01));
            float voroMicro = noise21(texturePos / 7.2 + tAnim * 0.02);

            // Scalloped sub-mesh lobe segmentation across the wave wake
            vec2 pTrail = bodyDriftPos / (foamScale * 38.0);
            float lobeN1 = noise21(pTrail + vec2(tAnim * 0.06, -tAnim * 0.04)) * 0.60
                + noise21(pTrail * 2.1 - vec2(tAnim * 0.08, tAnim * 0.05) + 19.7) * 0.40;
            float lobeN2 = noise21(pTrail * 0.92 - vec2(tAnim * 0.05, tAnim * 0.07) + 53.1) * 0.60
                + noise21(pTrail * 1.95 + vec2(tAnim * 0.07, -tAnim * 0.06) + 87.4) * 0.40;
            float wakeCarve = smoothstep(0.12, 0.56, blendedAge);
            float trailLobe1 = mix(1.0, smoothstep(0.24, 0.66, lobeN1), wakeCarve * 0.88);
            float trailLobe2 = smoothstep(0.22, 0.64, lobeN2);

            float holeMask = smoothstep(0.38, 0.68, voroMeso * 0.65 + voroMacro * 0.35);
            float perforateProgress = smoothstep(0.26, 0.78, blendedAge);

            float edgeNoise = (noise21(texturePos / 8.5 + vec2(tAnim * 0.08, -tAnim * 0.06)) - 0.5) * 0.065;
            float softMeso = voroMeso + edgeNoise;

            float subEnv1 = outerEnvelope * trailLobe1;
            float wallWidth = mix(0.38, 0.12, smoothstep(0.12, 0.80, blendedAge));
            wallWidth *= mix(0.35, 1.0, smoothstep(0.0, 0.68, subEnv1));
            float cavityOpening = mix(0.030, 0.012, smoothstep(0.18, 0.85, blendedAge));
            float filamentLace = 1.0 - smoothstep(cavityOpening * 0.50, wallWidth * 1.50, softMeso);
            float softHalo = (1.0 - smoothstep(0.0, wallWidth * 2.0, softMeso)) * 0.22;
            filamentLace = clamp(filamentLace * 0.80 + softHalo, 0.0, 1.0);
            filamentLace = smoothstep(0.08, 0.90, filamentLace);

            float domeCurve = sqrt(clamp(1.0 - pow(voroDist / 0.56, 2.0), 0.0, 1.0));
            float domeIntegrity = 1.0 - smoothstep(0.16, 0.72, blendedAge);
            float bubbleDome = domeCurve * (0.14 + 0.16 * domeIntegrity);
            float cellVolume = clamp(filamentLace * 0.88 + bubbleDome, 0.0, 1.0);
            float detailedLace = cellVolume * (voroMicro * 0.32 + 0.68);

            // Crisp cellular froth at formation (never a flat blurred matte-white cloud)
            float earlyCloud = mix(0.78, 1.0, smoothstep(0.15, 0.75, voroMacro))
                * clamp(filamentLace * 1.15 + bubbleDome * 1.30, 0.0, 1.0) * (voroMicro * 0.38 + 0.62);
            float foamBody = mix(earlyCloud, detailedLace, smoothstep(0.20, 0.52, blendedAge));

            foamBody = clamp(foamBody - holeMask * perforateProgress * 0.70, 0.0, 1.0);
            foamBody = max(foamBody, filamentLace * 0.35 * (voroMicro * 0.3 + 0.7));

            float crumbNoise = noise21(texturePos / 18.0 + vec2(tAnim * 0.02, -tAnim * 0.015));
            float dissolveCutoff = smoothstep(0.46, 0.96, blendedAge) * 0.58;
            float crumbPersistence = smoothstep(dissolveCutoff, dissolveCutoff + 0.28, crumbNoise);

            float edgeFeather = smoothstep(0.04, 0.28, totalEnergy);
            float subMesh1 = foamBody * subEnv1 * crumbPersistence * edgeFeather;

            // Secondary sub-mesh: feathers at lobe extremities and weaves under & over the primary wake
            float totalEnergy2 = clamp(modulatedEnergy * mix(0.75, 1.28, lobeN2) + (1.0 - softTendril) * tendrilSprout * 0.50 - breakupFissure * 0.68, 0.0, 2.5);
            float outerEnvelope2 = smoothstep(0.03, 0.25, totalEnergy2);
            float subEnv2 = outerEnvelope2 * trailLobe2;
            float subMesh2 = 0.0;
            if (subEnv2 > 0.001) {
                vec2 shearDrift = localPerp * (sin(dot(bodyDriftPos, localFlow) * 0.028 + tAnim * 0.18) * 4.5);
                vec2 texturePos2 = bodyDriftPos + localFlow * (tAnim * 0.8) + shearDrift + vec2(41.7, -28.3);
                const float BUBBLE_FREQ_2 = 0.112;
                vec2 foamUv2 = (texturePos2 * BUBBLE_FREQ_2) / foamScale;
                vec2 warpedFoamUv2 = foamUv2 - foamSwirl * 0.85 + foamWarp * 1.15 + vec2(13.9, -8.4);
                vec2 voroField2 = voronoiBubbleField(warpedFoamUv2, tAnim * 0.38 + 17.3);
                float voroDist2 = voroField2.x;
                float voroMeso2 = voroField2.y;
                float softMeso2 = max(0.0, voroMeso2 - edgeNoise * 0.85);
                float wallWidth2 = mix(0.34, 0.10, smoothstep(0.10, 0.82, blendedAge)) * mix(0.32, 1.0, smoothstep(0.0, 0.68, subEnv2));
                float filamentLace2 = 1.0 - smoothstep(cavityOpening * 0.55, wallWidth2 * 1.45, softMeso2);
                filamentLace2 = smoothstep(0.10, 0.90, filamentLace2);
                float domeCurve2 = sqrt(clamp(1.0 - pow(voroDist2 / 0.54, 2.0), 0.0, 1.0));
                float cellVolume2 = clamp(filamentLace2 * 0.86 + domeCurve2 * (0.12 + 0.14 * domeIntegrity), 0.0, 1.0);
                float crumbNoise2 = noise21(texturePos2 / 19.0 - vec2(tAnim * 0.02, tAnim * 0.015) + 31.4);
                float crumbPersist2 = smoothstep(dissolveCutoff * 0.92, dissolveCutoff * 0.92 + 0.28, crumbNoise2);
                subMesh2 = cellVolume2 * (voroMicro * 0.34 + 0.66) * subEnv2 * crumbPersist2;
            }

            float overMesh2 = subMesh2 * smoothstep(0.38, 0.78, trailLobe2) * 0.76;
            float cellularSpindrift = max(subMesh1, overMesh2) + min(subMesh1, overMesh2) * 0.32;

            float crestPresence = clamp(uWhitecaps * 1.55, 0.58, 1.0) * clamp(uChoppySeas * 1.35, 0.65, 1.0);
            float combinedFoam = clamp(cellularSpindrift * 0.90 + rawFront * 1.25, 0.0, 2.0);
            oceanFoam = combinedFoam * crestPresence;

            // Subsurface undercurrent churn & under-lapping secondary wake mesh
            float churnEnvelope = smoothstep(0.06, 0.30, modulatedEnergy);
            float churnBody = 0.0;
            if (churnEnvelope > 0.001) {
                vec2 churnDriftPos = texturePos - flow * 12.0 + flowPerp * (sin(texturePos.x * 0.018 + tAnim * 0.12) * 3.0);
                const float CHURN_BUBBLE_FREQ = 0.108;
                vec2 churnUv = (churnDriftPos * CHURN_BUBBLE_FREQ) / foamScale;
                float churnVoro = voronoiBubbles(churnUv, tAnim);
                float churnLace = 1.0 - smoothstep(0.035, 0.28, churnVoro);
                float churnMicro = noise21(churnDriftPos / 8.8 - tAnim * 0.03);
                churnBody = churnLace * (churnMicro * 0.38 + 0.62) * churnEnvelope;
            }
            undercurrentFoam = clamp((subMesh2 * 0.88 + churnBody * 0.38) * crestPresence, 0.0, 1.35);

            aeratedBase = modulatedEnergy * outerEnvelope * 0.55 * uWhitecaps * uChoppySeas;
        }

        crestBody = smoothstep(mix(0.18, 0.14, highCountBoost), 0.85, macroElevation) * mix(0.45, 0.52, highCountBoost);

        // Trochoidal horizontal compression and kinetic forward surge
        vec2 swellPull = (dir1 * cos(phase1) * mix(0.35, 1.0, w1) * 0.42 + dir2 * cos(phase2) * mix(0.35, 1.0, w2) * 0.24) * swellSetGate;
        vec2 breakDrag = flow * rawEnergy * outerEnvelope * 0.7;
        vec2 churnSwirl = flowPerp * (voroMacro - 0.5) * 0.4 * rawEnergy;
        waveDisplacement = swellPull + breakDrag + churnSwirl;

        troughShadow = smoothstep(mix(0.12, 0.09, highCountBoost), 0.56, macroElevation);
    }

    // Strategy wrapper: populates ArchetypeResult from ocean chop physics
    void applyOceanArchetype(vec2 pos, vec2 flow, float tWave, float tAnim, inout ArchetypeResult ar) {
        float oFoam, oUnder, oAer, oCrest;
        vec2 oDisp; vec3 oNorm; float oGlint, oTrough;
        computeChoppyOcean(pos, flow, tWave, tAnim,
            oFoam, oUnder, oAer, oCrest, oDisp, oNorm, oGlint, oTrough);
        ar.foam = max(ar.foam, oFoam);
        float foamShield = 1.0 - clamp((oFoam + oAer * 0.8 + oUnder * 0.5) * 1.15, 0.0, 0.88);
        ar.displacement += (oDisp * (uDistortion * 0.45 * uChoppySeas)
            + (-oNorm.xy) * (uDistortion * 0.22 * uChoppySeas)) * foamShield;

        ar.normal = oNorm;
        ar.glint += oGlint;
        ar.troughShadow = oTrough;
        ar.crestBody = oCrest;
        ar.aeratedBase = oAer;
        ar.undercurrentFoam = oUnder;
    }
`;
