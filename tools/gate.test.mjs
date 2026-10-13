// tools/gate.test.mjs — node tools/gate.test.mjs
// Every route has an exact count, so a gate that passes everything (or escalates everything) FAILS.
// The before is the test: each case below would land in a different bucket if its rule were missing.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { confidence, blindSpot, blackShare, gateResult, gatePath, table, MIN_CONF } from './gate.mjs';

let checks = 0;
const ok = (fn, name) => { fn(); checks++; console.log('  ✓ ' + name); };

ok(() => {
  assert.equal(MIN_CONF, 0.65);
  assert.equal(confidence({ answer: false, p: 0.05 }), 0.95);                 // yes/no: max(p, 1-p)
  assert.equal(confidence({ answer: true, p: 0.5 }), 0.5);
  assert.equal(confidence({ answer: 'pink', p: 0.75 }), 0.75);                // choice: p of the pick
  assert.equal(confidence({ answer: 'f1', probabilities: { f1: 0.4, f2: 0.6 } }), 0.4);
  assert.equal(confidence({ answer: 2.46, probabilities: { 0: .01, 1: .12, 2: .27, 3: .6, 4: 0 } }), 0.87);  // score: 2+3
  assert.equal(confidence({ answer: 2.81, probabilities: { 0: .04, 1: .07, 2: .47, 3: .14, 4: .12, 5: .05, 6: .08, 7: .03 } }), 0.61);
  assert.equal(confidence({ answer: 2, probabilities: { 0: .5, 2: .5 } }), 0.5); // non-neighbours never add
  assert.equal(confidence({ answer: 3 }), null);
  assert.equal(confidence({ missing: true }), null);
}, 'confidence: one number for yes/no, choice and score');

ok(() => {
  assert.equal(blindSpot('cut_off'), 'cut off by the frame');
  assert.equal(blindSpot('q7', 'Is the character cut off by the frame?'), 'cut off by the frame');
  assert.equal(blindSpot('tod'), 'time of day');
  assert.equal(blindSpot('size'), 'size');
  assert.equal(blindSpot('lonely'), 'a feeling');
  for (const k of ['warm', 'night', 'colour', 'most', 'who', 'subject', 'together', 'most_like_f0']) assert.equal(blindSpot(k), null, k);
  // real wordings from FINNEGANS WEIGHTS g01 — all four are reads Jev is good at (or a measured layout read)
  assert.equal(blindSpot('warm', 'How warm or cold does the light in this picture feel?'), null);
  assert.equal(blindSpot('busy', 'How calm or busy does this picture look?'), null);
  assert.equal(blindSpot('subject', 'Is there one clear main subject: a figure or a shape that stands out from its background?'), null);
  assert.equal(blindSpot('size', 'How big is the main character in the picture?'), 'size');
}, 'blind spots: the measured ones, and nothing that reads well');

ok(() => {
  assert.equal(blackShare({ baseline: { top_words: ['black 256'] } }), 1);
  assert.equal(blackShare({ baseline: { top_words: ['light_grey 55', 'mauve 50'] } }), 0);
  assert.equal(blackShare({ grid: ['black black', 'black red'] }), 0.75);
  assert.equal(blackShare({}), null);
}, 'near-black: read from the baseline or the grid');

// one result with exactly one answer per rule
const NONE = 'none — a judgement, not a measurement';
const result = {
  ok: true, sheet: 'look.png',
  frames: [
    { id: 'f0', t: 1, label: 'shot 1', baseline: { top_words: ['light_grey 120'] }, jev: {
      empty:   { answer: false, p: 0.1, measured: false, agrees: true },                    // ① code (agreed)
      cut_off: { answer: false, p: 0.6, measured: true, agrees: false },                    // ① code (preset — never a blind spot)
      warm:    { answer: 2.46, probabilities: { 0: .01, 1: .12, 2: .27, 3: .6, 4: 0 }, control: NONE },  // ② sure (.87)
      night:   { answer: false, p: 0.05, control: NONE },                                   // ② sure (.95)
      who:     { answer: 'mush', p: 0.7, control: NONE },                                   // ② sure (.70)
      claim_a: { answer: true, p: 0.55, expected: true, agrees: true, control: 'expect' },  // ② checked against expect
      subject: { answer: false, p: 0.38, control: NONE },                                   // ③ unsure (.62)
      tod:     { answer: 2.81, probabilities: { 2: .47, 3: .14 }, control: NONE },          // ③ blind spot
      claim_b: { answer: true, p: 0.9, expected: false, agrees: false, control: 'expect' }, // ③ disagrees with expect
      gone:    { missing: true },                                                           // ③ no answer
      level:   { answer: 3, control: NONE },                                                // ③ no confidence given
    } },
    { id: 'f0s', twin_of: 'f0', jev: { subject: { answer: true, p: 0.5, control: NONE } } }, // a twin: skipped
    { id: 'f1', t: 2, baseline: { top_words: ['black 256'] }, jev: {
      empty: { answer: true, p: 0.9, measured: true, agrees: true },                        // ① code, even when dark
      night: { answer: true, p: 0.99, control: NONE },                                      // ③ near-black frame
    } },
  ],
  compare: {
    most_like_f0: { answer: 'f1', p: 0.98, control: 'none' },                               // ② sure
    which_warm:   { answer: 'f0', p: 0.5, control: 'none' },                                // ③ unsure
  },
};

