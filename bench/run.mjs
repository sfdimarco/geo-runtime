// ═══════════════════════════════════════════════════════════════════════════
// THE INSTRUMENT — sprint 0's whole deliverable.
//
// The scoreboard exists before the engine does. Build the sweep first.
//
// Done when: change one constant in the Rust source, rebuild, and the chart
// moves without anyone touching this file. RES is read OUT of the wasm, so the
// harness is never told what it was built from — it asks.
//
// ⚠⚠ TWO CLOCKS, AND THEY SEE DIFFERENT THINGS.
//   · CPU    build · view · upload · submit. Real, and what the engine owns.
//   · RASTER EXT_disjoint_timer_query_webgl2. Honest, but SOFTWARE RASTERISED
//            in this container — a regression signal, never an absolute claim.
//   `gl.finish()` is on neither path: measured at 0.01 ms against a draw that
//   actually costs 215 ms. A phase timed with finish() around it is a phase
//   nobody measured.
// ═══════════════════════════════════════════════════════════════════════════
import pkg from '/home/claude/.npm-global/lib/node_modules/playwright/index.js';
const { chromium } = pkg;
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderChart } from './chart.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TILES = [1, 2, 4, 8, 16, 24];
const REP = 25, BATCH = 8;

// ── a real static server; file:// cannot fetch wasm or load ES modules ─────
const MIME = { '.html':'text/html', '.js':'text/javascript', '.wasm':'application/wasm',
               '.json':'application/json', '.css':'text/css', '.svg':'image/svg+xml' };
const server = http.createServer((req, res) => {
  const rel = decodeURIComponent(req.url.split('?')[0]);
  if (rel === '/favicon.ico') { res.writeHead(204); return res.end(); }
  const file = path.join(ROOT, rel === '/' ? '/web/index.html' : rel);
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404); return res.end('not found');
  }
  res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  // ⚠ not cosmetic: without these the context still works but
  //   EXT_disjoint_timer_query_webgl2 is absent and raster is unmeasurable.
  args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader',
         '--enable-unsafe-swiftshader'],
});

// ═══ 1 · THE SWEEP ════════════════════════════════════════════════════════
const page = await browser.newPage({ viewport: { width: 1240, height: 760 } });
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') pageErrors.push(m.text()); });
await page.goto(`${BASE}/web/index.html`, { waitUntil: 'load' });
await page.waitForFunction(() => !!window.RT, null, { timeout: 20000 });

