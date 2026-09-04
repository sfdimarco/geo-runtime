#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════
# test.sh — one command, one board. Run this before you deploy.
#
# Six gates, fastest first, so a broken build fails in seconds rather than
# eight minutes:
#
#   1 unit      cargo test           ms      the logic that can be wrong silently
#   2 build     cargo → wasm → dist  s       and the .geocast → .geo compile
#   3 validate  vs GeoV itself       ~40s    THE CORRECTNESS GATE
#   4 fuzz      4,000 programs       ~90s    the bound, tested not asserted
#   5 sprint1   the rig              ~150s   reachability · 3 angles · the number
#   6 instrument the pipe sweep      ~180s   sprint 0's regression suite
#
# Any non-zero exit fails the board. `./test.sh quick` stops after gate 4.
# ═══════════════════════════════════════════════════════════════════════════
set -uo pipefail
cd "$(dirname "$0")"
QUICK="${1:-}"
LOG=bench/results/test-log
mkdir -p "$LOG"

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
  [ $rc -eq 0 ] || printf '\033[31m    ✖ %s exited %d — full log at %s/%s.txt\033[0m\n' "$name" "$rc" "$LOG" "$name"
  return 0
}

TAIL=14 run unit       cargo test --offline
TAIL=4  run build      ./build.sh
TAIL=12 run validate   node bench/validate.mjs
TAIL=10 run fuzz       node bench/fuzz.mjs
if [ "$QUICK" != "quick" ]; then
  TAIL=12 run sprint1    node bench/sprint1.mjs
  TAIL=14 run instrument node bench/run.mjs
fi

echo
echo "════════════════════════════════════════════"
echo "  THE BOARD"
echo "════════════════════════════════════════════"
fail=0
for i in "${!NAMES[@]}"; do
  if [ "${STATUS[$i]}" -eq 0 ]; then mark='✅'; else mark='✖ '; fail=1; fi
  printf '  %s %-11s %4ds\n' "$mark" "${NAMES[$i]}" "${SECS[$i]}"
done
echo "════════════════════════════════════════════"
if [ $fail -eq 0 ]; then
  echo "  ALL GREEN — safe to deploy"
else
  echo "  ✖ NOT GREEN — do not deploy"
fi
exit $fail
