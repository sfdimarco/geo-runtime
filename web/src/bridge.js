// ═══════════════════════════════════════════════════════════════════════════
// THE BRIDGE — the zero-copy contract, and the alarm that guards it.
//
// A Float32Array over WebAssembly.Memory.buffer DETACHES the moment linear
// memory grows: length goes to 0 and every read silently returns nothing.
// That is the footgun this file exists to make impossible AND to detect.
//
//   · The kernel's arena is static, so memory never grows.
//   · `views()` re-derives only when the ArrayBuffer IDENTITY changes.
//   · If it ever does change, `detaches` increments and the harness fails
//     the run. The bug becomes loud instead of silent.
//
// No wasm-bindgen, no glue, no imports — `WebAssembly.instantiate(bin, {})`.
// ═══════════════════════════════════════════════════════════════════════════

const GEO_ERR = {
  '-1': 'too short for a header',
  '-2': 'bad magic',
  '-3': 'unsupported version',
  '-4': 'a section offset or length falls outside the binary',
  '-5': 'the declared ceiling exceeds the arena, or is not what the header implies',
  '-6': 'a host or pose index is out of range',
  '-7': 'declared kind counts disagree with the part table',
};

export class Kernel {
  constructor(instance) {
    this.x = instance.exports;
    this.mem = this.x.memory;
    this.pages0 = this.x.mem_pages();
    this._buf = null;
    this._v = null;
    this._i = null;
    /** ⚠ non-zero means linear memory moved under a live view */
    this.detaches = 0;
    this.stride = this.x.vert_stride();
  }

  /** `src` is a URL to fetch, or the wasm bytes themselves (the bundled build). */
  static async load(src) {
    let bin;
    if (src instanceof Uint8Array) bin = src.buffer.slice(src.byteOffset, src.byteOffset + src.byteLength);
    else if (src instanceof ArrayBuffer) bin = src;
    else {
      const res = await fetch(src);
      if (!res.ok) throw new Error(`kernel ${src}: HTTP ${res.status}`);
      bin = await res.arrayBuffer();
    }
    const { instance, module } = await WebAssembly.instantiate(bin, {});
    const imports = WebAssembly.Module.imports(module);
    if (imports.length) {
      throw new Error(`kernel must have zero imports, found ${imports.length}`);
    }
    const k = new Kernel(instance);
    k.bytes = bin.byteLength;
    return k;
  }

  /** Typed-array views over the arena. No copy — these ARE the arena. */
  views() {
    const buf = this.mem.buffer;
    if (this._buf !== buf) {
      if (this._buf !== null) this.detaches++;
      this._buf = buf;
      this._v = this._i = null;
    }
    const vlen = this.x.mesh_len();
    const ilen = this.x.idx_len();
    if (this._v === null || this._v.length !== vlen) {
      this._v = new Float32Array(buf, this.x.mesh_ptr(), vlen);
    }
    if (this._i === null || this._i.length !== ilen) {
      this._i = new Uint32Array(buf, this.x.idx_ptr(), ilen);
    }
    return { v: this._v, i: this._i, verts: vlen / this.stride, tris: ilen / 3 };
  }

  /**
   * The bound, checked rather than trusted. Throws on the two ways a bounded
   * arena can quietly stop being bounded.
   */
  assertBounded(label = '') {
    const of = this.x.overflow_count();
    if (of !== 0) throw new Error(`${label}arena overflowed ${of}× — the ceiling was wrong`);
    const p = this.x.mem_pages();
    if (p !== this.pages0) throw new Error(`${label}linear memory grew ${this.pages0}→${p} pages`);
    if (this.detaches !== 0) throw new Error(`${label}view detached ${this.detaches}×`);
    return true;
  }

  /** Sprint 0's payload — no GeoV content. Returns vertices written. */
  buildHello(tiles) {
    const n = this.x.build_hello(tiles);
    const bound = this.x.bound_hello(tiles);
    if (n > bound) throw new Error(`build_hello wrote ${n} verts past its stated bound ${bound}`);
    return n;
  }

  get helloRes() { return this.x.hello_res(); }
  get memBytes() { return this.mem.buffer.byteLength; }

  // ── the .geo v0 program ──────────────────────────────────────────────────

  /**
   * Hand the kernel a program. Throws with the spec's own error text rather
   * than returning a code nobody checks.
   */
  loadGeo(bytes) {
    if (bytes.length > this.x.geo_capacity()) {
      throw new Error(`program is ${bytes.length} B, kernel capacity is ${this.x.geo_capacity()} B`);
    }
    new Uint8Array(this.mem.buffer, this.x.geo_ptr(), bytes.length).set(bytes);
    const code = this.x.geo_load(bytes.length);
    if (code !== 0) throw new Error(`geo_load refused the program: ${code} — ${GEO_ERR[code] || 'unknown'}`);
    this.geoBytes = bytes.length;
    return {
      bytes: bytes.length,
      maxVerts: this.x.geo_max_verts(),
      maxIdx: this.x.geo_max_idx(),
      planEnd: this.x.geo_plan_end(),
    };
  }

  /** Execute the program at time `t`. Returns vertices written. */
  buildGeo(t) {
    const n = this.x.geo_build(t);
    // the ceiling is checked on the way out, every frame, not just at load
    const ceil = this.x.geo_max_verts();
    if (n > ceil) throw new Error(`geo_build wrote ${n} verts past the declared ceiling ${ceil}`);
    return n;
  }

  /** Per-part spans: start, count, col_a, col_b. A view, not a copy. */
  groups() {
    const n = this.x.groups_len();
    if (this._g === undefined || this._gBuf !== this.mem.buffer || this._g.length !== n * 4) {
      this._gBuf = this.mem.buffer;
      this._g = new Uint32Array(this.mem.buffer, this.x.groups_ptr(), n * 4);
    }
    return { g: this._g, n };
  }
}
