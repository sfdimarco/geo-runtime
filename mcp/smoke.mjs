// ═══════════════════════════════════════════════════════════════════════════
// smoke.mjs — the MCP server, exercised as a real client over real stdio.
//
// ⚠ A server that imports cleanly is not a server that answers. This spawns
//   the actual process, negotiates the actual protocol, and calls every tool.
//   THE BEFORE IS THE TEST.
// ═══════════════════════════════════════════════════════════════════════════
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const client = new Client({ name: 'geo-smoke', version: '0.1.0' });
await client.connect(new StdioClientTransport({
  command: process.execPath, args: [path.join(HERE, 'server.mjs')], stderr: 'pipe',
}));

const { tools } = await client.listTools();
console.log(`tools/list  ${tools.length} tools: ${tools.map((t) => t.name).join(', ')}`);

let fails = 0;
const j = (r) => JSON.parse(r.content[0].text);
const check = (label, cond, detail) => {
  console.log(`  ${cond ? '✅' : '✖ '} ${label}${cond ? '' : `  — ${detail}`}`);
  if (!cond) fails++;
};

console.log('\ngeo_compile');
const c = j(await client.callTool({ name: 'geo_compile', arguments: {} }));
check(`2320 B · ceiling ${c.ceiling?.max_verts} verts`, c.ok && c.bytes === 2320 && c.ceiling.max_verts === 5787, JSON.stringify(c).slice(0, 160));

console.log('\ngeo_compile — a resolution the ISA cannot express');
const r = j(await client.callTool({ name: 'geo_compile', arguments: { res: { loft_u: 999 } } }));
check('REFUSED, and it named the key', r.ok === false && r.refused && /loft_u/.test(r.reason), JSON.stringify(r).slice(0, 160));

console.log('\ngeo_build — three times');
const b = j(await client.callTool({ name: 'geo_build', arguments: { times: [0, 1.05, 2.45], sample_verts: 2 } }));
check(`${b.frames?.length} frames, all within ceiling, 0 overflow, no growth`,
  b.ok && b.frames.length === 3 && b.all_within_ceiling && b.frames.every((f) => f.overflow === 0 && !f.memory_grew),
  JSON.stringify(b).slice(0, 200));
check('returned a sample, not the buffer', Array.isArray(b.sample) && b.sample.length <= 128, `sample len ${b.sample?.length}`);

console.log('\ngeo_validate — hostile times');
const v = j(await client.callTool({ name: 'geo_validate', arguments: {} }));
check(`${v.times_checked} times, ${v.breaches?.length} breaches`, v.ok && v.breaches.length === 0, JSON.stringify(v.breaches));

console.log('\ngeo_validate — 64 bytes of garbage');
const g = j(await client.callTool({ name: 'geo_validate', arguments: { geo_base64: Buffer.alloc(64).toString('base64') } }));
check('REFUSED with a named code', g.accepted === false && typeof g.meaning === 'string', JSON.stringify(g).slice(0, 160));

console.log('\ngeo_bench');
const n = j(await client.callTool({ name: 'geo_bench', arguments: { reps: 200 } }));
check(`${n.geo_build_ms?.mean} ms mean · floor ${n.noise_floor_pct}% · ~${n.speedup}× vs GeoV`,
  n.ok && n.geo_build_ms.mean > 0 && typeof n.noise_floor_pct === 'number', JSON.stringify(n).slice(0, 160));
check('caveats travel with the number', Array.isArray(n.caveats) && n.caveats.length >= 3, 'missing caveats');

console.log('\ngeo_inspect');
await client.callTool({ name: 'geo_compile', arguments: { out_path: 'bench/results/smoke.geo' } });
const i = j(await client.callTool({ name: 'geo_inspect', arguments: { geo_path: 'bench/results/smoke.geo' } }));
check(`magic ${i.magic} · header length matches file`, i.ok && i.length_matches_header, JSON.stringify(i).slice(0, 160));

console.log('\ngeo_render — the picture, and the numbers beside it');
const px = j(await client.callTool({ name: 'geo_render', arguments: {
  times: [0, 1.4], cols: 2, cell: [120, 160], out_path: 'bench/results/smoke-render.png', return_image: false } }));
check(`${px.size} · ${px.frames?.length} frames · every frame inside the ceiling`,
  px.ok && px.frames.length === 2 && px.all_within_ceiling && px.bytes > 0,
  JSON.stringify(px).slice(0, 200));
