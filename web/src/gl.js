// ═══════════════════════════════════════════════════════════════════════════
// THE DRAW PATH — WebGL2, seeded from GeoV's stageGL() shape.
//
// One context, one program, one VAO. The arena's interleave IS the attribute
// layout, so the typed-array view goes straight into gl.bufferData with no
// intermediate: pos3 uv2 nrm3, stride 32 bytes.
// ═══════════════════════════════════════════════════════════════════════════

const VS = `#version 300 es
layout(location=0) in vec3 aPos;
layout(location=1) in vec2 aUV;
layout(location=2) in vec3 aNrm;
uniform mat4 uMVP;
uniform mat3 uNrmMat;
out vec3 vN;
out vec2 vUV;
out vec3 vP;
void main(){
  vN = normalize(uNrmMat * aNrm);
  vUV = aUV;
  vP  = aPos;
  gl_Position = uMVP * vec4(aPos, 1.0);
}`;

// ⭐ THE VALUE PASS, in four lines. A single lambert term over a dark base
//   gives one muddy mass with no light side — which is what the first render
//   was. Warm key, COOL shadow, a cool bounce off the ground for the reflected
//   light under the form, and a rim to peel the silhouette off the ground.
//   Temperature is what makes the shading read as form rather than as tint.
const FS = `#version 300 es
precision highp float;
in vec3 vN; in vec2 vUV; in vec3 vP;
uniform vec3 uKey;
uniform vec3 uTint;
out vec4 frag;
const vec3 WARM = vec3(1.08, 1.00, 0.90);
const vec3 COOL = vec3(0.62, 0.76, 1.00);
void main(){
  vec3 N = normalize(vN);
  float lam    = max(dot(N, normalize(uKey)), 0.0);
  float bounce = max(dot(N, vec3(0.0, -1.0, 0.25)), 0.0);   // up from the floor
  float rim    = pow(1.0 - abs(N.z), 3.5);
  vec3 c = uTint * (COOL * (0.26 + 0.34 * bounce) + WARM * (1.02 * lam));
  c += vec3(0.14, 0.46, 0.52) * rim * 0.55;
  frag = vec4(c, 1.0);
}`;

function compile(gl, type, src, what) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    throw new Error(`${what}: ${gl.getShaderInfoLog(s)}`);
  }
  return s;
}

