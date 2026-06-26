import { AbstractEmitter } from './AbstractEmitter.js';
import { Noise } from '../lib/Noise.js';

/**
 * Smoke Plume emitter.
 *
 * Physics:
 *  - Chunky particles that spawn at sizeStart and billow to sizeEnd over their lifetime.
 *  - Alpha FADES IN over the first ~20% of life (no scale-from-zero pop).
 *  - Wind is SHARED across the scene (read from scene flags via DrawingFX.getSceneWind).
 *  - Perlin turbulence when wind is light; overrides turbulence when wind is strong.
 *  - spread controls the emission radius.
 */
export class SmokePlume extends AbstractEmitter {
    constructor(drawing, config) {
        super(drawing, config);
        this.noise = new Noise();
        this._spawnTimer = 0;
        this._spawnRate = 1.0 / (15 * this.config.density);
    }

    _spawnParticles(dt) {
        this._spawnTimer += dt;
        while (this._spawnTimer >= this._spawnRate) {
            this._spawnTimer -= this._spawnRate;
            this._emit();
        }
    }

    _emit() {
        if (this.particles.length >= 600) return;

        const sprite = new PIXI.Sprite(this.texture);
        sprite.anchor.set(0.5);

        // Random position within the spread radius
        const angle = Math.random() * Math.PI * 2;
        const r = Math.random() * this.config.spread;
        sprite.x = Math.cos(angle) * r;
        sprite.y = Math.sin(angle) * r;

        const life = 4.0 + Math.random() * 3.0;

        sprite.scale.set(this.config.sizeStart);
        sprite.alpha = 0;
        sprite.rotation = Math.random() * Math.PI * 2;

        // Resolve blend mode from string key (e.g. 'ADD' → PIXI.BLEND_MODES.ADD)
        sprite.blendMode = PIXI.BLEND_MODES[this.config.blendMode] ?? PIXI.BLEND_MODES.NORMAL;

        const grey = Math.floor(0x3a + Math.random() * 0x3a);
        sprite.tint = (grey << 16) | (grey << 8) | grey;

        this.container.addChild(sprite);

        this.particles.push({
            sprite,
            life,
            maxLife: life,
            vx: (Math.random() - 0.5) * 8,
            // Initial upward velocity from speedStart config
            vy: -(this.config.speedStart + Math.random() * this.config.speedStart * 0.3),
            rotSpeed: (Math.random() - 0.5) * 0.4,
            seedOffset: Math.random() * 500
        });
    }

    _updateParticle(p, dt) {
        const t = performance.now() / 2000;

        // Read live simulated wind — includes gust events and drift from WindSimulator
        // Import is deferred to avoid circular dependency at module load time
        const wind = globalThis.game?.ionrift?.particleFX?.DrawingFX?.getEffectiveWind?.()
                  ?? { windDir: this.config.windDir, windStrength: this.config.windStrength };

        const { windDir, windStrength } = wind;

        const windRad = (windDir - 90) * (Math.PI / 180);
        const targetVx = Math.cos(windRad) * windStrength * 80;

        const turbScale = Math.max(0, 1.0 - windStrength * 0.65);
        const turb = this.noise.fbm1D(t + p.seedOffset, 3, 0.5);
        const perpRad = windRad + Math.PI / 2;
        p.vx += (targetVx + Math.cos(perpRad) * turb * 30 * turbScale - p.vx) * dt * (1.5 + windStrength);
        p.vy += Math.sin(perpRad) * turb * 10 * turbScale * dt;

        // Decelerate upward velocity toward speedEnd target
        const targetVy = -this.config.speedEnd;
        p.vy += (targetVy - p.vy) * dt * 0.4;

        p.sprite.x += p.vx * dt;
        p.sprite.y += p.vy * dt;
        p.sprite.rotation += p.rotSpeed * dt;

        const lifeFraction = 1.0 - (p.life / p.maxLife);
        const targetScale = this.config.sizeStart + (this.config.sizeEnd - this.config.sizeStart) * lifeFraction;
        p.sprite.scale.set(targetScale);

        const ageRatio = p.life / p.maxLife;
        const fadeIn = Math.min(1, (1.0 - ageRatio) / 0.2);
        const fadeOut = Math.min(1, ageRatio / 0.3);
        p.sprite.alpha = Math.max(0, Math.min(fadeIn, fadeOut) * this.config.maxAlpha);
    }
}