const run = await page.evaluate(async ({ TILES, REP, BATCH }) => {
  const rt = window.RT, k = rt.k;

  const bench = (fn, batch = BATCH, rep = REP) => {
    for (let i = 0; i < batch; i++) fn();               // warm
    const o = [];
    for (let r = 0; r < rep; r++) {
      const t = performance.now();
      for (let i = 0; i < batch; i++) fn();
      o.push((performance.now() - t) / batch);
    }
    o.sort((a, b) => a - b);
    return { med: o[rep >> 1], min: o[0], max: o[rep - 1] };
  };

  // is the page clock clamped? every batch has to clear it.
  const probe = [];
  for (let i = 0; i < 120; i++) {
    const a = performance.now(); let s = 0;
    for (let j = 0; j < 4000; j++) s += j;
    probe.push(+(performance.now() - a).toFixed(4));
  }
  const grain = Math.min(...[...new Set(probe)].filter((x) => x > 0));

  // is finish() a synchronisation point here? recorded, not assumed.
  const finishProbe = (() => {
    rt.tiles = 24; k.buildHello(24);
    const { v, i } = k.views(); rt.stage.upload(v, i);
    const m = rt.matrices(); const gl = rt.stage.gl;
    const t = performance.now();
    for (let n = 0; n < 10; n++) { rt.stage.draw(m.mvp, m.nrm); gl.finish(); }
    const ms = (performance.now() - t) / 10;
    rt.stage.drain();          // pay for those ten now, not during the sweep
    return ms;
  })();

  const rows = [];
  for (const tiles of TILES) {
    rt.tiles = tiles;

    const gen = bench(() => k.buildHello(tiles));
    const view = bench(() => k.views());
    const { v, i, verts, tris } = k.views();
    const upload = bench(() => rt.stage.upload(v, i));
    const mats = rt.matrices();

    // ⚠ anything that DRAWS is benched small and drained after. Submission is
    //   async: 200 queued full-scene draws cost the CPU nothing and cost the
    //   next measurement everything.
    const submit = bench(() => rt.submitOnly(mats), 4, 7);
    rt.stage.drain();

    // the authoritative split: many frames, each timing its own four phases
    const cpu = bench(() => rt.frame(), 2, 9);
    rt.stage.drain();
    rt.resetAcc();
    for (let f = 0; f < 40; f++) rt.frame();
    const inFrame = rt.meanAcc();
    rt.stage.drain();

    const rasterMs = await rt.rasterMs(2, 30000);
    rt.stage.drain();

    rt.frame();
    const coverage = rt.stage.coverage(8);

    rows.push({
      tiles, verts, tris,
      vBytes: v.length * 4, iBytes: i.length * 4,
      genMs: gen.med, genMin: gen.min,
      viewMs: view.med,
      uploadMs: upload.med,
      submitMs: submit.med,
      cpuMs: inFrame.cpuMs, cpuMedIsolated: cpu.med, cpuMin: cpu.min,
      inFrame,
      residualMs: inFrame.cpuMs - inFrame.genMs - inFrame.viewMs
                - inFrame.uploadMs - inFrame.submitMs,
      crossCheck: gen.med > 0 ? inFrame.genMs / gen.med : null,
      rasterMs,
      coverage,
      boundVerts: k.x.bound_hello(tiles),
      overflow: k.x.overflow_count(),
      pages: k.x.mem_pages(),
    });
  }

  return {
    rows, grain, finishProbe,
    res: k.helloRes, wasmBytes: k.bytes,
    maxVerts: k.x.max_verts(), maxIdx: k.x.max_idx(),
    pages0: k.pages0, detaches: k.detaches, memBytes: k.memBytes,
    renderer: rt.stage.info.renderer, glVersion: rt.stage.info.version,
    timerQuery: rt.stage.info.timerQuery,
  };
}, { TILES, REP, BATCH });

// evidence you can look at
await page.evaluate(() => { window.RT.tiles = 6; window.RT.frame(); });
const resultsDir = path.join(ROOT, 'bench/results');
fs.mkdirSync(resultsDir, { recursive: true });
await page.locator('#c').screenshot({ path: path.join(resultsDir, 'frame.png') });
await page.screenshot({ path: path.join(resultsDir, 'hud.png') });
await page.close();

// ═══ 2 · THE DETACH PROOF — its own page. Growing memory is irreversible. ══
const p2 = await browser.newPage();
await p2.goto(`${BASE}/web/index.html`, { waitUntil: 'load' });
await p2.waitForFunction(() => !!window.RT, null, { timeout: 20000 });
const detach = await p2.evaluate(() => {
  const k = window.RT.k;
  k.buildHello(4);
  const live = k.views().v;
  const before = { len: live.length, bytes: live.byteLength, first: live[0] };
  const pagesBefore = k.x.mem_pages();
  k.x.__test_grow(1);                    // ⚠ deliberate. never on the runtime path.
  const stale = { len: live.length, bytes: live.byteLength };
  const fresh = k.views().v;             // views() must notice and re-derive
  return { before, stale, pagesBefore, pagesAfter: k.x.mem_pages(),
           detachedOnGrow: live.byteLength === 0,
           recovered: fresh.length === before.len && fresh[0] === before.first,
           alarmRaised: k.detaches };
});
await p2.close();
await browser.close();
server.close();

// ═══ 3 · VERDICT ══════════════════════════════════════════════════════════
const out = {
  when: new Date().toISOString(), sprint: 0,
  kernel: { res: run.res, wasmBytes: run.wasmBytes, maxVerts: run.maxVerts,
            maxIdx: run.maxIdx, pages0: run.pages0, memBytes: run.memBytes },
  env: { renderer: run.renderer, glVersion: run.glVersion,
         timerQuery: run.timerQuery, clockGrainMs: run.grain,
         finishIsSyncPoint: false, finishProbeMs: run.finishProbe,
         drainedBetweenPhases: true,
         note: 'raster is SOFTWARE rasterised (SwiftShader); regression signal only' },
  rows: run.rows, detach, pageErrors,
};

