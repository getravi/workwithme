# GitHub Actions Workflows

This directory contains CI/CD workflows for the pi-skills project.

## Workflows

### ci-cd.yml

**Trigger:** Push to `main`, Pull Requests to `main`

**Purpose:** Complete CI/CD pipeline - validates, checks version, and publishes when appropriate.

**Pipeline Stages (runs in order):**

1. **Validate Job** - Runs on every push and PR
   - ✅ Validates `package.json` structure
   - ✅ Validates all skills have proper `SKILL.md` files
   - ✅ Checks skill frontmatter (name, description)
   - ✅ Ensures skill names match directory names
   - ✅ Validates skill name format (lowercase, hyphens only)
   - ✅ Checks description length (max 1024 chars)
   - ✅ Validates extensions (if present)
   - ✅ Validates themes (if present)
   - ✅ Validates documentation files exist
   - ✅ Validates `CHANGELOG.md` format

2. **Check Version Job** - Runs only on push to `main` (after validation passes)
   - Compares version in `package.json` with previous commit
   - Outputs whether version changed
   - Outputs current version number

3. **Publish Job** - Runs only if version changed (on push to `main`)
   - Builds package
   - Publishes to npm
   - Creates GitHub release with tag

4. **Notify Skipped Job** - Runs if validation passed but version unchanged
   - Notifies that publish was skipped (content-only update)

**Required Secrets:**
- `NPM_TOKEN` - npm authentication token for publishing

**How to use:**
1. Create npm token: https://www.npmjs.com/settings/tokens
2. Add to repo secrets: Settings → Secrets → Actions → New repository secret
3. Update version in `package.json`
4. Commit and push - publishing is automatic

### dependencies.yml

**Trigger:** Weekly (Mondays at 9 AM UTC), Manual dispatch

**Purpose:** Check for outdated npm dependencies.

**Note:** Currently informational only - doesn't create PRs. Extend as needed.

## Monitoring Workflows

To see workflow status:
1. Go to repository on GitHub
2. Click "Actions" tab
3. Select workflow run to see details

## Pipeline Flow

```
Push/PR → Validate → (push to main only) → Check Version → (if changed) → Publish → Release
                                                        ↓
                                                    (if not changed) → Notify Skipped
```

## Local Testing

Before pushing, you can validate locally:

```bash
# Check package.json
npm pack --dry-run

# Test with pi
pi -e .

# Or test a specific skill
pi -e ./skills/your-skill
```

## Troubleshooting

### Publish fails

1. Check `NPM_TOKEN` is set in repo secrets
2. Ensure token has publish permissions
3. Verify package name is available on npm
4. Check version in `package.json` actually changed

### Validation fails

1. Look at failed job output in Actions tab
2. Fix reported issues
3. Commit and push again

Common validation errors:
- Missing `SKILL.md` in a skill directory
- Skill name doesn't match directory name
- Invalid skill name format (use lowercase, hyphens only)
- Description too long (> 1024 chars)
- Missing documentation files
- `CHANGELOG.md` missing `[Unreleased]` section

## Adding New Workflows

1. Create a new `.yml` file in this directory
2. Follow GitHub Actions syntax
3. Commit and push
4. Actions will pick it up automatically

See [GitHub Actions documentation](https://docs.github.com/en/actions) for more details.
