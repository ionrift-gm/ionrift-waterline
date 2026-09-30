/**
 * Animated water overlay using PIXI.Mesh + PIXI.Shader.
 * Voronoi caustics with background texture distortion (refraction).
 */

import { ShoreSdfGenerator } from './ShoreSdfGenerator.js';
import { MapBorderDetector } from './MapBorderDetector.js';
import { createWaterShader } from './shaders/WaterShader.js';

const LOG = (...args) => { try { if (game.settings?.get?.('ionrift-waterline', 'debug')) console.log('Waterline |', ...args); } catch { /* setting not yet registered */ } };


export class WaterMesh {

    /** @type {PIXI.Mesh} */
    mesh;

    /** @type {Function|null} */
    #tickerFn = null;

    /** @type {PIXI.Shader} */
    #shader;

    /** @type {PIXI.Texture|null} */
    #sdfTexture = null;

    /** @type {object|null} */
    #borderSignature = null;

    /** @type {string} */
    #archetype = 'ocean';

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

        let pts = Array.isArray(flatPoints) ? [...flatPoints] : Array.from(flatPoints);
        let n = pts.length / 2;
        if (n > 2 && Math.hypot(pts[0] - pts[(n - 1) * 2], pts[1] - pts[(n - 1) * 2 + 1]) < 0.001) {
            pts = pts.slice(0, (n - 1) * 2);
            n = pts.length / 2;
        }

        // Scene dimensions for UV mapping and boundary analysis
        const dims = canvas?.dimensions;
        const sceneW = dims?.sceneWidth || dims?.width || 4000;
        const sceneH = dims?.sceneHeight || dims?.height || 3000;
        const sceneX = dims?.sceneX ?? 0;
        const sceneY = dims?.sceneY ?? 0;

        // Detect border contact signature and bleed polygon past map edges to eliminate animation seams
        const borderSig = MapBorderDetector.detect(pts, dims);
        this.#borderSignature = borderSig;

        let meshPts = pts;
        if (borderSig.hasBorderContact) {
            meshPts = MapBorderDetector.bleed(pts, dims, 96.0);
            n = meshPts.length / 2;
        }

        const indices = earcut(meshPts, null, 2);
        if (!indices.length) {
            LOG('ERROR: Triangulation produced no indices');
            return;
        }

        LOG(`Triangulated ${n} vertices into ${indices.length / 3} triangles`);

        // Compute bounds
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (let i = 0; i < meshPts.length; i += 2) {
            minX = Math.min(minX, meshPts[i]);
            minY = Math.min(minY, meshPts[i + 1]);
            maxX = Math.max(maxX, meshPts[i]);
            maxY = Math.max(maxY, meshPts[i + 1]);
        }
        const boundsW = maxX - minX || 1;
        const boundsH = maxY - minY || 1;

        // Generate Signed Distance Field (SDF) texture for organic shorelines
        const sdfResult = ShoreSdfGenerator.generate(meshPts);
        this.#sdfTexture = sdfResult?.texture ?? null;
        const sdfBounds = sdfResult?.sdfBounds ?? new Float32Array([minX, minY, boundsW, boundsH]);
        const sdfMaxDist = sdfResult?.maxDist ?? ShoreSdfGenerator.DEFAULT_MAX_DIST;

        // Build extruded skirt geometry allowing waves to surge onto dry bank
        const skirtMargin = 35.0;
        const skirtGeom = ShoreSdfGenerator.buildSkirtGeometry(meshPts, indices, skirtMargin);

        const geometry = new PIXI.Geometry()
            .addAttribute('aVertexPosition', skirtGeom.vertices, 2)
            .addIndex(skirtGeom.indices);

