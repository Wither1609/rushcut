# Rushcut en mode serveur (Wither Editor de Work OS) : Electron sans écran, l'éditeur est servi en HTTP sur le port 8787.
FROM node:22-bookworm-slim

# Bibliothèques de Chromium/Electron, écran virtuel (rendu du motion design à l'export), polices.
RUN apt-get update && apt-get install -y --no-install-recommends \
      xvfb ca-certificates fonts-dejavu-core fonts-noto-color-emoji \
      libgtk-3-0 libnss3 libasound2 libgbm1 libxss1 libxshmfence1 libdrm2 libxkbcommon0 \
      libatk-bridge2.0-0 libcups2 libxcomposite1 libxdamage1 libxrandr2 libpango-1.0-0 libcairo2 \
    && rm -rf /var/lib/apt/lists/*

# Claude Code : mode abonnement (CLAUDE_CONFIG_DIR monté par docker-compose).
RUN npm install -g @anthropic-ai/claude-code && npm cache clean --force

WORKDIR /app
COPY package.json package-lock.json ./
# Electron télécharge son binaire à part ; ffmpeg-static le sien pendant npm ci.
RUN npm ci && (npx --no install-electron --no || node node_modules/electron/install.js) && test -x node_modules/electron/dist/electron && test -x node_modules/ffmpeg-static/ffmpeg
COPY . .
RUN npm run build && mkdir -p data && chown -R node:node /app/data

USER node
ENV RUSHCUT_SERVER=1 \
    RUSHCUT_DATA_DIR=/app/data \
    RUSHCUT_ENV_FILE=/app/.env \
    RUSHCUT_CLAUDE_AUTH=subscription \
    PORT=8787 \
    ELECTRON_DISABLE_SANDBOX=1
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s CMD node -e "fetch('http://127.0.0.1:8787/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["./docker-entrypoint.sh"]
