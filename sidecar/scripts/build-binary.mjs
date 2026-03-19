#!/usr/bin/env node
/**
 * build-binary.mjs — compile the sidecar to self-contained SEA binaries.
 *
 * Outputs to src-tauri/binaries/:
 *   sidecar-aarch64-apple-darwin
 *   sidecar-x86_64-apple-darwin
 *   sidecar-x86_64-unknown-linux-gnu
 *   sidecar-x86_64-pc-windows-msvc.exe
 *
 * Usage:
 *   node scripts/build-binary.mjs [--targets triple1,triple2]
 *   (default: host platform only)
 */

import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import {
  mkdirSync, copyFileSync, writeFileSync, readFileSync,
  existsSync, rmSync, createWriteStream,
} from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import https from 'node:https';
import os from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SIDECAR_DIR = resolve(__dirname, '..');
const PROJECT_ROOT = resolve(SIDECAR_DIR, '..');
const DIST_DIR = join(SIDECAR_DIR, 'dist');
const TAURI_BINARIES = join(PROJECT_ROOT, 'src-tauri', 'binaries');
const NODE_CACHE = join(SIDECAR_DIR, '.node-cache');
const NODE_VERSION = '20.20.0';

// ── Target definitions ───────────────────────────────────────────────────────

const ALL_TARGETS = [
  { triple: 'aarch64-apple-darwin',        nodeOs: 'darwin', nodeArch: 'arm64', ext: 'tar.gz', binInArchive: 'bin/node', platform: 'darwin' },
  { triple: 'x86_64-apple-darwin',         nodeOs: 'darwin', nodeArch: 'x64',   ext: 'tar.gz', binInArchive: 'bin/node', platform: 'darwin' },
  { triple: 'x86_64-unknown-linux-gnu',    nodeOs: 'linux',  nodeArch: 'x64',   ext: 'tar.gz', binInArchive: 'bin/node', platform: 'linux' },
  { triple: 'aarch64-unknown-linux-gnu',   nodeOs: 'linux',  nodeArch: 'arm64', ext: 'tar.gz', binInArchive: 'bin/node', platform: 'linux' },
  { triple: 'x86_64-pc-windows-msvc',      nodeOs: 'win',    nodeArch: 'x64',   ext: 'zip',    binInArchive: 'node.exe', platform: 'win32', outSuffix: '.exe' },
];

function hostTriple() {
  const arch = os.arch() === 'arm64' ? 'aarch64' : 'x86_64';
  const plat = os.platform() === 'darwin' ? 'apple-darwin'
    : os.platform() === 'win32' ? 'pc-windows-msvc'
    : 'unknown-linux-gnu';
  return `${arch}-${plat}`;
}

const argIdx = process.argv.indexOf('--targets');
const requestedTriples = argIdx !== -1 ? process.argv[argIdx + 1].split(',') : [hostTriple()];
const targets = ALL_TARGETS.filter(t => requestedTriples.includes(t.triple));
if (targets.length === 0) {
  console.error(`[build] no matching targets for: ${requestedTriples.join(', ')}`);
  process.exit(1);
}

// ── Step 1: esbuild ──────────────────────────────────────────────────────────

console.log('[build] bundling with esbuild...');
mkdirSync(DIST_DIR, { recursive: true });
const BUNDLE_FILE = join(DIST_DIR, 'bundle.cjs');

await build({
  entryPoints: [join(SIDECAR_DIR, 'server.ts')],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  outfile: BUNDLE_FILE,
  logLevel: 'warning',
  define: { 'import.meta.url': '__importMetaUrl' },
  banner: { js: `const __importMetaUrl = require('url').pathToFileURL(__filename).href;\n` },
});

// ── Step 2: Patch pi-coding-agent top-level package.json read ────────────────

