// ═══════════════════════════════════════════════════════════════════════════
// browser.mjs — the ONE place a headless browser is obtained.
//
// Three gates genuinely need a page, and only for the REFERENCE side:
//   validate  needs GeoV's own gcBuildForm, which is browser code
//   sprint1   needs the rig page, real layout, and a real mouse
//   run       needs WebGL2 and the raster clock
// The fuzz does not, and no longer asks for one.
//
// ⚠⚠ WHAT THIS FIXES: these three used to hardcode the bench container's own
//   paths — an absolute import of playwright out of /home/claude/.npm-global
//   and an executablePath into /opt/pw-browsers. On any other machine that is
//   ERR_MODULE_NOT_FOUND before the first assertion runs, so a reader who
//   cloned the repo and followed the README hit "NOT GREEN" at the correctness
//   gate and had no way to tell a real failure from a missing dependency.
//
// ⭐ LIVE IS NOT THE SAME AS REACHABLE — and neither is GREEN. A gate that is
//   green in exactly one room proves the room, not the code. So: resolve
//   normally, let playwright find its own browser, and when it genuinely is
//   not there, SKIP WITH A REASON rather than fail with a stack trace.
// ═══════════════════════════════════════════════════════════════════════════

/** Exit code meaning "this gate did not run, and here is why". Not a failure. */
export const SKIP = 3;

export class BrowserUnavailable extends Error {
  constructor(why, fix) {
    super(why);
    this.name = 'BrowserUnavailable';
    this.fix = fix;
  }
}

/**
 * Launch chromium without assuming anything about where it lives.
 *   1. GEO_CHROMIUM=/path/to/chrome  — an explicit override, for odd setups
 *   2. whatever playwright installed for itself
 * @param {{gl?:boolean, args?:string[]}} [opts]
 */
export async function launchChromium({ gl = false, args = [], ...rest } = {}) {
  let pw;
  try {
    pw = await import('playwright');
  } catch {
    try {
      pw = await import('playwright-core');
    } catch {
      throw new BrowserUnavailable(
        'playwright is not installed',
        'npm install   (then: npx playwright install chromium)',
      );
    }
  }

  const chromium = pw.chromium ?? pw.default?.chromium;
  if (!chromium) throw new BrowserUnavailable('playwright exports no chromium', 'npm install');

  // SwiftShader only where a GL context is actually needed — it is a large
  // slowdown and the raster clock is explicitly a regression signal, not a
  // claim about anyone's GPU.
  const GL = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'];
  const launch = {
    args: ['--no-sandbox', ...(gl ? GL : []), ...args],
    ...rest,
  };
  if (process.env.GEO_CHROMIUM) launch.executablePath = process.env.GEO_CHROMIUM;

  try {
    return await chromium.launch(launch);
  } catch (e) {
    throw new BrowserUnavailable(
      `chromium failed to launch — ${String(e.message).split('\n')[0]}`,
      'npx playwright install chromium',
    );
  }
}

/**
 * Launch, or skip this gate with a stated reason. A gate that cannot run is
 * not a gate that failed, and the board must be able to tell them apart.
 * @param {string} gate
 * @param {object} [opts]
 */
export async function launchOrSkip(gate, opts) {
  try {
    return await launchChromium(opts);
  } catch (e) {
    if (!(e instanceof BrowserUnavailable)) throw e;
    console.log(`\n\u26a0  SKIPPED \u00b7 ${gate} \u2014 ${e.message}`);
    console.log('   this gate needs a headless browser for its REFERENCE side.');
    console.log(`   fix: ${e.fix}`);
    console.log('   (the VM itself needs no browser \u2014 bench/fuzz.mjs still proves the bound.)');
    process.exit(SKIP);
  }
}
