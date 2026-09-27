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
        if (uLakeWaves <= 0.001) {
            lakeFoam = 0.0;
            lakeDisplacement = vec2(0.0);
            lakeNormal = vec3(0.0, 0.0, 1.0);
            lakeGlint = 0.0;
            lakeSkyReflect = 0.0;
            lakeTroughShadow = 0.0;
            lakeElevation = 0.0;
            lakeBankSlosh = 0.0;
            return;
        }

        vec2 windPerp = vec2(-wind.y, wind.x);

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
        float standingSeiche = (sin(tEdge * 0.85 + dynNoise1 * 3.14) * 0.18 + cos(tEdge * 1.15 + dynNoise2 * 4.0) * 0.12);

        float bankMotion = ((lap1 + lap2 + standingSeiche) * swellEnvelope + driftLap);

        // Asymmetric swash steepening (steep wash up the bank, soft slow recession)
        bankMotion = (bankMotion > 0.0) ? pow(bankMotion, 1.25) : -pow(-bankMotion, 0.90);

        // Combined bank slosh + micro edge ruffles
        lakeBankSlosh = (bankMotion * (uSwashSurge * 0.35 * shoreBias)) + (edgeRuffleChop * smoothstep(-4.0, 10.0, softBankDist));

        // 3. Lacustrine Wind Ruffles (Two intersecting ripple wave trains)
        float scaleFactor = clamp(uScale / 100.0, 0.5, 2.0);

        // Primary wind ripples along wind direction
        float rCoord1 = dot(worldPos, wind) / (32.0 * scaleFactor) - tWave * 1.35;
        float rCoord1Perp = dot(worldPos, windPerp) / (45.0 * scaleFactor);
        float ruffle1 = sin(rCoord1 + sin(rCoord1Perp * 1.5) * 0.45);

        // Secondary cross-ruffles angled at 35 degrees
        float rotA = 0.60;
        vec2 windRot = vec2(wind.x * cos(rotA) - wind.y * sin(rotA), wind.x * sin(rotA) + wind.y * cos(rotA));
        float rCoord2 = dot(worldPos, windRot) / (24.0 * scaleFactor) - tWave * 1.65;
        float ruffle2 = cos(rCoord2 + sin(rCoord1 * 1.2) * 0.40);

        // Trochoidal wave steepening: sharp crests, wider flat troughs
        float rawWave = (ruffle1 * 0.60 + ruffle2 * 0.40);
        float waveSteep = (rawWave > 0.0) ? pow(rawWave, 1.35) : -pow(-rawWave, 0.85);
        float surfaceWaves = waveSteep * uLakeWaves;
        float ruffleElev = clamp(surfaceWaves * 0.55, -0.5, 0.85) * smoothstep(0.0, 25.0, softBankDist);

        // 4. Concentric Drop Rings (Raindrops / Leaf / Fish Rises)
        float dropRings = 0.0;
        if (uLakeRings > 0.5) {
            for (int i = 0; i < 4; i++) {
                float fi = float(i);
                vec2 seed = vec2(fi * 17.3 + 11.2, fi * 31.7 + 57.1);
                vec2 cellCoord = floor((worldPos + seed * 50.0) / 320.0);
                vec2 cellDropCenter = (cellCoord + 0.5 + (hash22(cellCoord + seed) - 0.5) * 0.6) * 320.0 - seed * 50.0;
                float dropPeriod = 3.6 + hash21(cellCoord + seed) * 2.2;
                float phase = fract(tAnim / dropPeriod);
                float ringRadius = phase * 75.0;
                float dDrop = length(worldPos - cellDropCenter);
                float ringDist = abs(dDrop - ringRadius);
                float ringWave = sin(ringDist * 0.55 - phase * 6.28) * exp(-ringDist * 0.16) * (1.0 - phase);
                dropRings += ringWave * smoothstep(0.0, 20.0, softBankDist) * 0.25;
            }
        }

        // Total surface elevation
        lakeElevation = ruffleElev + dropRings;

        // Gradient & surface normal (physically tilts with uLakeWaves)
        vec2 ruffleGrad = (wind * (ruffle1 * 0.75) + windRot * (ruffle2 * 0.55)) * (uLakeWaves * 1.15);
        lakeNormal = normalize(vec3(-clamp(ruffleGrad, vec2(-0.75), vec2(0.75)), 1.0));

        vec3 sunDir = normalize(vec3(wind * 0.35 + vec2(-0.25, 0.45), 0.88));
        vec3 halfVec = normalize(sunDir + vec3(0.0, 0.0, 1.0));
        float NdotH = max(0.0, dot(lakeNormal, halfVec));

        // Specular Sun Glint / Shimmer automatically scaled by wave energy
        lakeGlint = (pow(NdotH, 36.0) * 0.85 + pow(NdotH, 12.0) * 0.25)
                    * (0.80 * max(0.05, uLakeWaves) * uSunGlint);

        // Ambient sky reflection & wave trough shadow (visible across the lake without sun glint)
        lakeSkyReflect = clamp(lakeNormal.y * 0.40 + lakeNormal.x * 0.25, -0.5, 0.5) * uLakeWaves;
        lakeTroughShadow = max(0.0, -surfaceWaves) * 0.55;

        // Delicate crest foam if lakeWaves is very high
        lakeFoam = smoothstep(0.55, 0.95, surfaceWaves) * (uWhitecaps * 0.6) * smoothstep(5.0, 25.0, softBankDist);

        // Micro-refraction displacement
        lakeDisplacement = (-lakeNormal.xy) * (uDistortion * 2.2 * uLakeWaves);
    }
`;
