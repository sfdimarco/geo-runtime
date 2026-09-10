#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════
// server.mjs — the .geo runtime, as an MCP server.
//
// WHY THIS EXISTS. The tool could be POINTED but not TOLD. Every door into it
// was a door to one small change — nudge a slider, scrub a frame — and none to
// a STATEMENT. A 90-second film needed 577 keys and four reaches past the UI.
// MCP is the statement API: a model says what a thing IS and the runtime
// answers, instead of a model driving a mouse.
//
// ⚠⚠ WHAT MCP DOES NOT DO: it does not make tokens cheaper. An argument is a
//   token whether it arrives here or in a code clip. What is cheap is the
//   SHAPE — a statement in, a summary out. Every tool here refuses to return a
//   buffer. See mcp/tools.mjs.
//
// ⭐ NO BROWSER. geokernel.wasm imports nothing, so this server runs anywhere
//   Node runs. That is the whole reason the runtime group ships first.
//
// stdout is the transport. Everything diagnostic goes to stderr, always.
// ═══════════════════════════════════════════════════════════════════════════
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import * as T from './tools.mjs';

const server = new McpServer(
  { name: 'geo-runtime', version: '0.1.0' },
  { capabilities: { tools: {} },
    instructions:
      'The .geo runtime: a bounded VM for animated form. A .geocast document ' +
      'compiles to a small .geo program whose memory ceiling is known before a ' +
      'single instruction runs. Compile with geo_compile, prove the bound with ' +
      'geo_validate, time it with geo_bench, and SEE it with geo_render. Tools return ' +
      'SUMMARIES, never mesh buffers — ask for sample_verts if you need actual numbers, ' +
      'and geo_render if you need to look. Refusal is a ' +
      'correct outcome: the compiler and the VM both refuse what the ISA cannot ' +
      'express and name the key.' },
);

// Shared input shapes. A program arrives ONE of three ways and never two.
const castIn = {
  cast: z.record(z.string(), z.any()).optional()
    .describe('A .geocast document inline. Omit both cast and cast_path to use the repo reference character.'),
  cast_path: z.string().optional()
    .describe('Path to a .geocast JSON file, absolute or relative to the repo root.'),
  // ⚠⚠ DELIBERATELY NOT BOUNDED HERE. The ISA's limits are the COMPILER's to
  //   state — it refuses what .geo v0 cannot express and names the key. Copying
  //   the 1..255 bound into this schema would put the ISA in two places, and the
  //   copy is the one that goes stale. The schema constrains the TYPE; the
  //   compiler owns the MEANING, and its refusal is what reaches the caller.
  res: z.record(z.string(), z.number().int()).optional()
    .describe('Resolution overrides (loft_u, loft_v, sweep_nu, noodle_nv, mitt_u, mitt_v, leaf_u, leaf_v). These drive the ceiling. Out-of-range values are REFUSED by the compiler, which names the offending key.'),
};
const progIn = {
  geo_path: z.string().optional().describe('Path to an already-compiled .geo binary.'),
  geo_base64: z.string().optional().describe('An already-compiled .geo binary, base64.'),
};

// ⚠ A tool may return an `image` alongside its summary — geo_render does, and
//   only geo_render. It is lifted out of the JSON into a real image block so
//   the caller SEES it; the summary still carries every number.
const ok = (v) => {
  const { image, ...rest } = v ?? {};
  const content = [{ type: 'text', text: JSON.stringify(rest, null, 1) }];
  if (image) content.push({ type: 'image', data: image.base64, mimeType: image.mimeType });
  return { content };
};
const wrap = (fn) => async (args) => {
  try {
    return ok(await fn(args ?? {}));
  } catch (e) {
    return {
      isError: true,
      content: [{ type: 'text', text: JSON.stringify({ ok: false, error: e.name, message: e.message }, null, 1) }],
    };
  }
};

server.registerTool('geo_compile', {
  title: 'Compile a .geocast to a .geo program',
  description:
    'Compile a .geocast document into a .geo v0 binary and report what the header declares — ' +
    'size, part/pose/beat counts, and the vertex and index CEILING, which is derived from the ' +
    'part counts rather than padded. If the document uses something the ISA cannot encode, the ' +
    'compiler REFUSES and names the key; that is a correct outcome, not a failure. ' +
    'Set out_path to write the binary.',
  inputSchema: {
    ...castIn,
    out_path: z.string().optional().describe('Write the compiled .geo here.'),
    include_base64: z.boolean().optional().describe('Also return the binary as base64. Off by default — it is bytes in your context.'),
  },
}, wrap(T.geo_compile));

server.registerTool('geo_build', {
  title: 'Build the mesh at one or more plan times',
  description:
    'Load a .geo program into the VM and build the mesh at the given time(s) along its plan. ' +
    'Reports vertex and index counts, whether each frame stayed within the declared ceiling, the ' +
    'overflow alarm, and whether linear memory grew (it must not). Returns NO mesh buffer — ' +
    'hundreds of KiB. Pass sample_verts for a few actual vertices.',
  inputSchema: {
    ...castIn, ...progIn,
    t: z.number().optional().describe('A single plan time. Default 0.'),
    times: z.array(z.number()).max(64).optional().describe('Several plan times in one call.'),
    sample_verts: z.number().int().min(1).max(16).optional().describe('Return this many vertices of the buffer, for inspection.'),
  },
}, wrap(T.geo_build));

