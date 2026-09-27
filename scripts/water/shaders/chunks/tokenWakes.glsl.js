export const TOKEN_WAKES_CHUNK = `
    // Ripple displacement helpers
    vec2 sampleWakeRing(vec2 worldPos, vec4 data, float t) {
        if (data.w < 0.0001) return vec2(0.0);
        vec2 c = data.xy;
        float ringR = max(data.z, 2.0);
        float amp   = data.w;
        vec2  d = worldPos - c;
        float r = length(d);
        if (r < 0.5) return vec2(0.0);
        vec2  dir   = d / r;
        float theta = atan(d.y, d.x);
        float h = fract(sin(dot(c, vec2(12.9898, 78.233))) * 43758.5453) * 6.28318;
        float lobes = max(uWakeRingWobbleLobes, 0.35);
        float wobble = uWakeRingWobbleAmp * ringR * (
            0.58 * sin(theta * lobes + t * uWakeRippleSpeed * 0.11 + h)
          + 0.42 * sin(theta * lobes * 1.71 - t * uWakeRippleSpeed * 0.07 + h * 1.37)
        );
        float ringReff = ringR + wobble;
        float band  = 1.0 - smoothstep(0.0, uWakeBandPx, abs(r - ringReff));
        float outer = 1.0 - smoothstep(ringReff + uWakeBandPx * 2.5, ringReff + uWakeBandPx * 7.0, r);
        float inner = smoothstep(ringReff * 0.02, ringReff * 0.08 + 2.0, r);
        float shell = band * outer * inner;
        float wave  = sin((r - ringReff) * uWakePhaseScale + t * uWakeRippleSpeed);
        return dir * wave * shell * amp * uDistortion * uWakeStrengthMul;
    }

    vec2 sumWakeRipples(vec2 worldPos, float t) {
        return sampleWakeRing(worldPos, uWake0, t)
             + sampleWakeRing(worldPos, uWake1, t)
             + sampleWakeRing(worldPos, uWake2, t)
             + sampleWakeRing(worldPos, uWake3, t)
             + sampleWakeRing(worldPos, uWake4, t)
             + sampleWakeRing(worldPos, uWake5, t)
             + sampleWakeRing(worldPos, uWake6, t)
             + sampleWakeRing(worldPos, uWake7, t);
    }

    // Per-stamp phase hash from anchor position
    float wakeStampPhase(vec2 anchor) {
        return fract(sin(dot(anchor, vec2(12.9898, 78.233))) * 43758.5453) * 6.2831;
    }

    // Sample one V-chevron stamp:
    // sa = (cx, cy, dirX, dirY): bow anchor and unit forward direction
    // sb = (age01, halfAngleTan, trailLengthPx, strength)
    vec2 sampleWakeStamp(vec2 p, vec4 sa, vec4 sb, float t) {
        float str = sb.w;
        if (str < 0.0001) return vec2(0.0);

        vec2  center = sa.xy;
        vec2  fwd    = normalize(sa.zw);
        vec2  perp   = vec2(-fwd.y, fwd.x);

        float age01  = sb.x;
        float tanHA  = max(sb.y, 0.01);
        float trailL = max(sb.z, 10.0);

        vec2  q       = p - center;
        float along   = -dot(q, fwd);
        float lateral = dot(q, perp);

        if (along < -2.0) return vec2(0.0);

        float vEdge  = max(along, 0.0) * tanHA + 2.0;
        float inV    = 1.0 - smoothstep(vEdge * 0.85, vEdge * 1.15, abs(lateral));

        float bowCap = smoothstep(-2.0, 4.0, along);
        float trailFall = 1.0 - smoothstep(trailL * 0.72, trailL, along);
        float lifeFade = 1.0 - smoothstep(0.55, 1.0, age01);
        float phase = wakeStampPhase(sa.xy);

        // Divergent crest wave along V arms
        float lenHA  = 1.0 / sqrt(1.0 + tanHA * tanHA);
        float sinHA  = tanHA * lenHA;
        float cosHA  = lenHA;
        float armDist = along * cosHA + abs(lateral) * sinHA;
        float wave = sin(armDist * uWakeDivergentK - t * uWakeDivergentOmega + phase);

        float latNorm = abs(lateral) / vEdge;
        float armFall = 1.0 - smoothstep(0.78, 1.08, latNorm);

        float lateralBlend = smoothstep(0.0, vEdge * 0.55, abs(lateral));
        vec2 edgeDir = sign(lateral) * perp - fwd * 0.18;
        vec2 axisDir = -fwd;
        vec2 armDir  = normalize(mix(axisDir, edgeDir, lateralBlend));

        return armDir * wave * armFall * trailFall * bowCap * inV * lifeFade
               * str * uDistortion * uWakeStrengthMul;
    }

    vec2 sumWakeStamps(vec2 p, float t) {
        return sampleWakeStamp(p, uWake0, uWake1, t)
             + sampleWakeStamp(p, uWake2, uWake3, t)
             + sampleWakeStamp(p, uWake4, uWake5, t)
             + sampleWakeStamp(p, uWake6, uWake7, t);
    }

    vec2 sumWakeDistortion(vec2 worldPos, float t) {
        if (uWakeStyle > 0.5) return sumWakeStamps(worldPos, t);
        return sumWakeRipples(worldPos, t);
    }

    // Token water interaction wavelets and foam
    float sampleTokenRippleWave(vec2 worldPos, vec4 data, vec2 flow, vec2 stretchedPos, float t) {
        if (data.w < 0.0001) return 0.0;
        vec2 c = data.xy;
        float amp = data.w;
        vec2 dVec = worldPos - c;
        float r   = length(dVec);

        float tokR = max(data.z, 8.0);
        float tokBound = tokR * 0.85;
        float maxReach = tokR * 0.85;

        if (r < tokBound - tokR * 0.05 || r > tokBound + maxReach * 1.15) return 0.0;

        vec2 dir = dVec / r;
        float dist = max(0.0, r - tokBound);
        float scaleRef = max(tokR / 50.0, 0.2);

        float theta = atan(dir.y, dir.x);
        float angularWobble = sin(theta * 3.0 + t * 0.40 + (c.x / scaleRef) * 0.05) * 0.28
                            + cos(theta * 5.0 - t * 0.30 + (c.y / scaleRef) * 0.05) * 0.18;
        float phaseJitter = (noise21((c / scaleRef) * 0.02 + vec2(t * 0.09, -t * 0.07)) - 0.5) * 2.4;

        float wavePhase = dist * (3.0 / tokR) - t * 0.70 + phaseJitter + angularWobble;
        float s = fract(wavePhase);

        float core = pow(max(0.0, 1.0 - abs(s - 0.5) * 7.5), 2.2);
        float wash = pow(max(0.0, 1.0 - abs(s - 0.5) * 3.4), 1.6) * 0.30;
        float env = smoothstep(0.0, tokR * 0.06, dist) * (1.0 - smoothstep(tokR * 0.20, maxReach, dist));

        float upstream = max(0.0, dot(dir, -flow));
        float flowMod = mix(0.75, 1.25, upstream);

        float breatheNoise = noise21((c / scaleRef) * 0.015 + vec2(t * 0.14, -t * 0.10) + dir * 0.25);
        float breatheGate = smoothstep(0.38, 0.66, breatheNoise);

        vec2 nPos = stretchedPos / scaleRef;
        float chunkNoise = noise21(nPos / 26.0 + vec2(t * 0.22, -t * 0.16));
        float chunk = smoothstep(0.38, 0.70, chunkNoise);
        float tearNoise = noise21(nPos / 15.0 - vec2(t * 0.28, t * 0.20) + 42.1);
        float tear = smoothstep(0.36, 0.66, tearNoise);
        float microFoam = mix(0.70, 1.0, noise21(nPos / 10.0 + t * 0.35));

        return (core + wash) * env * breatheGate * chunk * tear * microFoam * flowMod * amp * 0.38;
    }

    float sampleTokenWakeStampWave(vec2 p, vec4 sa, vec4 sb, vec2 stretchedPos, float t) {
        float str = sb.w;
        if (str < 0.0001) return 0.0;
        vec2  center = sa.xy;
        vec2  fwd    = normalize(sa.zw);
        vec2  perp   = vec2(-fwd.y, fwd.x);

        float age01  = sb.x;
        float tanHA  = max(sb.y, 0.01);
        float trailL = max(sb.z, 10.0);
        float stampScale = max(trailL / 160.0, 0.25);

        vec2  q       = p - center;
        float along   = -dot(q, fwd);
        float lateral = dot(q, perp);
        if (along < -2.0 * stampScale) return 0.0;

        float vEdge  = max(along, 0.0) * tanHA + 2.0 * stampScale;
        float inV    = 1.0 - smoothstep(vEdge * 0.88, vEdge * 1.12, abs(lateral));

        float bowDist = length(q - fwd * (36.0 * stampScale));
        float bowCap = pow(max(0.0, 1.0 - (bowDist / stampScale) * 0.22), 2.5) * 0.28;

        float trailFall = 1.0 - smoothstep(trailL * 0.60, trailL, along);
        float lifeFade = 1.0 - smoothstep(0.55, 1.0, age01);
        float phase = wakeStampPhase(sa.xy);

        float lenHA  = 1.0 / sqrt(1.0 + tanHA * tanHA);
        float sinHA  = tanHA * lenHA;
        float cosHA  = lenHA;
        float armDist = along * cosHA + abs(lateral) * sinHA;
        float wave = pow(max(0.0, sin(armDist * uWakeDivergentK - t * uWakeDivergentOmega + phase)), 3.0);

        float latNorm = abs(lateral) / vEdge;
        float armFall = 1.0 - smoothstep(0.78, 1.04, latNorm);

        vec2 nPos = stretchedPos / stampScale;
        float chunk = smoothstep(0.42, 0.70, noise21(nPos / 20.0 + t * 0.3));
        float microFoam = mix(0.70, 1.0, noise21(nPos / 9.0 + t * 0.4));

        float foam = (wave * armFall * 0.26 + bowCap) * trailFall * inV * lifeFade * str * chunk * microFoam;
        return foam;
    }

    float computeTokenWaves(vec2 worldPos, vec2 flow, float t) {
        float scaleRef = 1.0;
        if (uToken0.w > 0.0001) scaleRef = max(uToken0.z / 50.0, 0.2);
        else if (uToken1.w > 0.0001) scaleRef = max(uToken1.z / 50.0, 0.2);
        else if (uToken2.w > 0.0001) scaleRef = max(uToken2.z / 50.0, 0.2);
        else if (uToken3.w > 0.0001) scaleRef = max(uToken3.z / 50.0, 0.2);

        float stretchFreq = 0.020 / scaleRef;
        float stretchAmp  = 8.5 * scaleRef;
        vec2 waveStretchVec = vec2(
            sin(worldPos.y * (stretchFreq * 1.1) + t * 0.45) * stretchAmp + cos(worldPos.x * (stretchFreq * 0.8) - t * 0.35) * (stretchAmp * 0.76),
            cos(worldPos.x * stretchFreq + t * 0.40) * stretchAmp - sin(worldPos.y * (stretchFreq * 0.9) + t * 0.30) * (stretchAmp * 0.76)
        );
        vec2 stretchedPos = worldPos + waveStretchVec;

        float tokWave = 0.0;
        tokWave += sampleTokenRippleWave(worldPos, uToken0, flow, stretchedPos, t);
        tokWave += sampleTokenRippleWave(worldPos, uToken1, flow, stretchedPos, t);
        tokWave += sampleTokenRippleWave(worldPos, uToken2, flow, stretchedPos, t);
        tokWave += sampleTokenRippleWave(worldPos, uToken3, flow, stretchedPos, t);

        if (uWakeStyle > 0.5) {
            float s0 = sampleTokenWakeStampWave(worldPos, uWake0, uWake1, stretchedPos, t);
            float s1 = sampleTokenWakeStampWave(worldPos, uWake2, uWake3, stretchedPos, t);
            float s2 = sampleTokenWakeStampWave(worldPos, uWake4, uWake5, stretchedPos, t);
            float s3 = sampleTokenWakeStampWave(worldPos, uWake6, uWake7, stretchedPos, t);
            tokWave += (s0 + s1 + s2 + s3);
        }

        return clamp(tokWave, 0.0, 0.35);
    }
`;
