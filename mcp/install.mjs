// ═══════════════════════════════════════════════════════════════════════════
// install.mjs — register this server in a Claude Desktop config, safely.
//
// ⚠⚠ A config file is somebody's whole setup. This one had another server and
//   ~150 lines of preferences in it. So: BACK UP FIRST, parse, add exactly one
//   key, write, and re-read to prove the result still parses and still has
//   everything it started with.
//
//   node mcp/install.mjs           # add it
//   node mcp/install.mjs --dry     # say what would change, touch nothing
//   node mcp/install.mjs --remove  # take it back out
// ═══════════════════════════════════════════════════════════════════════════
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const NAME = 'geo-runtime';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const SERVER = path.join(HERE, 'server.mjs');

const dry = process.argv.includes('--dry');
const remove = process.argv.includes('--remove');

function configPath() {
  if (process.env.CLAUDE_CONFIG) return process.env.CLAUDE_CONFIG;
  const home = os.homedir();
  if (process.platform === 'win32') {
    return path.join(process.env.APPDATA || path.join(home, 'AppData/Roaming'), 'Claude', 'claude_desktop_config.json');
  }
  if (process.platform === 'darwin') {
    return path.join(home, 'Library/Application Support/Claude/claude_desktop_config.json');
  }
  return path.join(home, '.config/Claude/claude_desktop_config.json');
}

const p = configPath();
console.log(`config   ${p}`);
if (!fs.existsSync(p)) {
  console.log('✖ no Claude Desktop config found. Is the desktop app installed?');
  console.log('  (set CLAUDE_CONFIG=/path/to/claude_desktop_config.json to override)');
  process.exit(1);
}

const before = fs.readFileSync(p, 'utf8');
let cfg;
try {
  cfg = JSON.parse(before);
} catch (e) {
  console.log(`✖ the existing config is not valid JSON — refusing to touch it.\n  ${e.message}`);
  process.exit(1);
}

const keysBefore = Object.keys(cfg);
const serversBefore = Object.keys(cfg.mcpServers ?? {});

if (remove) {
  if (!cfg.mcpServers?.[NAME]) { console.log(`nothing to do — "${NAME}" is not registered`); process.exit(0); }
  delete cfg.mcpServers[NAME];
} else {
  cfg.mcpServers = cfg.mcpServers ?? {};
  cfg.mcpServers[NAME] = { command: process.execPath, args: [SERVER] };
}

const after = JSON.stringify(cfg, null, 2) + '\n';

console.log(`servers  ${serversBefore.join(', ') || '(none)'}  ->  ${Object.keys(cfg.mcpServers ?? {}).join(', ') || '(none)'}`);
console.log(`command  ${process.execPath}`);
console.log(`args     ${SERVER}`);

if (dry) { console.log('\n--dry — nothing written.'); process.exit(0); }

// back up, then write
const bak = `${p}.bak-${new Date().toISOString().replace(/[:.]/g, '-')}`;
fs.copyFileSync(p, bak);
fs.writeFileSync(p, after);

// ⚠ A GUARD THAT CHECKS THE INPUTS IS NOT A GUARD THAT CHECKS THE OUTCOME.
// Read back what is actually on disk and prove nothing was lost.
const reread = JSON.parse(fs.readFileSync(p, 'utf8'));
const lostTop = keysBefore.filter((k) => !(k in reread));
const lostSrv = serversBefore.filter((k) => !(k in (reread.mcpServers ?? {})) && k !== (remove ? NAME : null));
const present = remove ? !reread.mcpServers?.[NAME] : !!reread.mcpServers?.[NAME];

if (lostTop.length || lostSrv.length || !present) {
  fs.copyFileSync(bak, p);
  console.log('\n✖ VERIFY FAILED — the backup has been restored and nothing changed.');
  if (lostTop.length) console.log(`  lost top-level keys: ${lostTop.join(', ')}`);
  if (lostSrv.length) console.log(`  lost servers: ${lostSrv.join(', ')}`);
  if (!present) console.log(`  "${NAME}" did not end up ${remove ? 'removed' : 'registered'}`);
  process.exit(1);
}

console.log(`\n✅ ${remove ? 'removed' : 'registered'} · backup at\n   ${bak}`);
console.log('   Restart Claude Desktop for it to pick this up.');
