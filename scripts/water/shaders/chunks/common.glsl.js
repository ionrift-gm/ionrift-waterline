export const COMMON_CHUNK = `
    precision highp float;

    varying vec2 vUv;
    varying vec2 vWorldPos;
    varying vec2 vBgUv;

    uniform float uTime;
    uniform float uIntensity;
    uniform float uSpeed;
    uniform float uOpacity;
    uniform float uDistortion;
    uniform vec3 uWaterColor;
    uniform vec3 uHighlightColor;
    uniform vec4 uBounds;
    uniform vec4 uSceneDims;
    uniform vec4 uBorderTouches;
    uniform float uFadeWidth;
    uniform float uScale;
    uniform float uFlowAngle;
    uniform float uShoreWaves;
    uniform float uWaveCount;
    uniform float uWaveShoaling;
    uniform float uBankDrag;
    uniform float uWaveSegment;
    uniform float uWaveRegularity;
    uniform float uSwashSurge;
    uniform float uSurfFoam;
    uniform float uChoppySeas;
    uniform float uRiverWaves;
    uniform float uLakeWaves;
    uniform float uLakeRings;
    uniform float uWhitecaps;
    uniform float uSunGlint;
    uniform float uSpindriftWake;
    uniform float uCrestBound;
    uniform float uFoamHfWeight;
    uniform float uCoastSurf;
    uniform sampler2D uShoreSdf;
    uniform vec4 uSdfBounds;
    uniform float uSdfMaxDist;
    uniform sampler2D uBackground;

    // Token wake ripples: xyzw = center.xy, ring radius (px), amplitude 0-1
    uniform vec4 uWake0;
    uniform vec4 uWake1;
    uniform vec4 uWake2;
    uniform vec4 uWake3;
    uniform vec4 uWake4;
    uniform vec4 uWake5;
    uniform vec4 uWake6;
    uniform vec4 uWake7;
    uniform float uWakeBandPx;
    uniform float uWakePhaseScale;
    uniform float uWakeRippleSpeed;
    uniform float uWakeStrengthMul;
    uniform float uWakeRingWobbleAmp;
    uniform float uWakeRingWobbleLobes;
    uniform float uWakeStyle;
    uniform float uWakeDivergentK;
    uniform float uWakeDivergentOmega;

    // Wet token anchors: xy = center, z = radius, w = isWet
    uniform vec4 uToken0;
    uniform vec4 uToken1;
    uniform vec4 uToken2;
    uniform vec4 uToken3;

    // Procedural pseudo-random 2D hash
    vec2 hash22(vec2 p) {
        p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
        return fract(sin(p) * 43758.5453);
    }

    // Procedural pseudo-random 2D -> 1D hash
    float hash21(vec2 p) {
        p = fract(p * vec2(234.34, 435.345));
        p += dot(p, p + 34.23);
        return fract(p.x * p.y);
    }

    // 2D value noise
    float noise21(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        float a = dot(hash22(i), f);
        float b = dot(hash22(i + vec2(1.0, 0.0)), f - vec2(1.0, 0.0));
        float c = dot(hash22(i + vec2(0.0, 1.0)), f - vec2(0.0, 1.0));
        float d = dot(hash22(i + vec2(1.0, 1.0)), f - vec2(1.0, 1.0));
        return mix(mix(a, b, f.x), mix(c, d, f.x), f.y) + 0.5;
    }

    // Multi-octave Fractal Brownian Motion
    float fbm21(vec2 p) {
        float v = 0.0;
        v += 0.5000 * noise21(p); p *= 2.02;
        v += 0.2500 * noise21(p); p *= 2.03;
        v += 0.1250 * noise21(p);
        return v;
    }

    // Cellular Voronoi field returning vec2(d1, d2 - d1)
    // x = d1 (distance to closest seed), y = d2 - d1 (boundary wall distance)
    vec2 voronoiBubbleField(vec2 p, float t) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        float d1 = 8.0;
        float d2 = 8.0;
        for (int y = -1; y <= 1; y++) {
            for (int x = -1; x <= 1; x++) {
                vec2 g = vec2(float(x), float(y));
                vec2 h = hash22(i + g);
                vec2 basePos = 0.5 + (h - 0.5) * 0.65;
                float speed = mix(0.95, 1.85, fract(h.x * 17.31 + h.y * 29.53));
                float phX = h.y * 6.28318;
                float phY = fract(h.x * 7.13 + h.y * 11.29) * 6.28318;
                vec2 orbit = vec2(
                    sin(t * speed + phX) * 0.72 + sin(t * (speed * 1.62) + phY) * 0.28,
                    cos(t * (speed * 0.88) + phY) * 0.72 + cos(t * (speed * 1.48) + phX) * 0.28
                );
                float amp = mix(0.16, 0.26, fract(h.x * 31.7 + h.y * 19.1));
                vec2 o = basePos + orbit * amp;
                float d = length(g + o - f);
                if (d < d1) {
                    d2 = d1;
                    d1 = d;
                } else if (d < d2) {
                    d2 = d;
                }
            }
        }
        return vec2(d1, d2 - d1);
    }

    vec2 voronoiBubbleField(vec2 p) {
        return voronoiBubbleField(p, uTime);
    }

    float voronoiBubbles(vec2 p, float t) {
        return voronoiBubbleField(p, t).y;
    }

    float voronoiBubbles(vec2 p) {
        return voronoiBubbleField(p, uTime).y;
    }

    // Archetype strategy output contract
    struct ArchetypeResult {
        float foam;
        vec2  displacement;
        vec3  normal;
        float glint;
        float troughShadow;
        float crestBody;
        float aeratedBase;
        float undercurrentFoam;
        float bankSlosh;
        float elevation;
        float skyReflect;
        float lakeTroughShadow;
    };

    ArchetypeResult initArchetypeResult() {
        ArchetypeResult ar;
        ar.foam = 0.0;
        ar.displacement = vec2(0.0);
        ar.normal = vec3(0.0, 0.0, 1.0);
        ar.glint = 0.0;
        ar.troughShadow = 0.0;
        ar.crestBody = 0.0;
        ar.aeratedBase = 0.0;
        ar.undercurrentFoam = 0.0;
        ar.bankSlosh = 0.0;
        ar.elevation = 0.0;
        ar.skyReflect = 0.0;
        ar.lakeTroughShadow = 0.0;
        return ar;
    }
`;
