/**
 * Off-thread shader preparation for large water programs.
 *
 * PIXI compiles programs synchronously on first draw and, for GLSL ES 1.0 sources,
 * links them twice (once to read attributes, again after binding locations). With the
 * water fragment shader that blocks the main thread for several seconds per link.
 *
 * This helper compiles and links the exact sources once, using KHR_parallel_shader_compile
 * where available so the browser compiles in the background, then hands the finished program
 * to PIXI's own generateProgram so PIXI never compiles it itself.
 */

const LOG = (...args) => { try { if (game.settings?.get?.('ionrift-waterline', 'debug')) console.log('Waterline |', ...args); } catch { /* setting not yet registered */ } };

const GLSL3_RE = /^[ \t]*#[ \t]*version[ \t]+300[ \t]+es[ \t]*$/m;

/** @type {WeakMap<object, { uid: number, promise: Promise<boolean> }>} */
const PENDING = new WeakMap();

/**
 * Returns the sorted attribute names PIXI will bind for a GLSL ES 1.0 vertex shader,
 * or null for GLSL ES 3.0 sources (PIXI does not rebind those).
 * Matches PIXI's ordering: plain string comparison, index = binding location.
 * @param {string} vertexSrc
 * @returns {string[]|null}
 */
export function parseAttributeNames(vertexSrc) {
    if (typeof vertexSrc !== 'string') return [];
    if (GLSL3_RE.test(vertexSrc)) return null;
    const stripped = vertexSrc
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/[^\n]*/g, '');
    const names = new Set();
    const re = /^[ \t]*attribute\s+(?:(?:lowp|mediump|highp)\s+)?\w+\s+(\w+)\s*;/gm;
    let m;
    while ((m = re.exec(stripped)) !== null) names.add(m[1]);
    return [...names].sort((a, b) => (a > b ? 1 : -1));
}

/**
 * Runs PIXI's generateProgram against an already-linked program. The proxy turns the
 * compile/attach/link calls into no-ops so PIXI only queries the finished program.
 * @param {WebGLRenderingContext} gl
 * @param {object} program - PIXI.Program
 * @param {{ program: WebGLProgram, vs: WebGLShader, fs: WebGLShader }} linked
 * @param {Function} generate - PIXI.generateProgram
 * @returns {object} PIXI.GLProgram
 */
export function adoptLinkedProgram(gl, program, linked, generate) {
    const shaders = [linked.vs, linked.fs];
    let shaderIdx = 0;
    const noop = () => {};
    const overrides = {
        createShader: () => shaders[shaderIdx++] ?? null,
        shaderSource: noop,
        compileShader: noop,
        attachShader: noop,
        linkProgram: noop,
        bindAttribLocation: noop,
        createProgram: () => linked.program
    };
    const proxy = new Proxy(gl, {
        get(target, key) {
            if (Object.prototype.hasOwnProperty.call(overrides, key)) return overrides[key];
            const value = Reflect.get(target, key);
            return typeof value === 'function' ? value.bind(target) : value;
        }
    });
    return generate(proxy, program);
}

/**
 * Checks that PIXI's recorded attribute locations match the linked program.
 * @param {WebGLRenderingContext} gl
 * @param {object} program - PIXI.Program (attributeData populated)
 * @param {WebGLProgram} glProgram
 * @returns {boolean}
 */
export function attributeLocationsMatch(gl, program, glProgram) {
    const data = program?.attributeData ?? {};
    for (const [name, info] of Object.entries(data)) {
        if (gl.getAttribLocation(glProgram, name) !== info.location) return false;
    }
    return true;
}

/**
 * Polls a link until the browser reports completion. Resolves false on timeout or context loss.
 * @param {WebGLRenderingContext} gl
 * @param {WebGLProgram} glProgram
 * @param {object} ext - KHR_parallel_shader_compile
 * @param {{ pollMs?: number, timeoutMs?: number }} [opts]
 * @returns {Promise<boolean>}
 */
