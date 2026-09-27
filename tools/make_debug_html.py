import os

with open('scripts/water/WaterMesh.js', 'r', encoding='utf-8', errors='ignore') as f:
    code = f.read()

start_marker = 'const FRAGMENT_SRC = `'
end_marker = '`;\n\nexport class WaterMesh'
if end_marker not in code:
    end_marker = '`;\r\n\r\nexport class WaterMesh'

start = code.find(start_marker) + len(start_marker)
end = code.find(end_marker, start)
frag = code[start:end]

template = """<!DOCTYPE html>
<html>
<head>
<style>
body { margin: 0; background: #000; overflow: hidden; }
canvas { width: 1024px; height: 519px; display: block; }
</style>
</head>
<body>
<canvas id="gl" width="1024" height="519"></canvas>
<script>
const canvas = document.getElementById('gl');
const gl = canvas.getContext('webgl');

const vsSource = `
attribute vec2 position;
varying vec2 vUv;
varying vec2 vWorldPos;
varying vec2 vBgUv;
uniform vec4 uBounds;
uniform vec4 uSceneDims;
void main() {
    vUv = position * 0.5 + 0.5;
    vWorldPos = vUv * uBounds.zw + uBounds.xy;
    vBgUv = (vWorldPos - uSceneDims.xy) / uSceneDims.zw;
    gl_Position = vec4(position, 0.0, 1.0);
}
`;

const fsSource = `__FRAG_SRC__`;

function createShader(gl, type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        console.error('Shader compile error:', gl.getShaderInfoLog(shader));
        gl.deleteShader(shader);
        return null;
    }
    return shader;
}

const vs = createShader(gl, gl.VERTEX_SHADER, vsSource);
const fs = createShader(gl, gl.FRAGMENT_SHADER, fsSource);
const prog = gl.createProgram();
gl.attachShader(prog, vs);
gl.attachShader(prog, fs);
gl.linkProgram(prog);
if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    console.error('Program link error:', gl.getProgramInfoLog(prog));
}
gl.useProgram(prog);

// Quad buffer
const buf = gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER, buf);
gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
    -1, -1,
     1, -1,
    -1,  1,
    -1,  1,
     1, -1,
     1,  1
]), gl.STATIC_DRAW);

const posLoc = gl.getAttribLocation(prog, 'position');
gl.enableVertexAttribArray(posLoc);
gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

// Create dummy 1x1 textures
function makeTex(r, g, b, a) {
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([r, g, b, a]));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    return t;
}

// Bg texture (dark teal ocean)
const bgTex = makeTex(10, 48, 85, 255);
// Shore SDF (all water, deep inside polygon: r=255, g=0, b=255, a=255)
const sdfTex = makeTex(255, 0, 255, 255);

function setU1f(name, val) {
    const loc = gl.getUniformLocation(prog, name);
    if (loc) gl.uniform1f(loc, val);
}
function setU3f(name, x, y, z) {
    const loc = gl.getUniformLocation(prog, name);
    if (loc) gl.uniform3f(loc, x, y, z);
}
function setU4f(name, x, y, z, w) {
    const loc = gl.getUniformLocation(prog, name);
    if (loc) gl.uniform4f(loc, x, y, z, w);
}

setU1f('uTime', 10.0);
setU1f('uIntensity', 0.5);
setU1f('uSpeed', 0.75);
setU1f('uOpacity', 0.35);
setU1f('uDistortion', 0.025);
setU3f('uWaterColor', 0.043, 0.149, 0.282);
setU3f('uHighlightColor', 0.193, 0.299, 0.382);
setU4f('uBounds', 0.0, 0.0, 1024.0, 519.0);
setU4f('uSceneDims', 0.0, 0.0, 1024.0, 519.0);
setU1f('uFadeWidth', 80.0);
setU1f('uScale', 125.0);
setU1f('uFlowAngle', 45.0 * Math.PI / 180.0);
setU1f('uShoreWaves', 0.10);
setU1f('uWaveShoaling', 0.85);
setU1f('uBankDrag', 45.0);
setU1f('uWaveSegment', 0.85);
setU1f('uSwashSurge', 26.0);
setU1f('uChoppySeas', 0.85);
setU1f('uWhitecaps', 0.65);
setU1f('uSunGlint', 0.80);
setU1f('uSpindriftWake', 1.0);
setU1f('uCrestBound', 1.0);
setU1f('uFoamHfWeight', 0.35);
setU4f('uSdfBounds', 0.0, 0.0, 1024.0, 519.0);
setU1f('uSdfMaxDist', 128.0);
setU4f('uWake0', 0, 0, 0, 0);
setU4f('uWake1', 0, 0, 0, 0);
setU4f('uWake2', 0, 0, 0, 0);
setU4f('uWake3', 0, 0, 0, 0);
setU4f('uWake4', 0, 0, 0, 0);
setU4f('uWake5', 0, 0, 0, 0);
setU4f('uWake6', 0, 0, 0, 0);
setU4f('uWake7', 0, 0, 0, 0);
setU1f('uWakeBandPx', 12.0);
setU1f('uWakePhaseScale', 0.18);
setU1f('uWakeRippleSpeed', 3.5);
setU1f('uWakeStrengthMul', 1.0);
setU1f('uWakeRingWobbleAmp', 0.0);
setU1f('uWakeRingWobbleLobes', 3.0);
setU1f('uWakeStyle', 0.0);
setU1f('uWakeDivergentK', 0.14);
setU1f('uWakeDivergentOmega', 3.2);
setU4f('uToken0', 0, 0, 0, 0);
setU4f('uToken1', 0, 0, 0, 0);
setU4f('uToken2', 0, 0, 0, 0);
setU4f('uToken3', 0, 0, 0, 0);

gl.activeTexture(gl.TEXTURE0);
gl.bindTexture(gl.TEXTURE_2D, sdfTex);
const sdfLoc = gl.getUniformLocation(prog, 'uShoreSdf');
if (sdfLoc) gl.uniform1i(sdfLoc, 0);

gl.activeTexture(gl.TEXTURE1);
gl.bindTexture(gl.TEXTURE_2D, bgTex);
const bgLoc = gl.getUniformLocation(prog, 'uBackground');
if (bgLoc) gl.uniform1i(bgLoc, 1);

gl.drawArrays(gl.TRIANGLES, 0, 6);
console.log('Rendered frame successfully!');
</script>
</body>
</html>"""

html = template.replace('__FRAG_SRC__', frag)
os.makedirs('scratch', exist_ok=True)
with open('scratch/render_debug.html', 'w', encoding='utf-8') as f:
    f.write(html)
print('Wrote scratch/render_debug.html')
