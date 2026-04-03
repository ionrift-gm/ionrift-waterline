/**
 * Animated water overlay using PIXI.Graphics redrawn on a ticker.
 * No PIXI.Filter involved - works reliably on Foundry v13.
 *
 * Draws multiple semi-transparent blue polygon layers with
 * slight position offsets that shift over time, creating a
 * visible ripple/shimmer effect.
 */

const LOG = (...args) => console.log('Waterline |', ...args);

export class WaterOverlay {

    /** @type {PIXI.Container} */
    container;

    /** @type {number[][]} */
    #pointSets;

    /** @type {Function|null} */
    #tickerFn = null;

    /** @type {number} */
    #time = 0;

    /** @type {object} */
    #config;

    /**
     * @param {number[][]} pointSets - Array of flat point arrays
     * @param {object} [config]
     */
    constructor(pointSets, config = {}) {
        this.#pointSets = pointSets;
        this.#config = {
            speed:     config.speed ?? 0.4,
            intensity: config.intensity ?? 0.8,
            opacity:   config.opacity ?? 0.45,
        };

        this.container = new PIXI.Container();
        this.container.name = 'water-overlay';
        this.container.eventMode = 'none';

        // Create 3 graphics layers for the ripple effect
        this.#layers = [];
        for (let i = 0; i < 3; i++) {
            const gfx = new PIXI.Graphics();
            gfx.eventMode = 'none';
            this.container.addChild(gfx);
            this.#layers.push(gfx);
        }

        this.#draw(0);
    }

    /** @type {PIXI.Graphics[]} */
    #layers;

    /**
     * Starts the animation loop.
     */
    startAnimation() {
        if (this.#tickerFn) return;
        this.#tickerFn = (delta) => {
            this.#time += (1 / 60) * delta * this.#config.speed;
            this.#draw(this.#time);
        };
        canvas.app.ticker.add(this.#tickerFn);
        LOG('Water animation started');
    }

    /**
     * Redraws the water layers with time-based offsets.
     */
    #draw(t) {
        const baseOpacity = this.#config.opacity;
        const intensity = this.#config.intensity;

        // Layer configs: different colors, offsets, and animation phases
        const layerConfigs = [
            { color: 0x0a3355, alpha: baseOpacity * 0.7, offsetScale: 3, phaseX: 0.7, phaseY: 0.3 },
            { color: 0x1a5580, alpha: baseOpacity * 0.4, offsetScale: 5, phaseX: -0.5, phaseY: 0.8 },
            { color: 0x88bbdd, alpha: baseOpacity * 0.15 * intensity, offsetScale: 2, phaseX: 1.0, phaseY: -0.4 },
        ];

        for (let i = 0; i < this.#layers.length; i++) {
            const gfx = this.#layers[i];
            const cfg = layerConfigs[i];

            gfx.clear();

            // Slight position offset based on time for movement
            const ox = Math.sin(t * cfg.phaseX + i * 2.1) * cfg.offsetScale;
            const oy = Math.cos(t * cfg.phaseY + i * 1.7) * cfg.offsetScale;

            gfx.position.set(ox, oy);

            gfx.beginFill(cfg.color, cfg.alpha);
            for (const points of this.#pointSets) {
                gfx.drawPolygon(points);
            }
            gfx.endFill();
        }
    }

    /**
     * Stops animation.
     */
    stopAnimation() {
        if (this.#tickerFn) {
            canvas.app.ticker.remove(this.#tickerFn);
            this.#tickerFn = null;
        }
    }

    /**
     * Destroys this overlay.
     */
    destroy() {
        this.stopAnimation();
        if (this.container.parent) {
            this.container.parent.removeChild(this.container);
        }
        this.container.destroy({ children: true });
    }
}