        this.#archetype = config.archetype ?? 'ocean';
        const isSmallBody = (this.#archetype === 'lake' || this.#archetype === 'pond' || this.#archetype === 'puddle');

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
            uWaveCount: config.waveCount ?? 4.0,
            uWaveShoaling: config.waveShoaling ?? 1.5,
            uBankDrag: config.bankDrag ?? 45.0,
            uWaveSegment: config.waveSegment ?? 0.85,
            uWaveRegularity: config.waveRegularity ?? 0.60,
            uSwashSurge: config.swashSurge ?? 26.0,
            uSurfFoam: config.surfFoam ?? 0.70,
            uChoppySeas: config.choppySeas ?? 0.0,
            uRiverWaves: config.riverWaves ?? 0.0,
            uLakeWaves: isSmallBody ? (config.lakeWaves ?? 0.0) : 0.0,
            uLakeRings: isSmallBody ? (typeof config.lakeRings === 'number' ? Math.max(0.0, Math.min(2.0, config.lakeRings)) : (config.lakeRings ? 1.0 : 0.0)) : 0.0,
            uWhitecaps: config.whitecaps ?? 0.5,
            uSunGlint: config.sunGlint ?? 0.6,
            uSpindriftWake: config.spindriftWake ? 1.0 : 0.0,
            uCrestBound: config.crestBound ? 1.0 : 0.0,
            uFoamHfWeight: config.foamHfWeight ?? 1.0,
            uCoastSurf: (config.archetype === 'coast' || config.archetype === 'ocean') ? 1.0 : 0.0,
            uShoreSdf: this.#sdfTexture ?? PIXI.Texture.WHITE,
            uSdfBounds: sdfBounds,
            uSdfMaxDist: sdfMaxDist,
            uWaterColor: new Float32Array(config.waterColor ?? [0.05, 0.18, 0.30]),
            uHighlightColor: new Float32Array(config.highlightColor ?? [0.3, 0.55, 0.75]),
            uBounds: new Float32Array([minX, minY, boundsW, boundsH]),
            uSceneDims: new Float32Array([sceneX, sceneY, sceneW, sceneH]),
            uBorderTouches: new Float32Array([
                borderSig.touches.left ? 1.0 : 0.0,
                borderSig.touches.right ? 1.0 : 0.0,
                borderSig.touches.top ? 1.0 : 0.0,
                borderSig.touches.bottom ? 1.0 : 0.0
            ]),
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
            uWakeRingWobbleAmp: 0.07,
            uWakeRingWobbleLobes: 5.5,
            uWakeStyle: 0.0,
            uWakeDivergentK: 0.035,
            uWakeDivergentOmega: 1.8,
            uToken0: new Float32Array(4),
            uToken1: new Float32Array(4),
            uToken2: new Float32Array(4),
            uToken3: new Float32Array(4)
        };

        this.#shader = createWaterShader(uniforms);
        this.waterColor = config.waterColor;
        this.baseSampledColor = config.baseSampledColor ?? config.waterColor;

        this.mesh = new PIXI.Mesh(geometry, this.#shader);
        this.mesh.name = 'water-mesh';
        this.mesh.eventMode = 'none';
        this.mesh.blendMode = PIXI.BLEND_MODES.NORMAL;
        if (config.elevation !== undefined) {
            this.mesh.elevation = config.elevation;
            this.elevation = config.elevation;
        }
        if (config.sortLayer !== undefined) {
            this.mesh.sortLayer = config.sortLayer;
        }

        // Ensure uTime is updated to current wall-clock seconds on every render pass
        const origRender = this.mesh._render.bind(this.mesh);
        this.mesh._render = (renderer) => {
            if (this.#shader) {
                this.#shader.uniforms.uTime = performance.now() * 0.001;
            }
            origRender(renderer);
        };

        LOG(`WaterMesh created, bounds: ${minX.toFixed(0)},${minY.toFixed(0)} ${boundsW.toFixed(0)}x${boundsH.toFixed(0)}, elevation: ${config.elevation ?? 0}`);
    }