ok(() => {
  const g = gateResult(result, { job: 'j0', jobInfo: { texts: {}, pictures: ['frames/a.png', 'D:/abs/b.png'] } });
  assert.equal(g.code, 3);
  assert.equal(g.code_agreed, 2);
  assert.equal(g.jev, 5);
  assert.equal(g.jev_checked, 1);
  const kinds = g.eyes.map(e => `${e.frame}:${e.q}:${e.kind}`).sort();
  assert.deepEqual(kinds, [
    'all:which_warm:unsure',
    'f0:claim_b:disagrees with expect', 'f0:gone:no answer', 'f0:level:no confidence given',
    'f0:subject:unsure', 'f0:tod:blind spot',
    'f1:night:near-black frame',
  ]);
  assert.equal(g.eyes.find(e => e.q === 'subject').conf, 0.62);
  assert.ok(g.eyes.find(e => e.q === 'subject').picture.endsWith(path.join('frames', 'a.png')));
  assert.equal(g.eyes.find(e => e.q === 'night').picture, 'D:/abs/b.png');
}, 'routing: 3 code · 5 jev · 7 eyes, and the twin is skipped');

ok(() => {
  assert.equal(gateResult(result, { min: 0.6 }).eyes.filter(e => e.kind === 'unsure').length, 1);   // .62 now passes
  assert.equal(gateResult(result, { min: 0.9 }).eyes.filter(e => e.kind === 'unsure').length, 4);   // + .87, .70 escalate
}, 'the threshold moves answers between ② and ③');

ok(() => {
  assert.equal(gateResult({ ok: false, rate_limited: true }).rerun, true);
  assert.equal(gateResult({ ok: true, dry_run: true, frames: [] }).dry, true);
  assert.equal(gateResult({ ok: true, something: 1 }).skipped, 'not a geo_look result');
}, 'rate-limited → rerun · dry run → squint only · other JSON → skipped');

ok(() => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-'));
  try {
    fs.writeFileSync(path.join(dir, 'j0.json'), JSON.stringify(result));
    fs.writeFileSync(path.join(dir, 'j1.json'), JSON.stringify({ ok: false, rate_limited: true }));
    fs.writeFileSync(path.join(dir, '_summary.json'), JSON.stringify({ failed: [{ name: 'j1' }, { name: 'j2', error: 'threw' }] }));
    // a question whose KEY is innocent but whose WORDING is a blind spot — only --jobs can see it
    const jobs = path.join(dir, 'jobs.json');
    fs.writeFileSync(jobs, JSON.stringify([{ name: 'j0', args: { questions: { who: { instructions: 'Is the character cut off by the frame?' } }, images: [{ path: 'x.png' }] } }]));
    const plain = gatePath(dir, { write: false });
    assert.equal(fs.existsSync(path.join(dir, '_gate.json')), false);   // --no-write writes nothing
    const worded = gatePath(dir, { jobs });
    assert.equal(worded.written, path.join(path.resolve(dir), '_gate.json'));
    assert.equal(plain.calls, 3);                                  // j0, j1 and j2 (summary only)
    assert.deepEqual(plain.rerun, ['j1', 'j2']);
    assert.equal(plain.jev, 5);
    assert.equal(worded.jev, 4);                                    // "who" is now a blind spot
    assert.equal(worded.eyes.find(e => e.q === 'who').detail, 'cut off by the frame');
    const saved = JSON.parse(fs.readFileSync(path.join(dir, '_gate.json'), 'utf8'));
    assert.equal(saved.eyes.length, worded.eyes.length);
    const txt = table(worded);
    for (const s of ['① code   3', '② jev    4', '③ eyes   8 answers on 3 frames', 'rerun    2  j1, j2', 'blind spot 2 (cut off by the frame 1, time of day 1)'])
      assert.ok(txt.includes(s), `table is missing "${s}"\n${txt}`);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}, 'a folder: summary-only failures rerun, --jobs wording counts, _gate.json written, table reads right');

console.log(`gate: ${checks} checks passed`);