check('the frame table carries a vertex count per frame',
  px.frames?.every((f) => f.verts > 0), JSON.stringify(px.frames));

const im = await client.callTool({ name: 'geo_render', arguments: {
  times: [0], cols: 1, cell: [80, 100], out_path: 'bench/results/smoke-render.png' } });
check('an image block came back, not a base64 blob in the text',
  im.content?.some((c) => c.type === 'image' && c.mimeType === 'image/png'),
  im.content?.map((c) => c.type).join(','));

console.log('\ngeo_render — MOTION, one loop of the plan');
const mv = j(await client.callTool({ name: 'geo_render', arguments: {
  cast_path: 'bench/reference/v36-test-character-boots.geocast',
  gif: true, fps: 4, cell: [90, 120], out_path: 'bench/results/smoke-render.gif' } }));
check(`${mv.format} ${mv.size} · ${mv.frames?.length} frames @ ${mv.fps} fps · palette lossless: ${mv.palette_exact}`,
  mv.ok && mv.format === 'gif' && mv.frames.length === 10 && mv.all_within_ceiling,
  JSON.stringify(mv).slice(0, 200));
check('an animation is NOT inlined — it is for a person to open',
  mv.image === undefined && /not inlined/.test(mv.image_note ?? ''), mv.image_note);
check('and the bytes really are a GIF that loops',
  (() => { const b = fs.readFileSync('bench/results/smoke-render.gif');
    return b.toString('ascii', 0, 6) === 'GIF89a' && b.includes(Buffer.from('NETSCAPE2.0'))
        && b[b.length - 1] === 0x3B; })(), 'header/loop-block/trailer');

console.log('\n.geo v0.1 — a hand that carries a profile');
const hp = j(await client.callTool({ name: 'geo_compile', arguments: {
  cast_path: 'bench/reference/v36-test-character-boots.geocast' } }));
check(`${hp.bytes} B · ceiling ${hp.ceiling?.max_verts} · ${hp.parts?.hand_profiled} profiled hands`,
  hp.ok && hp.parts.hand_profiled === 2 && hp.ceiling.max_verts === 5043,
  JSON.stringify(hp).slice(0, 200));

const hb = j(await client.callTool({ name: 'geo_compile', arguments: { cast: { parts: [
  { id: 'body', kind: 'solid', y: [0, 0.6], w: 0.2, shape: 'ball' },
  { id: 'leg', kind: 'limb', host: 'body', w: 0.02, hand: 'wedge' }] } } }));
check('a hand shape the ISA has no profile for is REFUSED, by name',
  hb.ok === false && hb.refused && /wedge/.test(hb.reason), JSON.stringify(hb).slice(0, 200));

console.log('\nTHE TINKER LOOP — geo_ab, the before/after');
const abr = j(await client.callTool({ name: 'geo_ab', arguments: {
  casts: [{ label: 'BEFORE', cast_path: 'bench/reference/v36-test-character.geocast' },
          { label: 'AFTER',  cast_path: 'bench/reference/v36-test-character-boots.geocast' }],
  times: [0, 1.49], cell: [110, 140], out_path: 'bench/results/smoke-ab.png', return_image: false } }));
check(`${abr.size} · ${abr.variants?.length} variants · ${abr.variants?.[0]?.bytes} B vs ${abr.variants?.[1]?.bytes} B`,
  abr.ok && abr.variants.length === 2 && abr.variants[1].ceiling === 5043
  && abr.variants.every((v) => v.frames.length === 2 && v.frames.every((f) => f.within_ceiling)),
  JSON.stringify(abr).slice(0, 220));
check('ONE shared frame across both variants, so neither silently rescales',
  Array.isArray(abr.window) && abr.window.length === 4, JSON.stringify(abr.window));
check('it returns the numbers and NO verdict',
  !/better|worse|recommend|should use/i.test(JSON.stringify(abr)), 'a verdict leaked into the reply');

console.log('\nTHE TINKER LOOP — geo_sweep, one axis, the reference pinned');
const sw = j(await client.callTool({ name: 'geo_sweep', arguments: {
  cast_path: 'bench/reference/v36-test-character-boots.geocast',
  axis: 'parts.legL.handLen', values: [1.2, 2.783, 0, 4.2], t: 1.49,
  cell: [110, 140], cols: 5, out_path: 'bench/results/smoke-sweep.png', return_image: false } }));
check(`${sw.size} · ${sw.variants?.length} tiles (reference + 4)`,
  sw.ok && sw.variants.length === 5 && sw.variants[0].label === 'REF',
  JSON.stringify(sw).slice(0, 220));
