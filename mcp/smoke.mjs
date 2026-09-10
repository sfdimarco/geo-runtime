// ═══════════════════════════════════════════════════════════════════════════
// smoke.mjs — the MCP server, exercised as a real client over real stdio.
//
// ⚠ A server that imports cleanly is not a server that answers. This spawns
//   the actual process, negotiates the actual protocol, and calls every tool.
//   THE BEFORE IS THE TEST.
// ═══════════════════════════════════════════════════════════════════════════
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
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

await client.close();
console.log(`\n${fails === 0 ? '✅ MCP SMOKE: ALL GREEN' : `✖ MCP SMOKE: ${fails} FAILED`}`);
process.exit(fails === 0 ? 0 : 1);
