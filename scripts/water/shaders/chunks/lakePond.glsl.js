export const LAKE_POND_CHUNK = `
    // Evaluates lacustrine surface ruffles, trochoidal steepening, omnidirectional basin swash,
    // concentric drop rings, and ambient sky / trough illumination for enclosed lakes and ponds
    void computeLakePondWaves(
        vec2 worldPos, vec2 wind, vec2 shoreNormal, float signedDist, float softBankDist,
        float tWave, float tEdge, float tAnim,
        out float lakeFoam,
        out vec2 lakeDisplacement,
        out vec3 lakeNormal,
        out float lakeGlint,
        out float lakeSkyReflect,
        out float lakeTroughShadow,
        out float lakeElevation,
        out float lakeBankSlosh
    ) {
        lakeFoam = 0.0;
        lakeDisplacement = vec2(0.0);
        lakeNormal = vec3(0.0, 0.0, 1.0);
        lakeGlint = 0.0;
        lakeSkyReflect = 0.0;
        lakeTroughShadow = 0.0;
        lakeElevation = 0.0;
        lakeBankSlosh = 0.0;

        if (uLakeWaves <= 0.001 && uLakeRings <= 0.001) {
            return;
        }

        vec2 windPerp = vec2(-wind.y, wind.x);
        float scaleFactor = clamp(uScale / 100.0, 0.40, 3.00);

        // Ambient lacustrine respiration: living glassy swell present on calm lakes
        float tAmb = uTime * max(0.35, uSpeed * 0.85);
        float ambPhase1 = dot(worldPos, wind * 0.65 + windPerp * 0.35) * (0.015 / scaleFactor) - tAmb * 0.55;
        float ambPhase2 = dot(worldPos, -windPerp * 0.60 + wind * 0.40) * (0.020 / scaleFactor) - tAmb * 0.42;
        float ambWave = (sin(ambPhase1) * 0.06 + cos(ambPhase2) * 0.05) * smoothstep(0.0, 20.0, softBankDist);
        vec2 ambGrad = (wind * cos(ambPhase1) * 0.06 + windPerp * -sin(ambPhase2) * 0.05) * 0.50;

        if (uLakeWaves > 0.001) {
            // 1. Physical Windward vs Leeward Shore Exposure (Intrinsic Physical Fetch)
            // shoreNormal points inward toward deep water; -shoreNormal points toward the bank.
            // windExposure < 0: upwind shore (wind blowing off land onto water) or sheltered lee behind rock.
            // windExposure > 0: downwind receiving shore or windward face of rock.
            float windExposure = dot(wind, -shoreNormal);
            float shoreBias = 1.0 + 0.16 * windExposure;

            // Directional fetch envelope: upwind shores and rock lee-shadows require fetch distance to build waves,
            // while downwind receiving shores and windward rock faces carry waves right to the bank.
            float fetchJitter = noise21(worldPos * (0.016 / scaleFactor) - wind * (tAnim * 0.22));
            float upwindShelter = smoothstep(-0.12, 0.55, -windExposure);
            float requiredFetchDist = mix(14.0, 95.0 + 35.0 * fetchJitter, upwindShelter) * clamp(scaleFactor, 0.65, 1.65);
            float fetchEnvelope = smoothstep(requiredFetchDist * 0.15, requiredFetchDist, softBankDist);

            // Soft-bounded wave energy so 100% slider never blows out surface highlights
            float effLakeEnergy = uLakeWaves / sqrt(1.0 + 0.70 * uLakeWaves * uLakeWaves);

            // 2. Dynamic Perimeter Undulation & Shore Lapping (Omnidirectional Basin Swash)
            // Only needed near the bank where waterReach / fade / swashWetness transition
            if (softBankDist < max(uFadeWidth, 36.0) + 16.0) {
                vec2 drift1 = vec2(cos(tEdge * 0.35), sin(tEdge * 0.28)) * 18.0;
                vec2 drift2 = vec2(-sin(tEdge * 0.42), cos(tEdge * 0.48)) * 24.0;
                float dynNoise1 = noise21(worldPos * 0.022 + drift1 + vec2(tEdge * 0.08, -tEdge * 0.06));
                float dynNoise2 = noise21(worldPos * 0.055 - drift2 + vec2(-tEdge * 0.10, tEdge * 0.11));
                float dynNoise3 = noise21(worldPos * 0.120 + vec2(tEdge * 0.14, -tEdge * 0.12));

                // Radial in-and-out waves travelling toward the shoreline
                float radialLap1 = -signedDist * 0.072 - tEdge * 2.20 + (dynNoise1 - 0.5) * 3.4;
                float radialLap2 = -signedDist * 0.118 - tEdge * 3.35 + (dynNoise2 - 0.5) * 2.8;

                // Directional wind drift fetch component
                float windDriftPhase = dot(worldPos, wind) * 0.042 - tEdge * 1.85 + (dynNoise3 - 0.5) * 2.2;

                // High-frequency shoreline edge ruffles (wind chattering against the bank)
                float edgeChopCoord1 = dot(worldPos, wind) * 0.14 - tEdge * 3.8 + dynNoise2 * 2.5;
                float edgeChopCoord2 = dot(worldPos, windPerp) * 0.18 + tEdge * 2.9 - dynNoise1 * 2.0;
                float edgeRuffleChop = (sin(edgeChopCoord1) * 0.55 + cos(edgeChopCoord2) * 0.45) * (uLakeWaves * 2.6);

                // Spatial swell packet envelope: localized pulses across the shoreline
                float group1 = cos(dot(worldPos, wind) * 0.015 - tEdge * 0.55);
                float group2 = sin(dot(worldPos, windPerp) * 0.020 + tEdge * 0.48);
                float swellEnvelope = clamp(group1 * group1 * 0.60 + group2 * group2 * 0.35 + 0.25, 0.25, 1.0);

                // Superposition of radial waves + subtle wind fetch drift + gentle seiche breathing
                float lap1 = sin(radialLap1) * 0.44;
                float lap2 = cos(radialLap2) * 0.26;
                float driftLap = sin(windDriftPhase) * 0.18 * (0.6 + 0.4 * max(0.0, windExposure));
                float standingSeiche = (sin(tEdge * 0.85 + dynNoise1 * 3.14) * 0.22 + cos(tEdge * 1.15 + dynNoise2 * 4.0) * 0.15);

                float bankMotion = ((lap1 + lap2 + standingSeiche) * swellEnvelope + driftLap);

                // Asymmetric swash steepening (steep wash up the bank, soft slow recession)
                bankMotion = (bankMotion > 0.0) ? pow(bankMotion, 1.25) : -pow(-bankMotion, 0.90);

                // Combined bank slosh + micro edge ruffles (sheltered on upwind banks, active on downwind receiving shores)
                lakeBankSlosh = (bankMotion * (uSwashSurge * 0.35 * shoreBias)) + (edgeRuffleChop * smoothstep(-4.0, 10.0, softBankDist));
                lakeBankSlosh *= mix(0.20, 1.15, smoothstep(-0.65, 0.45, windExposure));
            }

            // 3. Lacustrine Wind Ruffles (Monotonic Wind-Fan Wavelets with Bounded Curvature)
            // Bounded domain warp curves crests gently without folding phase into concentric bullseye loops
            vec2 warp = (vec2(
                noise21(worldPos / (95.0 * scaleFactor) + vec2(tAnim * 0.08, -tAnim * 0.06)),
                noise21(worldPos / (95.0 * scaleFactor) - vec2(tAnim * 0.06, tAnim * 0.07) + 37.1)
            ) - 0.5) * (14.0 * scaleFactor * (1.0 - uWaveRegularity * 0.5));
            vec2 ruffledPos = worldPos + warp;

            // Nearshore wave shoaling bend: gently pulls phase toward receiving shore/rocks without rotating basis
            float shorePull = (1.0 - smoothstep(4.0, 44.0 * scaleFactor, softBankDist)) * smoothstep(-0.10, 0.65, windExposure) * (7.5 * scaleFactor);

            // Traveling "cat's paw" wind gusts modulate wavelet presence across the basin
            float gust1 = noise21(ruffledPos / (180.0 * scaleFactor) - wind * (tAnim * 0.32));
            float gust2 = noise21(ruffledPos / (85.0 * scaleFactor) + vec2(17.3, 42.1) - wind * (tAnim * 0.52));
            float gustMask = mix(0.38, 1.12, smoothstep(0.24, 0.78, gust1 * 0.58 + gust2 * 0.42));

            // Constant wind-fan directions (0 deg, +19 deg, -22 deg) prevent coordinate-folding swirls
            vec2 windRot1 = normalize(wind * 0.945 + windPerp * 0.325);
            vec2 windRot1Perp = vec2(-windRot1.y, windRot1.x);
            vec2 windRot2 = normalize(wind * 0.927 - windPerp * 0.375);
            vec2 windRot2Perp = vec2(-windRot2.y, windRot2.x);

            // Staggered wavelet packet masks break up continuous bars into finite crescentic ripple trains
            float u1 = dot(ruffledPos, wind);
            float v1 = dot(ruffledPos, windPerp);
            float pkt1 = smoothstep(0.22, 0.74, noise21(vec2((u1 - tWave * 22.0) / (72.0 * scaleFactor), v1 / (44.0 * scaleFactor)) + vec2(13.1, 7.4)));
            float pkt2 = smoothstep(0.26, 0.76, noise21(vec2((dot(ruffledPos, windRot1) - tWave * 26.0) / (60.0 * scaleFactor), dot(ruffledPos, windRot1Perp) / (38.0 * scaleFactor)) + vec2(59.3, 31.8)));
            float pkt3 = smoothstep(0.24, 0.78, noise21(vec2((dot(ruffledPos, windRot2) - tWave * 30.0) / (48.0 * scaleFactor), dot(ruffledPos, windRot2Perp) / (32.0 * scaleFactor)) + vec2(91.7, 23.4)));

            // Primary wind wavelets (strictly bounded phase meander <= 0.75 rad prevents contour rings)
            float meander1 = (noise21(ruffledPos / (52.0 * scaleFactor) + vec2(tAnim * 0.11, -tAnim * 0.09)) - 0.5) * 1.15;
            float rCoord1 = (u1 + shorePull) / (26.0 * scaleFactor) - tWave * 1.55 + meander1 + sin(v1 / (38.0 * scaleFactor)) * 0.35;
            float ruffle1 = sin(rCoord1) * pkt1;
            float dRuffle1 = cos(rCoord1) * pkt1;

            // Secondary fanned wavelets (+19 deg)
            float meander2 = (noise21(ruffledPos / (42.0 * scaleFactor) - vec2(tAnim * 0.13, tAnim * 0.10) + 18.3) - 0.5) * 1.05;
            float rCoord2 = (dot(ruffledPos, windRot1) + shorePull * 0.8) / (20.0 * scaleFactor) - tWave * 1.90 + meander2;
            float ruffle2 = cos(rCoord2) * pkt2;
            float dRuffle2 = -sin(rCoord2) * pkt2;

            // Tertiary opposing fanned wavelets (-22 deg)
            float rCoord3 = (dot(ruffledPos, windRot2) + shorePull * 0.6) / (15.0 * scaleFactor) - tWave * 2.30 + meander1 * 0.6;
            float ruffle3 = sin(rCoord3) * (0.42 * pkt3);
            float dRuffle3 = cos(rCoord3) * (0.42 * pkt3);

            // Trochoidal wave steepening: sharp crests, wider flat troughs, gated by directional wind fetch
            float rawWave = (ruffle1 * 0.54 + ruffle2 * 0.38 + ruffle3) * gustMask + ambWave * 0.50;
            float waveSteep = (rawWave > 0.0) ? pow(rawWave, 1.35) : -pow(-rawWave, 0.85);
            float surfaceWaves = waveSteep * effLakeEnergy * fetchEnvelope;
            float ruffleElev = clamp(surfaceWaves * 0.55, -0.5, 0.85) * smoothstep(0.0, 25.0, softBankDist);
            lakeElevation = ruffleElev;

            // Analytical slope gradient
            vec2 ruffleGrad = (
                wind * (dRuffle1 * 0.65) +
                windRot1 * (dRuffle2 * 0.48) +
                windRot2 * (dRuffle3 * 0.32) +
                ambGrad * 0.40
            ) * (effLakeEnergy * 1.05 * gustMask * fetchEnvelope);
            lakeNormal = normalize(vec3(-clamp(ruffleGrad, vec2(-0.65), vec2(0.65)), 1.0));

            // Single-sided downwind crest face (eliminates double-line rings around wave peaks)
            float downwindFace = smoothstep(-0.15, 0.35, dot(-ruffleGrad, wind));
            float singleCrest = smoothstep(0.06, 0.58, surfaceWaves) * (0.35 + 0.65 * downwindFace);

            // Specular Sun Glint: strictly capped so high Wave Energy never washes out into bright white bands
            if (singleCrest > 0.001 && uSunGlint > 0.001 && fetchEnvelope > 0.001) {
                vec3 sunDir = normalize(vec3(wind * 0.35 + vec2(-0.25, 0.45), 0.88));
                vec3 halfVec = normalize(sunDir + vec3(0.0, 0.0, 1.0));
                float NdotH = max(0.0, dot(lakeNormal, halfVec));
                float glintSparkle = smoothstep(0.45, 0.88, noise21(ruffledPos / (14.0 * scaleFactor) - wind * (tAnim * 0.75)));
                float rawGlint = (pow(NdotH, 56.0) * 0.75 + pow(NdotH, 24.0) * 0.16 * glintSparkle)
                            * singleCrest
                            * (0.55 * effLakeEnergy * min(uSunGlint, 1.0) * fetchEnvelope);
                lakeGlint = clamp(rawGlint, 0.0, 0.24);
            }

            // Ambient sky reflection & wave trough shadow (bounded brightness for deep water feel)
            lakeSkyReflect = clamp(singleCrest * 0.22 - max(0.0, -surfaceWaves) * 0.18, -0.20, 0.20) * (effLakeEnergy * 0.55 * fetchEnvelope + 0.06);
            lakeTroughShadow = max(0.0, -surfaceWaves) * 0.62;

            // Subtle, translucent wind-sheared whitecap flecks only on the highest gust crests (capped at 0.34)
            if (surfaceWaves > 0.38 && singleCrest > 0.001 && uWhitecaps > 0.001 && softBankDist > 5.0) {
                float foamWisp = smoothstep(0.38, 0.82, noise21(vec2(u1 * 0.055 - tWave * 1.8, v1 * 0.14) / scaleFactor + vec2(tAnim * 0.30, -tAnim * 0.22)));
                float rawLakeFoam = smoothstep(0.38, 0.82, surfaceWaves) * singleCrest * foamWisp * (uWhitecaps * 0.48) * fetchEnvelope * smoothstep(5.0, 25.0, softBankDist);
                lakeFoam = clamp(rawLakeFoam, 0.0, 0.34);
            }

            // Micro-refraction displacement
            lakeDisplacement = (-lakeNormal.xy) * (uDistortion * 2.2 * uLakeWaves);
        }

        // 4. Concentric Drop Rings (Raindrops / Leaf / Fish Rises - sparse, intermittent inland events)
        if (uLakeRings > 0.001 && uCoastSurf < 0.5) {
            float dropRings = 0.0;
            vec2 dropGrad = vec2(0.0);
            float calmWaterGate = max(0.18, 1.0 - uLakeWaves * 0.72);
            for (int i = 0; i < 4; i++) {
                float fi = float(i);
                vec2 seed = vec2(fi * 17.3 + 11.2, fi * 31.7 + 57.1);
                vec2 cellCoord = floor((worldPos + seed * 90.0) / 580.0);
                float dropPeriod = 14.0 + hash21(cellCoord + seed) * 10.0;
                float dropClock = tAnim + hash21(cellCoord * 3.1 + seed) * dropPeriod;
                float dropCycle = floor(dropClock / dropPeriod);
                float rawPhase = fract(dropClock / dropPeriod);

                // Long quiet rest interval: ring only expands during the first 22% of the cycle
                if (rawPhase > 0.22) continue;

                // Probabilistic cycle gate: only ~38% of cycles emit a ring in a given cell
                vec2 cycleSeed = seed + vec2(dropCycle * 7.13, dropCycle * 13.79);
                if (hash21(cellCoord * 1.9 + cycleSeed) < 0.62) continue;

                vec2 cellDropCenter = (cellCoord + 0.5 + (hash22(cellCoord + cycleSeed) - 0.5) * 0.68) * 580.0 - seed * 90.0;
                float phase = rawPhase / 0.22;
                float ringRadius = phase * 75.0;
                vec2 toFrag = worldPos - cellDropCenter;
                if (abs(toFrag.x) > 112.0 || abs(toFrag.y) > 112.0) continue;
                float dDrop = length(toFrag);
                float ringDist = abs(dDrop - ringRadius);
                if (ringDist > 36.0) continue;
                float ringAmp = exp(-ringDist * 0.16) * (1.0 - phase) * calmWaterGate * smoothstep(0.0, 20.0, softBankDist) * uLakeRings;
                float ringWave = sin(ringDist * 0.55 - phase * 6.28) * ringAmp * 0.35;
                dropRings += ringWave;

                if (dDrop > 0.5) {
                    vec2 radDir = toFrag / dDrop;
                    float slope = cos(ringDist * 0.55 - phase * 6.28) * 0.55 * ringAmp * sign(dDrop - ringRadius);
                    dropGrad += radDir * slope * 0.30;
                }
            }
            if (abs(dropRings) > 0.0005) {
                lakeElevation += dropRings;
                lakeNormal = normalize(vec3(lakeNormal.xy - dropGrad, lakeNormal.z));

                if (uSunGlint > 0.001) {
                    vec3 sunDir = normalize(vec3(wind * 0.35 + vec2(-0.25, 0.45), 0.88));
                    vec3 halfVec = normalize(sunDir + vec3(0.0, 0.0, 1.0));
                    float NdotH = max(0.0, dot(lakeNormal, halfVec));
                    lakeGlint += pow(NdotH, 28.0) * (abs(dropRings) * 1.2 * uSunGlint);
                }
            }
        }
    }

    // Strategy wrapper: populates ArchetypeResult from lake/pond wave physics
    void applyLakeArchetype(vec2 pos, vec2 flow, vec2 shoreNormal, float signedDist, float softBankDist,
                            float tWave, float tAnim, inout ArchetypeResult ar) {
        float tWaveLake = tWave;
        float tEdgeLake = tWave * 0.85;
        float tAnimLake = tAnim;
        float lFoam; vec2 lDisp; vec3 lNorm; float lGlint;
        float lSky, lTrough, lElev, lSlosh;
        computeLakePondWaves(pos, flow, shoreNormal, signedDist, softBankDist,
            tWaveLake, tEdgeLake, tAnimLake,
            lFoam, lDisp, lNorm, lGlint, lSky, lTrough, lElev, lSlosh);
        ar.foam = max(ar.foam, lFoam);
        ar.displacement += lDisp * 0.70;
        ar.glint += lGlint;
        ar.skyReflect = lSky;
        ar.lakeTroughShadow = lTrough;
        ar.elevation = lElev * 0.15;
        ar.bankSlosh = lSlosh;
    }
`;
