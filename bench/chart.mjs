// ═══════════════════════════════════════════════════════════════════════════
// THE CHART — rendered from results, never hand-edited.
//
// A stacked area of where the frame goes, over the sweep. If a phase grows,
// its band grows, and you see WHICH one without reading a number.
// Publish the loss as loudly as the win: the draw band is drawn even when it
// is the one losing.
// ═══════════════════════════════════════════════════════════════════════════

const PHASES = [
  ['genMs',    'build · wasm',  '#2FD0DE'],
  ['viewMs',   'view',          '#7B95E8'],
  ['uploadMs', 'upload',        '#E2B33A'],
  ['submitMs', 'submit',        '#F2594C'],
];

export function renderChart(out, history = []) {
  const rows = out.rows;
  const W = 900, H = 430;
  const L = 78, R = 168, T = 54, B = 76;
  const pw = W - L - R, ph = H - T - B;

  const maxY = Math.max(...rows.map(r => r.cpuMs)) * 1.12 || 1;
  const x = (i) => L + (rows.length === 1 ? pw / 2 : (i / (rows.length - 1)) * pw);
  const y = (v) => T + ph - (v / maxY) * ph;

  // stacked bands, bottom-up
  const bands = [];
  const running = rows.map(() => 0);
  for (const [key, label, colour] of PHASES) {
    const lower = running.slice();
    rows.forEach((r, i) => { running[i] += Math.max(0, (r.inFrame ? r.inFrame[key] : r[key]) || 0); });
    const up = rows.map((r, i) => `${x(i).toFixed(1)},${y(running[i]).toFixed(1)}`).join(' ');
    const down = rows.map((r, i) => `${x(i).toFixed(1)},${y(lower[i]).toFixed(1)}`)
                     .reverse().join(' ');
    bands.push({ key, label, colour, points: `${up} ${down}`,
                 last: running[rows.length - 1], lastLower: lower[rows.length - 1] });
  }

  const ticks = niceTicks(maxY, 5);
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');

  // per-phase legend, ordered top band first so it reads with the picture
  const legend = bands.slice().reverse().map((b, k) => {
    const mid = (b.last + b.lastLower) / 2;
    const share = (100 * (b.last - b.lastLower) / rows.at(-1).cpuMs).toFixed(0);
    return `
    <g transform="translate(${W - R + 14},${T + 6 + k * 34})">
      <rect width="11" height="11" y="-9" fill="${b.colour}"/>
      <text x="18" y="0" font-size="11.5" fill="#E4EDEF" font-weight="700">${esc(b.label)}</text>
      <text x="18" y="15" font-size="10.5" fill="#8A99A0">${(b.last - b.lastLower).toFixed(3)} ms · ${share}%</text>
    </g>`;
  }).join('');

  const hist = history.length > 1 ? historyStrip(history, W, H) : '';
  const HH = history.length > 1 ? 92 : 0;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H + HH}" width="${W}" height="${H + HH}" font-family="JetBrains Mono, ui-monospace, Menlo, monospace">
  <rect width="${W}" height="${H + HH}" fill="#0B0F11"/>
  <text x="${L}" y="26" font-size="12.5" fill="#2FD0DE" font-weight="700" letter-spacing="1.6">GEO-RUNTIME · SPRINT 0 · WHERE THE CPU FRAME GOES</text>
  <text x="${L}" y="43" font-size="10.5" fill="#6C7C81">RES=${out.kernel.res} · kernel ${out.kernel.wasmBytes} B · arena ceiling ${out.kernel.maxVerts.toLocaleString()} verts · ${esc(shortRenderer(out.env.renderer))}</text>

  ${ticks.map(t => `<line x1="${L}" y1="${y(t).toFixed(1)}" x2="${L + pw}" y2="${y(t).toFixed(1)}" stroke="#1E2A2E"/>
  <text x="${L - 10}" y="${(y(t) + 3.5).toFixed(1)}" font-size="10" fill="#6C7C81" text-anchor="end">${t.toFixed(t < 1 ? 2 : 1)} ms</text>`).join('\n  ')}

  ${bands.map(b => `<polygon points="${b.points}" fill="${b.colour}" fill-opacity="0.86"/>`).join('\n  ')}
  <polyline points="${rows.map((r, i) => `${x(i).toFixed(1)},${y(r.cpuMs).toFixed(1)}`).join(' ')}" fill="none" stroke="#E4EDEF" stroke-width="1.6"/>
  ${rows.map((r, i) => `<circle cx="${x(i).toFixed(1)}" cy="${y(r.cpuMs).toFixed(1)}" r="3" fill="#E4EDEF"/>`).join('\n  ')}

  <line x1="${L}" y1="${T + ph}" x2="${L + pw}" y2="${T + ph}" stroke="#3A4A50"/>
  ${rows.map((r, i) => `<text x="${x(i).toFixed(1)}" y="${T + ph + 18}" font-size="10.5" fill="#9CACB0" text-anchor="middle">${r.tiles}×</text>
  <text x="${x(i).toFixed(1)}" y="${T + ph + 32}" font-size="9.5" fill="#6C7C81" text-anchor="middle">${(r.verts / 1000).toFixed(0)}k</text>`).join('\n  ')}
  <text x="${L + pw / 2}" y="${T + ph + 54}" font-size="10" fill="#8A99A0" text-anchor="middle" letter-spacing="1.4">TILES · VERTICES — BUILD THROUGH SUBMIT. gl.finish() IS NOT A SYNC POINT HERE, SO IT IS ON NO MEASURED PATH.</text>
  ${legend}
  ${raster(rows, x, L, pw, T, ph)}
  ${hist}
