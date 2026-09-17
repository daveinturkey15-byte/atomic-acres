#!/bin/bash
set -e
for ID in aICKIbuo8zQ FKQOEO-1ceE mGpZaLy5_hM; do
  echo "=== $ID ==="
  yt-dlp -f "bestvideo[height<=1080][ext=mp4]/best[height<=1080]" -o "vid-$ID.%(ext)s" "https://www.youtube.com/watch?v=$ID" 2>&1 | tail -2
  V=$(ls vid-$ID.* 2>/dev/null | head -1)
  if [ -n "$V" ]; then
    ffmpeg -nostdin -loglevel error -i "$V" -vf "fps=1/3,scale=1600:-1" -q:v 3 "f-${ID}-%03d.jpg" 2>&1 | tail -2
    rm -f "$V"
    echo "frames: $(ls f-${ID}-*.jpg 2>/dev/null | wc -l)"
  fi
done
echo "TOTAL FRAMES: $(ls f-*.jpg 2>/dev/null | wc -l)"
