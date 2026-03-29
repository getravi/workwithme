# Vitor's Pi Skills

A collection of skills, extensions, and themes for the [Pi Coding Agent](https://buildwithpi.ai/).

This package is published on npm as `@vpellegrino/pi-skills` for easy installation with pi.

## Installation

```bash
pi install npm:@vpellegrino/pi-skills
```

Or install from git:

```bash
pi install git:github.com/vitor-duolingo/pi-skills
```

## What's Included

### Skills

All skills are in the [`skills`](skills) folder:

* [`/jira`](skills/jira) - Interact with Jira using jira-cli: search, create, view, edit, transition issues; manage epics, sprints, comments, and worklogs

### Extensions

Custom extensions for the PI Coding Agent can be found in the [`pi-extensions`](pi-extensions) folder.

Available extensions:

- `bash-compat` - Overrides the built-in bash tool to avoid streaming callback errors on some Node.js runtimes

See [`EXTENSIONS.md`](EXTENSIONS.md) for the extension template and development guide.

### Themes

Custom themes for the PI Coding Agent can be found in the [`pi-themes`](pi-themes) folder.

See [`THEMES.md`](THEMES.md) for the theme specification and examples.

### Prompt Templates

Reusable prompt templates are in the [`prompts`](prompts) folder.

See [`PROMPTS.md`](PROMPTS.md) for the prompt template format.

## Adding New Content

### Adding a Skill

1. Create a new directory in `skills/your-skill-name/`
2. Add a `SKILL.md` file with frontmatter:

```markdown
---
name: your-skill-name
description: What this skill does and when to use it. Be specific.
---

# Your Skill

## Setup

Run once before first use:
\`\`\`bash
cd /path/to/your-skill && npm install
\`\`\`

## Usage

\`\`\`bash
./scripts/your-script.sh <input>
\`\`\`
```

3. Add any helper scripts in a `scripts/` subdirectory (optional)
4. Add reference documentation in a `references/` subdirectory (optional)

### Adding an Extension

1. Create a new `.ts` file in `pi-extensions/your-extension.ts`
2. Export a default function that receives `ExtensionAPI`:

```typescript
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  // Your extension code here
  pi.on("session_start", async (_event, ctx) => {
    ctx.ui.notify("Extension loaded!", "info");
  });
}
```

### Adding a Theme

1. Create a new `.json` file in `pi-themes/your-theme.json`
2. Follow the theme specification from pi's documentation

## Development

```bash
# Clone the repo
git clone https://github.com/vitor-duolingo/pi-skills.git
cd pi-skills

# Install dependencies (for skills with scripts)
npm install

# Test locally with pi
pi -e .
```

## Publishing

### Automated Publishing

This project uses GitHub Actions for CI/CD:

- **Validation** runs on every push and PR
- **Publishing** happens automatically when version in `package.json` changes

To publish a new version:

1. Update version in `package.json` (semantic versioning)
2. Update `CHANGELOG.md`
3. Commit and push - CI handles the rest

### Manual Publishing

```bash
# Publish to npm
npm publish
```

**Note:** You need to set up `NPM_TOKEN` in GitHub repository secrets for automated publishing.

## CI/CD

- **Validate workflow** - Runs on every push and PR
- **Publish workflow** - Auto-publishes to npm when version changes
- **Dependencies workflow** - Checks for outdated packages weekly

See [CONTRIBUTING.md](CONTRIBUTING.md) for details.

## License

MIT

## Credits

Inspired by [mitsuhiko/agent-stuff](https://github.com/mitsuhiko/agent-stuff)
