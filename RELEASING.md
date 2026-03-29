# Release Process

This document describes how to cut a new release of WorkWithMe.

## Versioning

We use [Semantic Versioning](https://semver.org/):

| Change type | Version bump | Example |
|-------------|--------------|---------|
| Bug fixes, security patches | patch | `0.1.2` → `0.1.3` |
| New features, minor hardening | minor | `0.1.2` → `0.2.0` |
| Breaking changes | major | `0.1.x` → `1.0.0` |

## Steps

### 1. Commit all pending changes

Stage and commit everything that belongs in the release:

```bash
git add <files>
git commit -m "feat: ..."
```

Verify nothing is left dirty:

```bash
git status
```

### 2. Bump the version

Three files must always stay in sync:

| File | Field |
|------|-------|
| `package.json` | `"version"` |
| `src-tauri/tauri.conf.json` | `"version"` |
| `src-tauri/Cargo.toml` | `version = "..."` |

Edit all three, then commit:

```bash
git add package.json src-tauri/tauri.conf.json src-tauri/Cargo.toml
git commit -m "chore: bump version to X.Y.Z"
```

### 3. Push and tag

```bash
git push origin main
git tag vX.Y.Z
git push origin vX.Y.Z
```

### 4. CI/CD takes over

Pushing a `v*.*.*` tag triggers the full CI pipeline:

1. **CodeQL** — static analysis (SAST)
2. **Type checks + tests** — frontend tsc, vitest, Rust unit/integration tests, `pnpm audit`
3. **Build** — runs on `ubuntu-22.04`, `macos-latest`, `windows-latest` in parallel
   - Runs `tauri-apps/tauri-action` to produce platform installers (Rust backend compiled in)
4. **GitHub Release** — published automatically (not a draft) with tag name `vX.Y.Z`
5. **SHA256 checksums** — uploaded to the release as `SHA256SUMS-{OS}.txt`

Monitor progress at: `https://github.com/getravi/workwithme/actions`

### 5. Verify the release

Once CI is green:

- [ ] Visit the [Releases page](https://github.com/getravi/workwithme/releases) and confirm the release is published
- [ ] Confirm installers are present for all three platforms (`.dmg`, `.AppImage`/`.deb`, `.msi`/`.exe`)
- [ ] Confirm `SHA256SUMS-macOS.txt`, `SHA256SUMS-Linux.txt`, `SHA256SUMS-Windows.txt` are attached

## Hotfix releases

For an urgent patch on top of an already-tagged release:

1. Make the fix directly on `main`
2. Follow steps 1–5 above with a patch version bump

There are no release branches — `main` is always the release branch.
