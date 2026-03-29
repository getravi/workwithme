# Security Policy

## Supported Versions

Only the latest release is actively maintained and receives security fixes.

| Version | Supported |
|---------|-----------|
| latest  | ✅ |
| older   | ❌ |

## Reporting a Vulnerability

**Please do not report security vulnerabilities via GitHub Issues.**

If you discover a vulnerability, email the maintainer directly. Include:

- A description of the vulnerability and its potential impact
- Steps to reproduce (proof of concept if possible)
- The version or commit where you observed the issue
- Any suggested mitigations you are aware of

You should receive an acknowledgement within **48 hours** and a full response within **7 days**. If a fix is required, a patched release will be published and you will be credited (unless you prefer to remain anonymous).

## Scope

The following are **in scope**:

- The Tauri desktop application (`src/`, `src-tauri/`)
- The Rust backend server (`src-tauri/src/server/`)
- The CI/CD pipeline (`.github/workflows/`)
- Supply-chain issues (compromised dependencies, tampered releases)

The following are **out of scope**:

- Vulnerabilities in the underlying AI providers (Anthropic, Google, etc.)
- Social engineering of maintainers
- Physical attacks against the user's machine
- Theoretical vulnerabilities with no practical exploit path

## Security Design Notes

- The Rust HTTP/WS server binds exclusively to `127.0.0.1` and is not network-accessible.
- API keys and OAuth tokens are stored in the OS keychain (macOS Keychain, Linux libsecret, Windows Credential Manager) — never in plaintext files.
- Agent execution is sandboxed on macOS (Apple Seatbelt) and Linux (bubblewrap). **No sandbox is available on Windows** — a warning is displayed in the UI.
- The Content Security Policy restricts WebView script execution to same-origin resources.
- Release artifacts include per-platform SHA256 checksums (`SHA256SUMS-<OS>.txt`) attached to each GitHub Release.
