# mac-app

Run macOS UI automation via Accessibility (AXorcist). Intended for rapid feedback loops while iterating on macOS apps.

## Features

- **Tool**: `mac_app_query` - query UI elements using Accessibility
- **Tool**: `mac_app_click` - click a UI element
- **Tool**: `mac_app_type` - set a value on a UI element
- **Tool**: `mac_app_scroll_to` - scroll an element into view
- **Tool**: `mac_app_action` - run a custom Accessibility action
- **Tool**: `mac_app_focus` - fetch the focused element

## Requirements

- AXorcist CLI (`axorc`) available on PATH
- Accessibility permissions granted for the host process

## Usage

### Query elements

```
mac_app_query app="Safari" locator={"criteria":[{"attribute":"AXRole","value":"AXButton"}]}
```

### Click a button

```
mac_app_click app="Safari" locator={"criteria":[{"attribute":"AXTitle","value":"Back"}]}
```

### Type into a field

```
mac_app_type app="TextEdit" locator={"criteria":[{"attribute":"AXRole","value":"AXTextArea"}]} value="Hello"
```

### Scroll an element into view

```
mac_app_scroll_to app="Safari" locator={"criteria":[{"attribute":"AXTitle","value":"Downloads"}]}
```

### Custom action

```
mac_app_action app="Safari" locator={"criteria":[{"attribute":"AXTitle","value":"Back"}]} action="AXPress"
```

## Notes

Locator criteria are ANDed by default. Use `matchType` for contains/regex/prefix/suffix matching.
