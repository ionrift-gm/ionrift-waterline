const MODULE_ID = 'ionrift-waterline';

/**
 * Base class for all particle emitters.
 * Manages a PIXI.Container on canvas.effects and drives the ticker update loop.
 * Config is passed directly at construction time (from the placement panel or flags).
 */
export class AbstractEmitter {
    /**
     * @param {DrawingPlaceable} drawing
     * @param {object} config - Parsed FX config from flags
     */
    constructor(drawing, config) {
        this.drawing = drawing;
        this.config = this._parseConfig(config ?? {});

        this.container = new PIXI.Container();
        this.particles = [];
        this.active = false;
        this.lastTime = performance.now();

        // Place at world coordinates of the drawing anchor point
        this.container.position.set(drawing.document.x, drawing.document.y);

        const targetLayer = canvas.effects ?? canvas.stage;
        targetLayer.addChild(this.container);

        // Load texture asynchronously; start with white so the ticker runs immediately
        this.texture = PIXI.Texture.WHITE;
        this._loadTexture();

        this._tickerFn = this._tick.bind(this);
    }

    async _loadTexture() {
        try {
            this.texture = await PIXI.Assets.load('ui/particles/smoke.png');
        } catch {
            console.warn('Ionrift Waterline | Smoke texture not found, using fallback');
            this.texture = PIXI.Texture.WHITE;
        }
    }

    _parseConfig(raw) {
        return {
            type: raw.type ?? 'none',
            density: Number(raw.density) || 1.0,
            spread: Number(raw.spread) || 10,
            windDir: Number(raw.windDir) ?? 90,
            windStrength: Number(raw.windStrength) ?? 0.5,
            intensity: Number(raw.intensity) || 1.0,
            sizeStart: Number(raw.sizeStart) || 0.4,
            sizeEnd: Number(raw.sizeEnd) || 2.5,
            particleSize: Number(raw.particleSize) || 0.3,
            speedStart: Number(raw.speedStart) || 40,
            speedEnd: Number(raw.speedEnd) || 15,
            maxAlpha: Number(raw.maxAlpha) ?? 0.7,
            blendMode: raw.blendMode ?? 'NORMAL'
        };
    }

    start() {
        if (this.active) return;
        this.active = true;
        this.lastTime = performance.now();
        canvas.app.ticker.add(this._tickerFn);
    }

    stop() {
        if (!this.active) return;
        this.active = false;
        canvas.app.ticker.remove(this._tickerFn);
    }

    destroy() {
        this.stop();
        if (this.container.parent) this.container.parent.removeChild(this.container);
        this.container.destroy({ children: true });
        this.particles = [];
    }

    _tick() {
        if (!this.active) return;
        const now = performance.now();
        const dt = Math.min((now - this.lastTime) / 1000.0, 0.1);
        this.lastTime = now;

        this._spawnParticles(dt);

        for (let i = this.particles.length - 1; i >= 0; i--) {
            const p = this.particles[i];
            this._updateParticle(p, dt);
            p.life -= dt;
            if (p.life <= 0) {
                this.container.removeChild(p.sprite);
                p.sprite.destroy();
                this.particles.splice(i, 1);
            }
        }
    }

    // Override in subclasses
    _spawnParticles(dt) {}
    _updateParticle(p, dt) {}
}
