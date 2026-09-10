#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════
# test.sh — one command, one board. Run this before you deploy.
#
# Seven gates, fastest first, so a broken build fails in seconds rather than
# eight minutes:
#
#   1 unit      cargo test           ms      the logic that can be wrong silently  [cargo]
#   2 build     cargo → wasm → dist  s       and the .geocast → .geo compile       [cargo]
#   3 validate  vs GeoV itself       ~40s    THE CORRECTNESS GATE              [browser]
#   4 fuzz      4,000 programs       ~2s     the bound, tested not asserted
#   5 mcp       the server, spawned  ~2s     every tool, over real stdio
#   6 sprint1   the rig              ~150s   reachability · 3 angles · the number [browser]
#   7 instrument the pipe sweep      ~180s   sprint 0's regression suite        [browser]
#
# ⭐ THE GATE THAT NEEDS NOTHING IS THE ONE THAT MATTERS MOST. geokernel.wasm
#   imports NOTHING — no clock, no log, no memory, no random — so gate 4 proves
#   the bound on any machine with Node and no browser at all. The repo ships a
#   built web/geokernel.wasm, so that is true straight out of a clone — and it
#   is why gate 5, the MCP server, needs no prerequisite either.
#
#   [cargo]    rebuilds the kernel from Rust source
#   [browser]  needs headless chromium ONLY for its REFERENCE side — GeoV's own
#              gcBuildForm, the rig page, WebGL2. Never for the VM.
#
# A gate whose prerequisite is missing SKIPS with a stated reason and exits 3.
# ⚠⚠ A SKIP IS NOT A PASS AND THE BOARD MUST NEVER LET THEM LOOK ALIKE — a
#   skipped gate prints ⚠, is counted separately, and the summary refuses to
#   say "ALL GREEN" while any gate did not run.
#
# Any other non-zero exit fails the board. `./test.sh quick` stops after gate 5.
#
#     npm install && npx playwright install chromium   # enables [browser]
#     https://rustup.rs && rustup target add wasm32-unknown-unknown   # [cargo]
# ═══════════════════════════════════════════════════════════════════════════
set -uo pipefail
cd "$(dirname "$0")"
QUICK="${1:-}"
LOG=bench/results/test-log
mkdir -p "$LOG"

have() { command -v "$1" >/dev/null 2>&1; }

# A gate calls this first. Returns 1 when the tool is absent, having said why.
need() {
  have "$1" && return 0
  printf '⚠  SKIPPED — %s is not installed.\n' "$1"
  printf '   this gate %s\n' "$2"
  printf '   fix: %s\n' "$3"
  return 1
}

RUSTFIX='https://rustup.rs   then   rustup target add wasm32-unknown-unknown'

gate_unit() {
  need cargo 'tests the kernel logic from Rust source.' "$RUSTFIX" || return 3
  cargo test --offline
}
gate_build() {
  need cargo 'rebuilds web/geokernel.wasm from Rust source. The repo ships a
   built one, so the VM gates still run without it.' "$RUSTFIX" || return 3
  ./build.sh
}

# ── preflight ─────────────────────────────────────────────────────────────
printf '\n\033[36m▸ preflight\033[0m\n'
mark() { if "$1" >/dev/null 2>&1; then printf '    ✅ %-9s %s\n' "$2" "$3"; else printf '    ⚠  %-9s %s\n' "$2" "$4"; fi; }
printf '    ✅ %-9s %s\n' node "$(node -v 2>/dev/null || echo '—')"
if have cargo; then printf '    ✅ %-9s %s\n' cargo "$(cargo --version 2>/dev/null)"
else                printf '    ⚠  %-9s absent — gates 1,2 will skip\n' cargo; fi
if node -e "import('playwright').then(()=>process.exit(0),()=>process.exit(1))" 2>/dev/null; then
  printf '    ✅ %-9s installed\n' playwright
else
  printf '    ⚠  %-9s absent — gates 3,5,6 will skip\n' playwright
fi

declare -a NAMES STATUS SECS
run() {
  local name="$1"; shift
  local t0 rc
  printf '\n\033[36m▸ %s\033[0m  %s\n' "$name" "$*"
  t0=$(date +%s)
  "$@" > "$LOG/$name.txt" 2>&1
  rc=$?
  local dt=$(( $(date +%s) - t0 ))
  tail -n "${TAIL:-12}" "$LOG/$name.txt" | sed 's/^/    /'
  NAMES+=("$name"); STATUS+=("$rc"); SECS+=("$dt")
  if [ $rc -ne 0 ] && [ $rc -ne 3 ]; then
    printf '\033[31m    ✖ %s exited %d — full log at %s/%s.txt\033[0m\n' "$name" "$rc" "$LOG" "$name"
  fi
  return 0
}

TAIL=14 run unit       gate_unit
TAIL=6  run build      gate_build
TAIL=12 run validate   node bench/validate.mjs
TAIL=10 run fuzz       node bench/fuzz.mjs
TAIL=8  run mcp        node mcp/smoke.mjs
if [ "$QUICK" != "quick" ]; then
  TAIL=12 run sprint1    node bench/sprint1.mjs
  TAIL=14 run instrument node bench/run.mjs
fi

echo
echo "════════════════════════════════════════════"
echo "  THE BOARD"
echo "════════════════════════════════════════════"
fail=0; skipped=0
for i in "${!NAMES[@]}"; do
  case "${STATUS[$i]}" in
    0) mark='✅'; note='' ;;
    3) mark='⚠ '; note='   SKIPPED — prerequisite missing, see log'; skipped=$((skipped+1)) ;;
    *) mark='✖ '; note="   exited ${STATUS[$i]}"; fail=1 ;;
  esac
  printf '  %s %-11s %4ds%s\n' "$mark" "${NAMES[$i]}" "${SECS[$i]}" "$note"
done
echo "════════════════════════════════════════════"
if [ $fail -ne 0 ]; then
  echo "  ✖ NOT GREEN — do not deploy"
elif [ $skipped -ne 0 ]; then
  printf '  ⚠  %d of %d gates DID NOT RUN. This is not a pass.\n' "$skipped" "${#NAMES[@]}"
  echo "     Everything that ran was green, including the bound (gate 4),"
  echo "     which needs no browser and no cargo."
  echo "     To close the rest:"
  echo "       npm install && npx playwright install chromium"
  echo "       https://rustup.rs && rustup target add wasm32-unknown-unknown"
else
  echo "  ALL GREEN — safe to deploy"
fi
exit $fail
