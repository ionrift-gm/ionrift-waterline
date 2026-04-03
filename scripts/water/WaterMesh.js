/**
 * Animated water overlay using PIXI.Mesh + PIXI.Shader.
 * Voronoi caustics with background texture distortion (refraction).
 */

const LOG = (...args) => console.log('Waterline |', ...args);

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

        // Sample background with distorted UVs (refraction)
        vec2 distortedBgUv = vBgUv + offset;
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
            uBackground: config.bgTexture
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

    get uniforms() {
        return this.#shader?.uniforms;
    }
}
