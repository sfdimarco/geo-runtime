// ═══════════════════════════════════════════════════════════════════════════
// VALIDATE — the .geo VM against GeoV itself, in the same JS context.
//
// The before is the test. Both engines run on the SAME document, at the SAME
// times along the plan, and the whole vertex buffer is compared float by float
// and the whole index buffer element by element.
//
// ⚠ This is the correctness gate. No timing number from Sprint 1 means anything
//   until this passes, because a fast engine that draws a different character
//   is not a faster engine.
// ═══════════════════════════════════════════════════════════════════════════
import pkg from '/home/claude/.npm-global/lib/node_modules/playwright/index.js';
const { chromium } = pkg;
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compile } from '../tools/geocast-to-geo.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REF = path.join(ROOT, 'bench/reference');
const TIMES = [0, 0.17, 0.35, 0.7, 1.05, 1.4, 1.75, 2.1, 2.45, 2.599, 2.6, 3.3, 5.2, -0.4];

const doc = JSON.parse(fs.readFileSync(path.join(REF, 'v36-test-character.geocast'), 'utf8'));
const wasmB64 = fs.readFileSync(path.join(ROOT, 'web/geokernel.wasm')).toString('base64');

// ── compile, and show what the header claims before anything runs ─────────
const { bin, info } = compile(doc);
console.log('\n════ COMPILE · .geocast → .geo v0 ════');
console.log(`  ${info.bytes} bytes  ·  header ${info.sections.header} · parts ${info.sections.parts} · poses ${info.sections.poses} · plan ${info.sections.plan}`);
console.log(`  ${info.parts} geometry parts (${info.solids} solid · ${info.limbs} limb · ${info.hands} hand · ${info.leaves} leaf), ${info.skippedDrawingParts} drawing parts skipped`);
console.log(`  ${info.poses} poses · ${info.beats} beats · plan_end ${info.planEnd}`);
console.log(`  CEILING DECLARED IN THE HEADER: ${info.maxVerts.toLocaleString()} verts · ${info.maxIdx.toLocaleString()} indices`);
fs.mkdirSync(path.join(ROOT, 'bench/results'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'bench/results/dummy.geo'), bin);

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--no-sandbox'],
});
const page = await browser.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(String(e).slice(0, 200)));
await page.goto('file://' + path.join(REF, 'geov-v36.html'), { waitUntil: 'load' });
await page.waitForTimeout(3500);

const out = await page.evaluate(async ({ doc, wasmB64, binB64, TIMES }) => {
  window.geocastNormalize && window.geocastNormalize(doc);
  if (!rigBoot()) throw new Error('rigBoot failed');
  await new Promise((r) => setTimeout(r, 1200));
  if (typeof window._gcPosed !== 'function') throw new Error('_gcPosed missing after boot');

  const dec = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  const { instance, module } = await WebAssembly.instantiate(dec(wasmB64), {});
  const W = instance.exports;
  if (WebAssembly.Module.imports(module).length) throw new Error('kernel gained an import');

  // write the program into linear memory, then hand it over
  const bin = dec(binB64);
  if (bin.length > W.geo_capacity()) throw new Error('program exceeds kernel capacity');
  new Uint8Array(W.memory.buffer, W.geo_ptr(), bin.length).set(bin);
  const code = W.geo_load(bin.length);
  if (code !== 0) throw new Error('geo_load refused the program: ' + code);

  const rows = [];
  for (const t of TIMES) {
    // ── the oracle: GeoV's own plan evaluator and its own mesh builder
    const pose = window.gcPlanPose(doc, window.gcPlanNorm(doc.plan), t);
    const REFM = gcBuildForm(doc, pose);

    // ── the VM
    const n = W.geo_build(t);
    const v = new Float32Array(W.memory.buffer, W.mesh_ptr(), W.mesh_len());
    const i = new Uint32Array(W.memory.buffer, W.idx_ptr(), W.idx_len());
    const g = new Uint32Array(W.memory.buffer, W.groups_ptr(), W.groups_len() * 4);

    let maxD = 0, at = -1;
    const nc = Math.min(REFM.v.length, v.length);
    for (let k = 0; k < nc; k++) {
      const d = Math.abs(REFM.v[k] - v[k]);
      if (d > maxD) { maxD = d; at = k; }
    }
    let badIdx = 0;
    for (let k = 0; k < Math.min(REFM.idx.length, i.length); k++) if (REFM.idx[k] !== i[k]) badIdx++;

    // groups: same spans, same colours
    let badGrp = 0;
    for (let k = 0; k < Math.min(REFM.groups.length, W.groups_len()); k++) {
      const rg = REFM.groups[k];
      if (rg.start !== g[k * 4] || rg.count !== g[k * 4 + 1]) badGrp++;
      const hex = '#' + g[k * 4 + 2].toString(16).padStart(6, '0');
      if (rg.a.toLowerCase() !== hex.toLowerCase()) badGrp++;
    }

    rows.push({
      t, refVerts: REFM.v.length / 8, vmVerts: n,
      refIdx: REFM.idx.length, vmIdx: i.length,
      refGroups: REFM.groups.length, vmGroups: W.groups_len(),
      maxDelta: maxD, maxDeltaAt: at, badIdx, badGrp,
      overflow: W.overflow_count(),
      withinCeiling: n <= W.geo_max_verts(),
    });
  }

  return {
    rows,
    ceiling: { verts: W.geo_max_verts(), idx: W.geo_max_idx() },
    planEnd: W.geo_plan_end(),
    pages: W.mem_pages(),
    wasmBytes: dec(wasmB64).length,
  };
}, { doc, wasmB64, binB64: Buffer.from(bin).toString('base64'), TIMES });

