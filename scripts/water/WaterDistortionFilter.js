/**
 * Water distortion filter. PIXI v7.
 * DIAGNOSTIC: Testing with minimal passthrough first,
 * then progressively adding features.
 */

// Test 1: Absolute minimal - just tint red to prove filter runs
const FRAG_PASSTHROUGH = `
    precision highp float;
    varying vec2 vTextureCoord;
    uniform sampler2D uSampler;

    void main(void) {
        vec4 src = texture2D(uSampler, vTextureCoord);
        // Tint red to prove shader is running
        gl_FragColor = vec4(src.r + 0.5, src.g * 0.3, src.b * 0.3, src.a);
    }
`;

export class WaterDistortionFilter extends PIXI.Filter {

    #tickerFn = null;

    constructor(_options = {}) {
        // Minimal: no custom uniforms, just the passthrough shader
        super(null, FRAG_PASSTHROUGH, {});
        this.padding = 0;
        console.log('Waterline | WaterDistortionFilter created (passthrough test)');
    }

    startAnimation() {
        // No-op for passthrough test
    }

    stopAnimation() {
        if (this.#tickerFn) {
            canvas.app.ticker.remove(this.#tickerFn);
            this.#tickerFn = null;
        }
    }

    destroy() {
        this.stopAnimation();
        super.destroy();
    }
}
