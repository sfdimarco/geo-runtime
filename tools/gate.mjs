// tools/gate.mjs — THE GATE: send every glance to the cheapest reader that can answer it.
//
//   ① CODE   a preset (empty? where? touches the edge? pieces?) is MEASURED in code on the same
//            grid Jev reads. The measurement is the answer; Jev's reply only calibrates.
//   ② JEV    a judgement passes when Jev is SURE (confidence >= 0.65), the question is not a
//            blind spot, and — if you gave an `expect` — it agrees with it.
//   ③ EYES   everything else goes to a reader that sees the whole picture (Claude, or Mook):
//            unsure · blind spot · near-black frame · disagrees with expect · no answer.
//   RERUN    a call that never came back (rate-limited, no key, threw): ask again, nobody looks.
//
// CONFIDENCE — one number for every kind of answer. 0.65 is jev-glance's "a person would
// hesitate" band (p between 0.35 and 0.65), said once:
//   yes / no   max(p, 1 - p)                       p is P(yes)
//   choice     the probability of the chosen option
//   score      the most probability on two neighbouring steps — a ladder reading is sure when
//              it is pinned to within one step
//
// BLIND SPOTS — measured, so Jev never answers them alone (JEV-SPEC.md):
//   time of day (four day-lights read as one "midday", SQUARE EYES call04) · a character's size
//   (flat 1.3-2.3) · cut off by the frame on real film frames (layout effect 0.04 — the preset
//   measures it in code) · counting · feelings from layout (0.28-0.48) · near-black frames (the
//   grid reads "black 256"). A preset is never a blind spot: code answers it before this list.
//
// usage   node tools/gate.mjs <results dir | result.json> [...] [--jobs <jobs.json>] [--min 0.65]
//                             [--top 15] [--json] [--no-write]
//         --jobs lets the gate read each question's wording and name each frame's picture file.
// writes  <dir>/_gate.json — every answer that needs eyes, with its confidence and its picture.
// The gate reads result files only: it never calls Jev and never touches a key. It costs $0.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(HERE, '..');          // image paths in jobs are relative to the repo (batch-look's abs())
const CELLS = 256;                            // a 16 x 16 grid

export const MIN_CONF = 0.65;
export const NEAR_BLACK = 0.9;                // share of the grid that reads "black"
export const BLIND_SPOTS = [
  [/\b(tod|time of day|morning|midday|noon|dawn|dusk|afternoon|daylight)\b/, 'time of day'],
  [/\b(size|how big|how small|tiny|scale)\b/, 'size'],
  [/\b(cut off|cutoff|cropped|off screen|offscreen|out of frame|out of the frame)\b/, 'cut off by the frame'],
  [/\b(count|how many|number of)\b/, 'counting'],
  // emotion words only: "how warm does the light FEEL" is colour, and warm/cold reads well (0.83-0.96)
  [/\b(lonely|alone|sad|happy|angry|scared|afraid|emotion|emotional)\b/, 'a feeling'],
];

const words = (s) => String(s ?? '').toLowerCase().replace(/[_\-]+/g, ' ');

/** The blind spot a question falls in (by its key, and its wording when known), or null. */
export function blindSpot(key, text) {
  const s = words(key) + ' | ' + words(text);
  for (const [re, name] of BLIND_SPOTS) if (re.test(s)) return name;
  return null;
}

/** How sure one answer is, 0..1, the same way for yes/no, choice and score. null = no way to tell. */
export function confidence(a) {
  if (!a || a.missing) return null;
  if (typeof a.answer === 'boolean') return a.p == null ? null : +Math.max(a.p, 1 - a.p).toFixed(3);
  if (typeof a.answer === 'string') return a.p ?? a.probabilities?.[a.answer] ?? null;
  if (typeof a.answer === 'number' && a.probabilities) {
    const steps = Object.keys(a.probabilities).map(Number).filter(Number.isFinite).sort((x, y) => x - y);
    let best = 0;
    for (const s of steps) best = Math.max(best, (a.probabilities[s] ?? 0) + (a.probabilities[s + 1] ?? 0));
    return +best.toFixed(3);
  }
  return null;
}

/** Share of a frame's grid that reads "black" (from the baseline or the grid), or null if unknown. */
export function blackShare(row) {
  const top = row?.baseline?.top_words;
  if (Array.isArray(top)) {
    const m = top.map(String).find(w => /^black \d+$/.test(w));
    return m ? +m.split(' ')[1] / CELLS : 0;   // not in the top words: far from near-black
  }
  if (Array.isArray(row?.grid)) {
    const ws = row.grid.join(' ').split(/\s+/).filter(Boolean);
    return ws.length ? ws.filter(w => w === 'black').length / ws.length : null;
  }
  return null;
}

