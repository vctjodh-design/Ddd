#!/bin/bash
set -e

# Run pnpm install with -O0 optimization flags so better-sqlite3 doesn't OOM during the
# native build that pnpm triggers automatically for it.
CFLAGS="-O0" CXXFLAGS="-O0" pnpm install --frozen-lockfile

# ── Rebuild better-sqlite3 against the correct Node.js ABI ───────────────────
#
# pnpm uses its own bundled Node.js (v24) to run install scripts, so the binary
# it produces is compiled against V8 ABI for Node 24. The api-server workflow
# runs under the system PATH node (Node 20), causing an ABI mismatch at runtime.
# We fix this by rebuilding the native addon explicitly against the Node 20 nix
# store path after install completes.
#
# Find the Node 20 nix store prefix (exclude doc/dev/lib sub-derivations)
NODE20_DIR=$(ls -d /nix/store/*-nodejs-20.*/ 2>/dev/null \
  | grep -vE '(doc|dev|lib|man|wrapped)' \
  | head -1 \
  | sed 's|/$||')

if [ -n "$NODE20_DIR" ] && [ -d "$NODE20_DIR/include/node" ]; then
  # Locate the unpacked better-sqlite3 source (version-agnostic glob)
  SQLITE_DIR=$(ls -d node_modules/.pnpm/better-sqlite3@*/node_modules/better-sqlite3 2>/dev/null | head -1)
  if [ -n "$SQLITE_DIR" ] && [ -d "$SQLITE_DIR" ]; then
    echo "[post-merge] Rebuilding better-sqlite3 → Node.js 20 ($NODE20_DIR)..."
    rm -rf "$SQLITE_DIR/build"
    (cd "$SQLITE_DIR" && CFLAGS="-O0" CXXFLAGS="-O0" node-gyp rebuild --nodedir="$NODE20_DIR")
    echo "[post-merge] better-sqlite3 native build complete."
  else
    echo "[post-merge] Warning: better-sqlite3 directory not found in .pnpm store"
  fi
else
  echo "[post-merge] Warning: Node.js 20 nix path not found — better-sqlite3 may have wrong ABI at runtime"
  echo "[post-merge]   Expected pattern: /nix/store/*-nodejs-20.*/"
  ls /nix/store/*-nodejs-20.*/ 2>/dev/null || true
fi

# Push any pending database schema migrations
pnpm --filter db push

# ── Restore missing .bin symlinks in workspace packages ──────────────────────
#
# pnpm's virtual store layout sometimes omits .bin entries for devDependencies
# in workspace packages. Recreate critical ones so workflow scripts can resolve
# their binaries without a full re-install.
#
PROC_ENG_BIN="artifacts/processing-engine/node_modules/.bin"
mkdir -p "$PROC_ENG_BIN"
for pair in \
  "vite:../vite/bin/vite.js" \
  "tsc:../typescript/bin/tsc" \
  "tsx:../tsx/dist/cli.mjs"
do
  name="${pair%%:*}"
  target="${pair##*:}"
  dest="$PROC_ENG_BIN/$name"
  src="$PROC_ENG_BIN/$target"
  # Only create the symlink if the target file actually exists
  if [ -f "$(dirname "$dest")/$target" ] && [ ! -e "$dest" ]; then
    ln -sf "$target" "$dest"
    echo "[post-merge] Linked $name → $target"
  fi
done
