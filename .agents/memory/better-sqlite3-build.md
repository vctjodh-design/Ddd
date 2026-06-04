---
name: better-sqlite3 native build
description: How to make better-sqlite3 work in Replit after pnpm install
---

`pnpm approve-builds` is interactive and fails in non-TTY environments (readline closed error). The native addon is NOT compiled automatically.

**Fix:**
```bash
cd /home/runner/workspace/node_modules/.pnpm/better-sqlite3@12.10.0/node_modules/better-sqlite3
node_modules/.bin/prebuild-install
```

After this, restart the api-server workflow. The binary ends up at `build/better_sqlite3.node`.

**Why:** pnpm's build approval system requires an interactive TTY. The `prebuild-install` binary from better-sqlite3's own node_modules downloads the prebuilt binary for the current Node.js ABI (node-v137 = Node.js 24.x).

**How to apply:** Any time better-sqlite3 is freshly installed or the environment is reset, run the prebuild-install step before starting the api-server.
