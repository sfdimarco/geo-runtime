// ═══════════════════════════════════════════════════════════════════════════
// tools.mjs — what a model is allowed to say to the .geo runtime.
//
// ⭐⭐⭐ THE DESIGN RULE, and it is the whole reason this exists:
//
//     THE PROTOCOL IS NOT A COMPRESSION LAYER. AN ARGUMENT IS STILL A TOKEN.
//
//   Wrapping the runtime in MCP does not make anything cheaper by itself. What
//   makes it cheap is that every tool here takes a STATEMENT — a document, a
//   path, a time — and returns a SUMMARY, never a buffer. geo_build produces
//   46,296 floats and reports eight numbers. A tool that returned the mesh
//   would cost more than the code clip it replaced and would have been a
//   waste of the whole exercise.
//
// ⭐ And none of it needs a browser. geokernel.wasm imports nothing, so every
//   tool in this file runs in bare Node on any machine.
// ═══════════════════════════════════════════════════════════════════════════
import fs from 'node:fs';
import path from 'node:path';
import { loadKernel, Rejected, ROOT } from '../bench/kernel.mjs';
import { compile, Refused } from '../tools/geocast-to-geo.mjs';

/** GeoV's own gcBuildForm on the same mesh, re-measured in BENCH-002. */
export const GEOV_BASELINE_MS = 1.960;

const REJECTION = {
  '-1': 'too short for a header',
  '-2': 'bad magic (not a .geo file)',
  '-3': 'unsupported version',
  '-4': 'a section falls outside the binary',
  '-5': 'ceiling exceeds the arena, or is not what the header implies',
  '-6': 'a host or pose index is out of range',
  '-7': 'kind counts disagree with the part table',
};

const abs = (p) => (path.isAbsolute(p) ? p : path.join(ROOT, p));

/** Accept a .geocast as an inline object or a path, and say which. */
function readCast({ cast, cast_path }) {
  if (cast && cast_path) throw new Error('pass cast OR cast_path, not both');
  if (cast) return { doc: cast, from: 'inline' };
  if (cast_path) {
    const p = abs(cast_path);
    return { doc: JSON.parse(fs.readFileSync(p, 'utf8')), from: p };
  }
  const p = path.join(ROOT, 'bench/reference/v36-test-character.geocast');
  return { doc: JSON.parse(fs.readFileSync(p, 'utf8')), from: `${p} (default reference)` };
}

/** Accept a .geo program as a path or base64. */
function readProgram({ geo_path, geo_base64 }) {
  if (geo_path) return { bin: new Uint8Array(fs.readFileSync(abs(geo_path))), from: abs(geo_path) };
  if (geo_base64) return { bin: new Uint8Array(Buffer.from(geo_base64, 'base64')), from: 'base64' };
  return null;
}

/** Either a compiled cast or a supplied program — one program, one path in. */
async function program(args) {
  const supplied = readProgram(args);
  if (supplied) return { ...supplied, info: null };
  const { doc, from } = readCast(args);
  const { bin, info } = compile(doc, args.res);
  return { bin, from: `compiled from ${from}`, info };
}

// ═══ geo_compile ═══════════════════════════════════════════════════════════
export async function geo_compile(args = {}) {
  const { doc, from } = readCast(args);
  let out;
  try {
    out = compile(doc, args.res);
  } catch (e) {
    if (e instanceof Refused) {
      return { ok: false, refused: true, source: from, reason: e.message,
        note: 'The compiler refuses what the ISA cannot express and names the key. ' +
              'Refusal is a correct outcome, not a bug.' };
    }
    throw e;
  }
  const { bin, info } = out;

  let written = null;
  if (args.out_path) {
    written = abs(args.out_path);
    fs.mkdirSync(path.dirname(written), { recursive: true });
    fs.writeFileSync(written, bin);
  }

  return {
    ok: true,
    source: from,
    bytes: info.bytes,
    parts: { total: info.parts, solid: info.solids, limb: info.limbs, hand: info.hands, leaf: info.leaves,
             // ⭐ v0.1 — how many of those hands carry a PROFILE rather than the mitt
             hand_profiled: info.profiledHands,
             drawing_parts_skipped: info.skippedDrawingParts },
    poses: info.poses,
    beats: info.beats,
    plan_end: info.planEnd,
    ceiling: { max_verts: info.maxVerts, max_idx: info.maxIdx },
    sections: info.sections,
    written,
    // the headline the whole architecture rests on
    expansion: `${info.bytes} B declares a ceiling of ${info.maxVerts.toLocaleString()} verts — ` +
               'known before a single instruction runs.',
    geo_base64: args.include_base64 ? Buffer.from(bin).toString('base64') : undefined,
  };
}