export class Stage {
  constructor(canvas) {
    const gl = canvas.getContext('webgl2', {
      antialias: true,
      depth: true,
      alpha: true,             // so the CSS ground shows through the clear
      preserveDrawingBuffer: true,
      powerPreference: 'high-performance',
    });
    if (!gl) throw new Error('no WebGL2 context');
    this.gl = gl;
    this.canvas = canvas;

    const p = gl.createProgram();
    gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, VS, 'vertex shader'));
    gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, FS, 'fragment shader'));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      throw new Error(`link: ${gl.getProgramInfoLog(p)}`);
    }
    this.prog = p;
    this.u = {
      mvp: gl.getUniformLocation(p, 'uMVP'),
      nrm: gl.getUniformLocation(p, 'uNrmMat'),
      key: gl.getUniformLocation(p, 'uKey'),
      tint: gl.getUniformLocation(p, 'uTint'),
    };

    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    this.vbo = gl.createBuffer();
    this.ibo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    const S = 8 * 4; // pos3 uv2 nrm3, floats → bytes
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, S, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, S, 12);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 3, gl.FLOAT, false, S, 20);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.ibo);
    gl.bindVertexArray(null);

    gl.enable(gl.DEPTH_TEST);
    // ⚠ THE WINDING CONVENTION, STATED ONCE.
    //   arena::quads emits (a, c, b) (b, c, d) — byte-identical to GeoV's own
    //   gcQuads, which BENCH-002 validated index-for-index. That winding puts
    //   the front face on the CW side, so the renderer is told the convention
    //   rather than the data being rewritten to suit the renderer.
    //   Culling stays ON deliberately: with it off, an inside-out surface looks
    //   fine forever. With it on, the coverage check catches it the same day.
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
    gl.frontFace(gl.CW);

    // The only clock in this environment that can see the rasteriser.
    // ⚠ gl.finish() cannot — measured at 0.01 ms against a 215 ms draw.
    this.timerExt = gl.getExtension('EXT_disjoint_timer_query_webgl2');

    this.count = 0;
    this.info = {
      renderer: (() => {
        const d = gl.getExtension('WEBGL_debug_renderer_info');
        return d ? gl.getParameter(d.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
      })(),
      version: gl.getParameter(gl.VERSION),
      timerQuery: !!this.timerExt,
    };
  }

  /**
   * Upload straight from the arena views. `v` and `i` are windows onto WASM
   * linear memory — there is no intermediate array anywhere in this call.
   */
  upload(v, i) {
    const gl = this.gl;
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bufferData(gl.ARRAY_BUFFER, v, gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.ibo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, i, gl.DYNAMIC_DRAW);
    this.count = i.length;
  }

  resize(w, h) {
    this.canvas.width = w;
    this.canvas.height = h;
    this.gl.viewport(0, 0, w, h);
  }

  draw(mvp, nrmMat, tint = [0.16, 0.74, 0.80], key = [-0.42, 0.72, 0.55]) {
    const gl = this.gl;
    gl.clearColor(0.043, 0.058, 0.070, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    if (!this.count) return;
    gl.useProgram(this.prog);
    gl.bindVertexArray(this.vao);
    gl.uniformMatrix4fv(this.u.mvp, false, mvp);
    gl.uniformMatrix3fv(this.u.nrm, false, nrmMat);
    gl.uniform3fv(this.u.key, key);
    gl.uniform3fv(this.u.tint, tint);
    gl.drawElements(gl.TRIANGLES, this.count, gl.UNSIGNED_INT, 0);
  }

  /**
   * Draw the mesh one part at a time, each in its own colour.
   * `groups` is the kernel's span table: start, count, col_a, col_b per part —
   * a view over linear memory, like everything else here.
   * ⭐ The spans are BYTE-IDENTICAL to GeoV's own `M.groups`, which is what lets
   *   the same character come out of a different engine looking like itself.
   */
  drawGroups(mvp, nrmMat, groups, n, key = [-0.42, 0.72, 0.55]) {
    const gl = this.gl;
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    if (!n) return;
    gl.useProgram(this.prog);
    gl.bindVertexArray(this.vao);
    gl.uniformMatrix4fv(this.u.mvp, false, mvp);
    gl.uniformMatrix3fv(this.u.nrm, false, nrmMat);
    gl.uniform3fv(this.u.key, key);
    const tint = new Float32Array(3);
    for (let k = 0; k < n; k++) {
      const start = groups[k * 4];
      const count = groups[k * 4 + 1];
      if (!count) continue;
      const c = groups[k * 4 + 2];
      tint[0] = ((c >> 16) & 255) / 255;
      tint[1] = ((c >> 8) & 255) / 255;
      tint[2] = (c & 255) / 255;
      gl.uniform3fv(this.u.tint, tint);
      gl.drawElements(gl.TRIANGLES, count, gl.UNSIGNED_INT, start * 4);
    }
    this.count = 0;
  }

  /**
   * Force every queued draw to actually complete.
   * ⚠ THE INSTRUMENT BUG THIS EXISTS FOR: draw submission is asynchronous and
   *   unbounded. Benchmarking `submit` queues hundreds of full-scene draws the
   *   CPU never waits for, so the GPU is still working on them minutes later —
   *   which starves every measurement that follows and eventually applies
   *   backpressure to unrelated phases. gl.finish() does not drain it here.
   *   A 1×1 readPixels does.
   */
  drain() {
    const px = new Uint8Array(4);
    this.gl.readPixels(0, 0, 1, 1, this.gl.RGBA, this.gl.UNSIGNED_BYTE, px);
    return px;
  }

  readCenterPixel() {
    const gl = this.gl;
    const px = new Uint8Array(4);
    gl.readPixels(this.canvas.width >> 1, this.canvas.height >> 1,
                  1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    return Array.from(px);
  }

  /** Fraction of sampled pixels that are not the clear colour. Proves it drew. */
  coverage(step = 8) {
    const gl = this.gl;
    const w = this.canvas.width, h = this.canvas.height;
    const px = new Uint8Array(w * h * 4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
    let hit = 0, n = 0;
    for (let y = 0; y < h; y += step) {
      for (let x = 0; x < w; x += step) {
        const o = (y * w + x) * 4;
        n++;
        if (px[o] > 20 || px[o + 1] > 22 || px[o + 2] > 25) hit++;
      }
    }
    return hit / n;
  }
}

// ── the smallest matrix maths the stage needs ─────────────────────────────
export function perspective(fovy, aspect, near, far) {
  const f = 1 / Math.tan(fovy / 2), nf = 1 / (near - far);
  return new Float32Array([
    f / aspect, 0, 0, 0,
    0, f, 0, 0,
    0, 0, (far + near) * nf, -1,
    0, 0, 2 * far * near * nf, 0,
  ]);
}

export function orbit(az, el, dist, target = [0, 0, 0]) {
  const ce = Math.cos(el), se = Math.sin(el);
  const ca = Math.cos(az), sa = Math.sin(az);
  const eye = [
    target[0] + dist * ce * sa,
    target[1] + dist * se,
    target[2] + dist * ce * ca,
  ];
  return lookAt(eye, target, [0, 1, 0]);
}

export function lookAt(eye, at, up) {
  const z = norm3([eye[0] - at[0], eye[1] - at[1], eye[2] - at[2]]);
  const x = norm3(cross3(up, z));
  const y = cross3(z, x);
  return new Float32Array([
    x[0], y[0], z[0], 0,
    x[1], y[1], z[1], 0,
    x[2], y[2], z[2], 0,
    -dot3(x, eye), -dot3(y, eye), -dot3(z, eye), 1,
  ]);
}

export function mul4(a, b) {
  const o = new Float32Array(16);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
      o[c * 4 + r] = s;
    }
  }
  return o;
}

/** Upper-left 3×3 of a view matrix — orthonormal here, so no inverse needed. */
export function nrmMat(m) {
  return new Float32Array([m[0], m[1], m[2], m[4], m[5], m[6], m[8], m[9], m[10]]);
}

const cross3 = (a, b) => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
const dot3 = (a, b) => a[0]*b[0] + a[1]*b[1] + a[2]*b[2];
const norm3 = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0]/l, a[1]/l, a[2]/l]; };
