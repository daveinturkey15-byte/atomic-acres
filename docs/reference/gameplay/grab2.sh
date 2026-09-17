#!/bin/bash
for ID in 1icNQzMgLUM VfcKHcDJXpM tB35IKluv0g; do
  yt-dlp -f "bestvideo[height<=1080][ext=mp4]/best[height<=1080]" -o "v2-$ID.%(ext)s" "https://www.youtube.com/watch?v=$ID" >/dev/null 2>&1
  V=$(ls v2-$ID.* 2>/dev/null | head -1)
  if [ -n "$V" ]; then
    ffmpeg -nostdin -loglevel error -i "$V" -vf "fps=1/4,scale=1600:-1" -q:v 3 "g-${ID}-%03d.jpg" 2>/dev/null
    rm -f "$V"
  fi
done
echo "NEW FRAMES: $(ls g-*.jpg 2>/dev/null | wc -l)"