/** A jobs file is batch-look's [{ name, args }] or one geo_look args object (look-when-open). */
export function readJobs(file) {
  const j = JSON.parse(fs.readFileSync(file, 'utf8'));
  const one = (args) => ({
    texts: Object.fromEntries(Object.entries({ ...(args?.questions ?? {}), ...(args?.compare ?? {}) })
      .map(([k, q]) => [k, q?.instructions ?? ''])),
    pictures: (args?.images ?? []).map(im => im?.path ?? null),
  });
  return Array.isArray(j) ? Object.fromEntries(j.map(x => [x.name, one(x.args)])) : { '*': one(j) };
}

/** Route every answer in ONE geo_look result. */
export function gateResult(r, { min = MIN_CONF, job = '', jobInfo = null } = {}) {
  const g = { job, rerun: false, dry: false, code: 0, code_agreed: 0, jev: 0, jev_checked: 0, eyes: [] };
  if (!r || r.ok === false) { g.rerun = true; return g; }
  if (r.dry_run) { g.dry = true; return g; }
  if (!Array.isArray(r.frames)) { g.skipped = 'not a geo_look result'; return g; }
  const texts = jobInfo?.texts ?? {};
  const pictureOf = (row) => {          // grid-door jobs have no picture file: the label names the shot
    const m = /^f(\d+)$/.exec(row?.id ?? '');
    const p = row?.path ?? (m ? jobInfo?.pictures?.[+m[1]] : null);
    return p ? (path.isAbsolute(p) ? p : path.join(REPO, p)) : undefined;
  };
  const need = (row, q, kind, a, detail) => g.eyes.push({ job, frame: row?.id ?? 'all', label: row?.label, t: row?.t,
    picture: row ? pictureOf(row) : undefined, q, kind, detail, answer: a?.answer, conf: confidence(a) ?? undefined });
  const judge = (row, q, a, dark) => {
    if (dark) return need(row, q, 'near-black frame', a);
    const blind = blindSpot(q, texts[q]);
    if (blind) return need(row, q, 'blind spot', a, blind);
    if ('expected' in a) {
      if (a.agrees) { g.jev++; g.jev_checked++; return; }
      return need(row, q, 'disagrees with expect', a, `expected ${JSON.stringify(a.expected)}`);
    }
    const c = confidence(a);
    if (c == null) return need(row, q, 'no confidence given', a);
    if (c < min) return need(row, q, 'unsure', a);
    g.jev++;
  };
  for (const row of r.frames) {
    if (row.twin_of || !row.jev) continue;          // a scrambled twin is a control, not a frame
    const dark = (blackShare(row) ?? 0) >= NEAR_BLACK;
    for (const [q, a] of Object.entries(row.jev)) {
      if (!a || a.missing) { need(row, q, 'no answer'); continue; }
      if (a.measured != null) { g.code++; if (a.agrees) g.code_agreed++; continue; }   // ① code is the truth
      judge(row, q, a, dark);
    }
  }
  for (const [q, a] of Object.entries(r.compare ?? {})) {
    if (!a || a.missing) { need(null, q, 'no answer'); continue; }
    judge(null, q, a, false);
  }
  return g;
}

/** Route a results folder (batch-look's outdir) or one result file. Writes <dir>/_gate.json. */
export function gatePath(target, { jobs = null, min = MIN_CONF, write = true } = {}) {
  const isDir = fs.statSync(target).isDirectory();
  const files = isDir ? fs.readdirSync(target).filter(f => f.endsWith('.json') && !f.startsWith('_')).sort().map(f => path.join(target, f)) : [target];
  const J = typeof jobs === 'string' ? readJobs(jobs) : jobs;
  const per = files.map(f => {
    const job = path.basename(f, '.json');
    let r; try { r = JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return { job, rerun: true, eyes: [], unreadable: String(e.message || e) }; }
    return gateResult(r, { min, job, jobInfo: J?.[job] ?? J?.['*'] ?? null });
  });
  // batch-look writes no file for a job that threw — its summary still names it
  const have = new Set(per.map(x => x.job));
  let failed = [];
  if (isDir) try { failed = (JSON.parse(fs.readFileSync(path.join(target, '_summary.json'), 'utf8')).failed ?? []).map(x => x.name).filter(n => n && !have.has(n)); } catch {}
  const sum = (k) => per.reduce((s, x) => s + (x[k] || 0), 0);
  const eyes = per.flatMap(x => x.eyes ?? []);
  const t = { target: path.resolve(target), min, calls: per.filter(x => !x.skipped).length + failed.length,
    rerun: [...per.filter(x => x.rerun).map(x => x.job), ...failed], dry: per.filter(x => x.dry).length,
    skipped: per.filter(x => x.skipped).map(x => x.job),
    code: sum('code'), code_agreed: sum('code_agreed'), jev: sum('jev'), jev_checked: sum('jev_checked'), eyes };
  if (isDir && write) {
    t.written = path.join(t.target, '_gate.json');
    fs.writeFileSync(t.written, JSON.stringify({ at: new Date().toISOString(), ...t }, null, 1));
  }
  return t;
}

