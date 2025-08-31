#!/usr/bin/env bash
# download_song.sh - Download song using yt-dlp (search-first), MP3 output to public/songs
set -euo pipefail

if [ $# -eq 0 ]; then
  echo "Usage: $0 \"Song Name Artist\"" >&2
  echo "Example: $0 \"Taki Taki DJ Snake\"" >&2
  exit 1
fi

# User input (song + artist in one string)
SONG="$*"
SEARCH_QUERY="${SONG} official audio"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE}")" && pwd)"
OUTDIR="${SCRIPT_DIR}/public/songs"
mkdir -p "$OUTDIR"

echo "🎵 Searching for: $SEARCH_QUERY"
echo "📁 Download directory: $OUTDIR"

# Ensure yt-dlp + ffmpeg exist
if ! command -v yt-dlp >/dev/null 2>&1; then
  echo "❌ Error: yt-dlp is not installed!" >&2
  exit 1
fi
if ! command -v ffmpeg >/dev/null 2>&1; then
  echo "❌ Error: ffmpeg is not installed!" >&2
  exit 1
fi

# Download best audio match
yt-dlp \
  -x --audio-format mp3 \
  --newline \
  --no-warnings \
  --no-check-certificate \
  -o "${OUTDIR}/%(title)s.%(ext)s" \
  "ytsearch1:${SEARCH_QUERY}"

echo "✅ Download completed successfully!"

# Show library count
mp3_count=$(find "$OUTDIR" -type f -name "*.mp3" | wc -l | tr -d ' ')
echo "📊 Total songs in library: ${mp3_count}"

# Regenerate playlist if generator exists
if [ -f "${SCRIPT_DIR}/generate_playlist.py" ]; then
  echo "🔄 Regenerating playlist..."
  ( cd "${SCRIPT_DIR}" && python3 generate_playlist.py ) || true
fi

