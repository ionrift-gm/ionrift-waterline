export const RIVER_FLOW_CHUNK = `
    // ═══════════════════════════════════════════════════════════════════════════════
    // RIVER SHADER STRATEGIES
    // ═══════════════════════════════════════════════════════════════════════════════
    // STRATEGY 1 (ACTIVE): Babbling River Bumps & Dips
    // STRATEGY 2 (KEPT ASIDE): Discrete C-Shape Wavelets (Legacy)
    // ═══════════════════════════════════════════════════════════════════════════════

    // ─────────────────────────────────────────────────────────────────────────────
    // STRATEGY 1 (ACTIVE): BABBLING RIVER (BUMPS & DIPS)
    // ─────────────────────────────────────────────────────────────────────────────
    // Simulates an organic babbling river composed of dense stochastic bumps (water mounds
    // and stone boils) and dips (troughs and hollows) across multiple incommensurate scales.
    // Overlapping bumps and dips merge and carve into each other, but the combined elevation
    // is softly saturated via H = S / sqrt(1.0 + k * S^2) so peak amplitude never doubles.

    void evalBumpDipLayer(
        vec2 streamPos, vec2 cellSize, float tVal, float layerScale,
        float regularity, float speedMult, float seedOffset,
        inout float sumElev, inout vec2 sumGrad
    ) {
        vec2 cellId = floor(streamPos / cellSize);

        for (int dy = -1; dy <= 1; dy++) {
            for (int dx = -1; dx <= 1; dx++) {
                vec2 cId = cellId + vec2(float(dx), float(dy));

                vec2 r1 = hash22(cId * 19.37 + vec2(17.1 + seedOffset, 73.3));
                vec2 r2 = hash22(cId * 37.81 + vec2(53.2, 19.7 + seedOffset));
                vec2 r3 = hash22(cId * 41.13 + vec2(31.4 + seedOffset, 89.1));

                // Stagger alternate rows to eliminate Cartesian grid alignment (centered to prevent asymmetric reach)
                float rowStagger = (mod(abs(cId.y), 2.0) - 0.5) * (cellSize.x * 0.25);

                // Jittered anchor inside cell (strictly bounded to ensure 3x3 search coverage)
                vec2 jitter = (r1 - 0.5) * cellSize * (0.22 * mix(0.70, 0.20, regularity));
                vec2 anchor = (cId + 0.5) * cellSize + vec2(rowStagger + jitter.x, jitter.y);

                // Independent drift velocity: each bump drifts at its own speed (no rigid conveyor)
                float driftSpeed = mix(0.78, 1.22, r2.x) * speedMult;

                // Independent asynchronous lifecycle: bumps emerge, bob, and dissolve independently
                float period = mix(1.8, 3.8, r3.x);
                float phase = r1.y * 6.28318;
                float localTime = tVal * driftSpeed + phase;
                float tau = fract(localTime / period);

                // Smooth C1 emergence and dissipation envelope: zero at birth and death
                float lifeEnv = smoothstep(0.01, 0.22, tau) * (1.0 - smoothstep(0.68, 0.99, tau));

                // Individual bump drift offset along stream (strictly bounded to prevent cell boundary clipping)
                float driftDist = (tau - 0.5) * cellSize.x * (0.18 * mix(0.30, 0.60, r2.y));
                vec2 center = anchor + vec2(driftDist, 0.0);

                // Polarity & Variance: positive = bump (mound), negative = dip (depression)
                float polarity = (r2.y > 0.44) ? 1.0 : -0.85;
                float amp = mix(0.55, 1.10, r3.y) * polarity * lifeEnv;

                // Streamline aspect ratio: moderate elongation along flow (natural fluid lobes)
                float aspect = mix(1.10, 1.35, r1.x);
                float radU = cellSize.x * 0.44 * aspect * layerScale;
                float radV = cellSize.y * 0.46 * layerScale;

                // Subtle individual tilt angle
                float tilt = (r3.x - 0.5) * 0.20 * (1.0 - regularity * 0.4);
                float cT = cos(tilt);
                float sT = sin(tilt);

                vec2 dPos = streamPos - center;
                float du = dPos.x * cT - dPos.y * sT;
                float dv = dPos.x * sT + dPos.y * cT;

                // Smooth asymmetric streamline profile: C1 smooth transition across du = 0
                float wakeMask = smoothstep(-0.25 * radU, 0.25 * radU, du);
                float uScaleSide = radU * mix(0.88, 1.14, wakeMask);

                // Gentle parabolic wake curvature smoothly attenuated at center
                float parabolicWake = 0.12 * wakeMask * ((dv * dv) / max(1.0, radV));
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
        ) * (5.0 * (1.0 - uWaveRegularity * 0.5));
        vec2 warpedPos = worldPos + eddyWarp;

        // Stream coordinates: u along flow, v perpendicular
        float uProg = dot(warpedPos, flow) - centerDrift;
        float vLat  = dot(warpedPos, flowPerp);

        // Uniform drift speed along the channel
        float baseDrift = tWave * 48.0;
        float uDrift = uProg - baseDrift;
        vec2 streamPos = vec2(uDrift, vLat);

        float scaleFactor = clamp(uScale / 45.0, 0.5, 2.0);

        // ─── BABBLING RIVER BUMPS & DIPS DENSE MULTI-SCALE EVALUATION ───
        float sumElev = 0.0;
        vec2 sumGrad = vec2(0.0);

        // LAYER 1: Macro Bumps & Dips (Broad water mounds and stone boils)
        vec2 cell1 = vec2(40.0, 28.0) * scaleFactor;
        evalBumpDipLayer(
            streamPos, cell1, tWave, scaleFactor,
            uWaveRegularity, 1.0, 0.0,
            sumElev, sumGrad
        );

        // LAYER 2: Meso Babbling Ripples (Medium bumps & chatter, rotated 24 deg)
        float rotA = 0.42; // ~24 degrees
        float cA = cos(rotA); float sA = sin(rotA);
        vec2 streamPos2 = vec2(streamPos.x * cA - streamPos.y * sA, streamPos.x * sA + streamPos.y * cA);
        vec2 cell2 = vec2(25.0, 18.0) * scaleFactor;
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

        // LAYER 3: High-frequency capillary ripples (fine babbling texture, rotated -18 deg)
        float rotB = -0.31;
        float cB = cos(rotB); float sB = sin(rotB);
        vec2 streamPos3 = vec2(streamPos.x * cB - streamPos.y * sB, streamPos.x * sB + streamPos.y * cB);
        vec2 cell3 = vec2(15.0, 12.0) * scaleFactor;
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
        // Mathematical guarantee: H stays strictly within (-1.0, 1.0)
        // Two bumps meeting add volume/breadth, but do NOT double in peak amplitude!
        float kSat = 0.80;
        float denom = sqrt(1.0 + kSat * sumElev * sumElev);
        float riverElevation = sumElev / denom;

        // Analytical gradient dampening via chain rule: dH/dx = dS/dx / denom^3
        float denom3 = denom * denom * denom;
        vec2 boundedGrad = sumGrad / denom3;

        // Map gradient to world space and modulate by bankFactor
        // Slope gain (14.0) converts the normalized 1/radius gradient from pixel units to a tabletop surface incline (slope ~0.25-0.65)
        const float kSlopeGain = 14.0;
        vec2 worldGrad = (flow * boundedGrad.x + flowPerp * boundedGrad.y) * (kSlopeGain * uRiverWaves * bankFactor);

        // Surface normal: smooth, stable, physically bounded
        riverNormal = normalize(vec3(-clamp(worldGrad, vec2(-0.75), vec2(0.75)) * 1.8, 1.0));

        // ─── SUN SPECULAR GLINTS ───
        vec3 sunDir = normalize(vec3(flow * 0.35 + vec2(-0.25, 0.45), 0.88));
        vec3 halfVec = normalize(sunDir + vec3(0.0, 0.0, 1.0));
        float NdotH = max(0.0, dot(riverNormal, halfVec));

        riverGlint = (pow(NdotH, 32.0) * 0.85 + pow(NdotH, 12.0) * 0.25)
            * smoothstep(0.01, 0.38, riverElevation)
            * (1.4 * uSunGlint * uRiverWaves);

        // ─── DELICATE CREST & RIFFLE FOAM ───
        float steepness = length(worldGrad);
        float crestPresence = smoothstep(0.08, 0.40, riverElevation) * smoothstep(0.08, 0.35, steepness);
        float rifflePresence = smoothstep(0.15, 0.50, steepness) * smoothstep(-0.05, 0.30, riverElevation);
        float foamFlicker = noise21(worldPos * 0.18 + vec2(tWave * 1.6, tWave * 0.9));
        float baseFoam = max(crestPresence, rifflePresence * 0.60) * (0.60 + 0.40 * foamFlicker);
        float foam = baseFoam * (0.30 + 1.8 * uWhitecaps) * uRiverWaves;
        riverFoam = clamp(foam, 0.0, 0.96);

        // Suppress abruptly at the exact waterline so waves do not spill awkwardly onto dry bank
        riverFoam *= smoothstep(3.0, 20.0, signedDist);

        // Micro-refraction displacement
        riverDisplacement = (-worldGrad) * (uDistortion * 1.5 * uRiverWaves);
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // STRATEGY 2 (KEPT ASIDE): DISCRETE C-SHAPE WAVELETS (LEGACY)
    // ─────────────────────────────────────────────────────────────────────────────
    // Evaluates a single localized discrete wavelet instance layer with diverse C-shape archetypes
    void evalRiverWaveletLayer(
        vec2 streamPos, vec2 cellSize, float timeVal, float layerScale,
        float regularity, float speedMult, float seedOffset, float bankDrag,
        inout float maxPosElev, inout float maxNegElev, inout vec2 domSlope, inout float maxFoam
    ) {
        vec2 cellId = floor(streamPos / cellSize);

        float sumWeight = 0.0001;
        vec2 weightedSlope = vec2(0.0);

        for (int dy = -1; dy <= 1; dy++) {
            for (int dx = -1; dx <= 1; dx++) {
                vec2 cId = cellId + vec2(float(dx), float(dy));

                vec2 rnd  = hash22(cId * 17.37 + vec2(13.1 + seedOffset, 71.9));
                vec2 rnd2 = hash22(cId * 31.83 + vec2(53.7, 19.3 + seedOffset));
                vec2 rnd3 = hash22(cId * 47.19 + vec2(29.4, 83.1 + seedOffset));

                float basePeriod = mix(1.9, 3.8, rnd2.y);
                float instPhase = rnd.y * 6.28318;
                float localTime = timeVal * speedMult + instPhase;
                float cycleIndex = floor(localTime / basePeriod);
                float tau = fract(localTime / basePeriod);

                vec2 cycleRnd  = hash22(cId * 29.71 + vec2(cycleIndex * 19.37 + seedOffset, cycleIndex * 41.13));
                vec2 cycleRnd2 = hash22(cId * 43.11 + vec2(cycleIndex * 31.29, cycleIndex * 13.71 + seedOffset));

                vec2 cellGridPos = (cId + 0.5) * cellSize;
                float turb1 = noise21(cellGridPos * 0.035 + vec2(timeVal * 0.18, -timeVal * 0.14) + vec2(seedOffset * 0.1, 0.0));
                float turb2 = noise21(cellGridPos * 0.082 - vec2(timeVal * 0.12, timeVal * 0.16) + 47.3);
                float localTurbulence = turb1 * 0.60 + turb2 * 0.40;

                float activeProb = mix(0.78, 0.52, regularity * (1.1 - localTurbulence * 0.6));
                if (cycleRnd.x > activeProb) continue;

                // Stagger alternate rows to eliminate Cartesian grid alignment (centered to prevent asymmetric reach)
                float rowStagger = (mod(abs(cId.y), 2.0) - 0.5) * (cellSize.x * 0.25);

                float jitterX = (rnd.x - 0.5) * cellSize.x * mix(0.40, 0.15, regularity);
                float jitterY = (rnd.y - 0.5) * cellSize.y * mix(0.40, 0.12, regularity);
                vec2 anchor = (cId + 0.5) * cellSize + vec2(rowStagger + jitterX, jitterY);

                float ampVariance = mix(0.35, 1.65, cycleRnd.y);
                float riseCurve = mix(1.0, 2.0, cycleRnd2.x);
                float decayCurve = mix(1.15, 1.85, cycleRnd2.y);
                float tauPeak = 0.40;
                float tauEnd = 0.82;
                float lifeAmp = (tau < tauPeak)
                    ? pow(tau / tauPeak, riseCurve)
                    : (tau < tauEnd)
                        ? pow(max(0.0, 1.0 - (tau - tauPeak) / (tauEnd - tauPeak)), decayCurve)
                        : 0.0;
                lifeAmp *= ampVariance;

                float aspectType = mix(rnd3.x, cycleRnd2.x, 0.45);
                float widthMul = mix(0.55, 1.75, aspectType);
                float bowScale = mix(1.35, 0.60, aspectType);

                float bluntness = mix(-0.25, 0.35, cycleRnd2.y);
                float wingSkew = (cycleRnd.x - 0.5) * 0.40 * (1.0 - regularity * 0.35);

                float speedMul = mix(0.80, 1.25, cycleRnd.y);
                float surgeDist = mix(1.8, 4.2, cycleRnd2.x) * layerScale * bowScale;
                float forwardSurge = smoothstep(0.10, 0.55, tau) * surgeDist;
                float driftU = (tau - 0.5) * cellSize.x * 0.35 * (speedMul - 1.0) + forwardSurge;

                float lateralDrift = (tau - 0.5) * mix(-2.5, 2.5, cycleRnd.x) * (1.0 - regularity * 0.5);
                vec2 instCenter = anchor + vec2(driftU, lateralDrift);

                float instAngle = (rnd2.x - 0.5) * 0.55 * (1.0 - regularity * 0.4);
                float yawDrift = (tau - 0.38) * mix(-0.16, 0.16, cycleRnd.x) * (1.0 - regularity * 0.35);
                float dynAngle = instAngle + yawDrift;
                float cA = cos(dynAngle);
                float sA = sin(dynAngle);

                vec2 delta = streamPos - instCenter;
                float du = delta.x * cA - delta.y * sA;
                float dv = delta.x * sA + delta.y * cA;

                float lateralSpread = (0.85 + 0.30 * smoothstep(0.05, 0.45, tau)) * (1.0 + 0.25 * smoothstep(0.50, 0.82, tau));
                float halfWidth = cellSize.y * mix(0.35, 0.65, rnd.x) * widthMul * lateralSpread;
                if (abs(dv) >= halfWidth) continue;

                float sY = dv / halfWidth;
                float sY2 = sY * sY;
                float latMask = (1.0 - sY2) * (1.0 - sY2);
                float dLatMask_dv = -4.0 * sY * (1.0 - sY2) / halfWidth;

                float bowAmp = mix(4.5, 10.5, cycleRnd2.y) * layerScale * bowScale * (1.0 - regularity * 0.2);
                float bowMorph = (0.75 + 0.35 * smoothstep(0.12, 0.48, tau)) * (1.0 - 0.22 * smoothstep(0.50, 0.82, tau));
                float dynBowAmp = bowAmp * bowMorph;

                float shearRate = mix(-0.35, 0.35, cycleRnd.y) * (1.0 - regularity * 0.4);
                float dynWingSkew = clamp(wingSkew + (tau - 0.38) * shearRate, -0.65, 0.65);

                float baseBow = (1.0 - sY2) * (1.0 + bluntness * (1.0 - sY2));
                float dBaseBow_dsY = -2.0 * sY * (1.0 + 2.0 * bluntness * (1.0 - sY2));

                float bowCurve = baseBow * (1.0 + dynWingSkew * sY);
                float dCurve_dsY = dBaseBow_dsY * (1.0 + dynWingSkew * sY) + baseBow * dynWingSkew;

                float wobbleFreq = mix(1.8, 2.6, rnd.x);
                float lipPhase = sY * wobbleFreq + rnd.x * 6.28;
                float lipAmp = 0.55 * (1.0 - regularity * 0.5);
                float lipWobble = sin(lipPhase) * lipAmp;
                float dLipWobble_dsY = cos(lipPhase) * wobbleFreq * lipAmp;

                float flexPhase = sY * 2.4 + tau * 2.6 + rnd2.x * 6.28;
                float flexAmp = mix(1.5, 3.5, cycleRnd.x) * layerScale * (1.0 - regularity * 0.4) * (0.35 + 0.65 * min(1.0, lifeAmp));
                float crestFlex = sin(flexPhase) * flexAmp;
                float dCrestFlex_dsY = cos(flexPhase) * 2.4 * flexAmp;

                float uCrest = dynBowAmp * bowCurve + lipWobble + crestFlex;
                float distToCrest = du - uCrest;
                float duCrest_dv = (dynBowAmp * dCurve_dsY + dLipWobble_dsY + dCrestFlex_dsY) / halfWidth;

                float taper = mix(0.50, 1.0, 1.0 - sY2);
                float crestFineness = mix(1.15, 0.82, min(1.0, lifeAmp));
                float crestDiffusion = 1.0 + 0.35 * smoothstep(0.48, 0.95, tau);
                float wCrest = mix(3.5, 8.0, mix(rnd.y, cycleRnd.x, 0.4)) * layerScale * taper * crestFineness * crestDiffusion;
                float q = distToCrest / wCrest;
                if (abs(q) > 2.2) continue;

                float q2 = q * q;
                float expF = exp(-q2);
                float kOsc = 2.6;
                float cosOsc = cos(q * kOsc);
                float sinOsc = sin(q * kOsc);

                float crestShape = expF * cosOsc;
                if (crestShape > 0.0) {
                    float steepenPower = mix(1.2, 2.0, min(1.0, lifeAmp));
                    crestShape = pow(crestShape, steepenPower);
                } else {
                    crestShape = -pow(-crestShape, 1.15) * 0.45;
                }

                float dExp_dq = -2.0 * q * expF;
                float dShape_dq = dExp_dq * cosOsc - expF * kOsc * sinOsc;
                float dq_du = 1.0 / wCrest;
                float dq_dv = -duCrest_dv / wCrest;

                float dShape_du = dShape_dq * dq_du;
                float dShape_dv = dShape_dq * dq_dv;

                float lifeEnvelope = smoothstep(0.01, 0.18, tau) * (1.0 - smoothstep(0.54, 0.82, tau));

                float instIntensity = lifeAmp * lifeEnvelope * mix(0.70, 1.30, rnd.x) * bankDrag * (0.75 + 0.35 * localTurbulence);
                float instElev = crestShape * latMask * instIntensity;

                float dElev_duLocal = instIntensity * (latMask * dShape_du);
                float dElev_dvLocal = instIntensity * (dLatMask_dv * crestShape + latMask * dShape_dv);

                float dElev_du = dElev_duLocal * cA + dElev_dvLocal * sA;
                float dElev_dv = -dElev_duLocal * sA + dElev_dvLocal * cA;
                vec2 instSlope = vec2(dElev_du, dElev_dv);

                if (instElev > 0.0) {
                    maxPosElev = max(maxPosElev, instElev);
                } else {
                    maxNegElev = min(maxNegElev, instElev);
                }

                float wSlope = pow(abs(instElev) + 0.001, 2.0);
                weightedSlope += instSlope * wSlope;
                sumWeight += wSlope;

                float crestSharpness = smoothstep(wCrest * 0.85, 0.0, abs(distToCrest));
                float breakCondition = smoothstep(0.40, 0.85, lifeAmp);
                
                float fleckFlicker = noise21(streamPos * 0.12 + vec2(timeVal * 1.2, tau * 2.5));
                float peelBias = clamp(1.0 + dynWingSkew * sY * 0.85, 0.25, 1.75);
                float crestPresence = mix(0.40, 1.0, breakCondition) * min(1.0, lifeAmp * 1.5) * peelBias;
                float instFoam = (crestSharpness * latMask * crestPresence * bankDrag) * (0.65 + 0.35 * fleckFlicker) * smoothstep(0.12, 0.75, crestShape) * lifeEnvelope;

                maxFoam = max(maxFoam, instFoam);
            }
        }

        domSlope = weightedSlope / sumWeight;
    }

    void computeRiverWaves_legacy(
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

        vec2 flowPerp = vec2(-flow.y, flow.x);

        float bankDragDist = max(uBankDrag, 25.0);
        float bankDistNorm = clamp(signedDist / bankDragDist, 0.0, 1.0);
        float bankFactor = mix(0.30, 1.0, smoothstep(0.0, 1.0, bankDistNorm));

        float centerDrift = (1.0 - bankDistNorm * bankDistNorm) * 9.0;

        vec2 eddyWarp = vec2(
            sin(worldPos.y * 0.032 + tAnim * 0.35) + cos(worldPos.x * 0.022 - tAnim * 0.30),
            cos(worldPos.x * 0.028 + tAnim * 0.30) - sin(worldPos.y * 0.022 + tAnim * 0.30)
        ) * (4.5 * (1.0 - uWaveRegularity * 0.5));
        vec2 warpedPos = worldPos + eddyWarp;

        float uProg = dot(warpedPos, flow) - centerDrift;
        float vLat  = dot(warpedPos, flowPerp);

        float baseDrift = tWave * 50.0;
        float uDrift = uProg - baseDrift;
        vec2 streamPos = vec2(uDrift, vLat);

        float scaleFactor = clamp(uScale / 45.0, 0.5, 2.0);

        vec2 cell1 = vec2(58.0, 38.0) * scaleFactor;
        float posElev1 = 0.0;
        float negElev1 = 0.0;
        vec2 slope1 = vec2(0.0);
        float foam1 = 0.0;
        evalRiverWaveletLayer(
            streamPos, cell1, tWave, scaleFactor,
            uWaveRegularity, 1.0, 0.0, bankFactor,
            posElev1, negElev1, slope1, foam1
        );

        float rotAngle = 0.20;
        float cR = cos(rotAngle); float sR = sin(rotAngle);
        vec2 streamPos2 = vec2(streamPos.x * cR - streamPos.y * sR, streamPos.x * sR + streamPos.y * cR);
        vec2 cell2 = vec2(38.0, 26.0) * scaleFactor;
        float posElev2 = 0.0;
        float negElev2 = 0.0;
        vec2 slope2 = vec2(0.0);
        float foam2 = 0.0;
        evalRiverWaveletLayer(
            streamPos2, cell2, tWave, scaleFactor * 0.65,
            uWaveRegularity, 1.25, 41.7, bankFactor,
            posElev2, negElev2, slope2, foam2
        );

        vec2 slope2Rot = vec2(slope2.x * cR + slope2.y * sR, -slope2.x * sR + slope2.y * cR);

        float posElev = max(posElev1, posElev2 * 0.28);
        float negElev = min(negElev1, negElev2 * 0.28);
        float combinedElev = (posElev + negElev);
        
        float steepening = pow(max(0.0, posElev), 2.0) * 0.35;
        float riverElevation = clamp((combinedElev + steepening) * uRiverWaves, -0.5, 1.0);

        float w1 = pow(abs(posElev1 + negElev1) + 0.001, 2.0);
        float w2 = pow(abs(posElev2 + negElev2) + 0.001, 2.0);
        vec2 domSlope = (slope1 * w1 + slope2Rot * w2) / (w1 + w2);
        vec2 riverGrad = (flow * domSlope.x + flowPerp * domSlope.y) * uRiverWaves;

        riverNormal = normalize(vec3(-clamp(riverGrad, vec2(-0.55), vec2(0.55)) * 1.6, 1.0));

        vec3 L = normalize(vec3(flow * 0.35 + vec2(-0.25, 0.45), 0.88));
        vec3 Hhalf = normalize(L + vec3(0.0, 0.0, 1.0));
        float NdotH = max(0.0, dot(riverNormal, Hhalf));
        
        riverGlint = (pow(NdotH, 44.0) * 0.85 + pow(NdotH, 16.0) * 0.20)
            * smoothstep(0.12, 0.65, riverElevation)
            * (0.65 * uSunGlint * uRiverWaves);

        float combinedFoam = max(foam1, foam2 * 0.25);
        riverFoam = clamp(combinedFoam * (0.65 + 1.2 * uWhitecaps) * uRiverWaves, 0.0, 0.95);
        riverFoam *= smoothstep(3.0, 20.0, signedDist);

        riverDisplacement = (-riverGrad) * (uDistortion * 1.8 * uRiverWaves);
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // ACTIVE RIVER WAVE SIMULATION DISPATCH
    // ─────────────────────────────────────────────────────────────────────────────
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
        ar.elevation = max(ar.elevation, rFoam * 0.45 + slopeMag * 0.35);
    }
`;