check('a value the ISA refuses is a TILE that names its key, not a thrown sweep',
  sw.variants?.some((v) => v.ok === false && /handLen/.test(v.refused ?? '')) &&
  sw.variants?.filter((v) => v.ok).length === 4,
  JSON.stringify(sw.variants));

console.log('\ngeo_sweep — an axis that is not there');
const bad = j(await client.callTool({ name: 'geo_sweep', arguments: {
  cast_path: 'bench/reference/v36-test-character-boots.geocast',
  axis: 'parts.legL.wobble', values: [1, 2] } }));
check('REFUSED, and it says why sweeping an unset key would lie',
  bad.ok === false && /wobble/.test(bad.reason ?? ''), JSON.stringify(bad).slice(0, 200));

console.log('\ngeo_look — what Jev would read, dry run (no key, no network)');
const lk = j(await client.callTool({ name: 'geo_look', arguments: { dry_run: true, frames: 3, include_grid: true } }));
check(`${lk.frames?.length} frames · ${lk.question_count} questions · ~${lk.est_tokens} tokens`,
  lk.ok && lk.dry_run && lk.frames.length === 3 && lk.question_count === 9
  && lk.frames.every((f) => f.grid?.length === 16 && f.grid.every((row) => row.split(' ').length === 16)),
  JSON.stringify(lk).slice(0, 220));
check('auto-fit: the subject is present in every frame and the measurement says where',
  lk.frames?.every((f) => f.measured.empty === false && f.measured.where !== 'none' && f.measured.coverage > 0),
  JSON.stringify(lk.frames?.map((f) => f.measured)));
const far = j(await client.callTool({ name: 'geo_look', arguments: { dry_run: true, frames: 1, window: [5, 5, 6, 6] } }));
check('a camera pointed at nothing MEASURES empty — the control can change its answer',
  far.ok && far.frames[0].measured.empty === true && far.frames[0].measured.where === 'none', JSON.stringify(far.frames?.[0]));
const nope = j(await client.callTool({ name: 'geo_look', arguments: { dry_run: true, questions: { 'Bad Name': { type: 'boolean', instructions: 'x' } } } }));
check('a badly named custom question is REFUSED, by name', nope.ok === false && /Bad Name/.test(nope.message ?? ''), JSON.stringify(nope).slice(0, 200));

console.log('\ngeo_look — THE GLANCE: a picture through the image door, its scrambled twin, the fine palette');
const png = 'bench/results/smoke-render.png';                       // geo_render wrote it above
const gl = j(await client.callTool({ name: 'geo_look', arguments: { dry_run: true, include_grid: true, images: [{ path: png, label: 'smoke' }],
  legend: 'scene', presets: [], control: 'scramble', palette: 'fine', questions: { calm: { type: 'score', instructions: 'How calm is it?', criteria: ['busy', 'calm'] } } } }));
check(`the image door answers through MCP · ${gl.frames?.length} frames (real + twin) · ${gl.palette}`,
  gl.ok && gl.frames.length === 2 && gl.frames[1].twin_of === 'f0' && /fine/.test(gl.palette ?? '') && gl.frames.every((f) => f.baseline && f.grid?.length === 16),
  JSON.stringify(gl).slice(0, 240));
const bagOf = (f) => f.grid.join(' ').split(' ').sort().join(',');
check('the twin has the SAME words in OTHER places (colour kept, layout gone)',
  gl.frames?.length === 2 && bagOf(gl.frames[0]) === bagOf(gl.frames[1]) && gl.frames[0].grid.join() !== gl.frames[1].grid.join(), 'twin words differ, or were not shuffled');

const cmp = j(await client.callTool({ name: 'geo_look', arguments: { dry_run: true, frames: 2, presets: [],
  compare: { same: { type: 'choice', instructions: 'Which frame looks most like frame f0?', criteria: { f0: 'frame f0', f1: 'frame f1' } } } } }));
check('compare: ONE question across all frames (not one per frame)', cmp.ok && cmp.question_count === 1, JSON.stringify(cmp).slice(0, 160));

console.log('\ngeo_look — the grid door');
const gw = Array(256).fill('black'); [[1, 1], [2, 1], [1, 2], [2, 2]].forEach(([c, rr]) => { gw[rr * 16 + c] = 'red'; });
const gd = j(await client.callTool({ name: 'geo_look', arguments: { dry_run: true, grids: [{ words: gw, label: 'red block' }], presets: ['empty', 'where', 'touches_edge'] } }));
check('a red block in the corner MEASURES top_left, not empty, not cut off',
  gd.ok && gd.frames[0].measured.where === 'top_left' && !gd.frames[0].measured.empty && !gd.frames[0].measured.touches_edge, JSON.stringify(gd.frames?.[0]?.measured));
