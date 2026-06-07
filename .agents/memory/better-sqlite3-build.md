---
name: better-sqlite3 native build
description: How to make better-sqlite3 work in Replit — correct node target is critical
---

The binary must be compiled targeting the exact same Node.js that the API server runtime uses. Replit has two Node.js versions in the nix store simultaneously:
- `nodejs-20.20.0` — used by the API server workflow (`node` in PATH)
- `nodejs-24.12.0` — used by pnpm internally

**The ABI trap:** `pnpm install` runs the `better-sqlite3` install script via pnpm's own node (Node.js 24), so the binary gets compiled for Node.js 24. But the API server runs `node` from PATH (Node.js 20). This causes a fatal `undefined symbol: _ZN2v812api_internal33ConvertToJSGlobalProxyIfNecessaryEm` error at runtime — a V8 ABI mismatch.

**Full fix sequence (confirmed working):**
```bash
# 1. Install node-gyp globally (not on PATH by default)
npm install -g node-gyp

# 2. Clear any partial/wrong build
rm -rf node_modules/.pnpm/better-sqlite3@12.10.0/node_modules/better-sqlite3/build

# 3. Rebuild using -O0 (prevents OOM kill) AND --nodedir pointing at the exact
#    Node.js 20 nix path that the API server workflow actually runs with.
#    Find the correct path: ps aux | grep "dist/index" — note the nodejs-XX.XX path
cd node_modules/.pnpm/better-sqlite3@12.10.0/node_modules/better-sqlite3
CFLAGS="-O0" CXXFLAGS="-O0" node-gyp rebuild \
  --nodedir=/nix/store/jfar9wnj6kvr0gr6klh1gk7vgckkfr5j-nodejs-20.20.0

# 4. Restart the api-server workflow
```

This produces `build/Release/better_sqlite3.node` compiled for the correct ABI.

**Why -O0:** The sqlite3 amalgamation is huge — default `-O2` OOM-kills the container mid-compile.

**Why --nodedir:** pnpm uses Node.js 24 internally; without `--nodedir`, node-gyp inherits the wrong V8 headers. Always check which node the API server process actually runs (use `ps aux | grep "dist/index"`) and pass that path as `--nodedir`.

**neverBuiltDependencies conflict:** Do NOT add `neverBuiltDependencies: [better-sqlite3]` to root `package.json` — it conflicts with `onlyBuiltDependencies` already set in `pnpm-workspace.yaml`.

**Port conflict note:** When Replit adds artifact-based workflows, they conflict with old hand-configured workflows on the same ports. Remove the old ones with `removeWorkflow()` and kill any lingering processes (`ps aux | grep "dist/index"` → `kill -9 <pid>`) before restarting the artifact workflow.
