# Contributing to Work With Me

First, thank you for considering contributing to Work With Me! It's people like you that make open source such a great community to learn, inspire, and create.

## Project Structure

| Directory | What it contains |
|-----------|-----------------|
| `src/` | Tauri frontend — React + TypeScript UI |
| `src-tauri/` | Rust/Tauri native shell + backend server |
| `src-tauri/src/server/` | Axum HTTP + WebSocket server, agent runtime, REST API |

The frontend communicates with the Rust backend over WebSocket for streaming agent events and REST for configuration. The backend manages agent sessions using the embedded `pi_agent_rust` library.

### Adding Extensions

Work With Me supports [Model Context Protocol (MCP)](https://modelcontextprotocol.io) tool servers. To add extensions:

1. Add your MCP server entry to `~/.pi/mcp.json`
2. Restart the app — extensions are loaded automatically at session start

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
   ```

   **Linux:** Ensure `libsecret-tools` is installed for keychain storage support:
   ```bash
   sudo apt-get install libsecret-tools  # Ubuntu/Debian
   ```
   Without this package, token storage will silently return null, causing connectors to show as "available" but unable to authenticate.

3. Run the development server in Tauri:
   ```bash
   pnpm run tauri:dev
   ```

### Building for Release

```bash
pnpm run tauri:build
```

The Rust backend is compiled and bundled automatically as part of the Tauri build — no separate build step is needed.

Thank you!
