# the reference

**The before is the test.** These are not copies for convenience — they are the
oracle the VM is validated against.

- `geov-v36.html` — GeoV v36, byte-for-byte as shipped. Its `gcBuildForm` is the
  ground truth for every vertex the `.geo` VM emits.
- `lib/p5.min.js` — ⚠ `rigBoot()` dies without it, with an error that reads
  exactly like an architecture fault. It is not optional.
- `v36-test-character.geocast` — the crash-test dummy. 9 parts, 3 poses, 4 beats.

`node bench/validate.mjs` loads the page, runs both engines in the same JS
context on the same document, and compares whole buffers.
