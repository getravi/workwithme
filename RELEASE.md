# Release Instructions

Complete end-to-end checklist for releasing a new version of workwithme to GitHub with CI-built binaries.

## Important Learnings from v0.1.5 Release

### Critical Configuration Issues

**⚠️ externalBin Path Must Include Platform Suffix**
- ❌ Wrong: `"externalBin": ["binaries/sidecar"]`
- ✅ Correct: `"externalBin": ["binaries/sidecar-$ARCH"]`
- **Why:** Tauri needs to find platform-specific binaries (sidecar-aarch64-apple-darwin, sidecar-x86_64-apple-darwin, etc.)
- **What happens if wrong:** Tauri bundles a fallback binary (100MB Rust binary instead of 3.2MB Node.js SEA)
- **Impact:** DMG goes from 34MB to 105MB unexpectedly
- **Prevention:** Review `src-tauri/tauri.conf.json` externalBin config before release

### Binary Size Reality Check

**DMG Composition (v0.1.6 - CORRECTED):**
```
workwithme.app/
  ├── MacOS/
  │   ├── sidecar         100 MB  (Node.js 20.20.0 SEA binary - includes full Node.js runtime)
  │   ├── workwithme      9.4 MB  (Rust binary with LTO)
  │   └── ...
  ├── Resources/          100 KB  (Frontend assets: dist/, icons, etc)
  └── Info.plist

Total uncompressed:       ~109 MB
DMG compressed:           ~34 MB
```

**Important Note on Sidecar Size**:
- The sidecar is 100MB because Node.js SEA (Single Executable Application) binaries inherently include the entire Node.js runtime (~85-90MB)
- This is NOT a bug or sign of incorrect bundling
- The prior estimate of 3.2MB was aspirational/incorrect - impossible to achieve with Node.js
- DMG compression reduces the 109MB app bundle to ~34MB, which is reasonable
- To significantly reduce size, would need to:
  - Replace Node.js sidecar with pure Rust implementation (~3MB savings, major rewrite)
  - Use lighter UI framework instead of React (~1-2MB savings, major rewrite)
  - Accept current size as baseline for this tech stack

**What Optimization Impact Actually Is:**
- ✅ **Rust LTO:** Reduces Rust binary by ~10-20% (hard to see in compressed DMG)
- ✅ **Frontend code splitting:** Helps browser caching at RUNTIME, NOT smaller download
- ❌ **Build artifact cleanup:** Doesn't affect shipped binaries
- ❌ **Version consistency:** Process improvement, no size impact

**What Would Actually Reduce Size:**
- Replace Node.js sidecar with pure Rust implementation (~3MB savings, but major rewrite)
- Use lighter UI framework instead of React (~1-2MB savings, major rewrite)
- Remove unnecessary Tauri plugins (minimal impact)

**Current Size is Reasonable:**
34MB DMG for a production Tauri app + React + Node.js sidecar is good. Don't optimize prematurely.

## Prerequisites

- [ ] Main branch is up-to-date with all desired features/fixes merged
- [ ] All tests pass locally: `pnpm test`
- [ ] Code builds locally: `pnpm run tauri:build` (optional, CI will do this)
- [ ] You have push access to the repository
- [ ] `gh` CLI is installed and authenticated

## Step 1: Verify Current State

```bash
# Check branch
git branch
# Should show: * main

# Check if working directory is clean
git status
# Should show: "working tree clean"

# If not clean, commit or stash changes first
git stash  # Only if you want to discard uncommitted work
```

## Step 2: Determine New Version

Decide on the new version number following semantic versioning (X.Y.Z):
- X = Major (breaking changes)
- Y = Minor (new features, backward compatible)
- Z = Patch (bug fixes, backward compatible)

Example: `0.1.5`

## Step 3: Update All Three Version Files

**CRITICAL:** All three files must be updated or binaries will have wrong version numbers.

### 3a. Edit `package.json`
```bash
# Find and update the version line
# Change: "version": "0.1.4"
# To:     "version": "0.1.5"
```

### 3b. Edit `src-tauri/Cargo.toml`
```bash
# Find and update the [package] version
# Change: version = "0.1.4"
# To:     version = "0.1.5"
```

### 3c. Edit `src-tauri/tauri.conf.json`
```bash
# Find and update the version field (MOST COMMONLY FORGOTTEN!)
# Change: "version": "0.1.4"
# To:     "version": "0.1.5"
```

## Step 4: Verify All Versions Match

Run this command to catch mistakes before pushing:

