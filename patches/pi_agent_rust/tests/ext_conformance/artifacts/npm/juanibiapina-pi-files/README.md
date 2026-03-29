# @juanibiapina/pi-files

A [pi](https://github.com/badlogic/pi-mono) extension that tracks files read, written, and edited by the agent during a session.

## Features

- **`/files` command** — Show a list of all files the agent has interacted with, sorted by most recent access
- **Operation indicators** — Each file shows R (read), W (written), E (edited) labels
- **Open in editor** — Select a file to open it in your configured editor
- **Keyboard shortcut** — Optionally bind a shortcut to open the file list
- **Session-aware** — Rebuilds file list from session history on resume, clears on session switch

## Installation

```bash
pi install npm:@juanibiapina/pi-files
```

Requires [@juanibiapina/pi-extension-settings](https://github.com/juanibiapina/pi-extension-settings) for settings management.

## Usage

Use `/files` in pi to open the file picker. Navigate with arrow keys, press Enter to open a file in your editor.

## Settings

Configure via `/extension-settings`:

| Setting | Description | Example |
|---------|-------------|---------|
| `editorCommand` | Command to open files (space-separated, path is appended) | `code -g` |
| `shortcut` | Keyboard shortcut to open file list | `ctrl+f` |

## License

MIT