// ═══ geo_build ═════════════════════════════════════════════════════════════
export async function geo_build(args = {}) {
  const { bin, from, info } = await program(args);
  const K = await loadKernel();
  let header;
  try {
    header = K.load(bin);
  } catch (e) {
    if (e instanceof Rejected) {
      return { ok: false, rejected: true, source: from, code: e.rc,
        meaning: REJECTION[String(e.rc)] ?? 'unknown rejection code', reason: e.message };
    }
    throw e;
  }

  const times = args.times ?? [args.t ?? 0];
  const frames = times.map((t) => {
    const b = K.build(t);
    return {
      t, verts: b.verts, idx: b.idx,
      within_ceiling: b.verts <= header.maxVerts && b.idx <= header.maxIdx,
      overflow: b.overflow, memory_grew: b.grew,
    };
  });

  // A sample, never the buffer. Eight floats is enough to see it moved.
  const mesh = K.meshView();
  const sample = args.sample_verts
    ? Array.from(mesh.slice(0, Math.min(args.sample_verts, 16) * K.build(times[0]).stride))
        .map((x) => +x.toFixed(4))
    : undefined;

  return {
    ok: true,
    source: from,
    bytes: bin.length,
    compiled_info: info ? { parts: info.parts, poses: info.poses, beats: info.beats } : undefined,
    header,
    vert_stride: K.build(times[0]).stride,
    frames,
    all_within_ceiling: frames.every((f) => f.within_ceiling),
    memory_pages: K.pages,
    sample,
    note: 'Vertex and index buffers are not returned — they are hundreds of KiB. ' +
          'Ask for sample_verts if you need to see actual numbers.',
  };
}

// ═══ geo_validate ══════════════════════════════════════════════════════════
// The structural gate the VM can answer on its own. It does NOT replace
// bench/validate.mjs, which compares against GeoV itself and needs a browser.
export async function geo_validate(args = {}) {
  const { bin, from } = await program(args);
  const K = await loadKernel();

  let header;
  try {
    header = K.load(bin);
  } catch (e) {
    if (e instanceof Rejected) {
      return { ok: false, accepted: false, source: from, code: e.rc,
        meaning: REJECTION[String(e.rc)] ?? 'unknown rejection code',
        verdict: 'REFUSED — and a refusal that names its key is the VM working, not failing.' };
    }
    throw e;
  }

  // Hostile times: before the plan, after it, and absurd on both sides.
  const TIMES = args.times ?? [0, 0.17, 0.35, 0.7, 1.05, 1.4, 1.75, 2.1, 2.45,
                               header.planEnd - 0.001, header.planEnd, header.planEnd + 0.7,
                               -0.4, 1e9, -1e9];
  const pages0 = K.pages;
  const breaches = [];
  for (const t of TIMES) {
    const b = K.build(t);
    if (b.verts > header.maxVerts) breaches.push({ t, kind: 'verts_over_ceiling', got: b.verts, ceiling: header.maxVerts });
    if (b.idx > header.maxIdx) breaches.push({ t, kind: 'idx_over_ceiling', got: b.idx, ceiling: header.maxIdx });
    if (b.overflow !== 0) breaches.push({ t, kind: 'arena_overflow', count: b.overflow });
    if (K.pages !== pages0) breaches.push({ t, kind: 'memory_grew', pages: K.pages });
  }

  return {
    ok: breaches.length === 0,
    accepted: true,
    source: from,
    header,
    times_checked: TIMES.length,
    breaches,
    verdict: breaches.length === 0
      ? 'ACCEPTED, and the bound held at every time checked — including outside the plan.'
      : `ACCEPTED but the bound was breached ${breaches.length}×. This is the exact failure a bounded VM exists to make impossible.`,
    scope: 'Structural only. This does not prove the picture is correct — ' +
           'that is bench/validate.mjs against GeoV itself, which needs a browser.',
  };
}

// ═══ geo_bench ═════════════════════════════════════════════════════════════
export async function geo_bench(args = {}) {
  const { bin, from } = await program(args);
  const K = await loadKernel();
  const header = K.load(bin);
  const t = args.t ?? 1.05;
  const reps = Math.min(args.reps ?? 300, 5000);
  const s = K.time(t, { reps });
  const b = K.build(t);

  const speedup = GEOV_BASELINE_MS / s.mean;
  const floorPct = s.spread * 100;

  return {
    ok: true,
    source: from,
    t,
    verts: b.verts,
    idx: b.idx,
    geo_build_ms: { mean: +s.mean.toFixed(4), min: +s.min.toFixed(4),
                    p50: +s.p50.toFixed(4), p95: +s.p95.toFixed(4), reps: s.n },
    noise_floor_pct: +floorPct.toFixed(1),
    geov_baseline_ms: GEOV_BASELINE_MS,
    speedup: +speedup.toFixed(2),
    machine: `${process.platform}/${process.arch} · node ${process.versions.node}`,
    caveats: [
      'A DELTA SMALLER THAN THE NOISE FLOOR IS NOT A RESULT — the floor is printed above.',
      `The ${GEOV_BASELINE_MS} ms baseline was measured on a different machine in BENCH-002. ` +
      'A speedup computed across two machines is an estimate, not a measurement.',
      'This times geo_build only. The upload is 84% of the real CPU frame; the build is 14%.',
    ],
  };
}

