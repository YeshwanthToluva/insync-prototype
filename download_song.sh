#!/usr/bin/env bash
# download_song.sh - Download song using yt-dlp (search-first), MP3 output to public/songs
set -euo pipefail

if [ $# -eq 0 ]; then
  echo "Usage: $0 \"Song Name or URL\"" >&2
  exit 1
fi

SONG="$*"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE}")" && pwd)"
OUTDIR="${SCRIPT_DIR}/public/songs"
mkdir -p "$OUTDIR"

echo "🎵 Searching for: $SONG"
echo "📁 Download directory: $OUTDIR"

if ! command -v yt-dlp >/dev/null 2>&1; then
  echo "❌ Error: yt-dlp is not installed! Try: python3 -m pip install -U yt-dlp or pacman -S yt-dlp" >&2
  exit 1
fi

if ! command -v ffmpeg >/dev/null 2>&1; then
  echo "❌ Error: ffmpeg is not installed! Install ffmpeg so MP3 conversion works." >&2
  exit 1
fi

# Use ytsearch1: to grab the first matching result; convert to MP3
# --newline ensures progress lines are printed for the Node server to parse
# Keep a simple output template that worked in the test
yt-dlp \
  -x --audio-format mp3 \
  --newline \
  --no-warnings \
  --no-check-certificate \
  -o "${OUTDIR}/%(title)s.%(ext)s" \
  "ytsearch1:${SONG}"

echo "✅ Download completed successfully!"

# Show library count (optional)
mp3_count=$(find "$OUTDIR" -type f -name "*.mp3" | wc -l | tr -d ' ')
echo "📊 Total songs in library: ${mp3_count}"

# Regenerate playlist if generator exists (server also triggers this, but local is fine)
if [ -f "${SCRIPT_DIR}/generate_playlist.py" ]; then
  echo "🔄 Regenerating playlist..."
  ( cd "${SCRIPT_DIR}" && python3 generate_playlist.py ) || true
fi

