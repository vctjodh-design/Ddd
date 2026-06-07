---
name: better-sqlite3 native build
description: How to make better-sqlite3 work in Replit after pnpm install
---

No prebuilt binary exists for the Replit Node.js runtime. `pnpm install` hangs on the better-sqlite3 install script because the default `-O2` compilation OOM-kills the container mid-build.

**Full fix sequence (confirmed working):**
```bash
# 1. Install node-gyp globally (not on PATH by default in Replit)
npm install -g node-gyp

# 2. Clear any partial build from the failed attempt
rm -rf node_modules/.pnpm/better-sqlite3@12.10.0/node_modules/better-sqlite3/build

# 3. Rebuild manually with -O0 to avoid OOM kill
cd node_modules/.pnpm/better-sqlite3@12.10.0/node_modules/better-sqlite3
CFLAGS="-O0" CXXFLAGS="-O0" node-gyp rebuild --jobs=1

# 4. Run pnpm install with the same flags so pnpm records the script as done
cd <workspace root>
CFLAGS="-O0" CXXFLAGS="-O0" pnpm install

# 5. Restart workflows
```

This produces `build/Release/better_sqlite3.node` and completes pnpm's install tracking.

**Why:** The sqlite3 amalgamation is huge — compiling at `-O2` exhausts the container's memory and is OOM-killed. `-O0` drops peak memory enough to finish. `pnpm install` must be run again (with the flags) after the manual build so pnpm marks the install script as successfully completed; otherwise it will re-attempt the build on every subsequent `pnpm install`. Note: do NOT add `neverBuiltDependencies: [better-sqlite3]` to package.json — it conflicts with `onlyBuiltDependencies` in pnpm-workspace.yaml.

**How to apply:** Any time the Replit container is reset or `pnpm install` is run fresh, run this full sequence before starting the api-server. Always use `CFLAGS="-O0"` — the default `-O2` will be OOM-killed.
