# Pi Extensions

Custom extensions for the Pi Coding Agent.

## Adding Extensions

1. Create a new `.ts` file in this directory
2. Use the template in [`EXTENSIONS.md`](../EXTENSIONS.md)
3. Test with: `pi -e ./pi-extensions/your-extension.ts`

## Available Extensions

| Extension | Description | Command |
|-----------|-------------|---------|
| bash-compat | Overrides the built-in bash tool to avoid streaming callback errors | n/a |

## Extension Development

See [EXTENSIONS.md](../EXTENSIONS.md) for full documentation on:
- Event handling
- Custom tools
- Commands
- Keyboard shortcuts
- UI interactions

## Testing

```bash
# Test a single extension
pi -e ./pi-extensions/your-extension.ts

# Test all extensions from this package
pi -e .
```