```bash
echo "=== Version Check ===" && \
echo "package.json:" && grep '"version"' package.json && \
echo "Cargo.toml:" && grep 'version = ' src-tauri/Cargo.toml | head -1 && \
echo "tauri.conf.json:" && grep '"version"' src-tauri/tauri.conf.json
```

**All three lines must show the SAME version number (0.1.5 in this example).**

If they don't match, fix the files now before proceeding.

## Step 5: Commit Version Bump to Main

```bash
# Stage version files
git add package.json src-tauri/Cargo.toml src-tauri/tauri.conf.json

# Commit with descriptive message
git commit -m "chore: bump version to 0.1.5"

# Push to main branch (this ensures latest code is in CI)
git push origin main

# Verify push succeeded
git log -1 --oneline
# Should show your commit at the top
```

## Step 6: Verify Main Branch is Up-to-Date Remotely

```bash
# Fetch latest remote info
git fetch origin

# Check if local main matches remote main
git status
# Should show: "Your branch is up to date with 'origin/main'"

# If not, you need to pull or understand what's different
git log origin/main -1 --oneline
```

## Step 7: Create and Push Release Tag

The tag **must** start with `v` and match your version exactly (e.g., `v0.1.5`).
This triggers the CI workflow to build all platform binaries.

```bash
# Create annotated tag with release notes
git tag -a v0.1.5 -m "Release v0.1.5

What's new in 0.1.5:
- Rust LTO optimizations for smaller binaries (~30% reduction)
- Frontend code splitting for better browser caching
- Removed 46MB of orphaned build artifacts
- Enhanced build logging
- Fixed version consistency across all config files

Build: macOS (aarch64/x86_64) + Linux + Windows
Sidecar: Node.js 20.20.0 SEA binary (~3.2MB)"

# Push tag to remote (this triggers CI!)
git push origin v0.1.5

# Verify tag was pushed
git ls-remote --tags origin | grep v0.1.5
```

## Step 8: Monitor CI Build

The CI workflow will automatically trigger and build binaries for all platforms.

```bash
# Option 1: Check via gh CLI
gh run list --all --limit 5

# Option 2: Watch via browser
# https://github.com/getravi/workwithme/actions

# Expected: Two workflows should start
# - One for push to main (version bump)
# - One for the v0.1.5 tag (binary build)
```

**Build Duration:** ~10-15 minutes for all platforms (macOS arm64/x86_64, Linux x86_64, Windows x86_64)

## Step 9: Verify Release and Binaries

Wait for the build to complete, then verify:

```bash
# Check if release was created
gh release view v0.1.5

# Or view in browser
# https://github.com/getravi/workwithme/releases/tag/v0.1.5
```

### Expected Artifacts

The release should contain these files (macOS example):

```
workwithme_0.1.5_aarch64.dmg          (≈33-35 MB) - macOS ARM64 installer
workwithme_0.1.5_x64-setup.exe        (≈21 MB)    - Windows installer
workwithme_0.1.5_amd64.AppImage       (≈109 MB)   - Linux AppImage
workwithme_0.1.5_amd64.deb            (≈39 MB)    - Linux Debian package
workwithme_0.1.5_x64_en-US.msi        (≈32 MB)    - Windows MSI
workwithme_aarch64.app.tar.gz         (≈33 MB)    - macOS app archive
SHA256SUMS-Linux.txt                              - Checksums for Linux builds
SHA256SUMS-macOS.txt                              - Checksums for macOS builds
SHA256SUMS-Windows.txt                            - Checksums for Windows builds
```

### Verification Checklist

**File Names & Versions:**
- [ ] All platform binaries are present
- [ ] Filenames contain correct version (0.1.5, not 0.1.4)
- [ ] SHA256SUMS files are present for each platform

**Expected File Sizes** (v0.1.5 as reference):
- [ ] `workwithme_0.1.5_aarch64.dmg`: ~34 MB (NOT 105MB+)
- [ ] `workwithme_0.1.5_x64-setup.exe`: ~21 MB
- [ ] `workwithme_0.1.5_amd64.AppImage`: ~109 MB
- [ ] `workwithme_0.1.5_amd64.deb`: ~39 MB
- [ ] `workwithme_0.1.5_x64_en-US.msi`: ~32 MB
- [ ] `workwithme_aarch64.app.tar.gz`: ~34 MB

**Size Sanity Checks:**
- [ ] DMG is NOT 105MB (would mean wrong sidecar bundled)
- [ ] All files are not suspiciously small (>10MB each)
- [ ] Total size across all platforms makes sense

**Release Metadata:**
- [ ] Release shows correct tag and timestamp
- [ ] Release is marked as "Latest"
- [ ] Release body has comprehensive notes
- [ ] All checksum files are present and readable

## Step 10: Download and Test (Optional but Recommended)

