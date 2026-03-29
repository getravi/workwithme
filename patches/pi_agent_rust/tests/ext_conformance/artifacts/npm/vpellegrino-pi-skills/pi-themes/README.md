# Pi Themes

Custom themes for the Pi Coding Agent TUI.

## Adding Themes

1. Create a new `.json` file in this directory
2. Follow the theme specification (see [THEMES.md](../THEMES.md))
3. Test with pi

## Available Themes

| Theme | Description |
|-------|-------------|
| *Add your themes here* | Theme description |

## Theme Usage

After installing this package:

```
/theme:theme-name
```

Or set in `settings.json`:

```json
{
  "theme": "theme-name"
}
```

## Theme Template

```json
{
  "name": "my-theme",
  "description": "A beautiful dark theme",
  "palette": {
    "background": "#1e1e2e",
    "foreground": "#cdd6f4",
    "primary": "#89b4fa",
    "secondary": "#f5c2e7",
    "accent": "#f38ba8",
    "error": "#f38ba8",
    "warning": "#f9e2af",
    "success": "#a6e3a1",
    "muted": "#6c7086",
    "dim": "#45475a"
  },
  "syntax": {
    "keyword": "#cba6f7",
    "string": "#a6e3a1",
    "number": "#fab387",
    "comment": "#6c7086",
    "function": "#89b4fa",
    "variable": "#cdd6f4"
  }
}
```

See [THEMES.md](../THEMES.md) for full documentation.
