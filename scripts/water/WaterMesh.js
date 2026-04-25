/**
 * Animated water overlay using PIXI.Mesh + PIXI.Shader.
 * Voronoi caustics with background texture distortion (refraction).
 */

const LOG = (...args) => { try { if (game.settings?.get?.('ionrift-waterline', 'debug')) console.log('Waterline |', ...args); } catch { /* setting not yet registered */ } };

const VERTEX_SRC = `
    precision highp float;
    attribute vec2 aVertexPosition;

    uniform mat3 translationMatrix;
    uniform mat3 projectionMatrix;
    uniform vec4 uBounds;
    uniform vec4 uSceneDims;

    varying vec2 vUv;
    varying vec2 vWorldPos;
    varying vec2 vBgUv;

    void main(void) {
        vUv = (aVertexPosition - uBounds.xy) / uBounds.zw;
        vWorldPos = aVertexPosition;

        // Map world position to background texture UVs
        vBgUv = (aVertexPosition - uSceneDims.xy) / uSceneDims.zw;

        gl_Position = vec4((projectionMatrix * translationMatrix * vec3(aVertexPosition, 1.0)).xy, 0.0, 1.0);
    }
`;

const FRAGMENT_SRC = `
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
    uniform float uFadeWidth;
    uniform float uScale;
    uniform float uFlowAngle;
    uniform float uShoreWaves;
    uniform sampler2D uBackground;

    // Token wake ripples (max 8); xyzw = center.xy, ring radius (px), amplitude 0–1
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
    // 0 = radial ripples (8 rings in uWake0–uWake7)
    // 1 = V-chevron stamps (4 stamps × 2 vec4 packed in uWake0–uWake7)
    uniform float uWakeStyle;
    // V-chevron wave parameters
    uniform float uWakeDivergentK;     // spatial wave-number along the arm (crests per px)
    uniform float uWakeDivergentOmega; // temporal animation rate

    // ---- Ripple helpers ----

    vec2 sampleWakeRing(vec2 worldPos, vec4 data, float t) {
        if (data.w < 0.0001) return vec2(0.0);
        vec2 c = data.xy;
        float ringR = max(data.z, 2.0);
        float amp   = data.w;
        vec2  d = worldPos - c;
        float r = length(d);
        if (r < 0.5) return vec2(0.0);
        vec2  dir   = d / r;
        float band  = 1.0 - smoothstep(0.0, uWakeBandPx, abs(r - ringR));
        float outer = 1.0 - smoothstep(ringR + uWakeBandPx * 2.5, ringR + uWakeBandPx * 7.0, r);
        float inner = smoothstep(ringR * 0.02, ringR * 0.08 + 2.0, r);
        float shell = band * outer * inner;
        float wave  = sin((r - ringR) * uWakePhaseScale + t * uWakeRippleSpeed);
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

    // ---- V-chevron stamp helpers ----

    // Cheap per-stamp phase hash -- gives each stamp deposited at a different
    // world position its own crest phase, avoiding tiled repetition along the path.
    float wakeStampPhase(vec2 anchor) {
        return fract(sin(dot(anchor, vec2(12.9898, 78.233))) * 43758.5453) * 6.2831;
    }

    // STUB: transverse crests run perpendicular to the motion direction and
    // fill the interior of the V with trailing cross-waves (like the classic
    // Kelvin wake pattern).  Not yet enabled -- enable by calling this function
    // and adding its result to the return value of sampleWakeStamp.
    // Requires uniforms: uWakeTransverseK, uWakeTransverseOmega, uWakeTransverseEnabled.
    // vec2 sampleWakeStampTransverse(vec2 fwd, vec2 perp, float along, float trailL,
    //                                float t, float phase, float str) {
    //     if (uWakeTransverseEnabled < 0.5) return vec2(0.0);
    //     float wave = sin(along * uWakeTransverseK + t * uWakeTransverseOmega + phase * 1.37);
    //     float fall = (1.0 - smoothstep(trailL * 0.6, trailL, along));
    //     return fwd * wave * fall * str * 0.35 * uDistortion * uWakeStrengthMul;
    // }

    // Sample one V-chevron stamp.
    // sa = (cx, cy, dirX, dirY)   -- bow anchor + unit forward direction
    // sb = (age01, halfAngleTan, trailLengthPx, strength)
    vec2 sampleWakeStamp(vec2 p, vec4 sa, vec4 sb, float t) {
        float str = sb.w;
        if (str < 0.0001) return vec2(0.0);

        vec2  center = sa.xy;
        vec2  fwd    = normalize(sa.zw);      // forward (motion) direction
        vec2  perp   = vec2(-fwd.y, fwd.x);  // left-hand perpendicular

        float age01  = sb.x;
        float tanHA  = max(sb.y, 0.01);
        float trailL = max(sb.z, 10.0);

        // Local frame: 'along' is positive *behind* the bow
        vec2  q       = p - center;
        float along   = -dot(q, fwd);    // > 0 = trailing
        float lateral = dot(q, perp);    // signed left/right

        // Cull anything ahead of the bow (no wake in front of the character)
        if (along < -2.0) return vec2(0.0);

        // V-mask: inside the wake V means |lateral| < along * tan(halfAngle).
        // Add a small constant so the apex isn't an infinitely thin point.
        float vEdge  = max(along, 0.0) * tanHA + 2.0;
        float inV    = 1.0 - smoothstep(vEdge * 0.85, vEdge * 1.15, abs(lateral));

        // Sharp apex cap -- wave begins right at the bow, not 18px behind it.
        float bowCap = smoothstep(-2.0, 4.0, along);

        // Trail length falloff -- stamp fades beyond its arm length.
        float trailFall = 1.0 - smoothstep(trailL * 0.72, trailL, along);

        // Lifetime fade
        float lifeFade = 1.0 - smoothstep(0.55, 1.0, age01);

        // Per-stamp random phase (free, from anchor position hash)
        float phase = wakeStampPhase(sa.xy);

        // --- DIVERGENT CREST WAVE ---
        // Crests run along each arm of the V; phase advances with distance from
        // the bow projected onto the arm direction. Negative time term so crests
        // travel OUTWARD (away from the character), not inward.
        float lenHA  = 1.0 / sqrt(1.0 + tanHA * tanHA); // cos(halfAngle)
        float sinHA  = tanHA * lenHA;                     // sin(halfAngle)
        float cosHA  = lenHA;
        float armDist = along * cosHA + abs(lateral) * sinHA;
        float wave = sin(armDist * uWakeDivergentK - t * uWakeDivergentOmega + phase);

        // Lateral profile: full strength across the V interior, soft taper at the edge.
        // (Empty-centreline behaviour caused the "V tip detached from character" look.)
        float latNorm = abs(lateral) / vEdge;
        float armFall = 1.0 - smoothstep(0.78, 1.08, latNorm);

        // Displacement direction:
        //   centreline (lateral~0): push BACKWARD along trail -- visible trailing wash
        //   V edges (|lateral|~vEdge): push outward perpendicular to motion
        // Blend between the two so the apex is connected to the V arms.
        float lateralBlend = smoothstep(0.0, vEdge * 0.55, abs(lateral));
        vec2 edgeDir = sign(lateral) * perp - fwd * 0.18;
        vec2 axisDir = -fwd;
        vec2 armDir  = normalize(mix(axisDir, edgeDir, lateralBlend));

        // TRANSVERSE STUB (see comment above -- not yet called):
        // vec2 transv = sampleWakeStampTransverse(fwd, perp, along, trailL, t, phase, str);

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

    // Hash for Voronoi
    vec2 hash22(vec2 p) {
        p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
        return fract(sin(p) * 43758.5453);
    }

    // Voronoi caustic pattern
    float voronoiCaustic(vec2 uv, float t) {
        vec2 i = floor(uv);
        vec2 f = fract(uv);
        float minDist1 = 1.0;
        float minDist2 = 1.0;

        for (int y = -1; y <= 1; y++) {
            for (int x = -1; x <= 1; x++) {
                vec2 neighbor = vec2(float(x), float(y));
                vec2 point = hash22(i + neighbor);
                point = 0.5 + 0.4 * sin(t * 0.8 + 6.2831 * point);
                float d = length(neighbor + point - f);
                if (d < minDist1) {
                    minDist2 = minDist1;
                    minDist1 = d;
                } else if (d < minDist2) {
                    minDist2 = d;
                }
            }
        }
        return minDist2 - minDist1;
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

    // 2D distortion vector from noise
    vec2 distortionOffset(vec2 uv, float t) {
        float nx = noise21(uv * 2.0 + vec2(t * 0.3, t * 0.2)) - 0.5;
        float ny = noise21(uv * 2.0 + vec2(t * 0.2, -t * 0.3) + 50.0) - 0.5;
        return vec2(nx, ny);
    }

    void main(void) {
        float t = uTime * uSpeed;

        // Flow direction from angle
        float ca = cos(uFlowAngle);
        float sa = sin(uFlowAngle);
        vec2 flow = vec2(ca, sa);
        vec2 flowPerp = vec2(-sa, ca);

        vec2 causticUV = vWorldPos / uScale;

        // Compute distortion offset for refraction (flow-rotated)
        vec2 distUV = causticUV * 2.0;
        float nx = noise21(distUV + flow * t * 0.3 + flowPerp * t * 0.1) - 0.5;
        float ny = noise21(distUV + flow * t * 0.2 - flowPerp * t * 0.15 + 50.0) - 0.5;
        vec2 offset = vec2(nx, ny) * uDistortion;
        vec2 wakeOff = sumWakeDistortion(vWorldPos, t);

        // Sample background with distorted UVs (refraction)
        vec2 distortedBgUv = vBgUv + offset + wakeOff;
        vec4 bgSample = texture2D(uBackground, distortedBgUv);

        // Two layers of Voronoi caustics (flow-rotated)
        vec2 flowOffset = flow * t * 0.3;
        float c1 = voronoiCaustic(causticUV * 1.0 + flowOffset, t * 1.0);
        float c2 = voronoiCaustic(causticUV * 1.8 + 3.7 + flowOffset * 0.7, t * 0.7);
        float caustic = (c1 + c2) * 0.5;
        float causticBright = smoothstep(0.0, 0.3, caustic) * uIntensity;

        // Depth undulation
        float depthWave = noise21(causticUV * 0.4 + flow * t * 0.08);
        float depth = 0.85 + depthWave * 0.15;

        // Build water tint
        vec3 waterTint = uWaterColor * depth;
        waterTint += uHighlightColor * causticBright * 0.4;

        // Shimmer
        float sparkle = noise21(causticUV * 6.0 + flow * t * 0.2);
        waterTint += vec3(0.06) * smoothstep(0.7, 0.95, sparkle) * uIntensity;

        // Blend distorted background with water tint
        vec3 color = mix(bgSample.rgb, waterTint, uOpacity);

        // Pixel-based edge fade
        float edgeL = vUv.x * uBounds.z;
        float edgeR = (1.0 - vUv.x) * uBounds.z;
        float edgeT = vUv.y * uBounds.w;
        float edgeB = (1.0 - vUv.y) * uBounds.w;
        float edgeDist = min(min(edgeL, edgeR), min(edgeT, edgeB));

        float edgeNoise = noise21(vWorldPos / 40.0 + flow * t * 0.02) * 15.0;
        float fade = smoothstep(0.0, uFadeWidth, edgeDist + edgeNoise);

        // Shore waves: irregular foam near edges
        // Uses heavy world-space noise to break waves into segments
        float shoreZone = smoothstep(uFadeWidth * 2.5, 0.0, edgeDist);
        if (shoreZone > 0.001 && uShoreWaves > 0.0) {
            // Phase varies with world position to break up uniform lines
            float phaseVar = noise21(vWorldPos / 120.0) * 8.0;
            float wavePhase = edgeDist * 0.06 - t * 1.2 + phaseVar;
            float wavePulse = smoothstep(0.2, 0.9, sin(wavePhase) * 0.5 + 0.5);

            // Segment mask: only show wave crests in patches, not continuous lines
            float segMask = noise21(vWorldPos / 90.0 + vec2(t * 0.03, -t * 0.02));
            segMask = smoothstep(0.35, 0.65, segMask);

            // Secondary smaller foam detail
            float foam = noise21(vWorldPos / 25.0 + flow * t * 0.08);
            foam = smoothstep(0.5, 0.8, foam) * 0.3;

            // Combine: segmented wave crests + scattered foam near shore
            float shore = shoreZone * (wavePulse * segMask + foam) * uShoreWaves * 0.25;
            color += vec3(shore);
        }

        // At edges, blend back to undistorted background
        vec3 bgOriginal = texture2D(uBackground, vBgUv).rgb;
        color = mix(bgOriginal, color, fade);

        gl_FragColor = vec4(color, 1.0);
    }
`;