</svg>`;
}

// ── the raster strip. Its own scale, its own warning, never mixed into the
//    CPU stack: 215 ms of SwiftShader would flatten a 1.5 ms frame to nothing.
function raster(rows, x, L, pw, T, ph) {
  const vals = rows.map(r => r.rasterMs).filter(v => v !== null && v !== undefined);
  if (vals.length !== rows.length) return '';
  const max = Math.max(...vals) * 1.15 || 1;
  const h = 54, y0 = T + ph - h - 6;
  const pts = rows.map((r, i) => `${x(i).toFixed(1)},${(y0 + h - (r.rasterMs / max) * h).toFixed(1)}`);
  return `
  <g opacity="0.95">
    <rect x="${L}" y="${y0}" width="${pw}" height="${h}" fill="#12191C" stroke="#243035"/>
    <polyline points="${pts.join(' ')}" fill="none" stroke="#E2B33A" stroke-width="1.6" stroke-dasharray="4 3"/>
    ${rows.map((r, i) => `<circle cx="${pts[i].split(',')[0]}" cy="${pts[i].split(',')[1]}" r="2.6" fill="#E2B33A"/>`).join('')}
    <text x="${L + 8}" y="${y0 + 14}" font-size="9.5" fill="#E2B33A" font-weight="700" letter-spacing="1.2">RASTER · SOFTWARE (SWIFTSHADER) — REGRESSION SIGNAL, NOT AN ABSOLUTE CLAIM</text>
    <text x="${L + pw - 8}" y="${y0 + h - 6}" font-size="10" fill="#E2B33A" text-anchor="end" font-weight="700">${vals.at(-1).toFixed(0)} ms</text>
    <text x="${L + 8}" y="${y0 + h - 6}" font-size="10" fill="#8A7534">${vals[0].toFixed(0)} ms</text>
  </g>`;
}

function historyStrip(history, W, H) {
  const last = history.slice(-14);
  const key = (h) => h.rows.at(-1).cpuMs;
  const maxV = Math.max(...last.map(key)) * 1.15 || 1;
  const x0 = 78, w = W - 78 - 168, y0 = H + 24, h = 46;
  const bw = Math.min(30, w / last.length - 6);
  return `
  <text x="${x0}" y="${H + 14}" font-size="10" fill="#6C7C81" letter-spacing="1.4">RUN HISTORY — FRAME AT THE WIDEST SWEEP · LABELLED BY THE RES IT WAS BUILT FROM</text>
  ${last.map((hh, i) => {
    const bx = x0 + i * (w / last.length);
    const bh = Math.max(1, (key(hh) / maxV) * h);
    const isLast = i === last.length - 1;
    return `<rect x="${bx.toFixed(1)}" y="${(y0 + h - bh).toFixed(1)}" width="${bw.toFixed(1)}" height="${bh.toFixed(1)}" fill="${isLast ? '#2FD0DE' : '#24555C'}"/>
  <text x="${(bx + bw / 2).toFixed(1)}" y="${y0 + h + 12}" font-size="9" fill="#6C7C81" text-anchor="middle">${hh.res}</text>`;
  }).join('\n  ')}`;
}

function niceTicks(max, want) {
  const raw = max / want;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map(s => s * mag).find(s => s >= raw) || mag * 10;
  const out = [];
  for (let v = 0; v <= max; v += step) out.push(v);
  return out;
}

function shortRenderer(s = '') {
  const m = s.match(/\(([^,]+),\s*([^,]+)/);
  return m ? `${m[2]}`.trim() : s.slice(0, 44);
}
