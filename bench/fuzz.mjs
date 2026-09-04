// ═══════════════════════════════════════════════════════════════════════════
// FUZZ — the bound is TESTED, not asserted.
//
// The claim under test is narrow and total:
//
//   FOR EVERY INPUT THE VM ACCEPTS, EXECUTION FITS THE CEILING THE HEADER
//   DECLARED — no arena overflow, no memory growth, no trap, at any time t.
//
// Rejection is always allowed. What is never allowed is ACCEPTING a program and
// then exceeding the bound, because that is the exact failure a bounded FSM
// exists to make impossible — and the one nobody would notice, since a clamped
// arena keeps rendering something plausible.
//
// Mutations are deliberately aimed at the arithmetic that computes the bound:
// giant counts, 255× resolutions, offsets pointing at the far end of the file.
// A 32-bit usize wrapping a multiply lands on a SMALL ceiling that passes the
// arena check — that hole was found by writing this file and is why the header
// maths saturates.
// ═══════════════════════════════════════════════════════════════════════════
import pkg from '/home/claude/.npm-global/lib/node_modules/playwright/index.js';
const { chromium } = pkg;
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compile } from '../tools/geocast-to-geo.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REF = path.join(ROOT, 'bench/reference');
const N = 4000;
const SEED = Number(process.argv[2] ?? 20260903);

const doc = JSON.parse(fs.readFileSync(path.join(REF, 'v36-test-character.geocast'), 'utf8'));
const { bin: seed } = compile(doc);
const wasmB64 = fs.readFileSync(path.join(ROOT, 'web/geokernel.wasm')).toString('base64');

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--no-sandbox'],
});
const page = await browser.newPage();
await page.goto('about:blank');

const out = await page.evaluate(async ({ wasmB64, seedB64, N, SEED }) => {
  const dec = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  const { instance } = await WebAssembly.instantiate(dec(wasmB64), {});
  const W = instance.exports;
  const seed = dec(seedB64);
  const pages0 = W.mem_pages();

  // deterministic PRNG, so a failure is reproducible from its seed
  let s = SEED >>> 0;
  const rnd = () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
  const ri = (n) => Math.floor(rnd() * n);

  const TIMES = [0, 0.35, 1.4, 2.599, 7.7, -3.1, 1e9, -1e9];
  const cap = W.geo_capacity();

  const stats = {
    tried: 0, accepted: 0, rejected: {}, traps: 0,
    overflowed: 0, exceededCeiling: 0, grew: 0,
    strategies: {},
  };
  const failures = [];

  const strategies = {
    // 1 — flip bytes anywhere
    byteflip(b) { const n = 1 + ri(24); for (let k = 0; k < n; k++) b[ri(b.length)] = ri(256); return b; },
    // 2 — attack the header only: that is where the ceiling is computed
    header(b) { const n = 1 + ri(10); for (let k = 0; k < n; k++) b[ri(64)] = ri(256); return b; },
    // 3 — giant part/pose/beat counts
    counts(b) {
      const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
      v.setUint16(8 + 2 * ri(7), ri(65536), true); return b;
    },
    // 4 — 255× resolutions, aimed straight at the multiply
    res(b) { for (let k = 0; k < 1 + ri(4); k++) b[22 + ri(8)] = ri(2) ? 255 : ri(256); return b; },
    // 5 — offsets pointing anywhere
    offsets(b) {
      const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
      v.setUint32(48 + 4 * ri(3), ri(2) ? ri(4294967296) : ri(b.length + 64), true); return b;
    },
    // 6 — a header that lies about its own ceiling
    ceiling(b) {
      const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
      v.setUint32(ri(2) ? 40 : 44, ri(2) ? ri(4294967296) : ri(100000), true); return b;
    },
    // 7 — truncate
    truncate(b) { return b.slice(0, ri(b.length + 1)); },
    // 8 — poison every float with NaN / ±inf / huge
    floats(b) {
      const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
      for (let k = 0; k < 1 + ri(30); k++) {
        const o = 4 * ri(Math.floor(b.length / 4));
        const pick = ri(4);
        v.setFloat32(o, pick === 0 ? NaN : pick === 1 ? Infinity : pick === 2 ? -Infinity : 1e30, true);
      }
      return b;
    },
    // 9 — pure noise, right magic so it gets past the front door
    noise(b) {
      const n = new Uint8Array(64 + ri(3000));
      for (let k = 0; k < n.length; k++) n[k] = ri(256);
      n[0] = 0x47; n[1] = 0x45; n[2] = 0x4F; n[3] = 0x30; n[4] = 0; n[5] = 0;
      return n;
    },
  };
  const names = Object.keys(strategies);

  for (let iter = 0; iter < N; iter++) {
    const name = names[iter % names.length];
    let b = strategies[name](seed.slice());
    stats.tried++;
    stats.strategies[name] = stats.strategies[name] || { tried: 0, accepted: 0 };
    stats.strategies[name].tried++;

    if (b.length > cap) b = b.slice(0, cap);
    let code;
    try {
      new Uint8Array(W.memory.buffer, W.geo_ptr(), b.length).set(b);
      code = W.geo_load(b.length);
    } catch (e) {
      stats.traps++;
      failures.push({ iter, name, phase: 'load', err: String(e).slice(0, 120) });
      continue;
    }

    if (code !== 0) {
      stats.rejected[code] = (stats.rejected[code] || 0) + 1;
      continue;
    }

    // ── ACCEPTED. From here the bound is a promise the VM has to keep. ──
    stats.accepted++;
    stats.strategies[name].accepted++;
    const ceilV = W.geo_max_verts();
    const ceilI = W.geo_max_idx();
    W.clear_overflow();

    for (const t of TIMES) {
      let n;
      try { n = W.geo_build(t); }
      catch (e) {
        stats.traps++;
        failures.push({ iter, name, phase: 'build', t, err: String(e).slice(0, 120) });
        break;
      }
      if (n > ceilV || W.idx_len() > ceilI) {
        stats.exceededCeiling++;
        failures.push({ iter, name, phase: 'ceiling', t, n, ceilV, idx: W.idx_len(), ceilI });
        break;
      }
      if (W.overflow_count() !== 0) {
        stats.overflowed++;
        failures.push({ iter, name, phase: 'overflow', t, count: W.overflow_count(), ceilV });
        break;
      }
      if (W.mem_pages() !== pages0) {
        stats.grew++;
        failures.push({ iter, name, phase: 'grew', t, pages: W.mem_pages() });
        break;
      }
    }
  }

  return { stats, failures: failures.slice(0, 12), pages0, pagesEnd: W.mem_pages() };
}, { wasmB64, seedB64: Buffer.from(seed).toString('base64'), N, SEED });