await browser.close();

// ── report ────────────────────────────────────────────────────────────────
console.log(`\n════ VALIDATE · the VM vs GeoV's own gcBuildForm ════`);
console.log(`  ceiling read back from the kernel: ${out.ceiling.verts.toLocaleString()} verts · plan_end ${out.planEnd}`);
console.log('\n       t |  verts (ref = vm) |  indices |  groups | max |Δvertex| | bad idx | bad grp');
let ok = true;
for (const r of out.rows) {
  const same = r.refVerts === r.vmVerts && r.refIdx === r.vmIdx
            && r.refGroups === r.vmGroups && r.badIdx === 0 && r.badGrp === 0
            && r.maxDelta < 1e-4 && r.overflow === 0 && r.withinCeiling;
  if (!same) ok = false;
  console.log(
    `  ${String(r.t).padStart(6)} | ${String(r.refVerts).padStart(6)} = ${String(r.vmVerts).padEnd(6)}` +
    ` | ${String(r.refIdx).padStart(7)}  | ${String(r.refGroups).padStart(2)} = ${String(r.vmGroups).padEnd(2)}` +
    `    |    ${r.maxDelta.toExponential(2)} |    ${String(r.badIdx).padStart(4)} |    ${String(r.badGrp).padStart(4)}` +
    `  ${same ? '' : ' ← MISMATCH'}`);
}

const worst = Math.max(...out.rows.map((r) => r.maxDelta));
console.log('\n════ VERDICT ════');
if (ok) {
  console.log(`  ✅ IDENTICAL at all ${out.rows.length} times along the plan.`);
  console.log(`     worst |Δvertex| across every float of every frame: ${worst.toExponential(3)}` +
              ` (${(worst / 1.19e-7).toFixed(1)} f32 ULP at 1.0)`);
  console.log(`     index buffers: 0 mismatches. group spans and colours: 0 mismatches.`);
  console.log(`     Times cover: the first beat, mid-segments, every key, the loop seam,`);
  console.log(`     past the end (${out.rows.at(-2).t}s wraps), and a negative time.`);
} else {
  console.log('  ✖ NOT IDENTICAL — do not read any timing from this build.');
  process.exitCode = 1;
}
if (errs.length) { console.log('  page errors:', errs.slice(0, 3).join(' | ')); process.exitCode = 1; }

fs.writeFileSync(path.join(ROOT, 'bench/results/validate.json'),
                 JSON.stringify({ when: new Date().toISOString(), compile: info, ...out }, null, 1));
console.log('\nwritten: bench/results/{dummy.geo,validate.json}');
