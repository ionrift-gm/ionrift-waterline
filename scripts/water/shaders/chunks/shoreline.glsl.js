export const SHORELINE_CHUNK = `
    // Discrete Wavelet Packet Emission:
    // Replaces continuous concentric lines with organically distributed individual wave packets.
    // In oceans: rolls perpendicular to coastlines across a wide nearshore shelf (50-74px).
    // In rivers: responds dynamically to main stream current (flow) -- wavelets start tight to
    // the bank (16-28px), drift downstream, shear obliquely into graceful downstream peelers,
    // and exhibit emergent drop-off on leeward trailing shores.
    float computeShoreWaves(float smoothDist, float cornerness, vec2 worldPos, vec2 flow, vec2 shoreNormal, float tWave, float tAnim) {
        float countMul = clamp(uWaveCount, 1.0, 8.0);
        float isRiver = clamp(uRiverWaves * 2.5 * (1.0 - uCoastSurf), 0.0, 1.0);

        // Nearshore shelf approach distance:
        // Ocean/Coast: wide 50-74px surf shelf.
        // River: tight 16-28px near-bank littoral zone so wavelets never intrude into mid-stream.
        float maxApproach = mix(50.0 + countMul * 3.0, 16.0 + countMul * 1.5, isRiver);
        if (smoothDist >= maxApproach || smoothDist <= 0.0) return 0.0;

        // Downstream bank alignment & emergent directional drop-off:
        // shoreNormal points inward into water from bank; -shoreNormal points toward bank.
        vec2 shoreTangent = vec2(-shoreNormal.y, shoreNormal.x);
        float flowAlongBank = dot(flow, shoreTangent);
        float bankParallel = abs(flowAlongBank);
        vec2 downBankTang = (flowAlongBank >= 0.0) ? shoreTangent : -shoreTangent;
        float bankFacing = dot(flow, -shoreNormal);

        // Drop-off in consideration of main stream direction:
        // Leeward shores (water flowing away from bank) gracefully drop off to calm water.
        // Parallel riverbanks maintain clean, graceful bank lapping.
        // Headlands facing oncoming torrent maintain full wave impact.
        float flowExposure = smoothstep(-0.40, 0.15, bankFacing);
        float streamDropOff = mix(1.0, flowExposure, isRiver);
        if (streamDropOff <= 0.001) return 0.0;

        float reg = clamp(uWaveRegularity, 0.0, 1.0);

        // Corner softening: suppresses wave crests inside tight concave vertices
        float cornerBreak = 1.0 - smoothstep(0.20, 0.70, cornerness) * 0.65;

        // Organic domain warp for natural ripple curvature and undulation
        float warp = (noise21(worldPos / 42.0 + vec2(tAnim * 0.15, -tAnim * 0.12)) - 0.5) * (4.5 * (1.0 - reg * 0.60));
        float localDist = max(0.0, smoothDist + warp);

        // Lattice cell size: spaced further apart along riverbanks (68px vs 45px) to eliminate line crowding
        float cellSize = mix(45.0, 68.0, isRiver);
        vec2 cell = floor(worldPos / cellSize);

        // Constant propagation speed (pixels per second): completely independent of wave count
        float waveSpeedPx = 16.0;
        float wavelength = maxApproach / (0.45 + 0.18 * countMul);
        float interval = (wavelength / waveSpeedPx) * mix(1.0, 1.7, isRiver);

        float totalCrest = 0.0;
        float foamScale = mix(clamp(uSurfFoam * 1.3, 0.0, 1.25), clamp(uSurfFoam * 0.65, 0.0, 0.65), isRiver);

        // Precomputed spatial noise shared across all wavelet packet emitters
        float meander = (noise21(worldPos / 24.0 + vec2(tAnim * 0.20, -tAnim * 0.15)) - 0.5) * (3.5 * (1.0 - reg * 0.5));
        float froth = noise21(worldPos / 14.0 + tAnim * 0.35);

        // Rivers use single solitary packets in flight; ocean uses up to 2
        int maxPackets = (isRiver > 0.4) ? 1 : 2;

        // 3x3 search over adjacent wavelet packet emitters
        for (int y = -1; y <= 1; y++) {
            for (int x = -1; x <= 1; x++) {
                vec2 neighbor = vec2(float(x), float(y));
                vec2 c = cell + neighbor;
                vec2 h = hash22(c);

                // Jittered emitter seed in world space
                vec2 seedPos = (c + 0.15 + 0.70 * h) * cellSize;

                // Emitter phase offset and individual speed jitter
                float phaseOffset = mix(h.x, 0.0, reg * 0.5) * interval;
                float speedJitter = mix(0.92 + 0.16 * fract(h.x * 7.3), 1.0, reg * 0.7);
                float cellSpeed = waveSpeedPx * speedJitter;
                float cellTransit = maxApproach / cellSpeed;

                // Local packet age relative to emission cycle
                float tLocal = tWave + phaseOffset;
                float age0 = mod(tLocal, interval);

                for (int p = 0; p < 2; p++) {
                    if (p >= maxPackets) break;
                    float age = (p == 0) ? age0 : (age0 + interval);
                    if (age >= cellTransit) continue;

                    // Physical distance from shoreline: starts at maxApproach, decreases to 0 at shore
                    float packetTargetDist = maxApproach - cellSpeed * age;
                    if (packetTargetDist < 0.0 || packetTargetDist > maxApproach) continue;

                    // In river mode: packet physically drifts downstream with the river current as it travels
                    vec2 packetCenter = seedPos + isRiver * downBankTang * (age * (waveSpeedPx * 1.5 + uSpeed * 8.0));
                    vec2 toFrag = worldPos - packetCenter;
                    float distToSeed = length(toFrag);

                    // Bite-sized packet lateral span
                    float spanRadius = mix(22.0, 36.0, h.y) * mix(1.0, 0.85, isRiver);
                    if (distToSeed > spanRadius * 1.25) continue;

                    // Lateral envelope: smooth bell curve tapering gracefully to 0 at both tips
                    float normDist = distToSeed / spanRadius;
                    float spanEnv = max(0.0, 1.0 - normDist * normDist);
                    spanEnv = spanEnv * spanEnv;

                    // Parabolic crest curvature
                    float crestBow = (1.0 - normDist * normDist) * mix(3.0, 5.0, fract(h.x * 13.7));

                    // Organic wavelet slant and heading jitter
                    float slant = (toFrag.x * (h.x - 0.5) + toFrag.y * (h.y - 0.5)) * 0.10;

                    // Downstream shear & wrapping:
                    // Tilts the wave crest so it wraps along the riverbank in the downstream direction
                    float distAlongDown = dot(toFrag, downBankTang);
                    float streamShear = distAlongDown * (0.38 * isRiver * smoothstep(0.0, 0.35, bankParallel));

                    // Distance from current pixel to the advancing curved packet crest
                    float curvedTargetDist = packetTargetDist - crestBow + slant + meander - streamShear;
                    float distToCrest = localDist - curvedTargetDist;

                    // Crest sharpness and profile (tighter, more delicate on rivers)
                    float crestTight = mix(mix(2.6, 4.0, reg), 3.2, isRiver);
                    float coreWidth = mix(3.6, 2.4, isRiver);
                    float core = pow(max(0.0, 1.0 - abs(distToCrest) / coreWidth), crestTight);

                    // Aerated wash / foam
                    float washWidth = mix(7.5, 4.0, isRiver);
                    float wash = pow(max(0.0, 1.0 - abs(distToCrest) / washWidth), 1.6) * mix(0.32, 0.14, isRiver) * mix(0.70, 1.30, froth) * foamScale;

                    // Lifecycle maturity: rises as it travels, peaks before the beach, softens at landing
                    float normAge = age / cellTransit;
                    float maturity = sin(normAge * 3.14159);
                    maturity = pow(max(0.0, maturity), 0.85);

                    // Shoaling amplification in shallow water
                    float shoaling = 1.0 + (1.0 - smoothstep(4.0, 32.0, localDist)) * uWaveShoaling * mix(1.0, 0.5, isRiver);

                    float packetIntensity = (core + wash) * spanEnv * maturity * shoaling;
                    totalCrest = max(totalCrest, packetIntensity);
                }
            }
        }

        // Shelf approach fade: gracefully transitions to open water offshore
        float approachFade = 1.0 - smoothstep(maxApproach * 0.70, maxApproach, smoothDist);
        // Waterline surf landing fade: smoothly hands off to beach surf wash
        float surfLanding = mix(smoothstep(2.0, 14.0, smoothDist), smoothstep(1.5, 8.0, smoothDist), isRiver);

        // River overall presence scaling and emergent directional drop-off
        float riverPresence = mix(1.0, 0.60, isRiver);
        float waveFoam = totalCrest * approachFade * surfLanding * cornerBreak * uWaveSegment * streamDropOff * riverPresence;

        // Waterline contact wash: pulses downstream with river current
        float edgeNoise = noise21(worldPos / 60.0 - vec2(tAnim * 0.07, -tAnim * 0.05));
        float edgeWash = (1.0 - smoothstep(0.0, 5.0, smoothDist)) * smoothstep(0.35, 0.65, edgeNoise) * 0.25;
        float streamCoord = dot(worldPos, flow);
        float riverEdgePulse = sin(streamCoord * 0.045 - tWave * 2.8) * 0.5 + 0.5;
        float edgePulse = mix(sin(worldPos.x * 0.018 + worldPos.y * 0.022 - tAnim * 1.4) * 0.5 + 0.5, riverEdgePulse, isRiver);
        float edgeFoam = edgeWash * edgePulse * mix(1.0, 0.5, cornerness) * foamScale * streamDropOff;

        return waveFoam + edgeFoam;
    }
`;
