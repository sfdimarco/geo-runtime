#!/usr/bin/env bash
# ── the build step. One command, no wasm-pack, no bundler. ──────────────────
set -euo pipefail
cd "$(dirname "$0")"
echo "▸ cargo build --release --target wasm32-unknown-unknown"
cargo build --release --target wasm32-unknown-unknown --offline
cp target/wasm32-unknown-unknown/release/geokernel.wasm web/geokernel.wasm
SZ=$(stat -c%s web/geokernel.wasm)
echo "▸ web/geokernel.wasm  ${SZ} bytes"
node tools/compile-asset.mjs
# dist/: one double-clickable file with the wasm inlined. The module graph is
# the SOURCE; the single file is a BUILD ARTIFACT, not a constraint.
node tools/bundle.mjs
echo "▸ dist/index.html     $(stat -c%s dist/index.html) bytes"
