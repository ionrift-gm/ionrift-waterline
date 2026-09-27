import { COMMON_CHUNK } from './chunks/common.glsl.js';
import { SHORELINE_CHUNK } from './chunks/shoreline.glsl.js';
import { OCEAN_CHOP_CHUNK } from './chunks/oceanChop.glsl.js';
import { RIVER_FLOW_CHUNK } from './chunks/riverFlow.glsl.js';
import { LAKE_POND_CHUNK } from './chunks/lakePond.glsl.js';
import { TOKEN_WAKES_CHUNK } from './chunks/tokenWakes.glsl.js';
import { CAUSTICS_CHUNK } from './chunks/caustics.glsl.js';
import { COMPOSITE_CHUNK } from './chunks/composite.glsl.js';

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
