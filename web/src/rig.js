// ═══════════════════════════════════════════════════════════════════════════
// RIG — sprint 1's runtime. The .geo binary executes; nothing else does.
//
// A frame is: geo_build(t) → view → upload → submit. JavaScript resolves
// nothing. There is no pose evaluator on this side, no rig walk, no host
// lookup — those all moved into the VM, because a binary that still needs JS
// to work out where the arms go is a command list with extra steps.
//
// Same four phases as Sprint 0, same clock discipline, same drain rules.
// ═══════════════════════════════════════════════════════════════════════════
import { Kernel } from './bridge.js';
import { Stage, perspective, orbit, mul4, nrmMat } from './gl.js';

export class Rig {
  constructor(kernel, stage, program) {
    this.k = kernel;
    this.stage = stage;
    this.program = program;          // { bytes, maxVerts, maxIdx, planEnd }
    this.t = 0;
    this.playing = true;
    this.speed = 1;
    this.az = 0.0;
    this.el = 0.12;
    this.dist = 1.52;
    this.stats = {
      buildMs: 0, viewMs: 0, uploadMs: 0, submitMs: 0, cpuMs: 0,
      verts: 0, tris: 0, groups: 0, vBytes: 0, iBytes: 0,
      programBytes: program.bytes, ceiling: program.maxVerts,
      detaches: 0, rasterMs: null,
    };
    this.acc = null;
    this.resetAcc();
  }

  resetAcc() { this.acc = { n: 0, buildMs: 0, viewMs: 0, uploadMs: 0, submitMs: 0, cpuMs: 0 }; }
  meanAcc() {
    const a = this.acc;
    if (!a.n) return null;
    const o = { n: a.n };
    for (const k of ['buildMs', 'viewMs', 'uploadMs', 'submitMs', 'cpuMs']) o[k] = a[k] / a.n;
    return o;
  }

  static async boot(canvas, kernelSrc, geoBytes) {
    const k = await Kernel.load(kernelSrc);
    const program = k.loadGeo(geoBytes);
    const stage = new Stage(canvas);
    return new Rig(k, stage, program);
  }

  matrices() {
    const aspect = this.stage.canvas.width / this.stage.canvas.height;
    const proj = perspective(0.85, aspect, 0.02, 60);
    // the figure stands on y=0 and is one unit tall, so look at its middle
    const view = orbit(this.az, this.el, this.dist, [0, 0.52, 0]);
    return { mvp: mul4(proj, view), nrm: nrmMat(view) };
  }

  /** One frame at the runtime's own clock position. */
  frame(dt = 0) {
    if (this.playing) this.t += dt * this.speed;
    return this.frameAt(this.t);
  }

  /** One frame at an explicit time — what the harness and the scrub use. */
  frameAt(t) {
    const s = this.stats;
    const t0 = performance.now();

    this.k.buildGeo(t);
    const t1 = performance.now();

    const { v, i, verts, tris } = this.k.views();
    const { g, n } = this.k.groups();
    const t2 = performance.now();

    this.stage.upload(v, i);
    const t3 = performance.now();

    const m = this.matrices();
    this.stage.drawGroups(m.mvp, m.nrm, g, n);
    const t4 = performance.now();

    s.buildMs = t1 - t0;
    s.viewMs = t2 - t1;
    s.uploadMs = t3 - t2;
    s.submitMs = t4 - t3;
    s.cpuMs = t4 - t0;
    s.verts = verts;
    s.tris = tris;
    s.groups = n;
    s.vBytes = v.length * 4;
    s.iBytes = i.length * 4;
    s.detaches = this.k.detaches;

    const a = this.acc;
    a.n++;
    a.buildMs += s.buildMs; a.viewMs += s.viewMs;
    a.uploadMs += s.uploadMs; a.submitMs += s.submitMs; a.cpuMs += s.cpuMs;
    return s;
  }

  /** The draw phase alone — submission, named honestly. */
  submitOnly(m) {
    const { g, n } = this.k.groups();
    this.stage.drawGroups(m.mvp, m.nrm, g, n);
  }

  /** Real rasterisation, from the GPU's own clock. Software here. */
  async rasterMs(draws = 2, timeoutMs = 30000) {
    const gl = this.stage.gl;
    const ext = this.stage.timerExt;
    if (!ext) return null;
    const m = this.matrices();
    this.submitOnly(m);
    const q = gl.createQuery();
    gl.beginQuery(ext.TIME_ELAPSED_EXT, q);
    for (let i = 0; i < draws; i++) this.submitOnly(m);
    gl.endQuery(ext.TIME_ELAPSED_EXT);
    gl.flush();
    const t0 = performance.now();
    while (performance.now() - t0 < timeoutMs) {
      await new Promise((r) => setTimeout(r, 8));
      if (gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) {
        const dis = gl.getParameter(ext.GPU_DISJOINT_EXT);
        const ns = gl.getQueryParameter(q, gl.QUERY_RESULT);
        gl.deleteQuery(q);
        return dis ? null : ns / 1e6 / draws;
      }
    }
    gl.deleteQuery(q);
    return null;
  }

  resize(w, h) { this.stage.resize(w, h); }
}
