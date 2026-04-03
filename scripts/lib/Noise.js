/**
 * Lightweight 1D Perlin-style noise for CPU-side vertex offsets.
 * Used by BorderGenerator to produce undulating wall edges.
 */
export class Noise {

    /** @type {number[]} Permutation table */
    #perm;

    /**
     * @param {number} [seed] - Optional seed value
     */
    constructor(seed) {
        this.#perm = Noise.#buildPermutation(seed ?? Math.random() * 65536);
    }

    /**
     * 1D smooth noise in range [-1, 1].
     * @param {number} x - Input coordinate
     * @returns {number}
     */
    noise1D(x) {
        const xi = Math.floor(x) & 255;
        const xf = x - Math.floor(x);
        const u = Noise.#fade(xf);

        const a = this.#perm[xi];
        const b = this.#perm[xi + 1];

        const gradA = Noise.#grad1D(a, xf);
        const gradB = Noise.#grad1D(b, xf - 1);

        return Noise.#lerp(gradA, gradB, u);
    }

    /**
     * Fractal Brownian Motion (layered noise).
     * @param {number} x - Input coordinate
     * @param {number} [octaves=3] - Number of layers
     * @param {number} [persistence=0.5] - Amplitude decay per octave
     * @returns {number}
     */
    fbm1D(x, octaves = 3, persistence = 0.5) {
        let value = 0;
        let amplitude = 1;
        let frequency = 1;
        let maxValue = 0;

        for (let i = 0; i < octaves; i++) {
            value += this.noise1D(x * frequency) * amplitude;
            maxValue += amplitude;
            amplitude *= persistence;
            frequency *= 2;
        }

        return value / maxValue;
    }

    // -- Private helpers --

    static #fade(t) {
        return t * t * t * (t * (t * 6 - 15) + 10);
    }

    static #lerp(a, b, t) {
        return a + t * (b - a);
    }

    static #grad1D(hash, x) {
        return (hash & 1) === 0 ? x : -x;
    }

    /**
     * Builds a seeded permutation table (512 entries, wraps at 256).
     * @param {number} seed
     * @returns {number[]}
     */
    static #buildPermutation(seed) {
        const p = new Array(256);
        for (let i = 0; i < 256; i++) p[i] = i;

        // Fisher-Yates shuffle with seeded PRNG
        let s = seed;
        for (let i = 255; i > 0; i--) {
            s = (s * 16807 + 0) % 2147483647;
            const j = s % (i + 1);
            [p[i], p[j]] = [p[j], p[i]];
        }

        // Double the table to avoid wrapping issues
        const perm = new Array(512);
        for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
        return perm;
    }
}