server.registerTool('geo_validate', {
  title: 'Prove the bound holds — structurally',
  description:
    'Load a program and build it at many times, including OUTSIDE its plan and at absurd values, ' +
    'checking that no build exceeds the ceiling the header declared, no arena overflow fires, and ' +
    'linear memory never grows. This is the failure a bounded VM exists to make impossible: ' +
    'accepting a program and then exceeding its own bound. ' +
    'SCOPE: structural only. It does not prove the PICTURE is right — that is bench/validate.mjs ' +
    'against GeoV itself, which needs a browser.',
  inputSchema: { ...castIn, ...progIn, times: z.array(z.number()).max(64).optional() },
}, wrap(T.geo_validate));

server.registerTool('geo_bench', {
  title: 'Time geo_build, with its noise floor',
  description:
    'Time geo_build over many reps and report mean, min, p50, p95 AND THE NOISE FLOOR. ' +
    'A delta smaller than the floor is not a result. Also reports a speedup against GeoV\'s ' +
    'gcBuildForm baseline of 1.960 ms — but that baseline was measured on a different machine, ' +
    'so the ratio is an estimate, not a measurement, and the tool says so. ' +
    'This times the BUILD only; on the real frame the upload is 84% and the build is 14%.',
  inputSchema: {
    ...castIn, ...progIn,
    t: z.number().optional().describe('Plan time to bench. Default 1.05.'),
    reps: z.number().int().min(10).max(5000).optional().describe('Timed reps. Default 300.'),
  },
}, wrap(T.geo_bench));

server.registerTool('geo_inspect', {
  title: 'Read a .geo header without running it',
  description:
    'Parse the 64-byte header of a .geo binary and report the magic, the declared ceiling, the ' +
    'section offsets, and whether the declared total length matches the actual file. Executes ' +
    'nothing. Use this on a file you did not compile yourself.',
  inputSchema: progIn,
}, wrap(T.geo_inspect));

server.registerTool('geo_render', {
  title: 'SEE the program — a software render or an animation, no browser',
  description:
    'Rasterise a .geo program to a PNG contact sheet and RETURN THE PICTURE. Every other tool ' +
    'here answers in numbers; this is the one that can show you that a foot detached, that a ' +
    'frame is dead, or that a pose reads. Pure Node — a z-buffer scanline rasteriser and a ' +
    'hand-rolled PNG encoder, no browser, no GPU, no dependencies. ' +
    'Pass gif:true for ONE LOOP OF THE PLAN as an animated GIF instead of a contact sheet — ' +
    'a sheet shows you eight moments, an animation shows you a foot leaving a leg. ' +
    'An animation is written to disk and NOT inlined: it is for a person to open. ' +
    'Each frame is listed with its vertex count and whether it stayed inside the ceiling, ' +
    'BECAUSE A CONTACT SHEET WILL LIE TO YOU ABOUT SMALL MOTION — read the numbers beside the ' +
    'picture. To look closely, pass a window in MESH coordinates: y_mesh = 1 - y_cast, so the ' +
    "FEET are the LOW y values. An image costs context; pass return_image:false for path and " +
    'numbers only.',
  inputSchema: {
    ...castIn,
    geo_path: z.string().optional().describe('Render an already-compiled .geo binary instead of a cast.'),
    times: z.array(z.number()).max(32).optional().describe('Plan times to draw. Default: 8 evenly across the plan.'),
    window: z.array(z.number()).length(4).optional()
      .describe('Crop box [x0,y0,x1,y1] in MESH coordinates. ⚠ y_mesh = 1 - y_cast — the feet are LOW y.'),
    gif: z.boolean().optional()
      .describe('Draw ONE LOOP of the plan as an animated GIF instead of a contact sheet. Frame count comes from fps x plan_end, sampled EXCLUSIVE of the end so the loop has no stutter at the seam.'),
    fps: z.number().int().min(1).max(50).optional().describe('Frames per second for gif:true. Default 10.'),
    cols: z.number().int().min(1).max(8).optional().describe('Frames per row of a contact sheet. Ignored for gif. Default 4.'),
    cell: z.array(z.number().int()).length(2).optional().describe('[width,height] of one frame in pixels. Default [300,400].'),
    out_path: z.string().optional().describe('Where to write the PNG. Default bench/results/render.png.'),
    return_image: z.boolean().optional().describe('Inline the PNG in the reply. Default true.'),
    max_image_bytes: z.number().int().optional().describe('Refuse to inline a PNG larger than this. Default 1.5 MB.'),
  },
}, wrap(T.geo_render));

const transport = new StdioServerTransport();
await server.connect(transport);
process.stderr.write('geo-runtime MCP server ready · 6 tools · no browser required\n');
