import { SmokePlume } from './SmokePlume.js';
import { WaterfallSpray } from './WaterfallSpray.js';
import { ParticlePlacementPanel } from './ParticleConfigApp.js';

const MODULE_ID = 'ionrift-waterline';

export class DrawingFX {

    /** @type {string|null} Active tool type: 'smoke' | 'waterfall' | null */
    static _activeTool = null;

    /** @type {object|null} Pending config from the placement panel */
    static _pendingConfig = null;

    /** @type {Function|null} Callback to call after placement completes/cancels */
    static _placementCallback = null;

    static init() {
        Hooks.on('getSceneControlButtons', DrawingFX._onGetSceneControlButtons);
        Hooks.on('drawDrawing', DrawingFX._onDrawDrawing);
        Hooks.on('updateDrawing', DrawingFX._onUpdateDrawing);
        Hooks.on('destroyDrawing', DrawingFX._onDestroyDrawing);
        Hooks.on('renderDrawingHUD', DrawingFX._onRenderDrawingHUD);
        Hooks.on('canvasReady', () => {
            DrawingFX._wireCanvasClick();
            DrawingFX._startWindSimulator();
        });
        Hooks.on('canvasTearDown', () => DrawingFX._stopWindSimulator());

        // When scene flags change (wind), push new base values into the simulator
        Hooks.on('updateScene', DrawingFX._onUpdateScene);

        game.ionrift ??= {};
        game.ionrift.particleFX = { DrawingFX };
    }

    // ── Wind Simulator ────────────────────────────────────────────────────────
    //
    // Maintains a scene-level evolving wind direction shared by all smoke stacks.
    // Separate from per-particle turbulence: this moves the *mean* wind direction.
    //
    // State:
    //   _ws.baseDir        — steady-state direction from scene flags
    //   _ws.baseStrength   — strength from scene flags
    //   _ws.turbulence     — 0-1 from scene flags, drives gust frequency + magnitude
    //   _ws.drift          — slow sinusoidal wander (always active)
    //   _ws.gustOffset     — current active gust offset (degrees)
    //   _ws.gustTimer      — seconds remaining in the current gust
    //   _ws.gustDuration   — total length of current gust
    //   _ws.nextGustIn     — seconds until the next gust event fires

    static _ws = null;          // wind simulator state object
    static _wsTicker = null;    // PIXI ticker callback reference

    static _startWindSimulator() {
        const scene = canvas.scene;
        DrawingFX._ws = {
            baseDir:      scene?.getFlag(MODULE_ID, 'windDir')         ?? 90,
            baseStrength: scene?.getFlag(MODULE_ID, 'windStrength')    ?? 0.5,
            turbulence:   scene?.getFlag(MODULE_ID, 'windTurbulence')  ?? 0.3,
            time:         0,
            drift:        0,
            gustOffset:   0,
            gustTimer:    0,
            gustDuration: 1,
            nextGustIn:   DrawingFX._randomGustInterval(scene?.getFlag(MODULE_ID, 'windTurbulence') ?? 0.3)
        };

        if (DrawingFX._wsTicker) {
            canvas.app.ticker.remove(DrawingFX._wsTicker);
        }
        DrawingFX._wsTicker = (dt) => DrawingFX._stepWindSimulator(dt / 60); // PIXI dt is in frames @ 60fps
        canvas.app.ticker.add(DrawingFX._wsTicker);
    }

    static _stopWindSimulator() {
        if (DrawingFX._wsTicker) {
            canvas.app?.ticker.remove(DrawingFX._wsTicker);
            DrawingFX._wsTicker = null;
        }
        DrawingFX._ws = null;
    }

    static _randomGustInterval(turbulence) {
        // High turbulence → gusts every ~3-8 s; low turbulence → every ~15-40 s
        const base = turbulence < 0.05 ? 999 : (3 + Math.random() * 5) / (turbulence + 0.05);
        return Math.max(3, base);
    }