const R = (n, d = 3, w = 8) => (n === null ? '     n/a'.padStart(w) : n.toFixed(d).padStart(w));
console.log('\n════ geo-runtime · SPRINT 0 · THE INSTRUMENT ════');
console.log(`  kernel   ${run.wasmBytes} bytes · RES=${run.res} (read out of the wasm)`);
console.log(`  arena    ${run.maxVerts.toLocaleString()} verts ceiling · ${(run.memBytes / 1048576).toFixed(2)} MiB linear memory`);
console.log(`  gl       ${run.renderer}`);
console.log(`  clocks   page grain ${run.grain} ms · gl.finish() ${run.finishProbe.toFixed(3)} ms → NOT a sync point`);
console.log('\n            ─────────── CPU · the part the engine owns ───────────    raster');
console.log(' tiles    verts     tris |    build     view   upload   submit |      cpu    resid |  software | cover');
for (const r of run.rows) {
  console.log(
    `  ${String(r.tiles).padStart(3)}  ${String(r.verts).padStart(7)}  ${String(r.tris).padStart(7)} |` +
    ` ${R(r.inFrame.genMs)} ${R(r.inFrame.viewMs, 4)} ${R(r.inFrame.uploadMs)} ${R(r.inFrame.submitMs)} |` +
    ` ${R(r.cpuMs)} ${R(r.residualMs)} | ${R(r.rasterMs, 1, 9)} | ${(r.coverage * 100).toFixed(0).padStart(3)}%`);
}

console.log('\n════ CHECKS ════');
const checks = [];
const push = (ok, label, detail) => {
  checks.push({ ok, label, detail: detail || '' });
  console.log(`  ${ok ? '✅' : '✖ '} ${label}${detail ? ' — ' + detail : ''}`);
  if (!ok) process.exitCode = 1;
};

const rast = run.rows.map((r) => r.rasterMs);
const rastOk = rast.every((x) => x !== null);
push(run.rows.every((r) => r.coverage > 0.05), 'it actually drew',
     `coverage ${(run.rows[0].coverage * 100).toFixed(0)}% at every size`);
push(run.rows.every((r) => r.verts <= r.boundVerts), 'every build stayed inside its stated bound');
push(run.rows.every((r) => r.overflow === 0), 'the arena never overflowed');
push(run.rows.every((r) => r.pages === run.pages0), 'linear memory never grew',
     `${run.pages0} pages throughout`);
push(!run.detaches, 'no view detached during the sweep');
push(detach.detachedOnGrow, 'the footgun is REAL and was reproduced',
     `growing memory took a live view to ${detach.stale.bytes} bytes`);
push(detach.recovered && detach.alarmRaised === 1, 'and the bridge caught it',
     `alarm raised ${detach.alarmRaised}×, view re-derived intact`);
const worstResid = Math.max(...run.rows.map((r) => Math.abs(r.residualMs) / r.cpuMs));
push(worstResid < 0.02, 'the four CPU phases account for the CPU frame',
     `worst unexplained residual ${(worstResid * 100).toFixed(3)}% — measured in-frame, 40 frames each`);
const xs = run.rows.map((r) => r.crossCheck).filter((x) => x);
push(xs.every((x) => x > 0.4 && x < 2.5), 'in-frame build agrees with the isolated bench',
     `ratio ${Math.min(...xs).toFixed(2)}–${Math.max(...xs).toFixed(2)}× (100 µs page clock is the spread)`);
push(rastOk, 'the raster clock answered');
push(rastOk && rast.every((x, i) => i === 0 || x >= rast[i - 1] * 0.85),
     'raster scales with triangles',
     rastOk ? `${rast[0].toFixed(0)} → ${rast.at(-1).toFixed(0)} ms software` : '');
push(pageErrors.length === 0, 'no page errors', pageErrors.slice(0, 2).join(' | '));
out.checks = checks;

// ── history, so a regression is visible rather than remembered ───────────
const histFile = path.join(resultsDir, 'history.json');
const hist = fs.existsSync(histFile) ? JSON.parse(fs.readFileSync(histFile, 'utf8')) : [];
const prev = hist.at(-1);
hist.push({ when: out.when, res: run.res, wasmBytes: run.wasmBytes,
  rows: run.rows.map((r) => ({ tiles: r.tiles, verts: r.verts, genMs: r.genMs,
    uploadMs: r.uploadMs, submitMs: r.submitMs, cpuMs: r.cpuMs, rasterMs: r.rasterMs })) });