const gbad = j(await client.callTool({ name: 'geo_look', arguments: { dry_run: true, grids: [{ words: Array(256).fill('chartreuse') }] } }));
check('a colour word the eye does not have is REFUSED, by name', gbad.ok === false && /chartreuse/.test(gbad.message ?? ''), JSON.stringify(gbad).slice(0, 160));

console.log('\ngeo_squint — the free half of the eye');
const sq = j(await client.callTool({ name: 'geo_squint', arguments: { images: [{ path: png }], legend: 'scene' } }));
check(`squint: ${sq.frames?.length} grid + baseline, nothing sent, no key needed`,
  sq.ok && sq.squint && sq.dry_run && sq.frames[0].grid.length === 16 && typeof sq.frames[0].baseline?.lum === 'number', JSON.stringify(sq).slice(0, 200));
await client.close();

console.log('\ngeo_look — THE ROUTE: a live call to a MOCK OpenRouter over real stdio (nothing leaves this machine)');
const http = await import('node:http');
let seen = null;
const mock = http.createServer((req, res) => {
  let b = ''; req.on('data', (d) => { b += d; });
  req.on('end', () => {
    seen = { url: req.url, auth: req.headers.authorization, body: JSON.parse(b) };
    const answers = {};
    for (const [k, q] of Object.entries(seen.body.questions)) {
      answers[k] = q.type === 'noul' ? { type: 'noul', noul: 0.91 }
        : q.type === 'choice' ? { type: 'choice', choice: Object.keys(q.criteria)[0], confidence: 0.8, probabilities: { [Object.keys(q.criteria)[0]]: 0.9 } }
        : { type: 'score', score: 1, confidence: 0.7, probabilities: { 0: 0.1, 1: 0.9 }, legend: { 0: q.criteria[0], 1: q.criteria[1] } };
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ id: 'gen-dec-smoke', model: 'typesafe/jev-1.13', provider: 'TypeSafe', answers, usage: { input_tokens: 42, output_tokens: 1, cost: 0.0000018 } }));
  });
});
await new Promise((r) => mock.listen(0, '127.0.0.1', r));
const port = mock.address().port;
const c2 = new Client({ name: 'geo-smoke-route', version: '0.1.0' });
await c2.connect(new StdioClientTransport({ command: process.execPath, args: [path.join(HERE, 'server.mjs')], stderr: 'pipe',
  env: { ...process.env, JEV_TRANSPORT: 'openrouter', OPENROUTER_API_KEY: 'smoke-not-a-key', JEV_ENDPOINT_OPENROUTER: `http://127.0.0.1:${port}/api/alpha/decisions`,
         GEO_LOOK_OUT: path.join(HERE, '..', 'bench', 'results', 'look-smoke') } }));
const lv = JSON.parse((await c2.callTool({ name: 'geo_look', arguments: { frames: 1, presets: ['empty'], questions: { tall: { type: 'boolean', instructions: 'Is it tall?' } }, wait_s: 0 } })).content[0].text);
check(`openrouter route: ${lv.transport} · ${lv.frames?.[0]?.jev?.tall?.answer} (p ${lv.frames?.[0]?.jev?.tall?.p}) · $${lv.cost_usd}`,
  lv.ok && lv.transport === 'openrouter' && lv.frames[0].jev.tall.answer === true && lv.frames[0].jev.tall.p === 0.91 && lv.cost_usd === 0.0000018 && lv.next_answer_in_s === 0,
  JSON.stringify(lv).slice(0, 240));
check("it spoke TypeSafe's shape: model typesafe/jev-1.13, booleans as noul, the key as a bearer",
  seen?.body?.model === 'typesafe/jev-1.13' && Object.values(seen.body.questions).every((q) => q.type !== 'boolean') && seen.auth === 'Bearer smoke-not-a-key' && /alpha\/decisions/.test(seen.url),
  JSON.stringify(seen?.body?.questions ?? {}).slice(0, 160));
await c2.close(); mock.close();

console.log(`\n${fails === 0 ? '✅ MCP SMOKE: ALL GREEN' : `✖ MCP SMOKE: ${fails} FAILED`}`);
process.exit(fails === 0 ? 0 : 1);
