// build step: the reference .geocast becomes the .geo program the page runs.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compile } from './geocast-to-geo.mjs';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const doc = JSON.parse(fs.readFileSync(path.join(ROOT, 'bench/reference/v36-test-character.geocast'), 'utf8'));
const { bin, info } = compile(doc);
fs.writeFileSync(path.join(ROOT, 'web/dummy.geo'), bin);
console.log(`▸ web/dummy.geo        ${info.bytes} bytes  ·  ceiling ${info.maxVerts.toLocaleString()} verts`);