    static _stepWindSimulator(dtSeconds) {
        const ws = DrawingFX._ws;
        if (!ws) return;

        ws.time += dtSeconds;

        // Slow sinusoidal drift — very gentle wander even at low turbulence
        ws.drift = Math.sin(ws.time * 0.12) * 8 * ws.turbulence
                 + Math.sin(ws.time * 0.05) * 5 * ws.turbulence;

        // Gust countdown
        ws.nextGustIn -= dtSeconds;
        if (ws.nextGustIn <= 0 && ws.turbulence > 0.05) {
            // Kick off a new gust event
            ws.gustDuration = 2 + Math.random() * 5;                // 2–7 s
            ws.gustTimer    = ws.gustDuration;
            ws.gustOffset   = (Math.random() - 0.5) * 2            // sign
                            * ws.turbulence * 90;                   // up to ±90° at max turbulence
            ws.nextGustIn   = DrawingFX._randomGustInterval(ws.turbulence);
        }

        // Gust envelope — bell curve: ramps up, peaks at 50%, decays back
        if (ws.gustTimer > 0) {
            ws.gustTimer -= dtSeconds;
            const progress = 1 - ws.gustTimer / ws.gustDuration; // 0→1
            ws.activeGust = ws.gustOffset * Math.sin(progress * Math.PI);
        } else {
            ws.activeGust = 0;
        }
    }

    /**
     * Returns the current live wind direction and strength for smoke emitters to read.
     * Falls back to raw scene flags if the simulator hasn't started.
     */
    static getEffectiveWind() {
        const ws = DrawingFX._ws;
        if (!ws) return DrawingFX.getSceneWind();
        return {
            windDir:      ws.baseDir + (ws.drift ?? 0) + (ws.activeGust ?? 0),
            windStrength: ws.baseStrength
        };
    }

    // ── Read raw scene wind flags ─────────────────────────────────────────────

    /**
     * Returns the stored (non-simulated) scene wind flags.
     * Used for initialization only — runtime reads should use getEffectiveWind().
     */
    static getSceneWind() {
        return {
            windDir:      canvas.scene?.getFlag(MODULE_ID, 'windDir')        ?? 90,
            windStrength: canvas.scene?.getFlag(MODULE_ID, 'windStrength')   ?? 0.5,
            windTurbulence: canvas.scene?.getFlag(MODULE_ID, 'windTurbulence') ?? 0.3
        };
    }

    // ── Toolbar ───────────────────────────────────────────────────────────────

    static _onGetSceneControlButtons(controls) {
        if (!game.user.isGM) return;

        const isV13 = !Array.isArray(controls);
        const drawGroup = isV13 ? controls.drawings : controls.find(c => c.name === 'drawings');
        if (!drawGroup?.tools) return;

        const panelTool = {
            name: 'particle-fx-panel',
            title: 'Particle FX',
            icon: 'fas fa-smog',
            order: 30,
            button: true,
            onClick: () => ParticlePlacementPanel.show(),
            onChange: () => {}
        };

        if (isV13) {
            drawGroup.tools['particle-fx-panel'] = panelTool;
        } else {
            drawGroup.tools.push(panelTool);
        }
    }

    // ── Scene wind changed — hot-update simulator base values ────────────────

    static _onUpdateScene(scene, changes) {
        if (!canvas.scene || scene.id !== canvas.scene.id) return;
        const windChanged = foundry.utils.hasProperty(changes, `flags.${MODULE_ID}.windDir`) ||
                            foundry.utils.hasProperty(changes, `flags.${MODULE_ID}.windStrength`) ||
                            foundry.utils.hasProperty(changes, `flags.${MODULE_ID}.windTurbulence`);
        if (!windChanged) return;

        const ws = DrawingFX._ws;
        if (ws) {
            ws.baseDir      = canvas.scene.getFlag(MODULE_ID, 'windDir')         ?? ws.baseDir;
            ws.baseStrength = canvas.scene.getFlag(MODULE_ID, 'windStrength')    ?? ws.baseStrength;
            ws.turbulence   = canvas.scene.getFlag(MODULE_ID, 'windTurbulence')  ?? ws.turbulence;
        }
    }

    // ── Click-to-place ────────────────────────────────────────────────────────

