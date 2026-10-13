#!/bin/sh
# Écran virtuel pour Electron (xvfb-run se bloque quand il est le processus 1 du conteneur).
rm -f /tmp/.X99-lock
Xvfb :99 -screen 0 1920x1080x24 -nolisten tcp >/dev/null 2>&1 &
export DISPLAY=:99
for _ in 1 2 3 4 5 6 7 8 9 10; do [ -e /tmp/.X11-unix/X99 ] && break; sleep 0.3; done
exec ./node_modules/.bin/electron . --no-sandbox --disable-gpu --disable-dev-shm-usage "$@"
