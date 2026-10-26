export const COMPOSITE_CHUNK = `
    void main(void) {
        float tWave = uTime * uSpeed;
        float tAnim = tWave * 0.9;
        float t = tWave;

        // Flow direction from angle
        float ca = cos(uFlowAngle);
        float sa = sin(uFlowAngle);
        vec2 flow = vec2(ca, sa);
        vec2 flowPerp = vec2(-sa, ca);

        vec2 causticUV = vWorldPos / uScale;

        // Polygon-aware Signed Distance Field mapping
        vec2 sdfUv = (vWorldPos - uSdfBounds.xy) / uSdfBounds.zw;
        bool inSdfBounds = (sdfUv.x >= 0.0 && sdfUv.x <= 1.0 && sdfUv.y >= 0.0 && sdfUv.y <= 1.0);
        vec4 sdfSample = texture2D(uShoreSdf, clamp(sdfUv, 0.0, 1.0));

        // Fallback distance to rectangular bounding box
        float edgeL = vUv.x * uBounds.z;
        float edgeR = (1.0 - vUv.x) * uBounds.z;
        float edgeT = vUv.y * uBounds.w;
        float edgeB = (1.0 - vUv.y) * uBounds.w;
        float aabbDist = min(min(edgeL, edgeR), min(edgeT, edgeB));

        float hasSdf = (inSdfBounds && sdfSample.a > 0.5) ? 1.0 : 0.0;
        // Continuous signed distance: positive inside water polygon, negative on dry ground or skirt
        float signedDist = (hasSdf > 0.5) ? ((sdfSample.b - 0.5) * (2.0 * uSdfMaxDist)) : max(aabbDist, uSdfMaxDist);

        float isWater = smoothstep(-1.0, 1.0, signedDist);
        float inDistPx = max(0.0, signedDist);
        float outDistPx = max(0.0, -signedDist);

        // Shore normal vector: multi-texel filter stencil (3.5 texels of the 384-grid)
        vec2 sdfStep = vec2(3.5 / 384.0);
        vec4 sR = texture2D(uShoreSdf, clamp(sdfUv + vec2(sdfStep.x, 0.0), 0.0, 1.0));
        vec4 sL = texture2D(uShoreSdf, clamp(sdfUv - vec2(sdfStep.x, 0.0), 0.0, 1.0));
        vec4 sU = texture2D(uShoreSdf, clamp(sdfUv + vec2(0.0, sdfStep.y), 0.0, 1.0));
        vec4 sD = texture2D(uShoreSdf, clamp(sdfUv - vec2(0.0, sdfStep.y), 0.0, 1.0));
        float dR = (sR.b - 0.5) * (2.0 * uSdfMaxDist);
        float dL = (sL.b - 0.5) * (2.0 * uSdfMaxDist);
        float dU = (sU.b - 0.5) * (2.0 * uSdfMaxDist);
        float dD = (sD.b - 0.5) * (2.0 * uSdfMaxDist);
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

        // Target shoreline position in world coordinates (closest boundary point this fragment faces)
        vec2 shorePoint = vWorldPos - shoreNormal * max(0.0, signedDist);

        // Scene boundaries
        float sLeft   = uSceneDims.x;
        float sRight  = uSceneDims.x + uSceneDims.z;
        float sTop    = uSceneDims.y;
        float sBottom = uSceneDims.y + uSceneDims.w;

        // Border bleed keeps the waterline seamless at a map cut. That geometry
        // continues into the canvas padding and must not be drawn.
        if (vWorldPos.x < sLeft || vWorldPos.x > sRight || vWorldPos.y < sTop || vWorldPos.y > sBottom) {
            discard;
        }

        // If uBorderTouches was not provided, safely assume any border could be a map cut
        vec4 borderTouches = (length(uBorderTouches) > 0.01) ? uBorderTouches : vec4(1.0);

        // Distance from closest boundary (shorePoint) to scene borders (0.0 if on or past border)
        float shoreDistLeft   = max(0.0, shorePoint.x - sLeft);
        float shoreDistRight  = max(0.0, sRight - shorePoint.x);
        float shoreDistTop    = max(0.0, shorePoint.y - sTop);
        float shoreDistBottom = max(0.0, sBottom - shorePoint.y);

        // Target cut detection: closest boundary is at or past a touched map border
        float targetCutLeft   = borderTouches.x * clamp(shoreNormal.x * 2.5, 0.0, 1.0)  * (1.0 - smoothstep(0.0, 40.0, shoreDistLeft));
        float targetCutRight  = borderTouches.y * clamp(-shoreNormal.x * 2.5, 0.0, 1.0) * (1.0 - smoothstep(0.0, 40.0, shoreDistRight));
        float targetCutTop    = borderTouches.z * clamp(shoreNormal.y * 2.5, 0.0, 1.0)  * (1.0 - smoothstep(0.0, 40.0, shoreDistTop));
        float targetCutBottom = borderTouches.w * clamp(-shoreNormal.y * 2.5, 0.0, 1.0) * (1.0 - smoothstep(0.0, 40.0, shoreDistBottom));
        float targetMapCut = max(max(targetCutLeft, targetCutRight), max(targetCutTop, targetCutBottom));

        // Detect if current pixel is immediately adjacent to an artificial map boundary cut
        float distToMapLeft   = max(0.0, vWorldPos.x - sLeft);
        float distToMapRight  = max(0.0, sRight - vWorldPos.x);
        float distToMapTop    = max(0.0, vWorldPos.y - sTop);
        float distToMapBottom = max(0.0, sBottom - vWorldPos.y);

        float localCutLeft   = borderTouches.x * clamp(shoreNormal.x + 0.6, 0.0, 1.0)  * (1.0 - smoothstep(0.0, 36.0, distToMapLeft));
        float localCutRight  = borderTouches.y * clamp(-shoreNormal.x + 0.6, 0.0, 1.0) * (1.0 - smoothstep(0.0, 36.0, distToMapRight));
        float localCutTop    = borderTouches.z * clamp(shoreNormal.y + 0.6, 0.0, 1.0)  * (1.0 - smoothstep(0.0, 36.0, distToMapTop));
        float localCutBottom = borderTouches.w * clamp(-shoreNormal.y + 0.6, 0.0, 1.0) * (1.0 - smoothstep(0.0, 36.0, distToMapBottom));
        float localMapCut = max(max(localCutLeft, localCutRight), max(localCutTop, localCutBottom));

        float totalMapCut = clamp(max(targetMapCut, localMapCut), 0.0, 1.0);

        // Combined map edge masks
        float shoreIsNatural = 1.0 - smoothstep(0.12, 0.60, totalMapCut);
        float mapEdgeMask = shoreIsNatural;

        // Organic bank erosion
        float reg = clamp(uWaveRegularity, 0.0, 1.0);
        float er1 = noise21(vWorldPos * 0.024);
        float er2 = noise21(vWorldPos * 0.068 + vec2(17.3, 41.9));
        float er3 = noise21(vWorldPos * 0.160 - vec2(33.1, 79.4));
        float bankErosion = (er1 * 0.55 + er2 * 0.32 + er3 * 0.13 - 0.45) * (14.0 * (1.0 - reg * 0.65)) * mapEdgeMask;
        float softBankDist = signedDist - bankErosion;

        // Dynamic fluid undulation and slosh
        float countMul = clamp(uWaveCount, 1.0, 8.0);
        float sloshTempo = (0.75 + 0.10 * countMul) * uSpeed;
        float coastScale = mix(1.0, clamp(uScale / 100.0, 0.40, 3.50), uCoastSurf);
        float sloshPhase = dot(vWorldPos, flow) * (0.022 / coastScale) - uTime * sloshTempo;
        float slosh1 = sin(sloshPhase + er1 * 2.8);
        float slosh2 = cos(sloshPhase * 1.6 + uTime * (sloshTempo * 0.7) + dot(vWorldPos, flowPerp) * (0.028 / coastScale) + er2 * 1.8);
        float microSlosh = noise21(vWorldPos * (0.075 / coastScale) + vec2(tAnim * 0.28, -tAnim * 0.22)) - 0.5;
        float bankSlosh = (slosh1 * 0.58 + slosh2 * 0.27 + microSlosh * 0.35) * (uSwashSurge * 0.35) * mapEdgeMask;

        // ─── Archetype Strategy Dispatch ───
        float isCoastSurf = uCoastSurf;
        ArchetypeResult ar = initArchetypeResult();

        // Lake/pond dispatch (fills bankSlosh for waterReach calculation)
        if (isCoastSurf < 0.5 && (uLakeWaves > 0.001 || uLakeRings > 0.001)) {
            applyLakeArchetype(vWorldPos, flow, shoreNormal, signedDist, softBankDist,
                tWave, tAnim, ar);
            bankSlosh = ar.bankSlosh;
        }

        // Effective water reach into the terrain / skirt
        float waterReach = softBankDist + bankSlosh;

        // Discard skirt fragments beyond water reach
        if (signedDist < 0.0 && waterReach <= 0.0) {
            discard;
        }

        // Ocean/coast dispatch
        applyOceanArchetype(vWorldPos, flow, tWave, tAnim, ar);

        // River dispatch
        applyRiverArchetype(vWorldPos, flow, max(0.0, waterReach), tWave, tAnim, ar);

        // ─── Pre-Refraction Gaussian Fillet & Shore Waves ───
        float edgeDist = max(0.0, signedDist);
        vec4 sRU = texture2D(uShoreSdf, clamp(sdfUv + vec2(sdfStep.x, sdfStep.y), 0.0, 1.0));
        vec4 sLU = texture2D(uShoreSdf, clamp(sdfUv + vec2(-sdfStep.x, sdfStep.y), 0.0, 1.0));
        vec4 sRD = texture2D(uShoreSdf, clamp(sdfUv + vec2(sdfStep.x, -sdfStep.y), 0.0, 1.0));
        vec4 sLD = texture2D(uShoreSdf, clamp(sdfUv + vec2(-sdfStep.x, -sdfStep.y), 0.0, 1.0));
        float dRU = (sRU.b - 0.5) * (2.0 * uSdfMaxDist);
        float dLU = (sLU.b - 0.5) * (2.0 * uSdfMaxDist);
        float dRD = (sRD.b - 0.5) * (2.0 * uSdfMaxDist);
        float dLD = (sLD.b - 0.5) * (2.0 * uSdfMaxDist);
        float dCross = (dR + dL + dU + dD) * 0.25;
        float dDiag = (dRU + dLU + dRD + dLD) * 0.25;
        float filletedDist = max(0.0, signedDist * 0.25 + dCross * 0.5 + dDiag * 0.25);
        float lapH = dR - 2.0 * signedDist + dL;
        float lapV = dU - 2.0 * signedDist + dD;
        float cornerness = clamp((abs(lapH) + abs(lapV)) / 10.0, 0.0, 1.0);
        float waveDist = mix(max(0.0, (signedDist + dR + dL + dU + dD) * 0.2), filletedDist, cornerness * 0.85);

        float shoreEffect = 0.0;
        if (hasSdf > 0.5 && shoreIsNatural > 0.05 && uShoreWaves > 0.001) {
            float shorePresence = mix(uShoreWaves, clamp(uShoreWaves * 1.45, 0.55, 1.0), isCoastSurf);
            shoreEffect = computeShoreWaves(waveDist, cornerness, vWorldPos, flow, shoreNormal, tWave, tAnim) * shorePresence * shoreIsNatural * mapEdgeMask;
        }
        float tokenWaveEffect = computeTokenWaves(vWorldPos, flow, tAnim);
        float totalWave = max(max(shoreEffect, tokenWaveEffect), ar.foam);
        float lensShield = 1.0 - clamp(max(totalWave * 1.45, ar.aeratedBase * 0.90 + ar.undercurrentFoam * 0.55), 0.0, 0.94);

        // ─── Refraction Pipeline ───
        vec2 distUV = causticUV * 2.0;
        float nx = noise21(distUV - flow * (tAnim * 0.3) + flowPerp * (tAnim * 0.1)) - 0.5;
        float ny = noise21(distUV - flow * (tAnim * 0.2) - flowPerp * (tAnim * 0.15) + 50.0) - 0.5;
        vec2 offset = vec2(nx, ny) * uDistortion;

        // Wave refraction displacement from archetype strategy
        offset += ar.displacement;

        // Froth optical scattering (parameterized by struct: zero for non-ocean)
        vec2 frothScatter = (vec2(noise21(vWorldPos / 48.0 + tAnim * 0.08), noise21(vWorldPos / 48.0 - tAnim * 0.07 + 23.1)) - 0.5)
            * (uDistortion * 0.30 * (ar.aeratedBase + ar.undercurrentFoam * 0.5) * uChoppySeas);
        offset += frothScatter;
        offset *= lensShield;

        vec2 wakeOff = sumWakeDistortion(vWorldPos, tAnim);

        // Convert total refraction displacement from UV space to world pixels and clamp to safe physical limits
        vec2 totalOffset = offset + wakeOff;
        vec2 dispPx = totalOffset * uSceneDims.zw;
        dispPx = clamp(dispPx, vec2(-22.0), vec2(22.0));

        // Shoreline inward reflection: prevent refraction from pulling dry riverbanks/land or black contours
        float normDisp = dot(dispPx, shoreNormal);
        vec2 tangDisp = dispPx - normDisp * shoreNormal;

        // Minimum distance from waterline for safe sampling
        float minWaterDist = 4.0;
        if (normDisp < 0.0) {
            normDisp = -normDisp * smoothstep(0.0, 8.0, inDistPx) * 0.30;
        }

        // Keep refraction sampling at least minWaterDist inside the water body
        float candidateDist = inDistPx + normDisp;
        if (candidateDist < minWaterDist && shoreIsNatural > 0.5) {
            normDisp = max(normDisp, minWaterDist - inDistPx);
        }

        dispPx = tangDisp + normDisp * shoreNormal;

        // Global SDF candidate verification: re-sample at displaced position
        if (hasSdf > 0.5) {
            vec2 candWorldPos = vWorldPos + dispPx;
            vec2 candSdfUv = (candWorldPos - uSdfBounds.xy) / uSdfBounds.zw;
            vec4 candSample = texture2D(uShoreSdf, clamp(candSdfUv, 0.0, 1.0));
            if (candSample.a > 0.5) {
                float candSignedDist = (candSample.b - 0.5) * (2.0 * uSdfMaxDist);
                if (candSignedDist < minWaterDist) {
                    // Displaced position is on dry land or too close to shore: reflect inward
                    float neededPush = minWaterDist - candSignedDist;
                    dispPx += shoreNormal * neededPush;
                    dispPx = clamp(dispPx, vec2(-22.0), vec2(22.0));
                }
            }
        }

        // Distorted background texture sampling
        vec2 distortedBgUv = clamp(vBgUv + dispPx / uSceneDims.zw, 0.0, 1.0);
        vec4 bgSample = texture2D(uBackground, distortedBgUv);

        // ─── Caustics (coast/ocean only) ───
        float causticBright = 0.0;
        if (isCoastSurf > 0.5 && uIntensity > 0.001 && uChoppySeas < 1.15) {
            vec2 causticWarp1 = vec2(
                noise21(causticUV * 1.5 - flow * (tAnim * 0.35)) - 0.5,
                noise21(causticUV * 1.5 - flowPerp * (tAnim * 0.30) + 37.2) - 0.5
            ) * 0.35;
            vec2 causticWarp2 = vec2(
                noise21(causticUV * 2.4 - flow * (tAnim * 0.25) + 71.8) - 0.5,
                noise21(causticUV * 2.4 + flowPerp * (tAnim * 0.28) + 14.9) - 0.5
            ) * 0.25;

            vec2 flowOffset = -flow * (tAnim * 13.0) / uScale;
            float c1 = voronoiCaustic(causticUV * 1.0 + flowOffset + causticWarp1, tAnim * 0.25);
            float c2 = voronoiCaustic(causticUV * 1.55 + 3.7 + flowOffset * 0.78 + causticWarp2, tAnim * 0.18);

            float softC1 = smoothstep(0.01, 0.38, c1);
            float softC2 = smoothstep(0.02, 0.42, c2);
            float caustic = (softC1 * 0.55 + softC2 * 0.45);
            causticBright = pow(caustic, 1.35) * uIntensity * max(0.0, 1.0 - uChoppySeas * 0.85);
        }

        // ─── Tinting Pipeline ───
        // Depth undulation
        float depthWave = noise21(causticUV * 0.4 - flow * (t * 0.20));
        float depth = 0.85 + depthWave * 0.15;

        // Slope shading and depth modulation (parameterized by ar.normal, ar.troughShadow)
        vec3 sunDir = normalize(vec3(flow * 0.35 + vec2(-0.25, 0.45), 0.88));
        float diffuse = max(0.0, dot(ar.normal, sunDir));
        float waveActivity = max(uChoppySeas, max(uRiverWaves, uLakeWaves));
        float surfaceFoamMask = 1.0 - clamp((totalWave * 1.35 + ar.aeratedBase * 0.85 + ar.undercurrentFoam * 0.6) * 1.2, 0.0, 0.95);
        float slopeShading = mix(1.0, mix(0.92, 1.08, diffuse), waveActivity * 0.55 * surfaceFoamMask);

        float troughFactor = mix(1.0, mix(0.84, 1.08, ar.troughShadow), uChoppySeas * 0.45 * surfaceFoamMask);
        vec3 waterTint = uWaterColor * (depth * troughFactor) * slopeShading;
        waterTint += uHighlightColor * causticBright * 0.4;

        // Lake illumination (struct-parameterized: zero for non-lake archetypes)
        waterTint += vec3(0.35, 0.65, 0.85) * ar.skyReflect * 0.60;
        waterTint -= vec3(0.04, 0.07, 0.10) * ar.lakeTroughShadow;
        waterTint += vec3(0.06, 0.11, 0.15) * max(0.0, ar.elevation);

        // Translucent crest body (struct-parameterized: zero for non-ocean)
        vec3 aquaCrest = mix(uWaterColor * 1.5 + vec3(0.04, 0.16, 0.20), vec3(0.05, 0.48, 0.58), 0.65);
        waterTint = mix(waterTint, aquaCrest, ar.crestBody * 0.35 * uChoppySeas * surfaceFoamMask);

        // Aerated subsurface foam base (struct-parameterized)
        vec3 aeratedSeafoam = vec3(0.20, 0.72, 0.75);
        waterTint = mix(waterTint, aeratedSeafoam, clamp(ar.aeratedBase * 0.75 * uChoppySeas, 0.0, 0.65));

        // Subsurface undercurrent churn (struct-parameterized)
        vec3 churnBubbleTint = vec3(0.38, 0.82, 0.88);
        waterTint = mix(waterTint, churnBubbleTint, clamp(ar.undercurrentFoam * 0.70 * uChoppySeas, 0.0, 0.48));

        // Shimmer sparkle (coast/ocean only)
        if (isCoastSurf > 0.5 && uIntensity > 0.001) {
            float sparkle = noise21(causticUV * 6.0 - flow * (t * 0.2));
            waterTint += vec3(0.06) * smoothstep(0.7, 0.95, sparkle) * uIntensity;
        }

        // Dynamic water opacity under foam (struct-parameterized: uChoppySeas gates non-ocean to uOpacity)
        float dynamicOpacity = mix(uOpacity, max(uOpacity, 0.90), clamp(totalWave * 1.25 + (ar.aeratedBase * 0.55 + ar.undercurrentFoam * 0.45) * uChoppySeas, 0.0, 0.90));
        vec3 color = mix(bgSample.rgb, waterTint, dynamicOpacity);

        // ─── Foam Compositing ───
        vec3 foamTint = vec3(0.98, 0.99, 1.0);
        float foamOpacity = 0.0;
        if (totalWave > 0.001 || ar.undercurrentFoam > 0.001) {
            vec3 bgCalm = texture2D(uBackground, clamp(vBgUv + (dispPx * 0.08) / uSceneDims.zw, 0.0, 1.0)).rgb;
            vec3 cleanSeaBase = mix(bgCalm, uWaterColor * depth, max(uOpacity, 0.85));
            vec3 seaInfluencedTint = mix(clamp(cleanSeaBase * 1.45 + vec3(0.14, 0.24, 0.28), 0.0, 1.0), vec3(0.90, 0.96, 0.98), 0.72);
            vec3 pureWhiteTint = vec3(0.98, 0.99, 1.0);

            // Multi-scale fluid texturing noise
            float tintSwirl = noise21(vWorldPos / 55.0 - flow * (t * 0.4));
            float tintMeso = noise21(vWorldPos / 22.0 + vec2(t * 0.02, -t * 0.015));
            float tintNoise = tintSwirl * 0.60 + tintMeso * 0.40;

            // Whiteness modulation
            float whiteness = smoothstep(0.28, 0.70, tintNoise);
            whiteness = mix(whiteness, 1.0, clamp(totalWave * 0.85, 0.0, 1.0));
            whiteness = clamp(whiteness * 0.45 + 0.55, 0.0, 1.0);

            foamTint = mix(seaInfluencedTint, pureWhiteTint, whiteness);
            color = mix(color, cleanSeaBase, smoothstep(0.16, 0.76, max(totalWave, ar.undercurrentFoam * 0.75)) * 0.85);

            // Secondary under-lapping wake sub-mesh
            float underWaveAlpha = clamp(ar.undercurrentFoam * 0.68, 0.0, 0.74) * (1.0 - clamp(totalWave * 0.62, 0.0, 0.78));
            vec3 underWaveTint = mix(cleanSeaBase, seaInfluencedTint, 0.66);
            color = mix(color, underWaveTint, underWaveAlpha);

            foamOpacity = clamp(totalWave * 0.95, 0.0, 0.96);
            color = mix(color, foamTint, foamOpacity);
        }

        // Sun glints from archetype strategy
        if (ar.glint > 0.001) {
            color += vec3(0.96, 0.98, 1.0) * ar.glint * 0.70 * (1.0 - foamOpacity * 0.85);
        }

        // ─── Meniscus & Edge Output ───
        // Swash / intertidal ground wetting: darkens and moistens shore where waves reach and recede
        float wetMargin = mix(24.0 + uSwashSurge * 0.75, 16.0 + uSwashSurge * 0.40, isCoastSurf);
        float swashWetness = smoothstep(-wetMargin, 6.0, waterReach + bankSlosh * 0.5);

        // At edges, sample undistorted background
        vec3 bgOriginal = texture2D(uBackground, clamp(vBgUv, 0.0, 1.0)).rgb;

        // Ground soak: coastal sand sheen (0.90), organic damp mud for lakes (0.76)
        float soakDarken = mix(0.76, 0.90, isCoastSurf);
        vec3 soakedBg = bgOriginal * mix(1.0, soakDarken, swashWetness);

        // Soft fluid meniscus edge fade
        float fadeDist = max(0.001, uFadeWidth);
        float effectiveFadeDist = mix(min(fadeDist, 18.0 + fadeDist * 0.30), fadeDist, isCoastSurf);
        float fade = (uFadeWidth <= 0.5) ? ((waterReach > 0.0) ? 1.0 : 0.0) : smoothstep(0.0, effectiveFadeDist, max(0.0, waterReach));
        fade = mix(1.0, fade, shoreIsNatural);
        color = mix(soakedBg, color, fade);

        // Coastal white surf wash and leading edge froth (coast/ocean only)
        if (isCoastSurf > 0.5 && waterReach > 0.0 && uSurfFoam > 0.001) {
            float surgeTempo = (0.75 + 0.10 * countMul) * uSpeed;
            float surgePhase = dot(vWorldPos, flow) * (0.022 / coastScale) - uTime * surgeTempo + er1 * 2.8;

            // Dynamic fluid surge
            float surgeCycle = sin(surgePhase) * 0.75 + cos(surgePhase * 1.6 + er2 * 1.8) * 0.25;
            float surgeMotion = (surgeCycle > 0.0) ? pow(surgeCycle, 1.25) : -pow(-surgeCycle, 0.85);
            vec2 surgeDrift = -shoreNormal * (surgeMotion * (3.5 + countMul * 0.35) * coastScale);
            float surgePhase2 = surgePhase + 2.35 + er2 * 1.4;
            float surgeCycle2 = sin(surgePhase2) * 0.72 + cos(surgePhase2 * 1.5 - er1 * 1.6) * 0.28;
            float surgeMotion2 = (surgeCycle2 > 0.0) ? pow(surgeCycle2, 1.25) : -pow(-surgeCycle2, 0.85);
            vec2 surgeDrift2 = -shoreNormal * (surgeMotion2 * (3.2 + countMul * 0.30) * coastScale);
            vec2 currentDrift = -flow * (uTime * (surgeTempo * 5.0));
            vec2 swashCoord = vWorldPos + currentDrift + surgeDrift;

            const float SWASH_FREQ = 0.088;
            float shoreFoamScale = pow(coastScale, 0.35);
            vec2 swashUv = (swashCoord * SWASH_FREQ) / shoreFoamScale;

            // Gentle fluid eddy swirl
            vec2 swashSwirl = vec2(
                sin(swashUv.y * 1.1 + tAnim * 0.65) * 0.16 + cos(swashUv.x * 0.95 - tAnim * 0.50) * 0.10,
                cos(swashUv.x * 1.1 - tAnim * 0.60) * 0.16 + sin(swashUv.y * 0.95 + tAnim * 0.45) * 0.10
            );

            // Gentle macro domain warp
            vec2 swashWarp = (vec2(
                noise21(swashUv * 1.05 + vec2(tAnim * 0.14, -tAnim * 0.10)),
                noise21(swashUv * 1.05 - vec2(tAnim * 0.10, tAnim * 0.12) + 26.4)
            ) - 0.5) * 0.16;

            vec2 warpedSwashUv = swashUv + swashSwirl + swashWarp;

            vec2 swashCoord2 = vWorldPos + currentDrift * 0.78 + surgeDrift2 + vec2(37.0, -23.0);
            vec2 swashUv2 = (swashCoord2 * (SWASH_FREQ * 1.18)) / shoreFoamScale;
            vec2 warpedSwashUv2 = swashUv2 - swashSwirl * 0.85 + swashWarp * 1.15 + vec2(14.3, -9.7);

            // Dual independent Voronoi bubble lattices for overlapping/underlapping sub-meshes
            vec2 voroField1 = voronoiBubbleField(warpedSwashUv, tAnim * 0.95);
            vec2 voroField2 = voronoiBubbleField(warpedSwashUv2, tAnim * 0.82 + 19.4);

            float voroMeso1 = voroField1.y;
            float voroMeso2 = voroField2.y;

            // Organic edge noise applied to field distance
            float edgeNoise = (noise21((vWorldPos + surgeDrift) / 9.0 + vec2(tAnim * 0.12, -tAnim * 0.10)) - 0.5) * 0.07;
            float softMeso1 = max(0.0, voroMeso1 + edgeNoise);
            float softMeso2 = max(0.0, voroMeso2 - edgeNoise * 0.85);

            // Sub-mesh spatial segmentation: break contiguous ribbon into overlapping scalloped lobes
            vec2 pShore = vWorldPos / coastScale;
            vec2 lobeWarp1 = vec2(
                noise21(pShore / 58.0 + vec2(tAnim * 0.05, -tAnim * 0.04)) - 0.5,
                noise21(pShore / 58.0 - vec2(tAnim * 0.04, tAnim * 0.06) + 31.7) - 0.5
            ) * 38.0;
            vec2 lobeWarp2 = vec2(
                noise21(pShore / 52.0 - vec2(tAnim * 0.06, tAnim * 0.04) + 73.9) - 0.5,
                noise21(pShore / 52.0 + vec2(tAnim * 0.05, -tAnim * 0.05) + 109.3) - 0.5
            ) * 36.0;

            vec2 lp1 = pShore + lobeWarp1;
            float n1Large = noise21(lp1 / 78.0 + vec2(tAnim * 0.03, -tAnim * 0.025));
            float n1Med   = noise21(lp1 / 36.0 - vec2(tAnim * 0.05, tAnim * 0.04) + 19.3);
            float n1Wave  = sin(lp1.x * 0.052 - lp1.y * 0.044 + n1Large * 3.8 - tAnim * 0.22) * 0.5 + 0.5;
            float rawLobe1 = n1Large * 0.42 + n1Med * 0.33 + n1Wave * 0.25;
            float lobeCutoff1 = mix(0.41, 0.34, reg * 0.5);
            float lobeEnv1 = smoothstep(lobeCutoff1, lobeCutoff1 + 0.32, rawLobe1);

            vec2 lp2 = pShore + lobeWarp2 + vec2(54.0, -39.0);
            float n2Large = noise21(lp2 / 68.0 - vec2(tAnim * 0.035, tAnim * 0.03) + 67.1);
            float n2Med   = noise21(lp2 / 32.0 + vec2(tAnim * 0.055, -tAnim * 0.045) + 93.4);
            float n2Wave  = sin(lp2.x * 0.046 + lp2.y * 0.054 + n2Large * 4.1 + tAnim * 0.19 + 2.4) * 0.5 + 0.5;
            float rawLobe2 = n2Large * 0.42 + n2Med * 0.33 + n2Wave * 0.25;
            float lobeCutoff2 = mix(0.43, 0.36, reg * 0.5);
            float lobeEnv2 = smoothstep(lobeCutoff2, lobeCutoff2 + 0.32, rawLobe2);

            // Variable cross-shore reach & extremity feathering per sub-mesh
            float reachNoise1 = noise21(lp1 / 45.0 + vec2(17.3, -29.8));
            float lobeShape1 = pow(lobeEnv1, 0.65);
            float minReach1 = mix(3.5, 0.0, lobeShape1) * coastScale;
            float maxReach1 = minReach1 + mix(4.0, mix(16.0, 50.0, reachNoise1) * mix(0.80, 1.20, surgeMotion * 0.5 + 0.5), lobeShape1) * coastScale;
            float innerEdgeWarp1 = (noise21(lp1 / 16.0 + tAnim * 0.08) - 0.5) * 9.0 * coastScale;
            float effReach1 = max(0.0, waterReach + innerEdgeWarp1);
            float radialFeather1 = smoothstep(minReach1, minReach1 + 3.0 * coastScale, waterReach)
                * (1.0 - smoothstep(maxReach1 * 0.22, maxReach1, effReach1));
            float subEnv1 = radialFeather1 * lobeEnv1;

            float reachNoise2 = noise21(lp2 / 42.0 + vec2(-41.6, 63.2));
            float lobeShape2 = pow(lobeEnv2, 0.65);
            float detach2 = smoothstep(0.35, 0.85, 1.0 - reachNoise2) * 7.5;
            float minReach2 = (detach2 + mix(4.0, 0.0, lobeShape2)) * coastScale;
            float maxReach2 = minReach2 + mix(4.0, mix(14.0, 44.0, reachNoise2) * mix(0.80, 1.20, surgeMotion2 * 0.5 + 0.5), lobeShape2) * coastScale;
            float innerEdgeWarp2 = (noise21(lp2 / 14.0 - tAnim * 0.09 + 51.4) - 0.5) * 8.5 * coastScale;
            float effReach2 = max(0.0, waterReach + innerEdgeWarp2);
            float radialFeather2 = smoothstep(minReach2, minReach2 + 4.0 * coastScale, waterReach)
                * (1.0 - smoothstep(maxReach2 * 0.22, maxReach2, effReach2));
            float subEnv2 = radialFeather2 * lobeEnv2;

            // Feathered Voronoi wall thickness & internal fenestration holes at extremities
            float microFroth = noise21(vWorldPos / 8.0 + (tAnim * 0.25));
            float aeration = 0.72 + 0.28 * microFroth;
            float hole1 = smoothstep(0.55, 0.82, noise21(pShore / 24.0 + vec2(tAnim * 0.05, -tAnim * 0.04))) * (1.0 - subEnv1 * 0.55);
            float hole2 = smoothstep(0.53, 0.80, noise21(pShore / 21.0 - vec2(tAnim * 0.04, tAnim * 0.05) + 61.3)) * (1.0 - subEnv2 * 0.55);

            float wallWidth1 = mix(0.08, 0.37, smoothstep(0.0, 0.72, subEnv1));
            float wallWidth2 = mix(0.07, 0.34, smoothstep(0.0, 0.72, subEnv2));
            float subMesh1 = pow(1.0 - smoothstep(0.016, wallWidth1, softMeso1), 1.35)
                * smoothstep(0.0, 0.32, subEnv1) * mix(0.30, 1.0, subEnv1) * (1.0 - hole1 * 0.65) * aeration;
            float subMesh2 = pow(1.0 - smoothstep(0.016, wallWidth2, softMeso2), 1.40)
                * smoothstep(0.0, 0.32, subEnv2) * mix(0.28, 1.0, subEnv2) * (1.0 - hole2 * 0.65) * aeration;

            float washGain = clamp(uShoreWaves * 1.35, 0.45, 1.10) * clamp(uSurfFoam * 1.25, 0.0, 1.30) * mapEdgeMask;
            float layerSwap = smoothstep(0.35, 0.65, noise21(pShore / 90.0 + 37.2));
            float underWash = mix(subMesh2, subMesh1, layerSwap) * washGain;
            float overWash  = mix(subMesh1, subMesh2, layerSwap) * washGain;

            // Soft leading edge froth crest modulated by sub-mesh lobes
            float lobePresence = clamp(lobeEnv1 + lobeEnv2 * 0.80, 0.0, 1.0);
            float leadWidth = mix(2.2, 6.2, lobePresence) * coastScale;
            float leadEdge = smoothstep(0.0, 2.0, waterReach) * smoothstep(leadWidth, 1.6, waterReach);
            float edgeRuffle = 0.85 + 0.30 * noise21((vWorldPos + surgeDrift) / 14.0 - (tAnim * 0.25));
            float leadFroth = leadEdge * mix(0.12, 1.0, lobePresence) * edgeRuffle * 0.82 * clamp(uSurfFoam * 1.20, 0.0, 1.25) * mapEdgeMask;

            // Composite underlapping sub-mesh (slightly submerged aqua-white) then overlapping sub-mesh
            vec3 underSwashTint = mix(uWaterColor * 1.35 + vec3(0.14, 0.24, 0.28), vec3(0.88, 0.95, 0.98), 0.72);
            vec3 overSwashTint = vec3(0.97, 0.99, 1.0);
            float foamCap = clamp(uSurfFoam * 1.25, 0.0, 1.0);
            color = mix(color, underSwashTint, clamp(underWash, 0.0, 1.0) * 0.58 * foamCap);
            color = mix(color, overSwashTint, clamp(max(overWash, leadFroth), 0.0, 1.0) * 0.82 * foamCap);
        }

        // Foam punch-through for inland bodies
        if (isCoastSurf <= 0.5 && totalWave > 0.001 && waterReach > -2.0) {
            float foamPunch = smoothstep(-2.0, 4.0, waterReach) * clamp(uSurfFoam * 1.25, 0.0, 1.0);
            color = mix(color, foamTint, foamPunch * foamOpacity);
        }

        // Lacustrine shore wash & lapping edge for inland bodies (lakes / ponds)
        if (isCoastSurf <= 0.5 && waterReach > 0.0) {
            float lapEdge = smoothstep(0.0, 2.5, waterReach) * smoothstep(8.0, 1.5, waterReach);
            float shoreLace = noise21(vWorldPos / 18.0 + vec2(tAnim * 0.20, -tAnim * 0.15));
            float lapFoam = lapEdge * clamp(uSurfFoam * 1.35, 0.0, 1.2) * (0.50 + 0.50 * shoreLace);
            vec3 lakeWashTint = mix(uWaterColor * 1.25 + vec3(0.12, 0.18, 0.22), vec3(0.96, 0.98, 1.0), 0.70);
            color = mix(color, lakeWashTint, clamp(lapFoam, 0.0, 1.0) * 0.65 * mapEdgeMask);
        }

        // Contact tension meniscus highlight along the undulating waterline
        float contactRidge = smoothstep(0.0, 2.0, waterReach) * smoothstep(5.0, 1.8, waterReach);
        float contactFleck = hash21(floor(vWorldPos * 0.45));
        float contactHighlight = contactRidge * (0.65 + 0.35 * contactFleck) * (0.45 + 0.45 * uSunGlint) * mapEdgeMask;
        color += vec3(0.95, 0.98, 1.0) * contactHighlight * fade;

        // Subpixel anti-aliasing at the advancing waterline (only on natural shores)
        float edgeAa = smoothstep(0.0, 1.5, max(0.0, waterReach));
        edgeAa = mix(1.0, edgeAa, shoreIsNatural);
        color = mix(bgOriginal, color, edgeAa);

        gl_FragColor = vec4(color, 1.0);
    }
`;
