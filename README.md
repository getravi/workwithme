# Work With Me

> **Alpha — expect rough edges. Contributions welcome!**

**An open-source, autonomous AI coworker for your desktop — use any LLM you want.**

Work With Me is a native desktop app that gives you a persistent, autonomous coding partner working directly alongside you. It's built on the open [pi-agent](https://github.com/badlogic/pi-mono) ecosystem and supports every major LLM provider — Claude, GPT-4, Gemini, and local models. No subscriptions. No lock-in. Yours to run, modify, and extend.

> Inspired by and an open alternative to Claude Cowork — because this kind of tooling should be available to everyone.

---

## Why Open Matters

Proprietary AI coworkers tie you to a single provider, a single pricing model, and someone else's decisions about what your tools can do. Work With Me is different:

- **Your LLM, your choice.** Switch between Claude, GPT-4o, Gemini, Ollama, and others from a dropdown. Change mid-session.
- **Your data, your machine.** Everything runs locally. No cloud sync, no telemetry.
- **Your extensions, your rules.** The pi-extension ecosystem lets you add capabilities — MCP tools, browser automation, subagents, and more.
- **Open source, MIT licensed.** Fork it. Modify it. Build on it.

---

## Features

- **Multi-provider LLM support** — Claude, GPT-4, Gemini, Ollama, and any provider supported by pi-ai; switch models without restarting
- **MCP tool integration** — connect any [Model Context Protocol](https://modelcontextprotocol.io) tool server
- **Subagents** — spawn and coordinate parallel agents to tackle complex tasks
- **Smart sessions** — intelligent session continuity; pick up where you left off
- **Parallel task execution** — run independent tasks simultaneously
- **AI Labelling** — automatically tags and categorizes agent actions (built-in feature)
- **Rich Markdown chat** — GitHub Flavored Markdown, syntax highlighting, and streaming responses
- **Session history** — browse, resume, and archive past conversations grouped by project

---

## Prerequisites

- [Node.js](https://nodejs.org/) v18+
- [pnpm](https://pnpm.io/) v10+
- [Rust](https://www.rust-lang.org/tools/install)
- [Tauri v2 prerequisites](https://v2.tauri.app/start/prerequisites/) for your platform

---

## Installation & Setup

1. **Clone the repository:**
   ```bash
   git clone https://github.com/getravi/workwithme.git
   cd workwithme
   ```

2. **Install dependencies:**
   ```bash
   pnpm install
   cd sidecar && pnpm install && cd ..
   ```

3. **Run in development mode:**
   ```bash
   pnpm run tauri:dev
   ```

4. **Build for production:**
   ```bash
   pnpm run tauri:build
   ```

---

## Bundled Extensions

Work With Me ships with a curated set of [pi-extensions](https://github.com/badlogic/pi-mono) that expand what the agent can do out of the box:

| Extension | What it does |
|-----------|-------------|
| [glimpse](https://github.com/HazAT/glimpse) | UI panels and visual tooling |
| [pi-mcp-adapter](https://github.com/nicobailon/pi-mcp-adapter) | Connect to any MCP tool server |
| [pi-subagents](https://github.com/nicobailon/pi-subagents) | Spawn parallel subagents |
| [pi-smart-sessions](https://github.com/HazAT/pi-smart-sessions) | Intelligent session management |
| [pi-parallel](https://github.com/HazAT/pi-parallel) | Parallel task execution |
| [chrome-cdp-skill](https://github.com/pasky/chrome-cdp-skill) | Browser automation via CDP |

You can add your own pi-extensions by installing them in `sidecar/` and registering them in `sidecar/server.ts`.

---

## Credits

Work With Me is built on [pi-mono](https://github.com/badlogic/pi-mono) by Mario Zechner — the open agent runtime and multi-provider LLM API at the core of everything this app does. It also relies on a growing ecosystem of community pi-extensions. See [CREDITS.md](CREDITS.md) for the full list of projects and authors.

---

## Contributing

We welcome contributions! Please see our [Contributing Guide](CONTRIBUTING.md) for details on the project structure, development setup, and how to build your own extensions.

Please read and follow our [Code of Conduct](CODE_OF_CONDUCT.md).

---

## License

[MIT](LICENSE)
