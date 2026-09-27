export const RIVER_FLOW_CHUNK = `
    // Evaluates a single localized discrete wavelet instance layer with diverse C-shape archetypes
    // and non-additive maximum blending (strictly prevents doubling or bright white hot-spots)
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

                // 1. EMERGENT SET ENERGY & ACTIVATION (DISAPPEAR / REAPPEAR)
                vec2 cellGridPos = (cId + 0.5) * cellSize;
                float setPhase1 = cellGridPos.x * 0.016 - timeVal * (speedMult * 0.40) + rnd.x * 1.5;
                float setPhase2 = cellGridPos.y * 0.022 + cellGridPos.x * 0.008 - timeVal * (speedMult * 0.30) + rnd2.y * 2.0;
                float waveSetInterf = sin(setPhase1) * cos(setPhase2);
                float turbulence = noise21(cellGridPos * 0.020 + vec2(timeVal * 0.12, -timeVal * 0.10)) - 0.5;

                float localEnergy = clamp(0.55 + waveSetInterf * 0.35 + turbulence * 0.28, 0.0, 1.0);

                float activationThreshold = mix(0.70, 0.92, regularity) * (1.20 - localEnergy * 0.40);
                if (rnd2.x > activationThreshold) continue;

                // Stagger alternate rows to eliminate Cartesian grid lanes
                float rowStagger = mod(abs(cId.y), 2.0) * (cellSize.x * 0.5);

                // Jittered anchor inside cell (continuous, no coordinate seams)
                float jitterX = (rnd.x - 0.5) * cellSize.x * mix(0.55, 0.15, regularity);
                float jitterY = (rnd.y - 0.5) * cellSize.y * mix(0.48, 0.12, regularity);
                vec2 anchor = (cId + 0.5) * cellSize + vec2(rowStagger + jitterX, jitterY);

                // 2. INDIVIDUAL LIFECYCLE
                float instLife = mix(1.8, 3.2, rnd2.y);
                float instPhase = rnd.y * 6.28318;
                float localTime = timeVal * speedMult + instPhase;
                float tau = fract(localTime / instLife); // 0 to 1

                float lifeAmp = sin(tau * 3.14159265);
                lifeAmp = pow(lifeAmp, mix(1.3, 1.9, localEnergy));

                // 3. MORPHOLOGICAL C-SHAPE VARIANCE (Soft rounded crescents, zero harsh angles/chevrons)
                // - aspectType: wide/shallow ripple vs compact crescent
                // - bluntness: rounded parabola vs flat-nosed scoop (always smooth C^1, zero chevron kinks)
                // - wingSkew: subtle natural asymmetric drift
                float aspectType = rnd3.x; // 0 to 1
                float widthMul = mix(0.70, 1.45, aspectType);
                float bowScale = mix(1.20, 0.70, aspectType);

                // Bluntness modulation: all curves use smooth parabolic/elliptic profiles
                // d(baseBow)/dsY at sY=0 is ALWAYS 0 -> NO sharp angles or chevron points!
                float bluntness = mix(-0.20, 0.35, rnd2.y);
                float wingSkew = (rnd.y - 0.5) * 0.35 * (1.0 - regularity * 0.4);

                // Dynamic surge lunge
                float speedMul = mix(0.85, 1.25, rnd2.x);
                float lunge = sin(smoothstep(0.15, 0.70, tau) * 3.14159) * (3.5 * localEnergy * layerScale * bowScale);
                float driftU = (tau - 0.5) * cellSize.x * 0.35 * (speedMul - 1.0) + lunge;

                float lateralSway = sin(tau * 6.28318 + rnd.x * 3.14) * 2.5 * (1.0 - regularity * 0.5);
                vec2 instCenter = anchor + vec2(driftU, lateralSway);

                // Stochastic instance rotation angle (+/- 14 deg)
                float instAngle = (rnd2.x - 0.5) * 0.48 * (1.0 - regularity * 0.4);
                float cA = cos(instAngle);
                float sA = sin(instAngle);

                vec2 delta = streamPos - instCenter;
                float du = delta.x * cA - delta.y * sA;
                float dv = delta.x * sA + delta.y * cA;

                // Lateral span with dynamic growth & archetype width
                // Sized so wavelets are distinct localized instances, not spanning the river
                float lateralExpansion = smoothstep(0.0, 0.30, tau);
                float lateralRelax = 1.0 + 0.20 * smoothstep(0.65, 0.98, tau);
                float halfWidth = cellSize.y * mix(0.35, 0.65, rnd.x) * widthMul * lateralExpansion * lateralRelax;
                if (abs(dv) >= halfWidth) continue;

                float sY = dv / halfWidth;
                float sY2 = sY * sY;
                float latMask = (1.0 - sY2) * (1.0 - sY2);
                float dLatMask_dv = -4.0 * sY * (1.0 - sY2) / halfWidth;

                // Soft C-Shape Bow:
                // Sized appropriately so wavelets are gentle ripples, not deep V-wedges!
                // If tighter crescents occur, they are very small (tiny micro-ripples)
                float bowAmp = mix(4.0, 9.0, rnd3.y) * layerScale * bowScale * (1.0 - regularity * 0.2) * (0.85 + 0.35 * localEnergy);
                
                // Gentle crest line undulation (no sharp micro-kinks)
                float wobbleFreq = mix(1.8, 2.6, rnd.x);
                float lipPhase = sY * wobbleFreq + timeVal * 2.0 + rnd.x * 6.28;
                float lipAmp = 0.65 * (1.0 - regularity * 0.5);
                float lipWobble = sin(lipPhase) * lipAmp;
                float dLipWobble_dsY = cos(lipPhase) * wobbleFreq * lipAmp;
                
                // Smooth rounded crescent profile (guaranteed zero chevron kink at sY=0):
                float baseBow = (1.0 - sY2) * (1.0 + bluntness * (1.0 - sY2));
                float dBaseBow_dsY = -2.0 * sY * (1.0 + 2.0 * bluntness * (1.0 - sY2));

                float bowCurve = baseBow * (1.0 + wingSkew * sY);
                float dCurve_dsY = dBaseBow_dsY * (1.0 + wingSkew * sY) + baseBow * wingSkew;

                float uCrest = bowAmp * bowCurve + lipWobble;
                float distToCrest = du - uCrest;
                float duCrest_dv = (bowAmp * dCurve_dsY + dLipWobble_dsY) / halfWidth;

                // 4. NATURAL CREST TAPERING (Thick in center, thin at wings!)
                float taper = mix(0.50, 1.0, 1.0 - sY2);
                float wCrest = mix(4.0, 7.5, rnd.y) * layerScale * taper * mix(1.15, 0.85, localEnergy);
                float q = distToCrest / wCrest;
                if (abs(q) > 2.2) continue;

                float q2 = q * q;
                float expF = exp(-q2);
                float kOsc = 2.6;
                float cosOsc = cos(q * kOsc);
                float sinOsc = sin(q * kOsc);

                // Dynamic steepening
                float crestShape = expF * cosOsc;
                if (crestShape > 0.0) {
                    float steepenPower = mix(1.3, 2.2, localEnergy * smoothstep(0.25, 0.65, tau));
                    crestShape = pow(crestShape, steepenPower);
                } else {
                    crestShape = -pow(-crestShape, 1.15) * 0.45;
                }

                // Analytical derivatives
                float dExp_dq = -2.0 * q * expF;
                float dShape_dq = dExp_dq * cosOsc - expF * kOsc * sinOsc;
                float dq_du = 1.0 / wCrest;
                float dq_dv = -duCrest_dv / wCrest;

                float dShape_du = dShape_dq * dq_du;
                float dShape_dv = dShape_dq * dq_dv;

                float instIntensity = lifeAmp * mix(0.75, 1.35, rnd.x) * bankDrag * (0.65 + 0.55 * localEnergy);
                float instElev = crestShape * latMask * instIntensity;

                // Slope components in local rotated instance frame
                float dElev_duLocal = instIntensity * (latMask * dShape_du);
                float dElev_dvLocal = instIntensity * (dLatMask_dv * crestShape + latMask * dShape_dv);

                float dElev_du = dElev_duLocal * cA + dElev_dvLocal * sA;
                float dElev_dv = -dElev_duLocal * sA + dElev_dvLocal * cA;
                vec2 instSlope = vec2(dElev_du, dElev_dv);

                // NON-ADDITIVE BLENDING:
                // Use maximum blending instead of additive accumulation!
                // This prevents overlapping waves from doubling into bright hot-spots.
                if (instElev > 0.0) {
                    maxPosElev = max(maxPosElev, instElev);
                } else {
                    maxNegElev = min(maxNegElev, instElev);
                }

                // Slope weighting: the dominant local wave controls the normal
                float wSlope = pow(abs(instElev) + 0.001, 2.0);
                weightedSlope += instSlope * wSlope;
                sumWeight += wSlope;

                // NON-ADDITIVE FOAM:
                // Foam tracks the maximum crest sharpness, never adding together
                float crestSharpness = smoothstep(wCrest * 0.30, 0.0, abs(distToCrest));
                float breakCondition = smoothstep(0.44, 0.80, localEnergy) * smoothstep(0.40, 0.85, lifeAmp);
                float foamActive = crestSharpness * latMask * breakCondition * bankDrag;
                
                float fleckFlicker = hash22(cId * 23.1 + vec2(floor(tau * 18.0), seedOffset)).x;
                float instFoam = foamActive * (0.60 + 0.40 * fleckFlicker) * smoothstep(0.35, 0.9, crestShape);

                maxFoam = max(maxFoam, instFoam);
            }
        }

        domSlope = weightedSlope / sumWeight;
    }

    // Downstream river flow wave simulation: discrete localized wavelet instances with diverse C-shape archetypes,
    // emergent non-linear interference, non-additive maximum blending, bank drag, and delicate crest foam
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

        vec2 flowPerp = vec2(-flow.y, flow.x);

        // 1. Bank Boundary Friction & Velocity Drag
        float bankDragDist = max(uBankDrag, 25.0);
        float bankDistNorm = clamp(signedDist / bankDragDist, 0.0, 1.0);
        float bankFactor = mix(0.30, 1.0, smoothstep(0.0, 1.0, bankDistNorm));

        // Parabolic mid-channel velocity bowing (static spatial offset, no runaway time shear)
        float centerDrift = (1.0 - bankDistNorm * bankDistNorm) * 9.0;

        // Organic fluid eddy warp (breaks up global linear uniformity)
        vec2 eddyWarp = vec2(
            sin(worldPos.y * 0.032 + tAnim * 0.35) + cos(worldPos.x * 0.022 - tAnim * 0.30),
            cos(worldPos.x * 0.028 + tAnim * 0.30) - sin(worldPos.y * 0.022 + tAnim * 0.30)
        ) * (4.5 * (1.0 - uWaveRegularity * 0.5));
        vec2 warpedPos = worldPos + eddyWarp;

        // Stream coordinates: u along flow, v perpendicular
        float uProg = dot(warpedPos, flow) - centerDrift;
        float vLat  = dot(warpedPos, flowPerp);

        // Uniform drift speed along the channel
        float baseDrift = tWave * (50.0 * max(0.5, uSpeed));
        float uDrift = uProg - baseDrift;
        vec2 streamPos = vec2(uDrift, vLat);

        float scaleFactor = clamp(uScale / 45.0, 0.5, 2.0);

        // LAYER 1: Primary downstream riffles (wide crescent wavelets)
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

        // LAYER 2: Secondary micro-riffles (smaller, faster, rotated slightly by ~12 deg)
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

        // NON-ADDITIVE INTERACTION:
        // Combine layers using smooth maximum instead of raw addition
        // to strictly prevent doubling / over-saturation
        float posElev = max(posElev1, posElev2 * 0.85);
        float negElev = min(negElev1, negElev2 * 0.85);
        float combinedElev = (posElev + negElev);
        
        // Controlled non-linear steepening
        float steepening = pow(max(0.0, posElev), 2.0) * 0.35;
        float riverElevation = clamp((combinedElev + steepening) * uRiverWaves, -0.5, 1.0);

        // Slope from dominant layer
        float w1 = pow(abs(posElev1 + negElev1) + 0.001, 2.0);
        float w2 = pow(abs(posElev2 + negElev2) + 0.001, 2.0);
        vec2 domSlope = (slope1 * w1 + slope2Rot * w2) / (w1 + w2);
        vec2 riverGrad = (flow * domSlope.x + flowPerp * domSlope.y) * uRiverWaves;

        // Surface normal & specular glints
        riverNormal = normalize(vec3(-clamp(riverGrad, vec2(-0.55), vec2(0.55)) * 1.6, 1.0));

        vec3 L = normalize(vec3(flow * 0.35 + vec2(-0.25, 0.45), 0.88));
        vec3 Hhalf = normalize(L + vec3(0.0, 0.0, 1.0));
        float NdotH = max(0.0, dot(riverNormal, Hhalf));
        
        // Controlled specular highlight: never blows out or doubles
        riverGlint = (pow(NdotH, 44.0) * 0.85 + pow(NdotH, 16.0) * 0.20)
            * smoothstep(0.12, 0.65, riverElevation)
            * (0.65 * uSunGlint * uRiverWaves);

        // NON-ADDITIVE FOAM:
        // Strictly max-based, never doubles into blinding white patches
        float combinedFoam = max(foam1, foam2 * 0.75);
        riverFoam = clamp(combinedFoam * (1.2 * uWhitecaps) * uRiverWaves, 0.0, 0.85);
        // Suppress abruptly at the exact waterline so waves do not spill awkwardly onto dry bank
        riverFoam *= smoothstep(3.0, 20.0, signedDist);

        // Micro-refraction displacement
        riverDisplacement = (-riverGrad) * (uDistortion * 1.8 * uRiverWaves);
    }
`;