const n = (x) => x.toLocaleString('en-US');
const short = (c) => (c == null ? '' : ' ' + c.toFixed(2).replace(/^0/, ''));

/** The one short table a reader needs: what passed where, and which frames need eyes. */
export function table(t, { top = 15 } = {}) {
  const kinds = {}, blinds = {};
  for (const e of t.eyes) { kinds[e.kind] = (kinds[e.kind] || 0) + 1; if (e.kind === 'blind spot') blinds[e.detail] = (blinds[e.detail] || 0) + 1; }
  const frames = new Map();
  for (const e of t.eyes) {
    const k = `${e.job} ${e.frame}`;
    if (!frames.has(k)) frames.set(k, { job: e.job, frame: e.frame, label: e.label, t: e.t, picture: e.picture, why: [] });
    frames.get(k).why.push(e.kind === 'blind spot' ? `${e.q} (blind: ${e.detail})` : `${e.q}${short(e.conf)} (${e.kind})`);
  }
  const answers = t.code + t.jev + t.eyes.length;
  const L = [];
  L.push(`GATE  ${path.basename(t.target)}  ·  ${n(t.calls)} calls  ·  ${n(answers)} answers  ·  sure ≥ ${t.min}`);
  L.push(`  ① code   ${n(t.code)} measured in code${t.code ? `  (Jev agreed ${n(t.code_agreed)}/${n(t.code)})` : ''}`);
  L.push(`  ② jev    ${n(t.jev)} passed${t.jev_checked ? `  (${n(t.jev_checked)} checked against your expect)` : ''}`);
  L.push(`  ③ eyes   ${n(t.eyes.length)} answers on ${n(frames.size)} frames`);
  if (t.eyes.length) L.push('           ' + Object.entries(kinds).sort((a, b) => b[1] - a[1]).map(([k, v]) =>
    k === 'blind spot' ? `blind spot ${v} (${Object.entries(blinds).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([b, c]) => `${b} ${c}`).join(', ')})` : `${k} ${v}`).join(' · '));
  L.push(`  rerun    ${t.rerun.length}${t.rerun.length ? '  ' + t.rerun.slice(0, 8).join(', ') + (t.rerun.length > 8 ? ' …' : '') : ''}`);
  if (t.dry) L.push(`  squint   ${t.dry} dry run(s) — grids only, nothing to route`);
  if (t.skipped.length) L.push(`  skipped  ${t.skipped.length} file(s) that are not geo_look results`);
  const list = [...frames.values()].sort((a, b) => b.why.length - a.why.length).slice(0, top);
  if (list.length) {
    L.push(`  frames that need eyes (${list.length} of ${n(frames.size)}):`);
    for (const f of list) {
      L.push(`    ${f.job} ${f.frame}${f.label ? `  "${f.label}"` : ''}${f.t != null ? `  t=${f.t}` : ''}${f.picture ? `  → ${f.picture}` : ''}`);
      L.push(`        ${f.why.join(' · ')}`);
    }
  }
  if (t.written) L.push(`  → every answer: ${t.written}`);
  return L.join('\n');
}

// ── CLI ──
const isMain = process.argv[1] && path.resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase();
if (isMain) {
  const argv = process.argv.slice(2), targets = [], o = { top: 15, json: false, write: true, min: MIN_CONF, jobs: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--jobs') o.jobs = argv[++i];
    else if (a === '--min') o.min = Number(argv[++i]);
    else if (a === '--top') o.top = Number(argv[++i]);
    else if (a === '--json') o.json = true;
    else if (a === '--no-write') o.write = false;
    else targets.push(a);
  }
  if (!targets.length || !(o.min > 0 && o.min < 1)) {
    console.error('usage: node tools/gate.mjs <results dir | result.json> [...] [--jobs jobs.json] [--min 0.65] [--top 15] [--json] [--no-write]');
    process.exit(2);
  }
  const all = targets.map(t => gatePath(t, o));
  if (o.json) console.log(JSON.stringify(all.length === 1 ? all[0] : all, null, 1));
  else console.log(all.map(t => table(t, o)).join('\n\n'));
}
