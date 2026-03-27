# Release Instructions

Complete checklist for releasing a new version of workwithme.

## Pre-Release: Version Bump

### 1. Update All Version Files

Update the version number in **ALL THREE** files (not just one or two!):

- [ ] `package.json` - Update `"version": "X.Y.Z"`
- [ ] `src-tauri/Cargo.toml` - Update `version = "X.Y.Z"` in `[package]` section
- [ ] `src-tauri/tauri.conf.json` - Update `"version": "X.Y.Z"`

**Verification:**
```bash
grep -n '"version"' package.json
grep -n 'version = ' src-tauri/Cargo.toml | head -3
grep -n '"version"' src-tauri/tauri.conf.json
```

All three should show the same version number. If any are different, the build will output wrong filenames.

### 2. Commit Version Bump

```bash
git add package.json src-tauri/Cargo.toml src-tauri/tauri.conf.json
git commit -m "chore: bump version to X.Y.Z"
git push origin main
```

### 3. Create Release Tag

```bash
git tag -a vX.Y.Z -m "Release vX.Y.Z

[Add release notes here describing what changed]"

git push origin vX.Y.Z
```

**Important:** The tag **must** start with `v` (e.g., `v0.1.5`, not `0.1.5`)

## CI Behavior

When you push a tag `vX.Y.Z`:
- GitHub Actions will trigger the CI workflow
- It will build binaries for macOS, Linux, and Windows
- Filenames will be generated from the version in `tauri.conf.json`
- A draft release will be created automatically
- Build takes ~10-15 minutes

## Verification Checklist

After the build completes:

- [ ] Release appears at https://github.com/getravi/workwithme/releases
- [ ] Binaries are named correctly:
  - `workwithme_X.Y.Z_aarch64.dmg` (macOS ARM)
  - `workwithme_X.Y.Z_x64-setup.exe` (Windows)
  - `workwithme_X.Y.Z_amd64.AppImage` (Linux)
  - `workwithme_X.Y.Z_x64_en-US.msi` (Windows MSI)
  - `.tar.gz` files for archives
- [ ] SHA256SUMS files are present
- [ ] All platforms succeeded in CI

## Common Mistakes to Avoid

❌ **Mistake 1: Only updating package.json**
- The Tauri app gets its version from `tauri.conf.json`
- Result: Binaries labeled with old version number

❌ **Mistake 2: Creating tag without version bump commit**
- Always bump versions first, then tag the bump commit
- Never tag a commit that doesn't include version updates

❌ **Mistake 3: Creating tag without `v` prefix**
- Tag must be `vX.Y.Z` not `X.Y.Z`
- CI only triggers on `v*.*.*` pattern

❌ **Mistake 4: Deleting and recreating tags**
- If you make a mistake, delete locally and remotely first:
  ```bash
  git tag -d vX.Y.Z
  git push origin :vX.Y.Z  # Delete from remote
  ```
- Then create the correct tag

## Example: Releasing v0.1.5

```bash
# 1. Update versions in all three files
# Edit: package.json, src-tauri/Cargo.toml, src-tauri/tauri.conf.json

# 2. Verify all three match
grep -n '"version"' package.json
grep -n 'version = ' src-tauri/Cargo.toml | head -3
grep -n '"version"' src-tauri/tauri.conf.json

# 3. Commit
git add package.json src-tauri/Cargo.toml src-tauri/tauri.conf.json
git commit -m "chore: bump version to 0.1.5"
git push origin main

# 4. Tag (with v prefix!)
git tag -a v0.1.5 -m "Release v0.1.5

- Rust LTO optimizations for smaller binaries
- Frontend code splitting for better caching"

git push origin v0.1.5

# 5. Wait 10-15 minutes and verify at:
# https://github.com/getravi/workwithme/releases
```

## Quick Check Script

Run this before creating a tag to catch mistakes early:

```bash
#!/bin/bash
VERSION=$(grep '"version"' package.json | grep -o '[0-9.]*' | head -1)
echo "Checking all version files for: $VERSION"

echo "package.json:"
grep '"version"' package.json

echo "Cargo.toml:"
grep 'version = ' src-tauri/Cargo.toml | head -1

echo "tauri.conf.json:"
grep '"version"' src-tauri/tauri.conf.json

# Check if all match
PACKAGE_VER=$(grep '"version"' package.json | grep -o '[0-9.]*' | head -1)
CARGO_VER=$(grep 'version = ' src-tauri/Cargo.toml | head -1 | grep -o '[0-9.]*' | head -1)
TAURI_VER=$(grep '"version"' src-tauri/tauri.conf.json | grep -o '[0-9.]*' | head -1)

if [ "$PACKAGE_VER" = "$CARGO_VER" ] && [ "$CARGO_VER" = "$TAURI_VER" ]; then
  echo "✅ All versions match: $PACKAGE_VER"
else
  echo "❌ Version mismatch!"
  echo "  package.json: $PACKAGE_VER"
  echo "  Cargo.toml: $CARGO_VER"
  echo "  tauri.conf.json: $TAURI_VER"
  exit 1
fi
```
