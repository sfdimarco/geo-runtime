// ═══════════════════════════════════════════════════════════════════════════
// THE RUNTIME — build → view → upload → submit, and the clock on each step.
//
// ⚠⚠ WHAT THIS FILE LEARNED THE HARD WAY
//
//   `gl.finish()` DOES NOT SYNCHRONISE in headless Chromium. Measured: a
//   draw + finish costs 0.01 ms while the same draw forced to complete by a
//   readPixels costs 215 ms. Timing a draw with finish() around it reports a
//   free draw forever — a phase that was never measured, charted as if it had
//   been. So finish() is not on the measured path anywhere in this repo.
//
//   Two clocks, and they see different things:
//     · CPU   — build, view, upload, submit. Real, and what the engine owns.
//     · GPU   — EXT_disjoint_timer_query_webgl2. Honest, but SOFTWARE
//               RASTERISED here (SwiftShader), so it is a regression signal
//               and never an absolute claim about anyone's machine.
//
//   The page clock is clamped to 100 µs, so every phase is batched above it.
// ═══════════════════════════════════════════════════════════════════════════
import { Kernel } from './bridge.js';
import { Stage, perspective, orbit, mul4, nrmMat } from './gl.js';

export class Runtime {
  constructor(kernel, stage) {
    this.k = kernel;
    this.stage = stage;
    this.tiles = 6;
    this.az = 0.62;
    this.el = 0.48;
    this.dist = 3.4;
    this.stats = {
      genMs: 0, viewMs: 0, uploadMs: 0, submitMs: 0, cpuMs: 0,
      rasterMs: null,
      verts: 0, tris: 0, vBytes: 0, iBytes: 0,
      res: kernel.helloRes, memBytes: kernel.memBytes, detaches: 0,
    };
    // ⚠ THE SPLIT IS TAKEN INSIDE THE FRAME, NOT INFERRED FROM SEPARATE RUNS.
    //   With a 100 µs page clock, four phases benched apart and one frame
    //   benched whole disagree by pure quantisation — and that disagreement
    //   looks exactly like an unaccounted phase. Accumulating in-frame makes
    //   the parts sum to the whole by construction, so a NON-zero residual
    //   later means a real phase went missing.
    this.acc = null;
    this.resetAcc();
  }

  resetAcc() {
    this.acc = { n: 0, genMs: 0, viewMs: 0, uploadMs: 0, submitMs: 0, cpuMs: 0 };
  }

  /** Mean of the accumulated frames, or null before any ran. */
  meanAcc() {
    const a = this.acc;
    if (!a.n) return null;
    return { n: a.n, genMs: a.genMs / a.n, viewMs: a.viewMs / a.n,
             uploadMs: a.uploadMs / a.n, submitMs: a.submitMs / a.n, cpuMs: a.cpuMs / a.n };
  }

  static async boot(canvas, kernelUrl = './geokernel.wasm') {
    const k = await Kernel.load(kernelUrl);
    const stage = new Stage(canvas);
    return new Runtime(k, stage);
  }

  matrices() {
    const aspect = this.stage.canvas.width / this.stage.canvas.height;
    const proj = perspective(0.85, aspect, 0.05, 60);
    const view = orbit(this.az, this.el, this.dist);
    return { mvp: mul4(proj, view), nrm: nrmMat(view) };
  }

  /** The draw call alone — SUBMISSION cost, not raster cost. Named honestly. */
  submitOnly(m) {
    this.stage.draw(m.mvp, m.nrm);
  }

  /** One CPU frame, phase by phase. No finish(), because finish() is a lie. */
  frame() {
    const s = this.stats;
    const t0 = performance.now();

    this.k.buildHello(this.tiles);
    const t1 = performance.now();

    const { v, i, verts, tris } = this.k.views();
    const t2 = performance.now();

    this.stage.upload(v, i);
    const t3 = performance.now();

    const m = this.matrices();
    this.stage.draw(m.mvp, m.nrm);
    const t4 = performance.now();

    s.genMs = t1 - t0;
    s.viewMs = t2 - t1;
    s.uploadMs = t3 - t2;
    s.submitMs = t4 - t3;
    s.cpuMs = t4 - t0;
    s.verts = verts;
    s.tris = tris;
    s.vBytes = v.length * 4;
    s.iBytes = i.length * 4;
    s.detaches = this.k.detaches;
    s.memBytes = this.k.memBytes;

    const a = this.acc;
    a.n++; a.genMs += s.genMs; a.viewMs += s.viewMs;
    a.uploadMs += s.uploadMs; a.submitMs += s.submitMs; a.cpuMs += s.cpuMs;
    return s;
  }

  /**
   * Real rasterisation time, from the GPU's own clock.
   * Returns ms per draw, or null if the extension is absent.
   * ⚠ SOFTWARE RASTERISED in the bench container. Regression signal only.
   */
  async rasterMs(draws = 3, timeoutMs = 8000) {
    const gl = this.stage.gl;
    const ext = this.stage.timerExt;
    if (!ext) return null;
    const m = this.matrices();
    this.stage.draw(m.mvp, m.nrm);            // warm
    const q = gl.createQuery();
    gl.beginQuery(ext.TIME_ELAPSED_EXT, q);
    for (let i = 0; i < draws; i++) this.stage.draw(m.mvp, m.nrm);
    gl.endQuery(ext.TIME_ELAPSED_EXT);
    gl.flush();
    const t0 = performance.now();
    while (performance.now() - t0 < timeoutMs) {
      await new Promise((r) => setTimeout(r, 8));
      if (gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) {
        const disjoint = gl.getParameter(ext.GPU_DISJOINT_EXT);
        const ns = gl.getQueryParameter(q, gl.QUERY_RESULT);
        gl.deleteQuery(q);
        return disjoint ? null : ns / 1e6 / draws;
      }
    }
    gl.deleteQuery(q);
    return null;
  }

  resize(w, h) { this.stage.resize(w, h); }
}
