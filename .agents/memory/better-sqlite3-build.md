---
name: better-sqlite3 native build
description: How to make better-sqlite3 work in Replit after pnpm install
---

`pnpm approve-builds` is interactive and fails in non-TTY environments. `prebuild-install` finds no prebuilt binary for Node.js v20.20.0 on linux-x64. The native addon must be compiled from source.

**Full fix sequence:**
```bash
# 1. Install packages without running scripts (prevents better-sqlite3 from hanging)
pnpm install --ignore-scripts

# 2. Install node-gyp globally (not on PATH by default)
npm install -g node-gyp

# 3. Clear any partial build artifacts, then compile with -O0 to avoid OOM kill
rm -rf node_modules/.pnpm/better-sqlite3@12.10.0/node_modules/better-sqlite3/build
cd node_modules/.pnpm/better-sqlite3@12.10.0/node_modules/better-sqlite3
CFLAGS="-O0" CXXFLAGS="-O0" node-gyp rebuild

# 4. Restart api-server workflow
```

This produces `build/Release/better_sqlite3.node`.

**Why:** No prebuilt binary exists for the Replit Node.js v20.20.0 (node-v115) runtime. `pnpm install` without `--ignore-scripts` hangs indefinitely on the better-sqlite3 install script. The default `-O2` optimization causes the sqlite3 amalgamation compile to be OOM-killed by the container — using `-O0` reduces memory usage enough to complete. Build tools (python3, make, gcc) are available in the Nix environment.

**How to apply:** Any time better-sqlite3 is freshly installed or the container is reset, run the full sequence before starting the api-server. The binary is NOT preserved across pnpm reinstalls. Always use `CFLAGS="-O0"` — the `-O2` default will be OOM-killed.