// ═══ geo_inspect ═══════════════════════════════════════════════════════════
// Read the header without executing anything.
export async function geo_inspect(args = {}) {
  const supplied = readProgram(args);
  if (!supplied) throw new Error('geo_inspect needs geo_path or geo_base64');
  const { bin, from } = supplied;
  if (bin.length < 64) return { ok: false, source: from, reason: `only ${bin.length} B — shorter than the 64 B header` };
  const v = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
  const magic = String.fromCharCode(...bin.slice(0, 4));
  return {
    ok: magic === 'GEO0',
    source: from,
    bytes: bin.length,
    magic,
    declared: {
      plan_end: +v.getFloat32(36, true).toFixed(4),
      max_verts: v.getUint32(40, true),
      max_idx: v.getUint32(44, true),
      parts_off: v.getUint32(48, true),
      poses_off: v.getUint32(52, true),
      plan_off: v.getUint32(56, true),
      total: v.getUint32(60, true),
    },
    length_matches_header: v.getUint32(60, true) === bin.length,
    note: 'Header only — nothing executed. Use geo_validate to test whether the VM accepts it.',
  };
}

// ═══ geo_render ════════════════════════════════════════════════════════════
// ⭐ THE SIXTH TOOL, AND THE ONLY ONE THAT DOES NOT RETURN A NUMBER.
//   compile / build / validate / bench / inspect all answer in numbers, and
//   NOTHING COULD SEE. A wide contact sheet told us "the legs never move"; a
//   windowed render of the same program showed a leg lifting and its boot
//   staying behind. The picture is not decoration — it is the check the
//   numbers cannot make.
//
// ⚠ This is the one place the summary rule bends, and deliberately: an image
//   costs context. It is a RENDERED PICTURE, not a mesh buffer — pass
//   return_image:false to get the path and the frame table alone.
export async function geo_render(args = {}) {
  const { render } = await import('../tools/render.mjs');
  const out = abs(args.out_path ?? 'bench/results/render.png');

  let from, opts;
  if (args.geo_path) { opts = { geoPath: abs(args.geo_path) }; from = abs(args.geo_path); }
  else { const c = readCast(args); opts = { doc: c.doc, res: args.res }; from = c.from; }

  let r;
  try {
    r = await render({
      ...opts, out,
      times: args.times ?? null,
      window: args.window ?? null,
      cols: args.cols ?? 4,
      cell: args.cell ?? [300, 400],
    });
  } catch (e) {
    if (e instanceof Refused) {
      return { ok: false, refused: true, source: from, reason: e.message,
        note: 'The compiler refuses what the ISA cannot express and names the key.' };
    }
    if (e instanceof Rejected) {
      return { ok: false, rejected: true, source: from, code: e.rc,
        meaning: REJECTION[String(e.rc)] ?? 'unknown rejection code', reason: e.message };
    }
    throw e;
  }

  const png = fs.readFileSync(r.out);
  const cap = args.max_image_bytes ?? 1_500_000;
  const inline = args.return_image !== false && png.length <= cap;

  return {
    ok: true,
    source: from,
    out: r.out,
    size: `${r.width}x${r.height}`,
    bytes: png.length,
    ceiling: r.ceiling,
    window: r.window.map((x) => +x.toFixed(4)),
    frames: r.frames,
    all_within_ceiling: r.frames.every((f) => f.within_ceiling && f.overflow === 0),
    image: inline ? { mimeType: 'image/png', base64: png.toString('base64') } : undefined,
    image_note: inline ? undefined
      : `image not inlined (${png.length} B > ${cap} B cap, or return_image:false) — it is on disk at the path above`,
    note: 'A CONTACT SHEET FINDS DEAD FRAMES AND WILL LIE TO YOU ABOUT SMALL ONES. ' +
          'Every frame is listed above with its vertex count; read the numbers beside the picture. ' +
          'To look closely at one region, pass a window — in MESH coordinates, where y_mesh = 1 - y_cast.',
  };
}