    static activatePlacement(type, config, callback) {
        DrawingFX._activeTool = type;
        DrawingFX._pendingConfig = config;
        DrawingFX._placementCallback = callback;

        // Switch to the Drawings layer so our _onClickLeft patch fires.
        // Without this the user may be on any layer and the click never reaches us.
        if (canvas.drawings && !canvas.drawings.active) {
            canvas.drawings.activate();
        }

        // Ensure the click patch is applied on this layer instance
        DrawingFX._wireCanvasClick();

        const label = type === 'smoke' ? 'Smoke Plume' : 'Waterfall Spray';
        ui.notifications.info(
            `📍 ${label} — click anywhere on the canvas to place. Press Escape to cancel.`,
            { permanent: false, console: false }
        );

        const onKeyDown = (e) => {
            if (e.key === 'Escape') {
                DrawingFX._activeTool = null;
                DrawingFX._pendingConfig = null;
                DrawingFX._placementCallback?.();
                DrawingFX._placementCallback = null;
                window.removeEventListener('keydown', onKeyDown);
                DrawingFX._cancelKeyListener = null;
                ui.notifications.info('Placement cancelled.', { console: false });
            }
        };
        window.addEventListener('keydown', onKeyDown);
        DrawingFX._cancelKeyListener = onKeyDown;
    }

    static _wireCanvasClick() {
        const layer = canvas.drawings;
        if (!layer || layer._waterlineClickPatched) return;

        const original = layer._onClickLeft?.bind(layer);
        layer._onClickLeft = async function (event) {
            if (DrawingFX._activeTool) {
                await DrawingFX._spawnEmitter(event);
                return;
            }
            if (original) return original(event);
        };
        layer._waterlineClickPatched = true;
    }

    static async _spawnEmitter(event) {
        const pos = event.interactionData?.origin ?? event.data?.getLocalPosition?.(canvas.stage);
        if (!pos) {
            console.warn('Ionrift Waterline | Could not resolve click position');
            return;
        }

        const type = DrawingFX._activeTool;
        const config = DrawingFX._pendingConfig ?? { type, density: 1.0, spread: 10 };

        // Clear state immediately to prevent double-drops
        DrawingFX._activeTool = null;
        DrawingFX._pendingConfig = null;
        DrawingFX._placementCallback?.();
        DrawingFX._placementCallback = null;
        if (DrawingFX._cancelKeyListener) {
            window.removeEventListener('keydown', DrawingFX._cancelKeyListener);
            DrawingFX._cancelKeyListener = null;
        }

        const drawingData = {
            author: game.user.id,
            x: pos.x - 4,
            y: pos.y - 4,
            shape: { type: "e", width: 8, height: 8 },
            fillColor: "#00aaff",
            fillAlpha: 0.25,
            strokeColor: "#00aaff",
            strokeWidth: 1,
            strokeAlpha: 0.6,
            flags: {
                [MODULE_ID]: {
                    fx: { type, ...config }
                }
            }
        };

        const cls = getDocumentClass('Drawing');
        await cls.create(drawingData, { parent: canvas.scene });
    }

    // ── HUD button (right-click on emitter → wind icon → opens panel) ─────────

