#!/bin/bash
# Cleanup script to remove PulseAudio sinks/sources created by soundpasta tests

set -euo pipefail

PREFIX="soundpasta-test"

echo "Cleaning up PulseAudio modules, sinks and sources with prefix: ${PREFIX}"

# Unload modules whose args reference sinks/sources with the prefix
pactl list short modules | grep "${PREFIX}" | awk '{print $1}' | sort -rn | while read modid; do
  echo "Unloading module $modid (matched by prefix)"
  pactl unload-module "$modid" 2>&1 || true
done

echo ""
echo "Remaining modules with prefix:"
pactl list short modules | grep "${PREFIX}" | wc -l || true

echo ""
echo "Remaining sinks with prefix:"
pactl list short sinks | grep "${PREFIX}" | wc -l || true

echo "Remaining sources with prefix:"
pactl list short sources | grep "${PREFIX}" | wc -l || true

