# Providers Extension

Register custom providers and show unified rate-limit and usage dashboards.

## Installation

Install via the pi-extensions package:

```bash
pi install git:github.com/aliou/pi-extensions
```

Or selectively in your `settings.json`:

```json
{
  "packages": [
    {
      "source": "git:github.com/aliou/pi-extensions",
      "extensions": ["extensions/providers"]
    }
  ]
}
```

## Features

- **Providers**: Registers OpenRouter Gemini and Moonshot model groups.
- **Usage bar**: Compact rate-limit widget below the editor.
- **/providers:usage**: Dashboard with rate limits and historical usage stats.
- **Warnings**: Projected rate-limit notifications for Claude and Codex.

## Usage

### Commands

- `/providers:usage` opens the usage dashboard.
- `/providers:toggle-widget` toggles the usage bar widget.

### Providers

OpenRouter providers show up in the `/model` selector under these IDs:

- `openrouter-google`
- `openrouter-moonshot`

## Requirements

- **OpenRouter keys**: Set `OPENROUTER_GOOGLE_API_KEY` and/or `OPENROUTER_MOONSHOT_API_KEY`.
- **Claude limits**: Requires `anthropic` auth configured in Pi.
- **Codex limits**: Requires `openai-codex` auth configured in Pi.
- **Opencode limits**: Requires cookies from Safari or Helium on macOS.

## Notes

OpenRouter usage uses the `GET https://openrouter.ai/api/v1/key` endpoint and reports daily, weekly, and monthly credit usage windows.
