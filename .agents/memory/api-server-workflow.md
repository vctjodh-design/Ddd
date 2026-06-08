---
name: API server workflow health check
description: How to make the artifacts/api-server workflow pass Replit's health check so it stays running
---

## Rule

The `artifacts/api-server: API Server` dev script must use `exec env PORT=... node ...` (not `pnpm run start` or a plain `node` invocation) so that the node process directly replaces the shell, making Replit's workflow health check detect the open port.

**Why:** Replit's artifact workflow health check only detects ports opened by the direct child of the workflow process. When pnpm runs the dev script, the process tree is `pnpm → sh → node`. Port 8080 is opened 2 levels deep, so the health check fails and Replit kills the process after 180 s. With `exec env PORT=... node ...`, the shell is replaced by node directly, so the port is visible.

**How to apply:**

1. Pre-build the dist once: `cd artifacts/api-server && node ./build.mjs`
2. The dev script in `artifacts/api-server/package.json` must be:
   ```
   "dev": "fuser -k ${PORT:-8080}/tcp 2>/dev/null || true; exec env PORT=${PORT:-8080} NODE_ENV=development node --enable-source-maps ./dist/index.mjs"
   ```
3. After any source changes, rebuild manually (`pnpm --filter @workspace/api-server run build`) before restarting the workflow.
4. Call `restart_workflow` once and it will succeed (returns immediately once port opens).
5. Do NOT call `restart_workflow` repeatedly — each call sends SIGTERM to the running server, resetting the cycle.

## Gotchas

- Removing the build step from `dev` means source changes are NOT picked up on restart. Always rebuild after code changes.
- `fuser -k ... || true` is needed so the script continues even if no process is on the port (fuser returns exit code 1 when nothing is found).
- Port 8080 is NOT in `.replit` `[[ports]]` — that's fine; Replit checks the port internally (localhost), not through the external proxy.
