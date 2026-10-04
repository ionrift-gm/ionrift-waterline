import { COMMON_CHUNK } from './chunks/common.glsl.js';
import { SHORELINE_CHUNK } from './chunks/shoreline.glsl.js';
import { OCEAN_CHOP_CHUNK } from './chunks/oceanChop.glsl.js';
import { RIVER_FLOW_CHUNK } from './chunks/riverFlow.glsl.js';
import { LAKE_POND_CHUNK } from './chunks/lakePond.glsl.js';
import { TOKEN_WAKES_CHUNK } from './chunks/tokenWakes.glsl.js';
import { CAUSTICS_CHUNK } from './chunks/caustics.glsl.js';
import { COMPOSITE_CHUNK } from './chunks/composite.glsl.js';
import { warmShaderProgram } from './ShaderWarmup.js';

export const WATER_VERTEX_SRC = `
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

export const WATER_FRAGMENT_SRC = [
    COMMON_CHUNK,
    SHORELINE_CHUNK,
    OCEAN_CHOP_CHUNK,
    RIVER_FLOW_CHUNK,
    LAKE_POND_CHUNK,
    TOKEN_WAKES_CHUNK,
    CAUSTICS_CHUNK,
    COMPOSITE_CHUNK
].join('\n');

/**
 * Creates a PIXI.Shader instance with assembled vertex and fragment sources.
 * @param {Record<string, any>} uniforms
 * @returns {PIXI.Shader}
 */
export function createWaterShader(uniforms) {
    return PIXI.Shader.from(WATER_VERTEX_SRC, WATER_FRAGMENT_SRC, uniforms);
}

/**
 * The shared water program. PIXI caches programs by source, so every water shader uses this one.
 * @returns {PIXI.Program}
 */
export function getWaterProgram() {
    return PIXI.Program.from(WATER_VERTEX_SRC, WATER_FRAGMENT_SRC);
}

/**
 * Compiles the water program in the background before any water mesh draws.
 * @param {PIXI.Renderer} [renderer]
 * @returns {Promise<boolean>}
 */
export function warmWaterShader(renderer = globalThis.canvas?.app?.renderer) {
    if (!renderer || !globalThis.PIXI?.Program) return Promise.resolve(false);
    return warmShaderProgram(renderer, getWaterProgram());
}