    startAnimation() {
        if (this.#tickerFn || !this.#shader) return;
        this.#tickerFn = () => {
            if (this.#shader) {
                this.#shader.uniforms.uTime = performance.now() * 0.001;
            }
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
        if (this.#sdfTexture) {
            try { this.#sdfTexture.destroy(true); } catch { /* ignore if already destroyed */ }
            this.#sdfTexture = null;
        }
        if (this.mesh?.parent) {
            this.mesh.parent.removeChild(this.mesh);
        }
        this.mesh?.destroy(true);
    }

    /** @type {object|null} Border signature detected for this water mesh */
    get borderSignature() {
        return this.#borderSignature;
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

    setWaveCount(val) {
        if (this.#shader) this.#shader.uniforms.uWaveCount = val;
    }

    setWaveShoaling(val) {
        if (this.#shader) this.#shader.uniforms.uWaveShoaling = val;
    }

    setBankDrag(val) {
        if (this.#shader) this.#shader.uniforms.uBankDrag = val;
    }

    setWaveSegment(val) {
        if (this.#shader) this.#shader.uniforms.uWaveSegment = val;
    }

    setWaveRegularity(val) {
        if (this.#shader) this.#shader.uniforms.uWaveRegularity = val;
    }

    setSwashSurge(val) {
        if (this.#shader) this.#shader.uniforms.uSwashSurge = val;
    }

    setSurfFoam(val) {
        if (this.#shader) this.#shader.uniforms.uSurfFoam = val;
    }

    setChoppySeas(val) {
        if (this.#shader) this.#shader.uniforms.uChoppySeas = val;
    }

    setRiverWaves(val) {
        if (this.#shader) this.#shader.uniforms.uRiverWaves = val;
    }

    setArchetype(val) {
        this.#archetype = val;
        const isSmallBody = (val === 'lake' || val === 'pond' || val === 'puddle');
        if (!isSmallBody && this.#shader) {
            this.#shader.uniforms.uLakeWaves = 0.0;
            this.#shader.uniforms.uLakeRings = 0.0;
        }
        if (this.#shader) {
            this.#shader.uniforms.uCoastSurf = (val === 'coast' || val === 'ocean') ? 1.0 : 0.0;
        }
    }

    setLakeWaves(val) {
        const isSmallBody = (this.#archetype === 'lake' || this.#archetype === 'pond' || this.#archetype === 'puddle');
        if (this.#shader) this.#shader.uniforms.uLakeWaves = isSmallBody ? (val ?? 0.0) : 0.0;
    }

    setLakeRings(val) {
        const isSmallBody = (this.#archetype === 'lake' || this.#archetype === 'pond' || this.#archetype === 'puddle');
        const numVal = typeof val === 'number' ? Math.max(0.0, Math.min(2.0, val)) : (val ? 1.0 : 0.0);
        if (this.#shader) this.#shader.uniforms.uLakeRings = isSmallBody ? numVal : 0.0;
    }

    setWhitecaps(val) {
        if (this.#shader) this.#shader.uniforms.uWhitecaps = val;
    }

    setSunGlint(val) {
        if (this.#shader) this.#shader.uniforms.uSunGlint = val;
    }

    setSpindriftWake(val) {
        if (this.#shader) this.#shader.uniforms.uSpindriftWake = val ? 1.0 : 0.0;
    }

    setCrestBound(val) {
        if (this.#shader) this.#shader.uniforms.uCrestBound = val ? 1.0 : 0.0;
    }

    setCoastSurf(val) {
        if (this.#shader) this.#shader.uniforms.uCoastSurf = val ? 1.0 : 0.0;
    }

    /**
     * Update water color and highlight uniforms in place without rebuilding the mesh.
     * @param {number[]|object} color - [r, g, b] or {r, g, b} normalized to 0-1
     */
    setWaterColor(color) {
        if (!this.#shader) return;
        const rgb = Array.isArray(color) ? color : [color.r, color.g, color.b];
        this.#shader.uniforms.uWaterColor[0] = rgb[0];
        this.#shader.uniforms.uWaterColor[1] = rgb[1];
        this.#shader.uniforms.uWaterColor[2] = rgb[2];
        this.#shader.uniforms.uHighlightColor[0] = Math.min(rgb[0] + 0.15, 1.0);
        this.#shader.uniforms.uHighlightColor[1] = Math.min(rgb[1] + 0.15, 1.0);
        this.#shader.uniforms.uHighlightColor[2] = Math.min(rgb[2] + 0.1, 1.0);
        this.waterColor = rgb;
    }

    /**
     * Push token-wake data into the water refraction shader.
     * @param {Float32Array} buf - Ripple: 8×vec4 ring data. Wake: 4×2 vec4 per line segment (32 floats).
     * @param {number} count - Ripple: 0-8 rings. Wake: 0-4 segments.
     * @param {object} [tuning] - Wake tuning
     */
    setWakeData(buf, count, tuning) {
        const sh = this.#shader;
        if (!sh) return;
        const u = sh.uniforms;

        const applyTuning = () => {
            if (!tuning) return;
            const gridScale = Math.max((canvas.grid?.size ?? 100) / 100, 0.2);
            u.uWakeBandPx      = (Number(tuning.shaderBandPx)      || 24) * gridScale;
            u.uWakePhaseScale  = (Number(tuning.shaderPhaseScale)   || 0.22) / gridScale;
            u.uWakeRippleSpeed = Number(tuning.shaderRippleSpeed)  || 7.5;
            u.uWakeStrengthMul = Number(tuning.shaderStrengthMul)  || 6;
            {
                const wa = Number(tuning.ringWobbleAmp);
                const wl = Number(tuning.ringWobbleLobes);
                u.uWakeRingWobbleAmp   = Number.isFinite(wa) ? Math.max(0, wa) : 0;
                u.uWakeRingWobbleLobes = Number.isFinite(wl) ? Math.max(0.35, wl) : 5.5;
            }
            // V-chevron wave parameters (only used in wake style)
            u.uWakeDivergentK     = (Number(tuning.wakeDivergentK)     || 0.035) / gridScale;
            u.uWakeDivergentOmega = Number(tuning.wakeDivergentOmega) || 1.8;
        };

        if (tuning?.wakeStyle === 'wake') {
            u.uWakeStyle = 1.0;
            applyTuning();
            // Pack 4 stamps × 2 vec4 each into uWake0-uWake7
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

        // Ripple mode: 8 ring vec4s in uWake0-uWake7
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

    /**
     * Push wet token position data into shader for continuous emanating wavelets.
     * @param {Float32Array} buf - 16 floats (4 vec4: cx, cy, tokR, isWet)
     * @param {number} count - Active tokens 0-4
     */
    setTokenData(buf, count) {
        const sh = this.#shader;
        if (!sh) return;
        const u = sh.uniforms;
        const n = Math.min(Math.max(count | 0, 0), 4);
        for (let i = 0; i < 4; i++) {
            const slot = u[`uToken${i}`];
            if (!slot) continue;
            if (i < n) {
                const o = i * 4;
                slot[0] = buf[o];
                slot[1] = buf[o + 1];
                slot[2] = buf[o + 2];
                slot[3] = buf[o + 3];
            } else {
                slot[0] = slot[1] = slot[2] = slot[3] = 0;
            }
        }
    }

    get shader() {
        return this.#shader;
    }

    get uniforms() {
        return this.#shader?.uniforms;
    }
}