export function waitForLink(gl, glProgram, ext, { pollMs = 50, timeoutMs = 60000 } = {}) {
    const start = performance.now();
    return new Promise(resolve => {
        const poll = () => {
            if (gl.isContextLost?.()) return resolve(false);
            if (gl.getProgramParameter(glProgram, ext.COMPLETION_STATUS_KHR)) return resolve(true);
            if (performance.now() - start > timeoutMs) return resolve(false);
            setTimeout(poll, pollMs);
        };
        poll();
    });
}

/**
 * Compiles and links a PIXI program ahead of first draw without blocking the main thread.
 * Safe to call repeatedly; concurrent calls share one compile. Resolves true when the
 * program is ready for PIXI to use, false when PIXI should fall back to its own path.
 * @param {object} renderer - PIXI.Renderer
 * @param {object} program - PIXI.Program
 * @param {{ pollMs?: number, timeoutMs?: number, generate?: Function }} [opts]
 * @returns {Promise<boolean>}
 */
export function warmShaderProgram(renderer, program, opts = {}) {
    const gl = renderer?.gl;
    const uid = renderer?.CONTEXT_UID;
    if (!gl || !program || uid === undefined) return Promise.resolve(false);
    if (program.glPrograms?.[uid]) return Promise.resolve(true);

    const pending = PENDING.get(program);
    if (pending && pending.uid === uid) return pending.promise;

    const promise = compileAndAdopt(renderer, gl, uid, program, opts).then(ok => {
        if (!ok && PENDING.get(program)?.promise === promise) PENDING.delete(program);
        return ok;
    });
    PENDING.set(program, { uid, promise });
    return promise;
}

async function compileAndAdopt(renderer, gl, uid, program, opts) {
    const generate = opts.generate ?? globalThis.PIXI?.generateProgram;
    if (typeof generate !== 'function') return false;

    const t0 = performance.now();
    const ext = gl.getExtension?.('KHR_parallel_shader_compile') ?? null;

    const vs = gl.createShader(gl.VERTEX_SHADER);
    gl.shaderSource(vs, program.vertexSrc);
    gl.compileShader(vs);
    const fs = gl.createShader(gl.FRAGMENT_SHADER);
    gl.shaderSource(fs, program.fragmentSrc);
    gl.compileShader(fs);

    const glProgram = gl.createProgram();
    gl.attachShader(glProgram, vs);
    gl.attachShader(glProgram, fs);
    const attribs = parseAttributeNames(program.vertexSrc);
    if (attribs) attribs.forEach((name, i) => gl.bindAttribLocation(glProgram, i, name));
    gl.linkProgram(glProgram);

    const cleanup = () => {
        try { gl.deleteProgram(glProgram); gl.deleteShader(vs); gl.deleteShader(fs); } catch { /* context gone */ }
    };

    if (ext) {
        const done = await waitForLink(gl, glProgram, ext, opts);
        if (!done) { cleanup(); return false; }
    } else {
        // No background compile available: let the canvas paint first, then link once.
        await new Promise(r => setTimeout(r, 0));
    }

    if (gl.isContextLost?.() || renderer.CONTEXT_UID !== uid) { cleanup(); return false; }
    if (program.glPrograms?.[uid]) { cleanup(); return true; }
    if (!gl.getProgramParameter(glProgram, gl.LINK_STATUS)) {
        LOG('Shader warmup link failed, deferring to renderer:', gl.getProgramInfoLog(glProgram));
        cleanup();
        return false;
    }

    let pixiProgram;
    try {
        pixiProgram = adoptLinkedProgram(gl, program, { program: glProgram, vs, fs }, generate);
    } catch (err) {
        LOG('Shader warmup adoption failed, deferring to renderer:', err);
        cleanup();
        return false;
    }
    if (!pixiProgram || !attributeLocationsMatch(gl, program, glProgram)) {
        LOG('Shader warmup attribute mismatch, deferring to renderer');
        cleanup();
        return false;
    }

    program.glPrograms[uid] = pixiProgram;
    LOG(`Shader ready in ${(performance.now() - t0).toFixed(0)}ms (${ext ? 'background' : 'direct'} compile)`);
    return true;
}
