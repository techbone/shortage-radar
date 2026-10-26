# Shortage Radar: the web app, the /run API and the agent, in one image.
# Everything is installed and built at image build time; nothing is fetched while it runs.
# Secrets are never baked in: pass them at run time (--env-file .env).
FROM node:22-slim

WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=8000

# Dependencies first so the layer caches. devDependencies stay: tsx runs the CLI (run.ts).
COPY package.json package-lock.json ./
RUN npm ci --include=dev --no-audit --no-fund

COPY . .
RUN npm run build && mkdir -p /app/logs /app/.state

EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8000)+'/api/status').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Binds 0.0.0.0 so the port mapping works. With no Zetaris or Nightshift reachable the UI opens in Sample mode.
CMD ["npm", "start"]
