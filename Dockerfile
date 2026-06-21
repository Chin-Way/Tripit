# Portable container image — runs TripIt on any host (Railway, Fly.io, Cloud
# Run, a VPS, etc.). For Render, the blueprint in render.yaml is simpler.
# Node 22+ is required for the built-in node:sqlite persistence layer.
FROM node:22-alpine
WORKDIR /app

# Install only runtime deps. The core needs none; qrcode is a dev-only tool and
# is skipped here. Persistence uses the built-in node:sqlite (no install); set
# DATABASE_URL to switch to Postgres (the optional 'pg' dep installs here too).
COPY package*.json ./
RUN npm install --omit=dev

COPY . .

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

CMD ["npm", "start"]