await browser.close();

const S = out.stats;
console.log(`\n════ FUZZ · the bound, tested ════   seed ${SEED} · ${S.tried} programs`);
console.log(`  accepted ${S.accepted}   rejected ${S.tried - S.accepted - S.traps}   traps ${S.traps}`);
console.log('\n  rejections by code');
const CODES = { '-1': 'too short for a header', '-2': 'bad magic', '-3': 'unsupported version',
  '-4': 'a section falls outside the binary', '-5': 'ceiling exceeds the arena / is not what the header implies',
  '-6': 'a host or pose index is out of range', '-7': 'kind counts disagree with the part table' };
for (const [c, n] of Object.entries(S.rejected).sort((a, b) => b[1] - a[1])) {
  console.log(`    ${String(c).padStart(3)}  ${String(n).padStart(5)}   ${CODES[c] || '?'}`);
}
console.log('\n  by strategy (accepted / tried)');
for (const [k, v] of Object.entries(S.strategies)) {
  console.log(`    ${k.padEnd(10)} ${String(v.accepted).padStart(4)} / ${String(v.tried).padStart(4)}`);
}

console.log('\n════ THE CLAIM ════');
const clean = S.traps === 0 && S.exceededCeiling === 0 && S.overflowed === 0 && S.grew === 0;
const line = (ok, label, n) => console.log(`  ${ok ? '✅' : '✖ '} ${label}${ok ? '' : ` — ${n}`}`);
line(S.traps === 0, 'no input trapped the VM', S.traps);
line(S.exceededCeiling === 0, 'no accepted program exceeded its declared ceiling', S.exceededCeiling);
line(S.overflowed === 0, 'no accepted program overflowed the arena', S.overflowed);
line(S.grew === 0, 'linear memory never grew', `${out.pages0} → ${out.pagesEnd}`);
console.log(`  ${S.accepted > 0 ? '✅' : '✖ '} the test had teeth — ${S.accepted} mutated programs were ACCEPTED and executed`);
if (!clean) { console.log('\n  first failures:'); for (const f of out.failures) console.log('   ', JSON.stringify(f)); process.exitCode = 1; }
if (S.accepted === 0) { console.log('\n  ✖ every mutation was rejected — this proves the door, not the room.'); process.exitCode = 1; }

fs.writeFileSync(path.join(ROOT, 'bench/results/fuzz.json'),
  JSON.stringify({ when: new Date().toISOString(), seed: SEED, ...out }, null, 1));
console.log('\nwritten: bench/results/fuzz.json');
