# Portable container image — runs TripIt on any host (Railway, Fly.io, Cloud
# Run, a VPS, etc.). For Render, the blueprint in render.yaml is simpler.
FROM node:20-alpine
WORKDIR /app

# Install only runtime deps (@anthropic-ai/sdk). The core needs none; qrcode is
# a dev-only tool and is skipped here.
COPY package*.json ./
RUN npm install --omit=dev

COPY . .

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

CMD ["npm", "start"]