export class WaterMesh {

    /** @type {PIXI.Mesh} */
    mesh;

    /** @type {Function|null} */
    #tickerFn = null;

    /** @type {PIXI.Shader} */
    #shader;

    /**
     * @param {number[]} flatPoints - Flat array [x, y, x, y, ...]
     * @param {object} config
     * @param {PIXI.Texture} config.bgTexture - Scene background texture
     */
    constructor(flatPoints, config = {}) {
        const earcut = PIXI.utils?.earcut ?? globalThis.earcut;
        if (!earcut) {
            LOG('ERROR: earcut not available');
            return;
        }

        if (!config.bgTexture) {
            LOG('ERROR: No background texture provided');
            return;
        }

        const indices = earcut(flatPoints, null, 2);
        if (!indices.length) {
            LOG('ERROR: Triangulation produced no indices');
            return;
        }

        LOG(`Triangulated ${flatPoints.length / 2} vertices into ${indices.length / 3} triangles`);

        // Compute bounds
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (let i = 0; i < flatPoints.length; i += 2) {
            minX = Math.min(minX, flatPoints[i]);
            minY = Math.min(minY, flatPoints[i + 1]);
            maxX = Math.max(maxX, flatPoints[i]);
            maxY = Math.max(maxY, flatPoints[i + 1]);
        }
        const boundsW = maxX - minX || 1;
        const boundsH = maxY - minY || 1;

        // Scene dimensions for UV mapping
        const dims = canvas.dimensions;
        const sceneW = dims.sceneWidth || dims.width;
        const sceneH = dims.sceneHeight || dims.height;
        const sceneX = dims.sceneX ?? 0;
        const sceneY = dims.sceneY ?? 0;

        const geometry = new PIXI.Geometry()
            .addAttribute('aVertexPosition', flatPoints, 2)
            .addIndex(indices);

        const uniforms = {
            uTime: 0.0,
            uIntensity: config.intensity ?? 0.8,
            uSpeed: config.speed ?? 0.4,
            uOpacity: config.opacity ?? 0.35,
            uDistortion: config.distortion ?? 0.008,
            uFadeWidth: config.fadeWidth ?? 50.0,
            uScale: config.scale ?? 150.0,
            uFlowAngle: (config.flowAngle ?? 0) * Math.PI / 180,
            uShoreWaves: config.shoreWaves ?? 0.0,
            uWaterColor: new Float32Array(config.waterColor ?? [0.05, 0.18, 0.30]),
            uHighlightColor: new Float32Array(config.highlightColor ?? [0.3, 0.55, 0.75]),
            uBounds: new Float32Array([minX, minY, boundsW, boundsH]),
            uSceneDims: new Float32Array([sceneX, sceneY, sceneW, sceneH]),
            uBackground: config.bgTexture,
            uWake0: new Float32Array(4),
            uWake1: new Float32Array(4),
            uWake2: new Float32Array(4),
            uWake3: new Float32Array(4),
            uWake4: new Float32Array(4),
            uWake5: new Float32Array(4),
            uWake6: new Float32Array(4),
            uWake7: new Float32Array(4),
            uWakeBandPx: 24.0,
            uWakePhaseScale: 0.22,
            uWakeRippleSpeed: 7.5,
            uWakeStrengthMul: 6.0,
            uWakeStyle: 0.0,
            uWakeDivergentK: 0.035,
            uWakeDivergentOmega: 1.8
        };

        this.#shader = PIXI.Shader.from(VERTEX_SRC, FRAGMENT_SRC, uniforms);

        this.mesh = new PIXI.Mesh(geometry, this.#shader);
        this.mesh.name = 'water-mesh';
        this.mesh.eventMode = 'none';
        this.mesh.blendMode = PIXI.BLEND_MODES.NORMAL;

        LOG(`WaterMesh created, bounds: ${minX.toFixed(0)},${minY.toFixed(0)} ${boundsW.toFixed(0)}x${boundsH.toFixed(0)}`);
    }

    startAnimation() {
        if (this.#tickerFn || !this.#shader) return;
        this.#tickerFn = (delta) => {
            this.#shader.uniforms.uTime += (1 / 60) * delta;
        };
        canvas.app.ticker.add(this.#tickerFn);
        LOG('Water mesh animation started');
    }

    stopAnimation() {
        if (this.#tickerFn) {
            canvas.app.ticker.remove(this.#tickerFn);
            this.#tickerFn = null;
        }
    }

    destroy() {
        this.stopAnimation();
        if (this.mesh?.parent) {
            this.mesh.parent.removeChild(this.mesh);
        }
        this.mesh?.destroy(true);
    }

    setBlendMode(mode) {
        if (typeof mode === 'string') {
            mode = PIXI.BLEND_MODES[mode.toUpperCase()] ?? PIXI.BLEND_MODES.NORMAL;
        }
        if (this.mesh) this.mesh.blendMode = mode;
    }

    setOpacity(val) {
        if (this.#shader) this.#shader.uniforms.uOpacity = val;
    }

    setIntensity(val) {
        if (this.#shader) this.#shader.uniforms.uIntensity = val;
    }

    setSpeed(val) {
        if (this.#shader) this.#shader.uniforms.uSpeed = val;
    }

    setDistortion(val) {
        if (this.#shader) this.#shader.uniforms.uDistortion = val;
    }

    setFadeWidth(val) {
        if (this.#shader) this.#shader.uniforms.uFadeWidth = val;
    }

    setScale(val) {
        if (this.#shader) this.#shader.uniforms.uScale = val;
    }

    setFlowAngle(deg) {
        if (this.#shader) this.#shader.uniforms.uFlowAngle = deg * Math.PI / 180;
    }

    setShoreWaves(val) {
        if (this.#shader) this.#shader.uniforms.uShoreWaves = val;
    }

    /**
     * Push token-wake data into the water refraction shader.
     * @param {Float32Array} buf - Ripple: 8×vec4 ring data. Wake: 4×2 vec4 per line segment (32 floats).
     * @param {number} count - Ripple: 0–8 rings. Wake: 0–4 segments.
     * @param {object} [tuning] - Wake tuning
     */
    setWakeData(buf, count, tuning) {
        const sh = this.#shader;
        if (!sh) return;
        const u = sh.uniforms;

        const applyTuning = () => {
            if (!tuning) return;
            u.uWakeBandPx      = Number(tuning.shaderBandPx)      || 24;
            u.uWakePhaseScale  = Number(tuning.shaderPhaseScale)   || 0.22;
            u.uWakeRippleSpeed = Number(tuning.shaderRippleSpeed)  || 7.5;
            u.uWakeStrengthMul = Number(tuning.shaderStrengthMul)  || 6;
            // V-chevron wave parameters (only used in wake style)
            u.uWakeDivergentK     = Number(tuning.wakeDivergentK)     || 0.035;
            u.uWakeDivergentOmega = Number(tuning.wakeDivergentOmega) || 1.8;
        };

        if (tuning?.wakeStyle === 'wake') {
            u.uWakeStyle = 1.0;
            applyTuning();
            // Pack 4 stamps × 2 vec4 each into uWake0–uWake7
            const ns = Math.min(Math.max(count | 0, 0), 4);
            for (let s = 0; s < 4; s++) {
                const o = s * 8;
                for (let k = 0; k < 2; k++) {
                    const slot = u[`uWake${s * 2 + k}`];
                    if (s < ns) {
                        const bo = o + k * 4;
                        slot[0] = buf[bo];
                        slot[1] = buf[bo + 1];
                        slot[2] = buf[bo + 2];
                        slot[3] = buf[bo + 3];
                    } else {
                        slot[0] = slot[1] = slot[2] = slot[3] = 0;
                    }
                }
            }
            return;
        }

        // Ripple mode: 8 ring vec4s in uWake0–uWake7
        u.uWakeStyle = 0.0;
        const n = Math.min(Math.max(count | 0, 0), 8);
        for (let i = 0; i < 8; i++) {
            const slot = u[`uWake${i}`];
            const o    = i * 4;
            if (i < n) {
                slot[0] = buf[o];
                slot[1] = buf[o + 1];
                slot[2] = buf[o + 2];
                slot[3] = buf[o + 3];
            } else {
                slot[0] = slot[1] = slot[2] = slot[3] = 0;
            }
        }
        applyTuning();
    }

    get uniforms() {
        return this.#shader?.uniforms;
    }
}

