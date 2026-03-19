#!/usr/bin/env node
/**
 * build-binary.mjs — bundle the sidecar for Tauri distribution.
 *
 * Outputs to sidecar/dist/:
 *   bundle.cjs — esbuild single-file bundle (all JS, ~18MB)
 *
 * Tauri resources then ships dist/ instead of the full sidecar directory
 * (eliminating node_modules from the app bundle).
 *
 * Usage:
 *   node scripts/build-binary.mjs
 */

import { build } from 'esbuild';
import { mkdirSync, copyFileSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SIDECAR_DIR = resolve(__dirname, '..');
const DIST_DIR = join(SIDECAR_DIR, 'dist');

// ── Step 1: esbuild ──────────────────────────────────────────────────────────

console.log('[build] bundling with esbuild...');
mkdirSync(DIST_DIR, { recursive: true });

await build({
  entryPoints: [join(SIDECAR_DIR, 'server.ts')],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  outfile: join(DIST_DIR, 'bundle.cjs'),
  logLevel: 'warning',
  define: { 'import.meta.url': '__importMetaUrl' },
  banner: { js: `const __importMetaUrl = require('url').pathToFileURL(__filename).href;\n` },
});

const bundleSize = (readFileSync(join(DIST_DIR, 'bundle.cjs')).length / 1e6).toFixed(1);
console.log(`[build] bundle.cjs written (${bundleSize} MB)`);

console.log('[build] done!');
console.log(`[build] dist/ is ready for Tauri resources`);
