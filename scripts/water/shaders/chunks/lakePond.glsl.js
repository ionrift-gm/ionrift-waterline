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
        float scaleFactor = clamp(uScale / 100.0, 0.5, 2.0);

        // Ambient lacustrine respiration: living glassy swell present on calm lakes
        float tAmb = uTime * max(0.35, uSpeed * 0.85);
        float ambPhase1 = dot(worldPos, wind * 0.65 + windPerp * 0.35) * 0.015 - tAmb * 0.55;
        float ambPhase2 = dot(worldPos, -windPerp * 0.60 + wind * 0.40) * 0.020 - tAmb * 0.42;
        float ambWave = (sin(ambPhase1) * 0.08 + cos(ambPhase2) * 0.06) * smoothstep(0.0, 20.0, softBankDist);
        vec2 ambGrad = (wind * cos(ambPhase1) * 0.08 + windPerp * -sin(ambPhase2) * 0.06) * 0.70;

        if (uLakeWaves > 0.001) {
            // 1. Physical Windward vs Leeward Shore Exposure (Intrinsic Physical Fetch)
            // shoreNormal points inward toward deep water; -shoreNormal points toward the bank
            float windExposure = dot(wind, -shoreNormal);
            float shoreBias = 1.0 + 0.16 * windExposure;

            // 2. Dynamic Perimeter Undulation & Shore Lapping (Omnidirectional Basin Swash)
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

            // Combined bank slosh + micro edge ruffles
            lakeBankSlosh = (bankMotion * (uSwashSurge * 0.35 * shoreBias)) + (edgeRuffleChop * smoothstep(-4.0, 10.0, softBankDist));

            // 3. Lacustrine Wind Ruffles (Organic wavefield with domain warping and gust modulation)
            // Spatial domain warping: curves wave crests organically, preventing rigid parallel grids
            vec2 warp = (vec2(
                noise21(worldPos * 0.011 + vec2(tAnim * 0.08, -tAnim * 0.06)),
                noise21(worldPos * 0.011 - vec2(tAnim * 0.06, tAnim * 0.07) + 37.1)
            ) - 0.5) * (20.0 * scaleFactor);
            vec2 ruffledPos = worldPos + warp;

            // Organic wind gust field (traveling "cat's paws" break up continuous periodic uniformity)
            float gust1 = noise21(ruffledPos * 0.005 - wind * (tAnim * 0.35));
            float gust2 = noise21(ruffledPos * 0.011 + vec2(17.3, 42.1) - wind * (tAnim * 0.55));
            float gustMask = mix(0.55, 1.25, smoothstep(0.20, 0.80, gust1 * 0.65 + gust2 * 0.35));

            // Primary wind ripples along wind direction with meandering crest lines
            float meander1 = (noise21(ruffledPos * 0.022 + vec2(tAnim * 0.09, 0.0)) - 0.5) * 2.0;
            float rCoord1 = dot(ruffledPos, wind) / (32.0 * scaleFactor) - tWave * 1.35 + meander1;
            float rCoord1Perp = dot(ruffledPos, windPerp) / (45.0 * scaleFactor);
            float ruffle1 = sin(rCoord1 + sin(rCoord1Perp * 1.5) * 0.45);

            // Secondary cross-ruffles angled at 35 degrees with dispersive phase
            float rotA = 0.60;
            vec2 windRot = vec2(wind.x * cos(rotA) - wind.y * sin(rotA), wind.x * sin(rotA) + wind.y * cos(rotA));
            float meander2 = (noise21(ruffledPos * 0.028 - vec2(0.0, tAnim * 0.11) + 18.3) - 0.5) * 1.8;
            float rCoord2 = dot(ruffledPos, windRot) / (24.0 * scaleFactor) - tWave * 1.65 + meander2;
            float ruffle2 = cos(rCoord2 + sin(rCoord1 * 1.2) * 0.40);

            // Tertiary capillary micro-texture shimmer
            float rCoord3 = dot(ruffledPos, wind - windRot * 0.5) / (16.0 * scaleFactor) - tWave * 2.20;
            float ruffle3 = sin(rCoord3) * 0.18;

            // Trochoidal wave steepening: sharp crests, wider flat troughs
            float rawWave = (ruffle1 * 0.60 + ruffle2 * 0.40 + ruffle3) * gustMask + ambWave;
            float waveSteep = (rawWave > 0.0) ? pow(rawWave, 1.35) : -pow(-rawWave, 0.85);
            float surfaceWaves = waveSteep * uLakeWaves;
            float ruffleElev = clamp(surfaceWaves * 0.55, -0.5, 0.85) * smoothstep(0.0, 25.0, softBankDist);
            lakeElevation = ruffleElev;

            // Gradient & surface normal (physically tilts with uLakeWaves and ambient breathing)
            vec2 ruffleGrad = (wind * (ruffle1 * 0.75) + windRot * (ruffle2 * 0.55) + ambGrad) * (uLakeWaves * 1.15);
            lakeNormal = normalize(vec3(-clamp(ruffleGrad, vec2(-0.75), vec2(0.75)), 1.0));

            vec3 sunDir = normalize(vec3(wind * 0.35 + vec2(-0.25, 0.45), 0.88));
            vec3 halfVec = normalize(sunDir + vec3(0.0, 0.0, 1.0));
            float NdotH = max(0.0, dot(lakeNormal, halfVec));

            // Specular Sun Glint / Shimmer automatically scaled by wave energy
            lakeGlint = (pow(NdotH, 36.0) * 0.85 + pow(NdotH, 12.0) * 0.25)
                        * (0.80 * uLakeWaves * uSunGlint);

            // Ambient sky reflection & wave trough shadow (visible across the lake without sun glint)
            lakeSkyReflect = clamp(lakeNormal.y * 0.40 + lakeNormal.x * 0.25, -0.5, 0.5) * (uLakeWaves * 0.85 + 0.15);
            lakeTroughShadow = max(0.0, -surfaceWaves) * 0.55;

            // Delicate crest foam if lakeWaves is very high
            lakeFoam = smoothstep(0.55, 0.95, surfaceWaves) * (uWhitecaps * 0.6) * smoothstep(5.0, 25.0, softBankDist);

            // Micro-refraction displacement
            lakeDisplacement = (-lakeNormal.xy) * (uDistortion * 2.2 * uLakeWaves);
        }

        // 4. Concentric Drop Rings (Raindrops / Leaf / Fish Rises - small inland bodies only)
        if (uLakeRings > 0.001 && uCoastSurf < 0.5) {
            float dropRings = 0.0;
            vec2 dropGrad = vec2(0.0);
            for (int i = 0; i < 4; i++) {
                float fi = float(i);
                vec2 seed = vec2(fi * 17.3 + 11.2, fi * 31.7 + 57.1);
                vec2 cellCoord = floor((worldPos + seed * 50.0) / 320.0);
                vec2 cellDropCenter = (cellCoord + 0.5 + (hash22(cellCoord + seed) - 0.5) * 0.6) * 320.0 - seed * 50.0;
                float dropPeriod = 3.6 + hash21(cellCoord + seed) * 2.2;
                float phase = fract(tAnim / dropPeriod);
                float ringRadius = phase * 75.0;
                vec2 toFrag = worldPos - cellDropCenter;
                float dDrop = length(toFrag);
                float ringDist = abs(dDrop - ringRadius);
                float ringAmp = exp(-ringDist * 0.16) * (1.0 - phase) * smoothstep(0.0, 20.0, softBankDist) * uLakeRings;
                float ringWave = sin(ringDist * 0.55 - phase * 6.28) * ringAmp * 0.35;
                dropRings += ringWave;

                if (dDrop > 0.5) {
                    vec2 radDir = toFrag / dDrop;
                    float slope = cos(ringDist * 0.55 - phase * 6.28) * 0.55 * ringAmp * sign(dDrop - ringRadius);
                    dropGrad += radDir * slope * 0.30;
                }
            }
            lakeElevation += dropRings;
            lakeNormal = normalize(vec3(lakeNormal.xy - dropGrad, lakeNormal.z));

            vec3 sunDir = normalize(vec3(wind * 0.35 + vec2(-0.25, 0.45), 0.88));
            vec3 halfVec = normalize(sunDir + vec3(0.0, 0.0, 1.0));
            float NdotH = max(0.0, dot(lakeNormal, halfVec));
            lakeGlint += pow(NdotH, 28.0) * (abs(dropRings) * 1.8 * uSunGlint);
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
        ar.elevation = lElev;
        ar.bankSlosh = lSlosh;
    }
`;
