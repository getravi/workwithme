# Contributing to Work With Me

First, thank you for considering contributing to Work With Me! It's people like you that make open source such a great community to learn, inspire, and create.

## Project Structure

| Directory | What it contains |
|-----------|-----------------|
| `src/` | Tauri frontend — React + TypeScript UI |
| `sidecar/` | Node.js backend — hosts the pi-agent session, exposes REST + WebSocket API |
| `src-tauri/` | Rust/Tauri native shell |
| `sidecar/extensions/` | Local pi-extensions bundled with the app |

The frontend communicates with the sidecar over WebSocket for streaming agent events and REST for configuration. The sidecar manages agent sessions using `@mariozechner/pi-coding-agent`.

### Adding Extensions

You can add community pi-extensions or build your own:
1. Install the extension package in `sidecar/` (e.g. `pnpm add github:author/my-extension`)
2. Import and register it in `sidecar/server.ts` in the `extensions` array
3. Restart the sidecar

## How to Contribute

### Reporting Bugs

If you find a bug, please create an issue containing:
- A clear and descriptive title
- Steps to reproduce the bug
- Expected versus actual behavior
- Your environment details (OS, version)
- Screenshots, if applicable

### Suggesting Enhancements

If you have an idea for an enhancement, please submit a feature request issue with:
- A clear and descriptive title
- Step-by-step description of the suggested enhancement
- Why this enhancement would be useful to most users

### Pull Requests

1. Fork the repo and create your branch from `main`.
2. If you've added code that should be tested, add tests.
3. If you've changed APIs, update the documentation.
4. Ensure the test suite passes.
5. Make sure your code lints.
6. Issue that pull request!

### Development Setup

1. Clone your fork:
   ```bash
   git clone https://github.com/getravi/workwithme.git
   cd workwithme
   ```
2. Install dependencies:
   ```bash
   pnpm install
   cd sidecar && pnpm install && cd ..
   ```
3. Run the development server in Tauri:
   ```bash
   pnpm run tauri:dev
   ```

   Note: `pnpm run dev` runs `tsx server.ts` directly for local development — no change from previous workflow.

### Building for Release

Before building or releasing the app:

1. Build the sidecar SEA binary:
   ```bash
   pnpm run build:sidecar
   ```
   This populates `src-tauri/binaries/` with the Self-Extracting Archive (SEA) binaries. This step is required before any production build.

2. Then proceed with your Tauri build:
   ```bash
   pnpm run tauri:build
   ```

**Note:** `sidecar/.node-cache/` is gitignored and auto-populated on first build. It contains cached Node.js binary downloads used by the SEA build process.

Thank you!
