---
name: better-sqlite3 native build
description: How to make better-sqlite3 work in Replit after pnpm install
---

`pnpm approve-builds` is interactive and fails in non-TTY environments. `prebuild-install` finds no prebuilt binary for Node.js v20.20.0 on linux-x64. The native addon must be compiled from source.

**Fix:**
```bash
cd node_modules/.pnpm/better-sqlite3@12.10.0/node_modules/better-sqlite3
npm exec node-gyp -- rebuild
```

This takes ~60s and produces `build/Release/better_sqlite3.node`. Then rebuild the api-server bundle and restart its workflow.

**Why:** No prebuilt binary exists for the Replit Node.js v20.20.0 runtime. `node-gyp` is not on PATH but works via `npm exec node-gyp`. Build tools (python3, make, gcc) are available in the Nix environment.

**How to apply:** Any time better-sqlite3 is freshly installed or the container is reset, run the node-gyp rebuild step before starting the api-server. The binary is NOT preserved across pnpm reinstalls.