```bash
# Download DMG (macOS example)
gh release download v0.1.5 -p "*.dmg"

# Verify checksum
sha256sum -c SHA256SUMS-macOS.txt

# Test the binary
# Install and run the app to verify it works
```

## Release Gotchas & Lessons Learned

### Gotcha 1: DMG Size Doesn't Reflect Code Optimizations
- Frontend code splitting improves BROWSER caching, not download size
- Rust LTO reduces binary by ~10-20% but gets compressed in DMG
- You won't see meaningful DMG size reduction without architectural changes
- **Solution:** Focus optimizations on runtime perf and build efficiency, not DMG size

### Gotcha 2: externalBin Configuration is Easy to Get Wrong
- Tauri needs platform-specific binary names in src-tauri/binaries/
- If externalBin path is wrong, Tauri silently bundles a fallback binary (huge!)
- The DMG will be 3x larger than expected if this is misconfigured
- **Solution:** Always verify externalBin uses `$ARCH` placeholder: `"binaries/sidecar-$ARCH"`
- **Check:** After release, verify DMG size is ~34MB, not 105MB

### Gotcha 3: Node.js SEA Binary vs Rust Binary
- SEA binary: 3.2MB (what we want for sidecar)
- Rust fallback binary: 100MB (what Tauri uses if externalBin is wrong)
- They're both Mach-O executables, so you can't tell by file type
- **Solution:** Check app bundle size: uncompressed ~40MB is correct, ~250MB is wrong

### Gotcha 4: externalBin Must Match Actual Binary Names + macOS Code Signing Complexity

**FIXED in v0.1.6** - Previous versions (v0.1.4, v0.1.5) were corrupted due to multiple issues.

**Part A: externalBin Path Mismatch**
- The sidecar build script outputs: `sidecar-aarch64-apple-darwin`, `sidecar-x86_64-apple-darwin`, etc.
- externalBin config was pointing to: `binaries/sidecar` (no platform suffix)
- Result: Tauri couldn't find the binary and failed to bundle it properly
- Solution: CI workflow renames platform-specific binary to generic name
  ```bash
  # On macOS: sidecar-aarch64-apple-darwin → sidecar
  # On Linux: sidecar-x86_64-unknown-linux-gnu → sidecar
  # On Windows: sidecar-x86_64-pc-windows-msvc.exe → sidecar.exe
  ```

**Part B: macOS Code Signing with External Binaries**
- When Tauri bundles an external binary, the app signature becomes invalid
- Attempts that FAILED:
  1. Re-sign after build: "code has no resources but signature indicates they must be present"
  2. Remove + fresh ad-hoc signature: Resource metadata conflicts persist
  3. Use --preserve-metadata: Conflicts remain
- Root cause: Tauri creates signature with resource requirements that don't match actual bundle after external binary is added
- Solution: Use minimal entitlements file without resource requirements
  ```bash
  codesign --remove-signature "$APP_BUNDLE"
  codesign --sign - --force --deep --entitlements .github/entitlements.plist "$APP_BUNDLE"
  ```

**Workaround for Users (if still experiencing issues)**:
```bash
# Remove quarantine attribute that triggers strict gatekeeper checks
xattr -rd com.apple.quarantine /Applications/workwithme.app
# Then the app will launch
open /Applications/workwithme.app
```

**Key Discovery**: App DOES launch when run directly from mounted DMG despite signature validation errors. The "damaged" error occurs specifically when:
1. App is copied to /Applications (different location)
2. Gatekeeper does fresh signature check on quarantined app

This is why the workaround works - removing quarantine attribute bypasses the strict gatekeeper check.

### Gotcha 5: Version Mismatches Have Cascading Effects
- Forgetting tauri.conf.json causes binaries to be labeled with old version
- This prevents the release from being marked as "Latest"
- Users downloading see old version number, causes confusion
- **Solution:** Use the 3-file version check BEFORE creating tag

## Troubleshooting

### Problem: Binaries Still Show Old Version (e.g., 0.1.4)

**Cause:** One of the three version files wasn't updated.

**Solution:**
1. Check which file is wrong: `grep -E 'version|"version"' package.json src-tauri/Cargo.toml src-tauri/tauri.conf.json`
2. Update the wrong file(s)
3. Commit: `git commit -am "fix: update version in [filename]"`
4. Push: `git push origin main`
5. Delete old tag locally and remotely:
   ```bash
   git tag -d v0.1.5
   git push origin :v0.1.5
   ```
6. Create correct tag and push again

### Problem: DMG is Much Larger Than Expected (105MB instead of 34MB)

**Cause:** externalBin configuration is wrong, Tauri bundled fallback binary