let bundleContent = readFileSync(BUNDLE_FILE, 'utf-8');
const PATCH_RE = /(var pkg = JSON\.parse\(\(0, )(\w+)(\.readFileSync\)\(getPackageJsonPath\(\), ["']utf-8["']\)\);)/;
if (PATCH_RE.test(bundleContent)) {
  bundleContent = bundleContent.replace(
    PATCH_RE,
    'var pkg = (() => { try { return JSON.parse((0, $2.readFileSync)(getPackageJsonPath(), "utf-8")); } catch { return {}; } })();'
  );
  writeFileSync(BUNDLE_FILE, bundleContent, 'utf-8');
  console.log('[build] patched pi-coding-agent package.json read');
} else {
  console.error('[build] FATAL: pi-coding-agent patch pattern not found in bundle.');
  console.error('  The dependency may have been updated. Locate the new pattern and update PATCH_RE.');
  process.exit(1);
}

const bundleSize = (readFileSync(BUNDLE_FILE).length / 1e6).toFixed(1);
console.log(`[build] bundle.cjs written (${bundleSize} MB)`);

// ── Step 3: Create SEA blob ──────────────────────────────────────────────────

console.log('[build] creating SEA blob...');
const SEA_CONFIG_FILE = join(DIST_DIR, 'sea-config.json');
const SEA_BLOB = join(DIST_DIR, 'sea.blob');
writeFileSync(SEA_CONFIG_FILE, JSON.stringify({
  main: BUNDLE_FILE,
  output: SEA_BLOB,
  disableExperimentalSEAWarning: true,
}));
execFileSync(process.execPath, ['--experimental-sea-config', SEA_CONFIG_FILE], { stdio: 'inherit' });
console.log('[build] SEA blob created');

// ── Step 4: Per-target: download node, inject, sign, copy ───────────────────

mkdirSync(NODE_CACHE, { recursive: true });
mkdirSync(TAURI_BINARIES, { recursive: true });

for (const target of targets) {
  console.log(`\n[build] building for ${target.triple}...`);
  await buildTarget(target);
}

console.log('\n[build] all targets complete!');

// ── Helpers ──────────────────────────────────────────────────────────────────

async function buildTarget(target) {
  const nodePkg = `node-v${NODE_VERSION}-${target.nodeOs}-${target.nodeArch}`;
  const archiveFile = join(NODE_CACHE, `${nodePkg}.${target.ext}`);
  const outSuffix = target.outSuffix || '';
  const binaryName = `sidecar-${target.triple}${outSuffix}`;
  const binaryOut = join(DIST_DIR, binaryName);

  // Download official Node.js binary if not cached
  if (!existsSync(archiveFile)) {
    const url = `https://nodejs.org/dist/v${NODE_VERSION}/${nodePkg}.${target.ext}`;
    console.log(`  [download] ${url}`);
    await download(url, archiveFile);
  }

  // Extract the node executable from the archive
  extractNodeBinary(archiveFile, target.ext, nodePkg, target.binInArchive, binaryOut);
  console.log(`  [extract] node binary → dist/${binaryName}`);

  // macOS: remove existing signature before injection
  if (target.platform === 'darwin') {
    try {
      execFileSync('codesign', ['--remove-signature', binaryOut], { stdio: 'pipe' });
    } catch {
      // Node binary may not be signed in some environments — OK to continue
    }
  }

  // Inject SEA blob using postject (invoke via node to avoid .bin shim issues on Windows)
  const postjectCli = join(SIDECAR_DIR, 'node_modules', 'postject', 'dist', 'cli.js');
  const postjectArgs = [
    postjectCli,
    binaryOut, 'NODE_SEA_BLOB', SEA_BLOB,
    '--sentinel-fuse', 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2',
  ];
  if (target.platform === 'darwin') postjectArgs.push('--macho-segment-name', 'NODE_SEA');
  execFileSync(process.execPath, postjectArgs, { stdio: 'inherit' });
  console.log(`  [postject] SEA blob injected`);

  // macOS: ad-hoc sign
  if (target.platform === 'darwin') {
    execFileSync('codesign', ['--sign', '-', binaryOut], { stdio: 'inherit' });
    console.log(`  [codesign] ad-hoc signed`);
  }

  // Copy to src-tauri/binaries/
  const tauriDest = join(TAURI_BINARIES, binaryName);
  copyFileSync(binaryOut, tauriDest);
  const sizeMB = (readFileSync(tauriDest).length / 1e6).toFixed(0);
  console.log(`  [copy] → src-tauri/binaries/${binaryName} (${sizeMB} MB)`);
}

function extractNodeBinary(archiveFile, ext, nodePkg, binInArchive, destFile) {
  if (ext === 'tar.gz') {
    const entryPath = `${nodePkg}/${binInArchive}`;
    const buf = execFileSync('tar', ['-xzf', archiveFile, '-O', entryPath], { stdio: 'pipe', maxBuffer: 200 * 1024 * 1024 });
    writeFileSync(destFile, buf);
    execFileSync('chmod', ['+x', destFile]);
  } else if (ext === 'zip') {
    const extractDir = join(DIST_DIR, 'node-win-extract');
    try {
      execFileSync('powershell', [
        '-NoProfile', '-Command',
        `Expand-Archive -Path '${archiveFile}' -DestinationPath '${extractDir}' -Force`,
      ]);
      copyFileSync(join(extractDir, nodePkg, binInArchive), destFile);
    } finally {
      rmSync(extractDir, { recursive: true, force: true });
    }
  }
}

function download(url, destFile) {
  return new Promise((resolve, reject) => {
    const file = createWriteStream(destFile);
    https.get(url, res => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        file.close();
        rmSync(destFile, { force: true });
        return download(res.headers.location, destFile).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        file.close();
        rmSync(destFile, { force: true });
        return reject(new Error(`HTTP ${res.statusCode} downloading ${url}`));
      }
      res.pipe(file);
      file.on('finish', () => file.close(resolve));
    }).on('error', err => { rmSync(destFile, { force: true }); reject(err); });
  });
}
