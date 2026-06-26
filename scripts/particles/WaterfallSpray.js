import { AbstractEmitter } from './AbstractEmitter.js';
import { Noise } from '../lib/Noise.js';

/**
 * Waterfall Spray emitter.
 *
 * Simulates the static mist/splash cloud at the base of a waterfall.
 * Particles burst upward and outward, gravity pulls them back down.
 * Short, additive-blended, blue-white mist that fades with a bell-curve alpha.
 * particleSize controls the base scale of each mist droplet.
 */
export class WaterfallSpray extends AbstractEmitter {
    constructor(drawing, config) {
        super(drawing, config);
        this.noise = new Noise();
        this._spawnTimer = 0;
        this._spawnRate = 1.0 / (30 * this.config.density);
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
        sprite.blendMode = PIXI.BLEND_MODES.ADD;

        // Spread across the splash zone
        const halfSpread = this.config.spread / 2;
        sprite.x = (Math.random() - 0.5) * halfSpread * 2;
        sprite.y = (Math.random() - 0.5) * (this.config.spread * 0.15);
        sprite.tint = 0xc8eeff;

        const life = 0.8 + Math.random() * 1.2;
        // particleSize controls base scale — grows as mist disperses
        const baseScale = this.config.particleSize * (0.6 + Math.random() * 0.8);
        sprite.scale.set(baseScale);
        sprite.alpha = 0;
        sprite.rotation = Math.random() * Math.PI * 2;

        this.container.addChild(sprite);

        const burstAngle = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 0.8;
        const burstSpeed = (80 + Math.random() * 120) * this.config.intensity;

        this.particles.push({
            sprite,
            life,
            maxLife: life,
            baseScale,
            vx: Math.cos(burstAngle) * burstSpeed,
            vy: Math.sin(burstAngle) * burstSpeed,
            gravity: 180 + Math.random() * 80,
            rotSpeed: (Math.random() - 0.5) * 2.0,
            seedOffset: Math.random() * 500
        });
    }

    _updateParticle(p, dt) {
        const t = performance.now() / 2000;

        p.vy += p.gravity * dt;
        p.vx *= (1 - dt * 2.5);

        const turb = this.noise.fbm1D(t + p.seedOffset, 2, 0.5);
        p.vx += turb * 8 * dt;

        p.sprite.x += p.vx * dt;
        p.sprite.y += p.vy * dt;
        p.sprite.rotation += p.rotSpeed * dt;

        // Mist expands as it disperses
        const lifeRatio = p.life / p.maxLife;
        p.sprite.scale.set(p.baseScale * (1.0 + (1.0 - lifeRatio) * 2.5));

        // Bell-curve alpha — fade in quickly, linger, fade out
        p.sprite.alpha = Math.max(0, Math.sin(lifeRatio * Math.PI) * 0.7);
    }
}