**Diagnosis:**
```bash
# Check actual app bundle size
hdiutil attach workwithme_X.Y.Z_aarch64.dmg -nobrowse
du -sh /Volumes/workwithme/workwithme.app

# Should be ~40MB uncompressed
# If it's 250MB+, the wrong sidecar is bundled
```

**Solution:**
1. Check `src-tauri/tauri.conf.json` externalBin config
2. Must be: `"externalBin": ["binaries/sidecar-$ARCH"]`
3. NOT: `"externalBin": ["binaries/sidecar"]` (missing $ARCH)
4. Verify `src-tauri/binaries/sidecar-*` files exist and are 3.2MB each
5. Fix the config, commit, delete old tag, create new tag

### Problem: CI Build Failed

**Check the logs:**
```bash
gh run view <run-id> --log | tail -100
```

**Common failures:**
- Type check failed: `pnpm test` locally to debug
- Rust build failed: Check Cargo.toml for syntax errors
- Node.js SEA build failed: Check sidecar dependencies
- externalBin wrong: Check tauri.conf.json has `$ARCH` placeholder

### Problem: Release Not Created

**Possible causes:**
1. Tag doesn't start with `v` (must be `vX.Y.Z`)
2. CI workflow is still running (wait 15 minutes)
3. CI workflow failed (check logs above)

**How to recover:**
```bash
# Delete the tag if it's wrong
git tag -d vX.Y.Z
git push origin :vX.Y.Z

# Fix the issue
# Then create correct tag and push
```

## Common Mistakes to Avoid

❌ **Mistake 1: Only updating package.json**
- Tauri binaries get their version from `src-tauri/tauri.conf.json`
- Result: Filenames show wrong version (0.1.4 when you wanted 0.1.5)
- **Prevention:** Use the version check command in Step 4

❌ **Mistake 2: Tagging before pushing to main**
- Tag should be on a commit that's already pushed to main
- Result: CI may build stale code
- **Prevention:** Always `git push origin main` before creating tag

❌ **Mistake 3: Forgetting the `v` prefix on tag**
- Tag must be `vX.Y.Z` (not `X.Y.Z`)
- CI only triggers on `v*.*.*` pattern
- **Prevention:** Always type `git tag -a vX.Y.Z`

❌ **Mistake 4: Creating tag on wrong branch**
- Make sure you're on main: `git branch`
- Result: Release builds from feature branch, incomplete code
- **Prevention:** Verify with `git branch` and `git log -1`

## Complete Example: Releasing v0.1.5

```bash
# 1. Verify state
git branch        # Should show * main
git status        # Should show clean working tree

# 2. Update three files
# Edit: package.json, src-tauri/Cargo.toml, src-tauri/tauri.conf.json
# Change all three from 0.1.4 to 0.1.5

# 3. Verify versions match
echo "=== Version Check ===" && \
echo "package.json:" && grep '"version"' package.json && \
echo "Cargo.toml:" && grep 'version = ' src-tauri/Cargo.toml | head -1 && \
echo "tauri.conf.json:" && grep '"version"' src-tauri/tauri.conf.json

# 4. Commit to main
git add package.json src-tauri/Cargo.toml src-tauri/tauri.conf.json
git commit -m "chore: bump version to 0.1.5"
git push origin main

# 5. Create and push tag (TRIGGERS CI!)
git tag -a v0.1.5 -m "Release v0.1.5

- Build optimizations
- Version consistency fixes"

git push origin v0.1.5

# 6. Monitor build
gh run list --all --limit 3
# Wait 10-15 minutes...

# 7. Verify release
gh release view v0.1.5
# Check https://github.com/getravi/workwithme/releases

# 8. Download and test (optional)
gh release download v0.1.5 -p "*.dmg"
sha256sum -c SHA256SUMS-macOS.txt
```

## Quick Reference

| Step | Command | Purpose |
|------|---------|---------|
| Check state | `git branch && git status` | Ensure on main, no uncommitted changes |
| Verify versions | `grep -E 'version\|"version"' package.json src-tauri/Cargo.toml src-tauri/tauri.conf.json` | All three must match |
| Commit | `git add ... && git commit -m "chore: bump version to X.Y.Z" && git push origin main` | Push version bump to main |
| Tag | `git tag -a vX.Y.Z -m "..."` | Create tag (locally) |
| Release | `git push origin vX.Y.Z` | Push tag to trigger CI build |
| Monitor | `gh run list` | Watch CI progress |
| Verify | `gh release view vX.Y.Z` | Check artifacts |

---

**Total Time:** ~20-30 minutes (including 10-15 min for CI build)
