export const COMPOSITE_CHUNK = `
    void main(void) {
        float tWave = uTime * uSpeed;
        float tAnim = uTime * 0.9;
        float t = tWave;

        // Flow direction from angle
        float ca = cos(uFlowAngle);
        float sa = sin(uFlowAngle);
        vec2 flow = vec2(ca, sa);
        vec2 flowPerp = vec2(-sa, ca);

        vec2 causticUV = vWorldPos / uScale;

        // Polygon-aware Signed Distance Field mapping
        vec2 sdfUv = (vWorldPos - uSdfBounds.xy) / uSdfBounds.zw;
        vec4 sdfSample = texture2D(uShoreSdf, clamp(sdfUv, 0.0, 1.0));

        // Fallback distance to rectangular bounding box
        float edgeL = vUv.x * uBounds.z;
        float edgeR = (1.0 - vUv.x) * uBounds.z;
        float edgeT = vUv.y * uBounds.w;
        float edgeB = (1.0 - vUv.y) * uBounds.w;
        float aabbDist = min(min(edgeL, edgeR), min(edgeT, edgeB));

        float hasSdf = (sdfSample.a > 0.5) ? 1.0 : 0.0;
        float isWater = sdfSample.b;
        float inDistPx = sdfSample.r * uSdfMaxDist;
        float outDistPx = sdfSample.g * uSdfMaxDist;

        // signedDist: positive inside water polygon, negative on dry ground or skirt
        float signedDist = (isWater > 0.5) ? inDistPx : (-outDistPx);
        if (hasSdf < 0.5) {
            signedDist = aabbDist;
            isWater = 1.0;
        }

        // Shore normal vector: multi-texel filter stencil (3.5 texels of the 384-grid)
        vec2 sdfStep = vec2(3.5 / 384.0);
        vec4 sR = texture2D(uShoreSdf, clamp(sdfUv + vec2(sdfStep.x, 0.0), 0.0, 1.0));
        vec4 sL = texture2D(uShoreSdf, clamp(sdfUv - vec2(sdfStep.x, 0.0), 0.0, 1.0));
        vec4 sU = texture2D(uShoreSdf, clamp(sdfUv + vec2(0.0, sdfStep.y), 0.0, 1.0));
        vec4 sD = texture2D(uShoreSdf, clamp(sdfUv - vec2(0.0, sdfStep.y), 0.0, 1.0));
        float dR = (sR.b > 0.5) ? (sR.r * uSdfMaxDist) : (-sR.g * uSdfMaxDist);
        float dL = (sL.b > 0.5) ? (sL.r * uSdfMaxDist) : (-sL.g * uSdfMaxDist);
        float dU = (sU.b > 0.5) ? (sU.r * uSdfMaxDist) : (-sU.g * uSdfMaxDist);
        float dD = (sD.b > 0.5) ? (sD.r * uSdfMaxDist) : (-sD.g * uSdfMaxDist);
        vec2 grad = vec2(dR - dL, dU - dD);
        vec2 shoreNormal = length(grad) > 0.001 ? normalize(grad) : vec2(0.0, 1.0);
        vec2 shoreTangent = vec2(-shoreNormal.y, shoreNormal.x);
        if (hasSdf < 0.5) {
            if (aabbDist == edgeL) shoreNormal = vec2(1.0, 0.0);
            else if (aabbDist == edgeR) shoreNormal = vec2(-1.0, 0.0);
            else if (aabbDist == edgeT) shoreNormal = vec2(0.0, 1.0);
            else shoreNormal = vec2(0.0, -1.0);
            shoreTangent = vec2(-shoreNormal.y, shoreNormal.x);
        }

        // Detect artificial map boundary cuts (shore normal pointing inward away from scene frame)
        float distToMapLeft   = max(0.0, vWorldPos.x - uSceneDims.x);
        float distToMapRight  = max(0.0, (uSceneDims.x + uSceneDims.z) - vWorldPos.x);
        float distToMapTop    = max(0.0, vWorldPos.y - uSceneDims.y);
        float distToMapBottom = max(0.0, (uSceneDims.y + uSceneDims.w) - vWorldPos.y);

        float cutLeft   = max(0.0, dot(shoreNormal, vec2(1.0, 0.0)))  * (1.0 - smoothstep(0.0, 80.0, distToMapLeft));
        float cutRight  = max(0.0, dot(shoreNormal, vec2(-1.0, 0.0))) * (1.0 - smoothstep(0.0, 80.0, distToMapRight));
        float cutTop    = max(0.0, dot(shoreNormal, vec2(0.0, 1.0)))  * (1.0 - smoothstep(0.0, 80.0, distToMapTop));
        float cutBottom = max(0.0, dot(shoreNormal, vec2(0.0, -1.0))) * (1.0 - smoothstep(0.0, 80.0, distToMapBottom));
        float mapCutAlignment = max(max(cutLeft, cutRight), max(cutTop, cutBottom));

        // Combined map edge mask: 0.0 on artificial map border cuts, 1.0 on natural inland riverbanks/shorelines
        float mapEdgeMask = 1.0 - smoothstep(0.20, 0.70, mapCutAlignment);

        // 1. Organic Bank Erosion (Carving into the "Hard Limit" / region edge)
        float reg = clamp(uWaveRegularity, 0.0, 1.0);
        float er1 = noise21(vWorldPos * 0.024);
        float er2 = noise21(vWorldPos * 0.068 + vec2(17.3, 41.9));
        float er3 = noise21(vWorldPos * 0.160 - vec2(33.1, 79.4));
        float bankErosion = (er1 * 0.55 + er2 * 0.32 + er3 * 0.13 - 0.45) * (14.0 * (1.0 - reg * 0.65)) * mapEdgeMask;
        float softBankDist = signedDist - bankErosion;

        // 2. Dynamic Fluid Undulation & Slosh (Water sloshing past the Soft Limit)
        float sloshPhase = dot(vWorldPos, flow) * 0.026 - tAnim * (uSpeed * 1.5);
        float slosh1 = sin(sloshPhase + er1 * 3.2);
        float slosh2 = cos(sloshPhase * 1.8 + tAnim * 0.65 + dot(vWorldPos, flowPerp) * 0.035);
        float microSlosh = noise21(vWorldPos * 0.075 + vec2(tAnim * 0.28, -tAnim * 0.22)) - 0.5;
        float bankSlosh = (slosh1 * 0.58 + slosh2 * 0.27 + microSlosh * 0.35) * (uSwashSurge * 0.35) * mapEdgeMask;

        // Lake & Pond physical wave simulation, omnidirectional swash, and drop rings
        float lakeFoam;
        vec2 lakeDisplacement;
        vec3 lakeNormal;
        float lakeGlint;
        float lakeSkyReflect;
        float lakeTroughShadow;
        float lakeElevation;
        float lakeBankSlosh;
        float tWaveLake = uTime * (uSpeed * 0.45);
        float tEdgeLake = uTime * (uSpeed * 0.40);
        float tAnimLake = uTime * (0.15 + 0.25 * uSpeed);
        computeLakePondWaves(vWorldPos, flow, shoreNormal, signedDist, softBankDist, tWaveLake, tEdgeLake, tAnimLake, lakeFoam, lakeDisplacement, lakeNormal, lakeGlint, lakeSkyReflect, lakeTroughShadow, lakeElevation, lakeBankSlosh);

        if (uLakeWaves > 0.001) {
            bankSlosh = lakeBankSlosh;
        }

        // Effective water reach into the terrain / skirt
        float waterReach = softBankDist + bankSlosh;

        // Discard skirt fragments beyond the maximum reach of water and wet swash
        if (waterReach <= -8.0) {
            discard;
        }

        // Open ocean swells, cross-chop, normal vector, and whitecaps
        float oceanFoam;
        float undercurrentFoam;
        float aeratedBase;
        float crestBody;
        vec2 waveDisplacement;
        vec3 oceanNormal;
        float oceanGlint;
        float troughShadow;
        computeChoppyOcean(vWorldPos, flow, tWave, tAnim, oceanFoam, undercurrentFoam, aeratedBase, crestBody, waveDisplacement, oceanNormal, oceanGlint, troughShadow);

        // River downstream wave trains and delicate crest foam
        float riverFoam;
        vec2 riverDisplacement;
        vec3 riverNormal;
        float riverGlint;
        computeRiverWaves(vWorldPos, flow, max(0.0, waterReach), tWave, tAnim, riverFoam, riverDisplacement, riverNormal, riverGlint);

        // Compute distortion offset for refraction (flow-rotated)
        vec2 distUV = causticUV * 2.0;
        float nx = noise21(distUV + flow * tAnim * 0.3 + flowPerp * tAnim * 0.1) - 0.5;
        float ny = noise21(distUV + flow * tAnim * 0.2 - flowPerp * tAnim * 0.15 + 50.0) - 0.5;
        vec2 offset = vec2(nx, ny) * uDistortion;

        // Wave refraction displacement
        vec2 wavePull = waveDisplacement * (uDistortion * 2.6 * uChoppySeas) + riverDisplacement + lakeDisplacement;
        offset += wavePull + (-oceanNormal.xy) * (uDistortion * 0.85 * uChoppySeas);

        // Froth optical scattering
        vec2 frothScatter = (vec2(noise21(vWorldPos / 8.0 + tAnim * 0.08), noise21(vWorldPos / 8.0 - tAnim * 0.07 + 23.1)) - 0.5)
            * (uDistortion * 2.2 * (aeratedBase + undercurrentFoam * 0.5) * uChoppySeas);
        offset += frothScatter;

        vec2 wakeOff = sumWakeDistortion(vWorldPos, tAnim);

        // Convert total refraction displacement from UV space to world pixels
        vec2 totalOffset = offset + wakeOff;
        vec2 dispPx = totalOffset * uSceneDims.zw;

        // Shoreline inward reflection: prevent refraction from pulling dry riverbanks/land
        float normDisp = dot(dispPx, shoreNormal);
        vec2 tangDisp = dispPx - normDisp * shoreNormal;

        // Smoothly reflect outward-pointing displacement inward as we approach the shoreline
        float shoreProximity = 1.0 - smoothstep(0.0, 40.0, signedDist);
        if (normDisp < 0.0) {
            normDisp = mix(normDisp, -normDisp, shoreProximity);
        }

        // Local bank boundary guard: ensure sample position never crosses onto dry land
        float candidateDist = signedDist + normDisp;
        float minWaterDist = 2.0;
        if (candidateDist < minWaterDist) {
            normDisp += (minWaterDist - candidateDist) * 2.0;
        }

        dispPx = tangDisp + normDisp * shoreNormal;

        // Global SDF verification: ensure displacement does not overshoot opposing banks or islands
        if (hasSdf > 0.5) {
            vec2 candPos = vWorldPos + dispPx;
            vec2 candSdfUv = (candPos - uSdfBounds.xy) / uSdfBounds.zw;
            vec4 candSample = texture2D(uShoreSdf, clamp(candSdfUv, 0.0, 1.0));
            if (candSample.a > 0.5) {
                float candInDist = candSample.r * uSdfMaxDist;
                float candOutDist = candSample.g * uSdfMaxDist;
                float candSignedDist = (candSample.b > 0.5) ? candInDist : (-candOutDist);

                if (candSignedDist < minWaterDist) {
                    if (signedDist > minWaterDist) {
                        float tSafe = clamp((signedDist - minWaterDist) / max(0.001, signedDist - candSignedDist), 0.0, 1.0);
                        dispPx *= tSafe;
                    } else {
                        dispPx *= 0.0;
                    }
                }
            }
        }

        // Sample background with reflected inward UVs (refraction)
        vec2 distortedBgUv = clamp(vBgUv + dispPx / uSceneDims.zw, 0.001, 0.999);
        vec4 bgSample = texture2D(uBackground, distortedBgUv);

        // Fluid domain warping
        vec2 causticWarp1 = vec2(
            noise21(causticUV * 1.5 + flow * (tAnim * 0.35)) - 0.5,
            noise21(causticUV * 1.5 - flowPerp * (tAnim * 0.30) + 37.2) - 0.5
        ) * 0.35;
        vec2 causticWarp2 = vec2(
            noise21(causticUV * 2.4 - flow * (tAnim * 0.25) + 71.8) - 0.5,
            noise21(causticUV * 2.4 + flowPerp * (tAnim * 0.28) + 14.9) - 0.5
        ) * 0.25;

        // Two layers of Voronoi caustics with domain noise
        vec2 flowOffset = flow * (tAnim * 13.0) / uScale;
        float c1 = voronoiCaustic(causticUV * 1.0 + flowOffset + causticWarp1, tAnim * 0.25);
        float c2 = voronoiCaustic(causticUV * 1.55 + 3.7 + flowOffset * 0.78 + causticWarp2, tAnim * 0.18);

        // Caustic edge smoothing
        float softC1 = smoothstep(0.01, 0.38, c1);
        float softC2 = smoothstep(0.02, 0.42, c2);
        float caustic = (softC1 * 0.55 + softC2 * 0.45);
        float causticBright = pow(caustic, 1.35) * uIntensity;

        // Suppress shallow-water caustics when open ocean chop is active
        causticBright *= max(0.0, 1.0 - uChoppySeas * 0.85);

        // Depth undulation
        float depthWave = noise21(causticUV * 0.4 + flow * t * 0.08);
        float depth = 0.85 + depthWave * 0.15;

        // Slope shading and depth modulation for open water swells
        vec3 sunDir = normalize(vec3(flow * 0.35 + vec2(-0.25, 0.45), 0.88));
        float diffuse = max(0.0, dot(oceanNormal, sunDir));
        float slopeShading = mix(1.0, mix(0.92, 1.08, diffuse), uChoppySeas * 0.7);

        // Deeper, richer troughs and crest illumination
        float troughFactor = mix(1.0, mix(0.72, 1.16, troughShadow), uChoppySeas * 0.7);
        vec3 waterTint = uWaterColor * (depth * troughFactor) * slopeShading;
        waterTint += uHighlightColor * causticBright * 0.4;

        if (uLakeWaves > 0.001) {
            // Ambient sky reflection across wave slopes
            waterTint += vec3(0.35, 0.65, 0.85) * lakeSkyReflect * 0.60;
            // Wave trough shadow
            waterTint -= vec3(0.04, 0.07, 0.10) * lakeTroughShadow;
            // Physical crest elevation illumination
            waterTint += vec3(0.06, 0.11, 0.15) * max(0.0, lakeElevation);
        }

        // Translucent crest body
        vec3 aquaCrest = mix(uWaterColor * 1.5 + vec3(0.04, 0.16, 0.20), vec3(0.05, 0.48, 0.58), 0.65);
        waterTint = mix(waterTint, aquaCrest, crestBody * 0.55 * uChoppySeas);

        // Aerated subsurface foam base
        vec3 aeratedSeafoam = vec3(0.20, 0.72, 0.75);
        waterTint = mix(waterTint, aeratedSeafoam, clamp(aeratedBase * 0.75 * uChoppySeas, 0.0, 0.65));

        // Subsurface undercurrent churn
        vec3 churnBubbleTint = vec3(0.38, 0.82, 0.88);
        waterTint = mix(waterTint, churnBubbleTint, clamp(undercurrentFoam * 0.70 * uChoppySeas, 0.0, 0.48));

        // Shimmer
        float sparkle = noise21(causticUV * 6.0 + flow * t * 0.2);
        waterTint += vec3(0.06) * smoothstep(0.7, 0.95, sparkle) * uIntensity;

        // Dynamic water opacity under foam
        float dynamicOpacity = mix(uOpacity, max(uOpacity, 0.65), clamp((aeratedBase * 0.45 + undercurrentFoam * 0.40 + oceanFoam * 0.50) * uChoppySeas, 0.0, 0.65));
        vec3 color = mix(bgSample.rgb, waterTint, dynamicOpacity);

        // Distance from shore into water (0 at waterline, positive in water)
        float edgeDist = max(0.0, signedDist);

        // Diagonal stencil samples for 9-point Gaussian fillet of sharp corners
        vec4 sRU = texture2D(uShoreSdf, clamp(sdfUv + vec2(sdfStep.x, sdfStep.y), 0.0, 1.0));
        vec4 sLU = texture2D(uShoreSdf, clamp(sdfUv + vec2(-sdfStep.x, sdfStep.y), 0.0, 1.0));
        vec4 sRD = texture2D(uShoreSdf, clamp(sdfUv + vec2(sdfStep.x, -sdfStep.y), 0.0, 1.0));
        vec4 sLD = texture2D(uShoreSdf, clamp(sdfUv + vec2(-sdfStep.x, -sdfStep.y), 0.0, 1.0));
        float dRU = (sRU.b > 0.5) ? (sRU.r * uSdfMaxDist) : (-sRU.g * uSdfMaxDist);
        float dLU = (sLU.b > 0.5) ? (sLU.r * uSdfMaxDist) : (-sLU.g * uSdfMaxDist);
        float dRD = (sRD.b > 0.5) ? (sRD.r * uSdfMaxDist) : (-sRD.g * uSdfMaxDist);
        float dLD = (sLD.b > 0.5) ? (sLD.r * uSdfMaxDist) : (-sLD.g * uSdfMaxDist);

        // 9-point Gaussian fillet: rounds off sharp polygon vertices into smooth arcs
        float dCross = (dR + dL + dU + dD) * 0.25;
        float dDiag = (dRU + dLU + dRD + dLD) * 0.25;
        float filletedDist = max(0.0, signedDist * 0.25 + dCross * 0.5 + dDiag * 0.25);

        // Curvature and corner detection via discrete Laplacian
        float lapH = dR - 2.0 * signedDist + dL;
        float lapV = dU - 2.0 * signedDist + dD;
        float cornerness = clamp((abs(lapH) + abs(lapV)) / 10.0, 0.0, 1.0);

        // Wave distance transitions to filleted arc at corners
        float waveDist = mix(max(0.0, (signedDist + dR + dL + dU + dD) * 0.2), filletedDist, cornerness * 0.85);

        // Shoreline waves with corner softening and map-edge suppression
        float shoreEffect = computeShoreWaves(waveDist, cornerness, vWorldPos, tWave, tAnim) * uShoreWaves * mapEdgeMask;

        // In open ocean or choppy sea modes, suppress shoreline waves on map edge cuts or non-SDF bounds
        if (uChoppySeas > 0.3) {
            if (hasSdf < 0.5 || signedDist > 45.0) {
                shoreEffect = 0.0;
            }
        }

        // Subtle organic waves and crestlets near tokens in the water
        float tokenWaveEffect = computeTokenWaves(vWorldPos, flow, tAnim);
        float totalWave = max(max(shoreEffect, tokenWaveEffect), max(max(oceanFoam, riverFoam), lakeFoam));

        // Composite wave crests and foam
        if (totalWave > 0.001) {
            vec3 seaInfluencedTint = mix(clamp(color * 1.45 + vec3(0.08, 0.16, 0.20), 0.0, 1.0), vec3(0.84, 0.92, 0.95), 0.55);
            vec3 pureWhiteTint = vec3(0.98, 0.99, 1.0);

            // Multi-scale fluid texturing noise
            float tintSwirl = noise21(vWorldPos / 55.0 - flow * (t * 5.0));
            float tintMeso = noise21(vWorldPos / 22.0 + vec2(t * 0.02, -t * 0.015));
            float tintNoise = tintSwirl * 0.60 + tintMeso * 0.40;

            // Whiteness modulation
            float whiteness = smoothstep(0.28, 0.70, tintNoise);
            whiteness = mix(whiteness, 1.0, clamp(totalWave * 0.85, 0.0, 1.0));
            whiteness = clamp(whiteness * 0.75 + 0.25, 0.0, 1.0);

            vec3 foamTint = mix(seaInfluencedTint, pureWhiteTint, whiteness);
            float foamOpacity = clamp(totalWave * 0.95, 0.0, 0.96);
            color = mix(color, foamTint, foamOpacity);
        }

        // Add specular sun glints onto wave crest facets
        float combinedGlint = oceanGlint + riverGlint + lakeGlint;
        if (combinedGlint > 0.001) {
            color += vec3(0.96, 0.98, 1.0) * combinedGlint * 0.70;
        }

        // Swash / Intertidal ground wetting: where water washes past the soft limit
        float maxReach = softBankDist + (uSwashSurge * 0.35);
        float swashWetness = smoothstep(-16.0, 4.0, maxReach);

        // At edges, blend back to undistorted background with wet ground soak & meniscus highlight
        vec3 bgOriginal = texture2D(uBackground, clamp(vBgUv, 0.0, 1.0)).rgb;
        vec3 soakedBg = bgOriginal * mix(1.0, 0.52, swashWetness);

        // Soft fluid meniscus edge fade (0.0 on dry beach, 1.0 in deep water)
        float fadeDist = max(2.0, uFadeWidth);
        float fade = smoothstep(0.0, fadeDist, max(0.0, waterReach));
        // On artificial map cuts where deep water exits the scene, maintain full opacity
        if (waterReach > 0.0) {
            fade = mix(1.0, fade, mapEdgeMask);
        }
        color = mix(soakedBg, color, fade);

        // Contact tension meniscus highlight along the undulating waterline (zero on map cuts)
        float contactRidge = smoothstep(0.0, 2.0, waterReach) * smoothstep(5.0, 1.8, waterReach);
        float contactFleck = hash21(floor(vWorldPos * 0.45));
        float contactHighlight = contactRidge * (0.65 + 0.35 * contactFleck) * (0.35 + 0.35 * uSunGlint) * mapEdgeMask;
        color += vec3(0.85, 0.95, 1.0) * contactHighlight * fade;

        gl_FragColor = vec4(color, 1.0);
    }
`;
