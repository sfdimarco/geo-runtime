// ═══════════════════════════════════════════════════════════════════════════
// SPRINT 1 — the done-when, measured.
//
//   The dummy renders from the .geo binary — posed, at three angles — faster
//   than GeoV, every HUD control passes elementFromPoint(centre) === it, and
//   there is a screenshot worth posting.
//
// ⚠⚠ PRESENT IS NOT REACHABLE. A control that exists, is visible, and is on
//   screen can still be covered by the next panel — GeoV's DEPTH slider was,
//   for months, and every clipping test passed it because nothing was clipped.
//   The only honest check is elementFromPoint at the control's own centre, run
//   on EVERY control in the row, plus a real mouse drag that moves the value.
// ═══════════════════════════════════════════════════════════════════════════
import pkg from '/home/claude/.npm-global/lib/node_modules/playwright/index.js';
const { chromium } = pkg;
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASELINE_MS = 1.960;   // GeoV gcBuildForm, re-measured in BENCH-002
const COMMITTED_MS = 1.93;   // the number the build plan named
const CONTROLS = ['btn-play', 'btn-a', 'btn-b', 'btn-c', 'rig-time', 'rig-yaw', 'rig-el'];
const TIMES = [0, 0.35, 0.7, 1.05, 1.4, 1.75, 2.1, 2.45];

const MIME = { '.html':'text/html', '.js':'text/javascript', '.wasm':'application/wasm',
               '.geo':'application/octet-stream', '.json':'application/json' };
const server = http.createServer((req, res) => {
  const rel = decodeURIComponent(req.url.split('?')[0]);
  if (rel === '/favicon.ico') { res.writeHead(204); return res.end(); }
  const file = path.join(ROOT, rel);
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
  args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1220, height: 820 } });
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 200)));
page.on('console', (m) => { if (m.type() === 'error') pageErrors.push(m.text().slice(0, 200)); });
await page.goto(`${BASE}/web/rig.html`, { waitUntil: 'load' });
await page.waitForFunction(() => !!window.RIG, null, { timeout: 20000 });

const OUT = path.join(ROOT, 'bench/results');
fs.mkdirSync(OUT, { recursive: true });

// ═══ 1 · REACHABILITY, AT THREE WINDOW SIZES ══════════════════════════════
// ⚠ reachable at one size is not reachable. v36's DEPTH slider was on screen at
//   every size and covered at all of them.
const SIZES = [[1220, 820], [1040, 640], [1360, 1000]];
const probe = (ids) => ids.map((id) => {
  const el = document.getElementById(id);
  if (!el) return { id, exists: false };
  const r = el.getBoundingClientRect();
  const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
  const hit = document.elementFromPoint(cx, cy);
  return {
    id, exists: true,
    w: Math.round(r.width), h: Math.round(r.height),
    onscreen: r.width > 0 && r.height > 0 && r.top >= 0 && r.bottom <= innerHeight
              && r.left >= 0 && r.right <= innerWidth,
    hit: hit === el || el.contains(hit),
    coveredBy: (hit === el || el.contains(hit)) ? null
             : (hit ? (hit.id || hit.tagName + '.' + hit.className).slice(0, 40)
                    : 'nothing — the point is outside the viewport'),
  };
});

const reachBySize = [];
for (const [w, h] of SIZES) {
  await page.setViewportSize({ width: w, height: h });
  await page.waitForTimeout(180);
  reachBySize.push({ size: `${w}×${h}`, rows: await page.evaluate(probe, CONTROLS) });
}
await page.setViewportSize({ width: 1220, height: 820 });
await page.waitForTimeout(180);
const reach = reachBySize[0].rows;