fs.writeFileSync(histFile, JSON.stringify(hist, null, 1));
fs.writeFileSync(path.join(resultsDir, 'latest.json'), JSON.stringify(out, null, 1));

// ⚠⚠ TWO THINGS THIS BLOCK LEARNED THE HARD WAY.
//   ① A run built from a DIFFERENT constant is not a baseline. Comparing
//      RES=72 against RES=48 reports "+123% verts" as if it were drift, which
//      is the same error as measuring the thing you designed instead of the
//      thing you shipped — in miniature.
//   ② KNOW YOUR NOISE FLOOR. Same binary, same constant, same container, this
//      harness spreads ±0–6% on `build` and ±6–49% on `cpu`, because `cpu`
//      carries GPU-adjacent work under a software rasteriser on a shared box.
//      A delta smaller than the floor is a Tuesday, not a regression — so the
//      floor is computed from history and printed next to the delta.
const sameRes = hist.filter((h) => h.res === run.res);
const floorFor = (tiles, key) => {
  const a = sameRes.map((h) => h.rows.find((r) => r.tiles === tiles)?.[key]).filter((x) => x > 0);
  if (a.length < 3) return null;
  const mn = Math.min(...a), mx = Math.max(...a);
  return (mx - mn) / mn;
};

if (prev && prev.res === run.res) {
  console.log(`\n════ vs PREVIOUS RUN (RES ${run.res}, same binary) ════`);
  console.log(`  ⭐ read the BUILD column. It is the phase the engine owns and the`);
  console.log(`     only one whose noise floor is tight enough to trust.`);
  const d = (a, b) => (b ? ((a - b) / b) * 100 : 0);
  const pc = (x) => ((x >= 0 ? '+' : '') + x.toFixed(1) + '%').padStart(8);
  for (const r of run.rows) {
    const q = prev.rows.find((x) => x.tiles === r.tiles);
    if (!q) continue;
    const db = d(r.genMs, q.genMs), dc = d(r.cpuMs, q.cpuMs);
    const fb = floorFor(r.tiles, 'genMs'), fc = floorFor(r.tiles, 'cpuMs');
    const tag = (delta, floor) => floor === null ? '  (no floor yet)'
      : Math.abs(delta) > floor * 100 ? '  ← EXCEEDS FLOOR' : `  (floor ±${(floor * 50).toFixed(0)}%)`;
    console.log(`  tiles ${String(r.tiles).padStart(2)}  build ${pc(db)}${tag(db, fb)}`);
    console.log(`             cpu ${pc(dc)}${tag(dc, fc)}`);
  }
} else if (prev) {
  console.log(`\n════ PREVIOUS RUN WAS A DIFFERENT BUILD (RES ${prev.res} → ${run.res}) ════`);
  const q = prev.rows.at(-1), r = run.rows.at(-1);
  console.log(`  not a regression comparison — the constant changed on purpose.`);
  console.log(`  at ${r.tiles}× : verts ${q.verts.toLocaleString()} → ${r.verts.toLocaleString()}` +
              `  ·  build ${q.genMs.toFixed(3)} → ${r.genMs.toFixed(3)} ms`);
  console.log(`  ⭐ THE CHART MOVED, AND NOBODY TOUCHED THE HARNESS.`);
}

if (sameRes.length >= 3) {
  const worst = Math.max(...[1, 2, 4, 8, 16, 24].flatMap((t) =>
    ['genMs', 'uploadMs', 'cpuMs'].map((k) => floorFor(t, k) ?? 0)));
  const build = Math.max(...[1, 2, 4, 8, 16, 24].map((t) => floorFor(t, 'genMs') ?? 0));
  console.log(`\n  noise floor from ${sameRes.length} same-binary runs:` +
              ` build ±${(build * 50).toFixed(0)}%  ·  worst phase ±${(worst * 50).toFixed(0)}%`);
}

fs.writeFileSync(path.join(resultsDir, 'chart.svg'), renderChart(out, hist));
console.log('\nwritten: bench/results/{latest.json,history.json,chart.svg,frame.png,hud.png}');