    static _onRenderDrawingHUD(hud, html, data) {
        const drawing = hud.object?.document;
        if (!drawing) return;
        const fxConfig = drawing.getFlag(MODULE_ID, 'fx');
        if (!fxConfig || fxConfig.type === 'none') return;

        const root = html instanceof HTMLElement ? html : html?.[0];
        if (!root) return;

        const button = document.createElement('div');
        button.classList.add('control-icon');
        button.dataset.action = 'particle-fx';
        button.title = 'Edit in Particle FX Panel';
        button.innerHTML = '<i class="fas fa-wind"></i>';

        button.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            hud.clear();
            // Open the main panel and load this emitter for editing
            ParticlePlacementPanel.show();
            // Give the panel time to render, then trigger edit
            setTimeout(() => {
                ParticlePlacementPanel._instance?._loadEmitterForEdit(drawing.id, 
                    document.querySelector('#waterline-particle-panel'));
            }, 100);
        });

        const rightCol = root.querySelector('.col.right');
        if (rightCol) rightCol.appendChild(button);
    }

    // ── Lifecycle ─────────────────────────────────────────────────────────────

    static _onDrawDrawing(drawing) {
        DrawingFX._setupEffect(drawing);
    }

    static _onUpdateDrawing(drawingDoc, changes) {
        const drawing = canvas.drawings?.get(drawingDoc.id);
        if (!drawing) return;

        if (foundry.utils.hasProperty(changes, `flags.${MODULE_ID}.fx`) ||
            foundry.utils.hasProperty(changes, 'shape') ||
            foundry.utils.hasProperty(changes, 'x') ||
            foundry.utils.hasProperty(changes, 'y')) {
            DrawingFX._setupEffect(drawing);
        }
    }

    static _onDestroyDrawing(drawing) {
        DrawingFX._teardownEffect(drawing);
    }

    static _setupEffect(drawing) {
        DrawingFX._teardownEffect(drawing);

        const rawConfig = drawing.document?.getFlag(MODULE_ID, 'fx');
        if (!rawConfig || rawConfig.type === 'none') return;

        // Always inject current scene wind so emitters start with correct values
        const wind = DrawingFX.getSceneWind();
        const fxConfig = {
            ...rawConfig,
            windDir: wind.windDir,
            windStrength: wind.windStrength
        };

        let emitter;
        if (fxConfig.type === 'smoke') {
            emitter = new SmokePlume(drawing, fxConfig);
        } else if (fxConfig.type === 'waterfall') {
            emitter = new WaterfallSpray(drawing, fxConfig);
        }

        if (emitter) {
            drawing._waterlineFx = emitter;
            emitter.start();
        }
    }

    static _teardownEffect(drawing) {
        if (drawing._waterlineFx) {
            drawing._waterlineFx.destroy();
            delete drawing._waterlineFx;
        }
    }

    // ── Canvas selection markers ──────────────────────────────────────────────

    /**
     * Draw pulsing selection circles over all emitter anchor points on the canvas.
     * Called by the panel when it opens/enters edit mode.
     */
    static showMarkers() {
        DrawingFX.hideMarkers();
        DrawingFX._markerContainer = new PIXI.Container();
        const layer = canvas.effects ?? canvas.stage;
        layer.addChild(DrawingFX._markerContainer);

        for (const doc of (canvas.scene?.drawings.contents ?? [])) {
            const fx = doc.getFlag(MODULE_ID, 'fx');
            if (!fx || fx.type === 'none') continue;
            DrawingFX._addMarker(doc);
        }
    }

    static _addMarker(doc) {
        if (!DrawingFX._markerContainer) return;
        const g = new PIXI.Graphics();
        const color = doc.getFlag(MODULE_ID, 'fx')?.type === 'smoke' ? 0x9b59b6 : 0x4a9ad9;

        g.lineStyle(2, color, 0.8);
        g.drawCircle(0, 0, 14);
        g.lineStyle(0);
        g.beginFill(color, 0.25);
        g.drawCircle(0, 0, 10);
        g.endFill();

        g.position.set(doc.x + 4, doc.y + 4); // Centre on the 8×8 ellipse
        g.interactive = true;
        g.cursor = 'pointer';
        g._drawingId = doc.id;

        // Pulse animation
        let tick = Math.random() * Math.PI * 2;
        const tickFn = () => {
            tick += 0.05;
            g.alpha = 0.6 + Math.sin(tick) * 0.4;
        };
        canvas.app.ticker.add(tickFn);
        g._tickFn = tickFn;

        g.on('pointerdown', () => {
            DrawingFX._onMarkerClick(doc.id);
        });

        DrawingFX._markerContainer.addChild(g);
    }

    static _onMarkerClick(drawingId) {
        const panel = ParticlePlacementPanel._instance;
        if (!panel) return;
        panel._loadEmitterForEdit(drawingId,
            document.querySelector('#waterline-particle-panel'));
        // Visually mark which is selected
        DrawingFX._highlightMarker(drawingId);
    }

    static _highlightMarker(selectedId) {
        if (!DrawingFX._markerContainer) return;
        for (const child of DrawingFX._markerContainer.children) {
            child.alpha = child._drawingId === selectedId ? 1.0 : 0.4;
        }
    }

    static hideMarkers() {
        if (!DrawingFX._markerContainer) return;
        for (const child of DrawingFX._markerContainer.children) {
            if (child._tickFn) canvas.app.ticker.remove(child._tickFn);
        }
        DrawingFX._markerContainer.parent?.removeChild(DrawingFX._markerContainer);
        DrawingFX._markerContainer.destroy({ children: true });
        DrawingFX._markerContainer = null;
    }
}
