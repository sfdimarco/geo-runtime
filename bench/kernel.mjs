// ═══════════════════════════════════════════════════════════════════════════
// kernel.mjs — the browser-free way to run a .geo program.
//
// geokernel.wasm imports NOTHING. It asks the host for no clock, no memory,
// no log, no random. That is not an accident of the build — it is the whole
// architecture stated in the module's import section:
//
//     WebAssembly.Module.imports(mod)  ->  []
//
// So it runs anywhere WebAssembly runs, and that includes bare Node. Anything
// that only exercises the VM — the fuzz, a build, a timing — needs no browser
// and no playwright. Only a gate that needs GeoV's OWN gcBuildForm as the
// reference side needs a page, because GeoV is browser code.
//
// ⚠ This module is the single loader. bench/ and the MCP server both import
//   it, so there is one place where "how you run a .geo program" is written
//   down, and one place to fix when it changes.
// ═══════════════════════════════════════════════════════════════════════════
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const WASM = path.join(ROOT, 'web/geokernel.wasm');

/** Thrown when the VM refuses a program. Refusal is always allowed; a refusal
 *  that names no key is the bug. */
export class Rejected extends Error {
  constructor(rc, why) { super(why); this.name = 'Rejected'; this.rc = rc; }
}

/**
 * Instantiate the kernel. No imports, no browser, no network.
 * @param {string} [wasmPath]
 */
export async function loadKernel(wasmPath = WASM) {
  const bytes = fs.readFileSync(wasmPath);
  const mod = new WebAssembly.Module(bytes);

  // The claim, checked rather than asserted — if this ever stops being empty,
  // the module has grown a host dependency and everything below is a lie.
  const imports = WebAssembly.Module.imports(mod);
  if (imports.length !== 0) {
    throw new Error(
      `geokernel.wasm declares ${imports.length} import(s) — it is no longer ` +
      `freestanding: ${imports.map((i) => `${i.module}.${i.name}`).join(', ')}`,
    );
  }

  const { exports: X } = new WebAssembly.Instance(mod, {});
  return new Kernel(X, bytes.length);
}

export class Kernel {
  constructor(X, wasmBytes) {
    this.X = X;
    this.wasmBytes = wasmBytes;
    this.loaded = null;
  }

  // ── memory views ────────────────────────────────────────────────────────
  // Re-derived on every access. The arena is preallocated and must never grow
  // — but a view cached across a grow is a silently detached buffer, and that
  // reads as "the mesh went empty" rather than as the bounds bug it is.
  get u8()  { return new Uint8Array(this.X.memory.buffer); }
  get pages() { return this.X.mem_pages(); }

  /**
   * Load a compiled .geo program into the VM's own buffer.
   * @param {Uint8Array} bin
   * @returns {{bytes:number, maxVerts:number, maxIdx:number, planEnd:number}}
   */
  load(bin) {
    const cap = this.X.geo_capacity();
    if (bin.length > cap) {
      throw new Rejected(-1, `program is ${bin.length} B, geo_capacity is ${cap} B`);
    }
    this.u8.set(bin, this.X.geo_ptr());
    const rc = this.X.geo_load(bin.length);
    if (rc !== 0) throw new Rejected(rc, `geo_load refused the program (rc=${rc})`);

    this.loaded = {
      bytes: bin.length,
      maxVerts: this.X.geo_max_verts(),
      maxIdx: this.X.geo_max_idx(),
      planEnd: this.X.geo_plan_end(),
    };
    this.X.clear_overflow();
    return this.loaded;
  }

  /** Build the mesh at plan time `t`. Returns what the build actually produced. */
  build(t) {
    if (!this.loaded) throw new Error('build() before load()');
    const pagesBefore = this.X.mem_pages();
    const rc = this.X.geo_build(t);
    return {
      rc,
      t,
      verts: this.X.vert_count(),
      idx: this.X.idx_len(),
      stride: this.X.vert_stride(),
      overflow: this.X.overflow_count(),
      grew: this.X.mem_pages() !== pagesBefore,
      pages: this.X.mem_pages(),
    };
  }

  /** Zero-copy view of the vertex buffer as it stands after the last build. */
  meshView() {
    return new Float32Array(this.X.memory.buffer, this.X.mesh_ptr(), this.X.mesh_len());
  }

  /** Zero-copy view of the index buffer as it stands after the last build. */
  idxView() {
    return new Uint32Array(this.X.memory.buffer, this.X.idx_ptr(), this.X.idx_len());
  }

  /**
   * Time one build. Reports the noise floor beside the mean, because a delta
   * smaller than the floor is not a result.
   * @returns {{mean:number, min:number, p50:number, p95:number, spread:number, n:number}}
   */
  time(t, { reps = 200, warmup = 100 } = {}) {
    for (let i = 0; i < warmup; i++) this.X.geo_build(t);
    const s = new Float64Array(reps);
    for (let i = 0; i < reps; i++) {
      const a = performance.now();
      this.X.geo_build(t);
      s[i] = performance.now() - a;
    }
    const sorted = Array.from(s).sort((a, b) => a - b);
    const mean = sorted.reduce((a, b) => a + b, 0) / reps;
    const p = (q) => sorted[Math.min(reps - 1, Math.floor(q * reps))];
    return {
      mean, min: sorted[0], p50: p(0.5), p95: p(0.95),
      spread: (p(0.95) - sorted[0]) / (mean || 1), n: reps,
    };
  }
}

/** Convenience: compile a .geocast document and load it in one step. */
export async function loadCast(doc, { res, wasmPath } = {}) {
  const { compile } = await import(
    new URL('../tools/geocast-to-geo.mjs', import.meta.url).href
  );
  const { bin, info } = compile(doc, res);
  const K = await loadKernel(wasmPath);
  const header = K.load(bin);
  return { K, bin, info, header };
}
