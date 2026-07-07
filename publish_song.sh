#!/bin/bash
# publish_song.sh — 一键发布歌曲到 AGITopia Music
# 用法: ./publish_song.sh --file <mp3路径> --id <slug> --title "歌名" --subtitle "英文副标题" --style "曲风" --duration "3:18" --desc "描述"
# 示例: ./publish_song.sh --file ~/Downloads/kunbuzhu.mp3 --id kunbuzhu --title "困不住" --subtitle "Can't Be Trapped" --style "R&B Rap" --duration "3:18" --desc "潘玮柏风格的旋律说唱"

set -euo pipefail

# --- Parse args ---
while [[ $# -gt 0 ]]; do
  case "$1" in
    --file)      MP3_FILE="$2"; shift 2 ;;
    --id)        SONG_ID="$2"; shift 2 ;;
    --title)     TITLE="$2"; shift 2 ;;
    --subtitle)  SUBTITLE="$2"; shift 2 ;;
    --style)     STYLE="$2"; shift 2 ;;
    --duration)  DURATION="$2"; shift 2 ;;
    --desc)      DESCRIPTION="$2"; shift 2 ;;
    --lyrics)    LYRICS_URL="$2"; shift 2 ;;
    *) echo "Unknown arg: $1"; exit 1 ;;
  esac
done

# --- Validate ---
: "${MP3_FILE:?Required: --file}"
: "${SONG_ID:?Required: --id}"
: "${TITLE:?Required: --title}"
: "${STYLE:?Required: --style}"
: "${DURATION:?Required: --duration}"

[[ -f "$MP3_FILE" ]] || { echo "File not found: $MP3_FILE"; exit 1; }

DATE=$(date +%Y-%m-%d)
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SONGS_JSON="$SCRIPT_DIR/public/songs.json"

echo "🎵 Publishing: $TITLE"
echo "   File: $MP3_FILE ($(du -h "$MP3_FILE" | cut -f1))"

# --- Step 1: Upload to R2 ---
echo "📤 Uploading to R2..."
wrangler r2 object put "ainovalife-music/$SONG_ID.mp3" \
  --file "$MP3_FILE" \
  --content-type audio/mpeg \
  --cache-control "public, max-age=31536000, immutable" \
  --remote

# --- Step 2: Update songs.json ---
echo "📝 Updating songs.json..."
NEW_ENTRY=$(cat <<JSON
  {
    "id": "$SONG_ID",
    "title": "$TITLE",
    "subtitle": "${SUBTITLE:-}",
    "artist": "James Cheng",
    "style": "$STYLE",
    "duration": "$DURATION",
    "date": "$DATE",
    "file": "$SONG_ID.mp3",
    "lyrics": "${LYRICS_URL:-}",
    "description": "${DESCRIPTION:-}"
  }
JSON
)

# Use python to insert at top of JSON array (newest first)
python3 -c "
import json, sys
with open('$SONGS_JSON') as f:
    songs = json.load(f)
songs.insert(0, $NEW_ENTRY)
with open('$SONGS_JSON', 'w') as f:
    json.dump(songs, f, ensure_ascii=False, indent=2)
print(f'Updated: {len(songs)} songs in index')
"

# --- Step 3: Deploy ---
echo "🚀 Deploying..."
wrangler deploy

# --- Step 4: Git push ---
echo "📦 Committing..."
git add "$SONGS_JSON"
git commit -m "Add song: $TITLE ($SONG_ID)"
git push origin main

echo ""
echo "✅ Done! $TITLE is live at https://music.ainovalife.com/"
echo "   Audio: https://music.ainovalife.com/audio/$SONG_ID.mp3"
