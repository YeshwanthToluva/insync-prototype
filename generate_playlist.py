#!/usr/bin/env python3
# generate_playlist.py (fixed)
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SONGS_DIR = ROOT / "public" / "songs"
OUT_JSON = ROOT / "songs.json"

try:
    from mutagen import File as MutagenFile
    HAVE_MUTAGEN = True
except Exception:
    HAVE_MUTAGEN = False

def safe_duration(p: Path):
    if not HAVE_MUTAGEN:
        return None
    try:
        mf = MutagenFile(str(p))
        if mf is not None and getattr(mf, "info", None) and getattr(mf.info, "length", None):
            return float(mf.info.length)
    except Exception:
        return None
    return None

def main():
    SONGS_DIR.mkdir(parents=True, exist_ok=True)
    entries = []
    idx = 1
    for fn in sorted(SONGS_DIR.iterdir()):
        if not fn.is_file():
            continue
        if fn.suffix.lower() not in [".mp3", ".m4a", ".opus", ".ogg", ".wav"]:
            continue

        raw = fn.stem  # string
        title = raw
        artist = "Unknown"

        # Parse "Artist - Title" safely without calling .strip() on lists
        if " - " in raw:
            parts = raw.split(" - ", 1)  # list of 2 strings
            if len(parts) == 2:
                a, t = parts[0], parts[1]
                artist = (a or "").strip() or "Unknown"
                title = (t or "").strip() or raw
            else:
                title = raw.strip()
        else:
            title = raw.strip()

        dur = safe_duration(fn)

        entries.append({
            "id": idx,
            "title": title,
            "artist": artist,
            "filename": fn.name,
            "duration": dur
        })
        idx += 1

    # Always write valid JSON (atomic write optional)
    with open(OUT_JSON, "w", encoding="utf-8") as f:
        json.dump(entries, f, ensure_ascii=False, indent=2)

if __name__ == "__main__":
    main()

