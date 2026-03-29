# @juanibiapina/pi-gob

A [pi](https://github.com/badlogic/pi-mono) extension for managing [gob](https://github.com/juanibiapina/gob) background jobs.

## Features

- **Live job widget** — Running jobs displayed below the editor, updated in real time via daemon connection
- **Progress bars** — Jobs with historical run data show a progress bar based on average duration
- **`/gob` command** — Interactive list of all jobs with actions (logs, stop, start, restart, remove)
- **Daemon protocol** — Connects directly to the gob daemon Unix socket for instant updates, with CLI fallback

## Installation

```bash
pi install npm:@juanibiapina/pi-gob
```

## Usage

### Widget

The widget appears automatically below the editor when there are running gob jobs in the current working directory. It disappears when all jobs stop.

```
● npm run dev │ ● make build ████░░░ 57%
```

- Jobs without historical stats show just the command name
- Jobs with previous runs show a progress bar based on average duration
- The widget updates in real time via the gob daemon event stream

### `/gob` Command

Use `/gob` to open an interactive job list. Navigate with arrow keys, press Enter to see available actions.

| Action | Available When | Description |
|--------|---------------|-------------|
| logs | Always | View last 50 lines of output |
| stop | Running | Stop the job |
| start | Stopped | Start the job again |
| restart | Always | Stop and start the job |
| remove | Stopped | Remove the job |

## How It Works

The extension connects to the gob daemon's Unix socket (`$XDG_RUNTIME_DIR/gob/daemon.sock`) and subscribes to job events. If the daemon isn't running, the extension retries every 5 seconds and falls back to the `gob` CLI for the `/gob` command.

## License

MIT
