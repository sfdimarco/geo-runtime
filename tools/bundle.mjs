// ═══════════════════════════════════════════════════════════════════════════
// THE BUNDLER — dist/index.html, one double-clickable file.
//
// ⚠ THE MODULE GRAPH IS THE SOURCE. The single file is a BUILD ARTIFACT.
//   The deployment decision dropped the single-file CONSTRAINT; it did not
//   drop the need for Mook to open the thing without a terminal. So the repo
//   keeps a real module graph and the build emits one file from it.
//   file:// cannot fetch a .wasm either, so the kernel is inlined as base64.
// ═══════════════════════════════════════════════════════════════════════════
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rd = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

// strip module syntax; concatenation replaces the resolver
const flatten = (src) => src
  .replace(/^\s*import\s[^;]*;\s*$/gm, '')
  .replace(/^export\s+(class|function|const|let|async)/gm, '$1');

const MODULES = ['web/src/bridge.js', 'web/src/gl.js', 'web/src/runtime.js'];
const wasm = fs.readFileSync(path.join(ROOT, 'web/geokernel.wasm'));
const html = rd('web/index.html');

const boot = html.match(/<script type="module">([\s\S]*?)<\/script>/)[1];
const head = html.slice(0, html.indexOf('<script type="module">'));

const inlined = `${head}
<script>
// ── kernel, inlined so the page works from file:// ────────────────────────
const __WASM_B64 = "${wasm.toString('base64')}";
const __WASM = Uint8Array.from(atob(__WASM_B64), (c) => c.charCodeAt(0));
</script>
<script type="module">
${MODULES.map((m) => `// ── ${m} ${'─'.repeat(Math.max(0, 58 - m.length))}\n${flatten(rd(m))}`).join('\n')}

// ── boot ──────────────────────────────────────────────────────────────────
${flatten(boot).replace('Runtime.boot($(\'c\'))', 'Runtime.boot($(\'c\'), __WASM)')}
</script>
</body>
</html>
`;

fs.mkdirSync(path.join(ROOT, 'dist'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'dist/index.html'), inlined);
