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
        ar.elevation = max(ar.elevation, rFoam * 0.45 + slopeMag * 0.35);
    }
`;
