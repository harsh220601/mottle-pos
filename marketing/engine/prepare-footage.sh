#!/usr/bin/env bash
# Extracts the app screen recordings used by the films into image sequences.
# Source: the site's own product footage in ../../assets. Output: ../.cache/footage
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
assets="$here/../../assets"
out="$here/../.cache/footage"
mkdir -p "$out"

seq() { # name source start end [crop] [fps]
  local name=$1 src=$2 ss=$3 to=$4 crop=${5:-} fps=${6:-30}
  local vf="fps=$fps"
  [ -n "$crop" ] && vf="crop=$crop,$vf"
  rm -rf "$out/$name"; mkdir -p "$out/$name"
  ffmpeg -v error -ss "$ss" -to "$to" -i "$assets/$src" -vf "$vf" -q:v 2 "$out/$name/%04d.jpg"
  echo "$name: $(ls "$out/$name" | wc -l) frames"
}

# Full-screen iPad recordings (1440x1080) inside ipad-preview.mp4
seq dash     ipad-preview.mp4 1.55  2.68
seq book     ipad-preview.mp4 3.75  7.18
seq checkin  ipad-preview.mp4 8.35  13.38
seq aiq      ipad-preview.mp4 14.75 20.70
seq aibook   ipad-preview.mp4 21.65 26.45
# Mottle AI panel recording (780x900)
seq aipanel  ai-demo.mp4      0     40.1
# Device-framed recordings in film.mp4: crop the screen only
seq rooms    film.mp4         0.2   6.8   896:656:606:122
seq clean    film.mp4         19.9  22.8   896:656:606:122
seq checkout film.mp4         17.0  19.6  896:656:606:122
