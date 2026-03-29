# Prompt Templates

Reusable prompt templates for the Pi Coding Agent.

## Adding Templates

1. Create a new `.md` file in this directory
2. Use `{{variable}}` syntax for placeholders
3. Add frontmatter with name and description

## Available Templates

| Template | Description | Usage |
|----------|-------------|-------|
| *Add your templates here* | Template description | `/prompt:template-name` |

## Template Usage

After installing this package:

```
/prompt:template-name
/prompt:template-name key:value another:value2
```

## Template Example

```markdown
---
name: code-review
description: Review code for bugs and best practices
---

# Code Review

Review the following code for:
- Bugs and logic errors
- Security issues
- Performance problems
- Best practices violations

## Files

{{files}}
```

See [PROMPTS.md](../PROMPTS.md) for full documentation.
