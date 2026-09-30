export const OCEAN_CHOP_CHUNK = `
    // Evaluates localized wave breaker energy and foam patch morphology
    vec2 evalPatchCoreEnergy(
        vec2 p, vec2 center, float age, float patchScale,
        float expandRate, float pinchRate, vec4 clumpSeed, float t,
        vec2 waveDir, float waveAtClump
    ) {
        float a = clamp(age, 0.0, 1.0);

        // Lifecycle envelopes: advancing front develops early; trailing body develops after cresting
        float frontBirth = smoothstep(0.0, 0.08, a);
        float bodyBirth = smoothstep(0.08, 0.25, a);
        float bodyDeath = 1.0 - smoothstep(0.68, 0.98, a);
        float bodyLife = bodyBirth * bodyDeath;

        float expandSpeed = max(0.0, 1.0 - a / 0.46);
        float crestSpeed = max(expandSpeed, waveAtClump);

        // Subside active surge when crest velocity drops
        float speedFactor = smoothstep(0.10, 0.45, crestSpeed);
        float lateDeathStart = mix(0.38, 0.65, speedFactor);
        float lateDeathEnd = mix(0.52, 0.88, speedFactor);
        float activeCrest = 1.0 - smoothstep(lateDeathStart, lateDeathEnd, a);

        float minimalFloor = 0.16 * bodyDeath;
        float speedGatedDeath = mix(minimalFloor, 1.0, activeCrest);

        float lateStage = smoothstep(0.35, 0.48, a);
        float normalDeath = 1.0 - smoothstep(0.55, 0.88, a);
        float frontDeath = mix(normalDeath, speedGatedDeath, lateStage);
        float frontLife = frontBirth * frontDeath;

        float crestActivity = frontLife * mix(1.0, speedFactor, lateStage);

        if (frontLife <= 0.0001 && bodyLife <= 0.0001) return vec2(0.0);

        float growth = smoothstep(0.0, 0.32, a);
        float expansion = mix(0.18, 1.0, sqrt(growth)) * mix(1.0, 1.45, smoothstep(0.35, 0.88, a));
        float cohesionRelax = 1.0 + 0.28 * smoothstep(0.28, 0.88, a);

        // Wave crest ridge alignment
        vec2 waveTan = vec2(-waveDir.y, waveDir.x);
        vec2 deltaP = p - center;
        float acrossDist = dot(deltaP, waveDir);
        float alongDist = dot(deltaP, waveTan);

        float waveAcrossScale = 1.0 + waveAtClump * 0.38;
        float waveAlongScale = 1.0 / (1.0 + waveAtClump * 0.55);
        vec2 waveShapedP = center + waveDir * (acrossDist * waveAcrossScale) + waveTan * (alongDist * waveAlongScale);

        float distToCluster = length(waveShapedP - center);
        float clusterFade = 1.0 - smoothstep(patchScale * 2.0, patchScale * 2.7, distToCluster);
        if (clusterFade <= 0.001) return vec2(0.0);

        // Fluid domain perturbation
        vec2 turbWarp = vec2(
            noise21((waveShapedP - center) * 0.016 + vec2(t * 0.03, -t * 0.02)) - 0.5,
            noise21((waveShapedP - center) * 0.016 - vec2(-t * 0.02, t * 0.03) + 41.3) - 0.5
        ) * 7.0;
        vec2 warpedP = waveShapedP + turbWarp;

        float bNoise = (noise21(warpedP * 0.020 + clumpSeed.xy * 23.7 + vec2(a * 0.10, -a * 0.06)) - 0.5) * 0.15;
        vec2 dpStart = warpedP - center;
        float xProg = dot(dpStart, waveDir);
        float yLat = dot(dpStart, waveTan);

        float lateralGrowth = mix(0.60, 1.0, smoothstep(0.02, 0.28, a));
        float crestWidth = patchScale * mix(0.55, 0.85, clumpSeed.z) * lateralGrowth;
        float bowAmp = crestWidth * 0.24;

        float w0 = 14.0;
        float rearRelax = patchScale * 0.08 * smoothstep(0.18, 0.85, a);
        float xRear = -w0 - rearRelax;

        float crestLunge = waveAtClump * patchScale * 0.30 * smoothstep(0.35, 0.70, a);
        float frontDist = patchScale * mix(0.80, 1.25, clumpSeed.z) * smoothstep(0.0, 0.48, a) + crestLunge;

        float lipWiggle = (noise21(vec2(yLat * 0.14, t * 0.35) + clumpSeed.xy * 17.1) - 0.5) * 4.0;
        float totalSpan = frontDist - xRear;
        float wakeT = clamp((frontDist - xProg) / max(totalSpan, 0.001), 0.0, 1.0);
        float localWidth = crestWidth * mix(0.75, 1.15, wakeT);
        float sY = clamp(abs(yLat) / max(localWidth, 0.001), 0.0, 1.0);
        float lateralMask = pow(max(0.0, 1.0 - sY * sY), 1.4);

        float xLip = frontDist - (sY * sY) * bowAmp + lipWiggle;
        float distAhead = xProg - xLip;

        float frontWarp = (noise21(warpedP * 0.045 + vec2(t * 0.02, -t * 0.015) + clumpSeed.xy * 19.3) - 0.5) * 6.0;
        float frontMicro = (noise21(warpedP * 0.12 + clumpSeed.zw * 31.7) - 0.5) * 3.0;
        float effDistAhead = distAhead + frontWarp + frontMicro;

        // Advancing wave front lip, crest nodules, and ballistic spray
        float frontLip = 0.0;
        if (frontLife > 0.001) {
            float distToLip = abs(effDistAhead);
            float crestPower = clamp(mix(speedFactor, 1.0, 1.0 - lateStage), 0.0, 1.0);
            float activeThick = mix(10.0, 18.0, clumpSeed.z);
            float restrainedThick = mix(5.0, 8.5, clumpSeed.z);
            float lipThick = mix(restrainedThick, activeThick, crestPower);
            float lipBand = smoothstep(lipThick, 0.4, distToLip);
            float solidCore = smoothstep(lipThick * 0.60, 0.0, distToLip) * mix(0.12, 0.95, crestPower);

            float bubbleW = yLat * 0.34 + noise21(warpedP * 0.08 + t * 0.05) * 4.2;
            float bubbleNodules = 0.70 + 0.30 * cos(bubbleW);
            float whiteNodes = pow(max(0.0, cos(bubbleW * 1.6 + 1.2)), 3.0) * 0.85;
            frontLip = lipBand * (solidCore + bubbleNodules * 0.85 + whiteNodes);

            float sprayParticles = 0.0;
            if (distAhead > -14.0 && distAhead < 20.0 && abs(yLat) < crestWidth * 1.30 && crestActivity > 0.01) {
                for (int i = 0; i < 28; i++) {
                    float fi = float(i);
                    float streamFreq = mix(1.8, 3.4, fract(fi * 0.382));
                    float streamPhase = fi * 0.0357 + fract(fi * 0.618) * 0.40;
                    float pTime = t * streamFreq + streamPhase + clumpSeed.x * 19.7;
                    float cycle = floor(pTime);
                    float tau = fract(pTime);
                    vec2 pSeed = vec2(fi * 17.31 + cycle * 43.19 + clumpSeed.y * 31.0, fi * 31.17 - cycle * 19.73 + clumpSeed.z * 23.0);
                    vec2 h1 = hash22(pSeed);
                    vec2 h2 = hash22(pSeed + vec2(19.43, 71.29));
                    float yBirth = (h1.x - 0.5) * 1.75 * crestWidth;
                    float isMicro = step(15.5, fi);
                    float isFwd = step(0.45, h1.y);
                    float throwFwd = mix(3.5, mix(10.0, 16.0, isMicro), fract(h1.y * 7.31));
                    float throwBack = mix(-2.0, mix(-7.0, -11.0, isMicro), fract(h1.y * 5.17));
                    float baseThrow = mix(throwBack, throwFwd, isFwd);
                    float throwDist = baseThrow * mix(0.20, 1.0, crestActivity);
                    float pFwd = throwDist * (tau - 0.25 * tau * tau);
                    float pLat = yBirth + (h2.x - 0.5) * mix(8.0, 14.0, isMicro) * tau;
                    vec2 pOffset = vec2(distAhead - pFwd, yLat - pLat);
                    float d2 = dot(pOffset, pOffset);
                    float pLife = smoothstep(0.0, 0.10, tau) * smoothstep(1.0, 0.55, tau);
                    float invR2 = mix(0.60, 1.30, isMicro);
                    float pDrop = exp(-d2 * invR2) * pLife;
                    sprayParticles += pDrop * mix(1.6, 2.2, isMicro);
                }
            }
            frontLip += sprayParticles * 1.8 * crestActivity;
            frontLip *= lateralMask * frontLife;
        }

        // Trailing wake foam body: piecewise envelope behind and ahead of lip
        float e0_body = 0.0;
        if (bodyLife > 0.001) {
            if (effDistAhead <= 0.0) {
                float dBehind = -effDistAhead;
                float rearWarp = (noise21(warpedP * 0.032 + vec2(t * 0.025, -t * 0.02) + clumpSeed.xy * 29.1) - 0.5) * 36.0;
                float microFringe = (noise21(warpedP * 0.095 + clumpSeed.zw * 13.5 + vec2(-t * 0.01, t * 0.015)) - 0.5) * 12.0;
                float effectiveDBehind = dBehind + rearWarp + microFringe;
                float rearSkirt = mix(50.0, 70.0, clumpSeed.w);
                float rearStart = max(totalSpan * 0.60, totalSpan - 24.0);
                float rearFade = 1.0;
                if (effectiveDBehind > rearStart) {
                    float sRear = clamp((effectiveDBehind - rearStart) / rearSkirt, 0.0, 1.0);
                    rearFade = pow(max(0.0, 1.0 - sRear), 2.2);
                }
                float wakeAging = mix(1.0, 0.35, smoothstep(0.10, 0.85, wakeT));
                e0_body = rearFade * wakeAging * lateralMask * bodyLife;
            } else {
                float frontSkirt = mix(8.0, 14.0, clumpSeed.z);
                float sFront = clamp(effDistAhead / frontSkirt, 0.0, 1.0);
                float frontSlope = pow(max(0.0, 1.0 - sFront), 1.8);
                e0_body = frontSlope * lateralMask * bodyLife;
            }
        }

        // Satellite breakaways
        float archetype = clumpSeed.y;
        float sat1Active = step(0.35, archetype);
        float sat2Active = step(0.65, archetype);
        float sat3Active = step(0.85, archetype);
        float satSpread = 1.0 + 0.25 * smoothstep(0.30, 0.88, a);

        float dist1 = crestWidth * mix(0.55, 0.90, clumpSeed.x) * satSpread;
        float alongWake1 = frontDist * mix(0.25, 0.65, clumpSeed.w);
        vec2 c1 = center + waveDir * alongWake1 + waveTan * dist1;
        vec2 dp1 = warpedP - c1;
        float r1 = patchScale * 0.22 * mix(0.7, 1.2, clumpSeed.z) * cohesionRelax;
        float s1 = clamp((length(dp1) / max(r1, 0.001)) + bNoise * 1.1, 0.0, 1.0);
        float e1 = pow(max(0.0, 1.0 - s1 * s1), 1.8) * 0.70 * sat1Active * bodyLife;

        float dist2 = -crestWidth * mix(0.55, 0.90, clumpSeed.y) * satSpread;
        float alongWake2 = frontDist * mix(0.35, 0.75, clumpSeed.z);
        vec2 c2 = center + waveDir * alongWake2 + waveTan * dist2;
        vec2 dp2 = warpedP - c2;
        float r2 = patchScale * 0.20 * mix(0.7, 1.2, clumpSeed.w);
        float s2 = clamp((length(dp2) / max(r2, 0.001)) + bNoise * 1.1, 0.0, 1.0);
        float e2 = pow(max(0.0, 1.0 - s2 * s2), 1.8) * 0.65 * sat2Active * bodyLife;

        float dist3 = (clumpSeed.x - 0.5) * crestWidth * 0.5;
        vec2 c3 = center - waveDir * (w0 * 0.5 + rearRelax * 0.5) + waveTan * dist3;
        vec2 dp3 = warpedP - c3;
        float r3 = patchScale * 0.16 * mix(0.7, 1.1, clumpSeed.x) * cohesionRelax;
        float s3 = clamp((length(dp3) / max(r3, 0.001)) + bNoise * 1.2, 0.0, 1.0);
        float e3 = pow(max(0.0, 1.0 - s3 * s3), 1.8) * 0.60 * sat3Active * bodyLife;

        float coreEnergy = (max(e0_body, frontLip * 0.45) + (e1 + e2 + e3)) * clusterFade;
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
        // Train 1: Primary swell (wavelength scaled by uWaveCount so count slider controls ocean wave density)
        vec2 dir1 = localFlow;
        vec2 tan1 = localPerp;
        float countMul = clamp(uWaveCount, 1.0, 8.0);
        // Responsive scaling: gentle widening below 4, balanced wave crowding (~3.3x density) above 4
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
        float w1 = pow(s1, 2.6) * packetEnvelope1;
        vec2 g1 = dir1 * (cos(phase1) * k1 * w1 * 2.0);

        float phase2 = basePhase2 + waveCrossCouple2;
        float s2 = sin(phase2) * 0.5 + 0.5;
        float chopThresh2 = mix(0.12, 0.08, highCountBoost);
        float w2 = pow(s2, 2.4) * packetEnvelope2 * smoothstep(chopThresh2, 0.65, uChoppySeas);
        vec2 g2 = dir2 * (cos(phase2) * k2 * w2 * 2.0);

        float phase3A = basePhase3 + waveCrossCouple3;
        float s3A = sin(phase3A) * 0.5 + 0.5;
        float k3B = k3 * 1.65;
        float spd3B = spd3 * 1.30;
        float phase3B = (across3 * 1.08 - along3 * 0.22) * k3B - tWave * spd3B + 14.7;
        float s3B = sin(phase3B) * 0.5 + 0.5;

        float combinedChop = pow(s3A * 0.72 + s3B * 0.28, 2.4);
        float w3 = combinedChop * chopGate * smoothstep(0.20, 0.85, uChoppySeas);
        vec2 g3 = localDir3 * (cos(phase3A) * k3 * w3 * 1.4);

        // 4. Non-linear Stokes elevation
        float waveInterference = w1 * w2;
        float chopIntensityMul = clamp(uChoppySeas * 1.15, 0.20, 1.40);
        float countElevationBoost = 1.0 + highCountBoost * 0.15;
        float baseElevation = (w1 * 0.50 + w2 * 0.32 + w3 * 0.14 + waveInterference * 0.55) * (chopIntensityMul * countElevationBoost);
        float steepening = pow(baseElevation, 2.0) * (0.85 * swellSetGate * chopIntensityMul);
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
        float sharpGlint = pow(NdotH, 44.0) * 1.05;
        float crestAffinity = smoothstep(0.35, 0.75, macroElevation) * mix(0.75, 1.0, swellSetGate);
        oceanGlint = (broadSheen + sharpGlint) * crestAffinity * (0.72 * uSunGlint * uChoppySeas);

        // 7. Seafoam patches across open sea
        float cellSize = 280.0;
        float swellPhase = dot(worldPos, dir1) * k1 - tWave * spd1;
        vec2 swellUndulation = (-dir1 * sin(swellPhase) * 6.5 + tan1 * cos(swellPhase * 0.7) * 3.5) * uChoppySeas;

        vec2 waterDriftPos = worldPos - flow * (tAnim * 13.0);
        vec2 waveBodyDisp = (
            dir1 * cos(phase1) * (w1 * 14.0) +
            dir2 * cos(phase2) * (w2 * 8.5) +
            localDir3 * cos(phase3A) * (w3 * 4.0)
        ) * uChoppySeas;

        vec2 bodyDriftPos = waterDriftPos + swellUndulation - waveBodyDisp;
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

                vec2 cellJitter = (rnd - 0.5) * 0.35 * cellSize;
                vec2 rawCellCenter = (cId + 0.5) * cellSize + cellJitter;
                vec2 clumpWorldPos = rawCellCenter + flow * (tAnim * 13.0) + dir1 * (mix(0.0, 20.0, uCrestBound));

                vec2 clumpTurbWarp = vec2(
                    noise21(clumpWorldPos / 160.0 + vec2(tAnim * 0.12, -tAnim * 0.09)) - 0.5,
                    noise21(clumpWorldPos / 160.0 - vec2(tAnim * 0.10, tAnim * 0.13) + 39.4) - 0.5
                ) * 32.0;
                vec2 warpedClumpPos = clumpWorldPos + clumpTurbWarp;

                float clumpSetPhase1 = dot(warpedClumpPos, dir1) * (k1 * 0.08) - tWave * (spd1 * 0.18);
                float clumpSetPhase2 = dot(warpedClumpPos, dir2) * (k2 * 0.09) - tWave * (spd2 * 0.16) + 19.3;
                float clumpSetInterf = sin(clumpSetPhase1) * cos(clumpSetPhase2);
                float setNoiseA = noise21(warpedClumpPos / 750.0 + flow * (tAnim * 0.03) + clumpSetInterf * 0.25);
                float setPulseClump = sin(clumpSetPhase1 + clumpSetInterf * 1.2) * 0.5 + 0.5;
                float dynamicSetEnergy = smoothstep(0.18, 0.75, setNoiseA * 0.50 + setPulseClump * 0.50);

                float phiClump1 = dot(warpedClumpPos, dir1) * k1 - tWave * spd1;
                float phiClump2 = dot(warpedClumpPos, dir2) * k2 - tWave * spd2 + 27.3;
                float phiClump3 = dot(warpedClumpPos, localDir3) * k3 - tWave * spd3 + 61.8;

                float clumpCrossMod = sin(phiClump2) * 0.20 + cos(phiClump3) * 0.10;
                float coupledPhaseAtClump = phiClump1 + clumpCrossMod - 1.5708;

                float cellThreshold = mix(0.15, 0.85, rnd.x);
                float setActivation = smoothstep(cellThreshold - 0.18, cellThreshold + 0.18, dynamicSetEnergy * uWhitecaps * (1.15 + highCountBoost * 0.15));
                if (setActivation <= 0.001) continue;

                float patchLife = 6.5 + rnd2.y * 3.5;
                float localTime = tAnim * 0.85 + rnd.y * patchLife;
                float gridAge = fract(localTime / patchLife);

                float stochasticDelay = (rnd2.x - 0.5) * 0.80;
                float waveAge = fract((-coupledPhaseAtClump + stochasticDelay) / 6.28318);
                float syncStrength = max(uSpindriftWake, uCrestBound);
                float pAge = mix(gridAge, waveAge, syncStrength);

                vec2 cellCenter = rawCellCenter + clumpTurbWarp;
                float instSpeedMul = mix(0.82, 1.20, rnd.y);
                vec2 instDrift = flow * (pAge * 10.0 * (instSpeedMul - 1.0));

                float swayFreq = mix(0.35, 0.65, rnd2.x);
                float instSway = sin(tAnim * swayFreq + rnd.x * 6.28318) * mix(3.0, 7.0, rnd2.y);
                vec2 instMeander = flowPerp * instSway;

                float instSwellPhaseOffset = (rnd.x - 0.5) * 1.2;
                float instHeaveAmp = mix(0.70, 1.30, rnd3.x);
                float clumpSwellPhase = coupledPhaseAtClump + instSwellPhaseOffset;
                vec2 instSwellDev = (-dir1 * sin(clumpSwellPhase) * 4.5 * instHeaveAmp + tan1 * cos(clumpSwellPhase * 0.7) * 2.5 * (rnd.y - 0.5)) * uChoppySeas;

                float sClump1 = sin(coupledPhaseAtClump + 1.5708) * 0.5 + 0.5;
                float sClump2 = sin(phiClump2) * 0.5 + 0.5;
                float waveConstructive = pow(sClump1, 2.6) * (0.65 + 0.60 * pow(sClump2, 2.4));
                float waveAtClump = waveConstructive * uChoppySeas;

                float instSurgeMul = mix(0.65, 1.35, rnd3.y);
                float crestSurgeDist = waveAtClump * mix(3.5, 9.0, uCrestBound) * instSurgeMul;
                float forwardSurge = (mix(pAge * 3.5, pAge * 9.0, uCrestBound) + crestSurgeDist) * instSpeedMul;
                vec2 center = cellCenter + flow * forwardSurge + instDrift + instMeander + instSwellDev;

                float pScale = (uScale * 0.48 + 30.0) * mix(0.75, 1.20, rnd2.x);
                float crestPeakLife = smoothstep(0.35, 0.0, pAge);
                float localWaveAtClump = mix(crestPeakLife, macroElevation, 0.50) * uChoppySeas;
                vec2 patchRes = evalPatchCoreEnergy(bodyDriftPos, center, pAge, pScale, 1.1, 1.2, vec4(rnd, rnd2), tAnim, dir1, localWaveAtClump);
                float e = patchRes.x;
                float fLip = patchRes.y;

                float cycleEnvelope = smoothstep(0.0, 0.06, pAge) * (1.0 - smoothstep(0.70, 0.88, pAge));
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

        float blendedAge = rawEnergy > 0.001 ? (weightedAge / rawEnergy) : 0.0;
        float smoothElev = clamp(macroElevation, 0.0, 1.25);
        float channelNoise = noise21(bodyDriftPos / 140.0 + dir1 * (tAnim * 0.05));
        float convergence = (channelNoise - 0.5) * 0.30 + (smoothElev - 0.5) * 0.15;
        float depthModulator = mix(0.85, 1.15, clamp(convergence + 0.5, 0.0, 1.0));

        float crestMound = 1.0 + smoothstep(0.28, 0.85, smoothElev) * 0.75 * uChoppySeas;
        float troughThinning = mix(0.45, 1.0, smoothstep(0.06, 0.38, smoothElev));
        float waveInfluence = crestMound * troughThinning;
        float modulatedEnergy = rawEnergy * depthModulator * waveInfluence;

        vec2 tendrilCoord = (bodyDriftPos + waveBodyDisp * 0.5) / 75.0 + vec2(tAnim * 0.02, -tAnim * 0.015);
        float tNoise = noise21(tendrilCoord) * 0.65 + noise21(tendrilCoord * 1.8 + 23.4) * 0.35;
        float softTendril = smoothstep(0.36, 0.82, tNoise);
        float tendrilSprout = smoothstep(0.12, 0.38, modulatedEnergy) * (1.0 - smoothstep(0.55, 0.85, modulatedEnergy));
        float tendrilProjection = softTendril * tendrilSprout * (0.35 + smoothstep(0.30, 0.80, smoothElev) * 0.30);

        float breakupNoise = noise21(bodyDriftPos / 32.0 + vec2(tAnim * 0.025, -tAnim * 0.02));
        float breakupFissure = smoothstep(0.36, 0.72, breakupNoise) * smoothstep(0.32, 0.82, blendedAge) * 0.42;

        float totalEnergy = clamp(modulatedEnergy + tendrilProjection - breakupFissure, 0.0, 2.5);
        float outerEnvelope = smoothstep(0.02, 0.28, totalEnergy);

        vec2 dChop3 = (-localDir3 * sin(phase3A + 0.85) * 2.8 + localTan3 * cos(phase3A * 1.15) * 1.8) * chopGate;
        vec2 dChop2 = (-dir2 * sin(phase2 + 0.60) * 3.0 + tan2 * cos(phase2 * 0.85) * 2.0) * env2;
        vec2 dCap = vec2(
            sin(capCoord.x * 6.28 + capCoord.y * 3.14 - tAnim * 2.2),
            cos(capCoord.y * 6.28 - capCoord.x * 3.14 + tAnim * 1.8)
        ) * 2.2;
        vec2 hfUndulation = (dChop3 * 0.55 + dChop2 * 0.30 + dCap * 0.35) * uChoppySeas;

        vec2 texturePos = bodyDriftPos + swellUndulation * 0.15 + hfUndulation * uFoamHfWeight;

        const float BUBBLE_FREQ = 0.096;
        vec2 foamUv = texturePos * BUBBLE_FREQ;
        vec2 foamSwirl = vec2(
            sin(foamUv.y * 1.4 + uTime * 0.55) * 0.22 + cos(foamUv.x * 1.1 - uTime * 0.42) * 0.15,
            cos(foamUv.x * 1.4 - uTime * 0.50) * 0.22 + sin(foamUv.y * 1.1 + uTime * 0.40) * 0.15
        );
        vec2 foamWarp = (vec2(
            noise21(foamUv * 1.3 + vec2(uTime * 0.08, -uTime * 0.06)),
            noise21(foamUv * 1.3 - vec2(uTime * 0.06, uTime * 0.07) + 27.4)
        ) - 0.5) * 0.16;

        vec2 voroField = voronoiBubbleField(foamUv + foamSwirl + foamWarp, uTime);
        float voroDist = voroField.x;
        float voroMeso = voroField.y;
        float voroMacro = noise21(foamUv * 0.45 + vec2(tAnim * 0.015, -tAnim * 0.01));
        float voroMicro = noise21(texturePos / 7.2 + tAnim * 0.03);

        float holeMask = smoothstep(0.38, 0.68, voroMeso * 0.65 + voroMacro * 0.35);
        float perforateProgress = smoothstep(0.15, 0.70, blendedAge);

        float edgeNoise = (noise21(texturePos / 8.5 + vec2(uTime * 0.08, -uTime * 0.06)) - 0.5) * 0.065;
        float softMeso = voroMeso + edgeNoise;

        float wallWidth = mix(0.35, 0.12, smoothstep(0.15, 0.80, blendedAge));
        wallWidth *= mix(0.55, 1.0, smoothstep(0.02, 0.25, totalEnergy));
        float cavityOpening = mix(0.035, 0.012, smoothstep(0.20, 0.85, blendedAge));
        float filamentLace = 1.0 - smoothstep(cavityOpening * 0.50, wallWidth * 1.55, softMeso);
        float softHalo = (1.0 - smoothstep(0.0, wallWidth * 2.2, softMeso)) * 0.28;
        filamentLace = clamp(filamentLace * 0.76 + softHalo, 0.0, 1.0);
        filamentLace = smoothstep(0.06, 0.90, filamentLace);

        float domeCurve = sqrt(clamp(1.0 - pow(voroDist / 0.58, 2.0), 0.0, 1.0));
        float domeIntegrity = 1.0 - smoothstep(0.18, 0.75, blendedAge);
        float bubbleDome = domeCurve * (0.18 + 0.18 * domeIntegrity);
        float cellVolume = clamp(filamentLace * 0.85 + bubbleDome, 0.0, 1.0);
        float detailedLace = cellVolume * (voroMicro * 0.30 + 0.70);

        float earlyCloud = smoothstep(0.30, 0.70, voroMacro) * (voroMeso * 0.4 + 0.6);
        float foamBody = mix(earlyCloud, detailedLace, smoothstep(0.10, 0.45, blendedAge));

        foamBody = clamp(foamBody - holeMask * perforateProgress * 0.70, 0.0, 1.0);
        foamBody = max(foamBody, filamentLace * 0.35 * (voroMicro * 0.3 + 0.7));

        float crumbNoise = noise21(texturePos / 18.0 + vec2(tAnim * 0.02, -tAnim * 0.015));
        float dissolveCutoff = smoothstep(0.40, 0.96, blendedAge) * 0.55;
        float crumbPersistence = smoothstep(dissolveCutoff, dissolveCutoff + 0.28, crumbNoise);

        float edgeFeather = smoothstep(0.01, 0.28, totalEnergy);
        float cellularSpindrift = foamBody * outerEnvelope * crumbPersistence * edgeFeather;

        float combinedFoam = clamp(cellularSpindrift + rawFront * 0.95, 0.0, 2.0);
        oceanFoam = combinedFoam * 0.90 * uWhitecaps * uChoppySeas;

        // Subsurface undercurrent churn
        vec2 churnDriftPos = texturePos - flow * 12.0 + flowPerp * (sin(texturePos.x * 0.018 + tAnim * 0.12) * 3.0);
        const float CHURN_BUBBLE_FREQ = 0.108;
        vec2 churnUv = churnDriftPos * CHURN_BUBBLE_FREQ;
        float churnVoro = voronoiBubbles(churnUv, uTime);
        float churnLace = 1.0 - smoothstep(0.035, 0.28, churnVoro);
        float churnMicro = noise21(churnDriftPos / 8.8 - tAnim * 0.03);
        float churnEnvelope = smoothstep(0.04, 0.28, modulatedEnergy);
        float churnBody = churnLace * (churnMicro * 0.38 + 0.62) * churnEnvelope;
        undercurrentFoam = churnBody * 0.42 * uWhitecaps * uChoppySeas;

        aeratedBase = modulatedEnergy * outerEnvelope * 0.65 * uWhitecaps * uChoppySeas;
        crestBody = smoothstep(mix(0.18, 0.14, highCountBoost), 0.85, macroElevation) * mix(0.45, 0.52, highCountBoost);

        // Trochoidal horizontal compression and kinetic forward surge
        vec2 swellPull = (dir1 * cos(phase1) * w1 * 0.70 + dir2 * cos(phase2) * w2 * 0.40) * swellSetGate;
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
        ar.displacement += oDisp * (uDistortion * 0.55 * uChoppySeas)
            + (-oNorm.xy) * (uDistortion * 0.30 * uChoppySeas);
        ar.normal = oNorm;
        ar.glint += oGlint;
        ar.troughShadow = oTrough;
        ar.crestBody = oCrest;
        ar.aeratedBase = oAer;
        ar.undercurrentFoam = oUnder;
    }
`;
