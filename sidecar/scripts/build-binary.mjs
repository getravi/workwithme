#!/usr/bin/env node
/**
 * build-binary.mjs — bundle the sidecar for Tauri distribution.
 *
 * Outputs to sidecar/dist/:
 *   bundle.cjs          — esbuild single-file bundle (all JS, ~18MB)
 *   node_modules/keytar — minimal keytar package (native addon, ~120KB)
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
  // keytar is a native addon — mark external and ship alongside the bundle.
  external: ['keytar', '*.node'],
  logLevel: 'warning',
  define: { 'import.meta.url': '__importMetaUrl' },
  banner: { js: `const __importMetaUrl = require('url').pathToFileURL(__filename).href;\n` },
});

const bundleSize = (readFileSync(join(DIST_DIR, 'bundle.cjs')).length / 1e6).toFixed(1);
console.log(`[build] bundle.cjs written (${bundleSize} MB)`);

// ── Step 2: copy minimal keytar package ──────────────────────────────────────
// Node's require('keytar') from dist/bundle.cjs will look for
// dist/node_modules/keytar/ — copy only the 3 files needed at runtime.

console.log('[build] copying keytar native addon...');
const KEYTAR_SRC = join(SIDECAR_DIR, 'node_modules', 'keytar');
const KEYTAR_DEST = join(DIST_DIR, 'node_modules', 'keytar');
const KEYTAR_LIB = join(KEYTAR_DEST, 'lib');
const KEYTAR_BUILD = join(KEYTAR_DEST, 'build', 'Release');
mkdirSync(KEYTAR_LIB, { recursive: true });
mkdirSync(KEYTAR_BUILD, { recursive: true });

copyFileSync(join(KEYTAR_SRC, 'package.json'), join(KEYTAR_DEST, 'package.json'));
copyFileSync(join(KEYTAR_SRC, 'lib', 'keytar.js'), join(KEYTAR_LIB, 'keytar.js'));

const keytarNode = join(KEYTAR_SRC, 'build', 'Release', 'keytar.node');
if (existsSync(keytarNode)) {
  copyFileSync(keytarNode, join(KEYTAR_BUILD, 'keytar.node'));
  console.log('[build] keytar.node copied');
} else {
  console.warn('[build] WARNING: keytar.node not found — keychain features will be unavailable');
}

console.log('[build] done!');
console.log(`[build] dist/ is ready for Tauri resources`);