// a real mouse drag on each slider — a hit test proves reachable, not usable
const drags = [];
for (const id of ['rig-time', 'rig-yaw', 'rig-el']) {
  const before = await page.$eval('#' + id, (e) => e.value);
  const box = await page.locator('#' + id).boundingBox();
  await page.mouse.move(box.x + box.width * 0.2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.78, box.y + box.height / 2, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(120);
  const after = await page.$eval('#' + id, (e) => e.value);
  const readout = await page.$eval('#' + id, (e) =>
    e.previousElementSibling.querySelector('span').textContent);
  drags.push({ id, before, after, moved: before !== after, readout });
}

// ═══ 2 · THREE ANGLES, POSED ══════════════════════════════════════════════
const shots = [];
for (const [btn, name, t] of [['btn-a', 'three-quarter', 0.35],
                              ['btn-b', 'front', 1.05],
                              ['btn-c', 'side', 1.75]]) {
  await page.click('#' + btn);
  await page.evaluate((tt) => { window.RIG.playing = false; window.RIG.t = tt; window.RIG.frameAt(tt); }, t);
  await page.waitForTimeout(150);
  const cov = await page.evaluate(() => { window.RIG.frameAt(window.RIG.t); return window.RIG.stage.coverage(6); });
  const file = path.join(OUT, `rig-${name}.png`);
  await page.locator('#c').screenshot({ path: file });
  shots.push({ name, t, coverage: cov, file: path.basename(file) });
}
await page.click('#btn-a');
await page.evaluate(() => { window.RIG.t = 0.35; window.RIG.frameAt(0.35); });
await page.waitForTimeout(150);
await page.screenshot({ path: path.join(OUT, 'sprint1-hud.png') });

// ═══ 3 · THE NUMBER ═══════════════════════════════════════════════════════
const perf = await page.evaluate(async ({ TIMES }) => {
  const rig = window.RIG;
  rig.playing = false;
  const rows = [];
  for (const t of TIMES) {
    rig.t = t;
    for (let i = 0; i < 10; i++) rig.frameAt(t);      // warm
    rig.stage.drain();
    rig.resetAcc();
    for (let i = 0; i < 60; i++) rig.frameAt(t);
    const m = rig.meanAcc();
    rig.stage.drain();
    const raster = await rig.rasterMs(2);
    rig.stage.drain();
    rows.push({ t, ...m, verts: rig.stats.verts, tris: rig.stats.tris,
                groups: rig.stats.groups, raster });
  }
  // the program's own cost, isolated: no view, no upload, no draw
  const bench = (fn, batch, rep) => {
    for (let i = 0; i < batch; i++) fn();
    const o = [];
    for (let r = 0; r < rep; r++) {
      const s = performance.now();
      for (let i = 0; i < batch; i++) fn();
      o.push((performance.now() - s) / batch);
    }
    o.sort((a, b) => a - b);
    return o[rep >> 1];
  };
  const buildOnly = bench(() => rig.k.buildGeo(1.05), 40, 25);
  return {
    rows, buildOnly,
    program: rig.program, wasmBytes: rig.k.bytes,
    ceiling: rig.k.x.geo_max_verts(),
    overflow: rig.k.x.overflow_count(),
    pages: rig.k.x.mem_pages(), pages0: rig.k.pages0,
    detaches: rig.k.detaches,
    renderer: rig.stage.info.renderer,
  };
}, { TIMES });

await page.close();
await browser.close();
server.close();

// ═══ REPORT ═══════════════════════════════════════════════════════════════
const f = (x, d = 3, w = 8) => (x === null || x === undefined ? '     n/a'.padStart(w) : x.toFixed(d).padStart(w));
console.log('\n════ geo-runtime · SPRINT 1 · THE SLICE ════');
console.log(`  program  ${perf.program.bytes} bytes of .geo  ·  kernel ${perf.wasmBytes} B, 0 imports`);
console.log(`  ceiling  ${perf.ceiling.toLocaleString()} verts, declared in the header`);
console.log(`  gl       ${perf.renderer}`);

console.log('\n════ REACHABILITY — elementFromPoint at each control centre ════');
for (const b of reachBySize) {
  const bad = b.rows.filter((r) => !r.hit);
  console.log(`  ${bad.length === 0 ? '✅' : '✖ '} ${b.size.padEnd(9)} ${b.rows.length - bad.length}/${b.rows.length} reachable` +
    (bad.length ? '   ✖ ' + bad.map((r) => `${r.id} (${r.coveredBy})`).join(', ') : ''));
}
for (const r of reach) {
  console.log(`     ${r.hit ? '·' : '✖'} ${r.id.padEnd(10)} ${String(r.w).padStart(4)}×${String(r.h).padStart(3)}` +
    `  onscreen=${r.onscreen}  hit=${r.hit}${r.coveredBy ? '  COVERED BY ' + r.coveredBy : ''}`);
}
for (const d of drags) {
  console.log(`  ${d.moved ? '✅' : '✖ '} ${d.id.padEnd(10)} real drag ${d.before} → ${d.after}   readout "${d.readout}"`);
}

console.log('\n════ THE FRAME, ACROSS THE PLAN ════   mean of 60 frames, split taken in-frame');
console.log('     t |   verts  tris |    build     view   upload   submit |      cpu |   raster');
for (const r of perf.rows) {
  console.log(`  ${String(r.t).padStart(4)} | ${String(r.verts).padStart(6)} ${String(r.tris).padStart(6)} |` +
    ` ${f(r.buildMs)} ${f(r.viewMs, 4)} ${f(r.uploadMs)} ${f(r.submitMs)} | ${f(r.cpuMs)} | ${f(r.raster, 1, 8)}`);
}

const builds = perf.rows.map((r) => r.buildMs);
const meanBuild = builds.reduce((a, b) => a + b, 0) / builds.length;
const worstBuild = Math.max(...builds);
console.log(`\n  geo_build   mean ${meanBuild.toFixed(3)} ms · worst ${worstBuild.toFixed(3)} ms · isolated ${perf.buildOnly.toFixed(3)} ms`);
console.log(`  GeoV        ${BASELINE_MS.toFixed(3)} ms for the same 5,787 verts (BENCH-002, this container)`);
console.log(`  →           ${(BASELINE_MS / meanBuild).toFixed(1)}× faster, worst case ${(BASELINE_MS / worstBuild).toFixed(1)}×`);

console.log('\n════ THE DONE-WHEN ════');
const checks = [];
const push = (ok, label, detail) => {
  checks.push({ ok, label, detail: detail || '' });
  console.log(`  ${ok ? '✅' : '✖ '} ${label}${detail ? ' — ' + detail : ''}`);
  if (!ok) process.exitCode = 1;
};
push(shots.every((s) => s.coverage > 0.02), 'the dummy renders at three angles, posed',
     shots.map((s) => `${s.name} ${(s.coverage * 100).toFixed(0)}%`).join(' · '));
const allReach = reachBySize.every((b) => b.rows.every((r) => r.exists && r.hit));
push(allReach, 'every control passes elementFromPoint at its centre, at every window size',
     `${CONTROLS.length} controls × ${SIZES.length} sizes`);
push(drags.every((d) => d.moved), 'and a real mouse drag moves each slider and its readout');
push(worstBuild < COMMITTED_MS, `geo_build beats the ${COMMITTED_MS} ms the plan named`,
     `worst ${worstBuild.toFixed(3)} ms`);
push(perf.rows.every((r) => r.verts === perf.ceiling), 'every frame lands exactly on the declared ceiling');
push(perf.overflow === 0, 'the arena never overflowed');
push(perf.pages === perf.pages0, 'linear memory never grew', `${perf.pages0} pages`);
push(perf.detaches === 0, 'no view detached');
push(pageErrors.length === 0, 'no page errors', pageErrors.slice(0, 2).join(' | '));

const out = { when: new Date().toISOString(), sprint: 1, baselineMs: BASELINE_MS,
              meanBuildMs: meanBuild, worstBuildMs: worstBuild, speedup: BASELINE_MS / meanBuild,
              reach, reachBySize, drags, shots, perf, checks, pageErrors };
fs.writeFileSync(path.join(OUT, 'sprint1.json'), JSON.stringify(out, null, 1));
console.log('\nwritten: bench/results/{sprint1.json,rig-*.png,sprint1-hud.png}');
