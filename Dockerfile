FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src

RUN npm run build

# Production image
FROM node:20-alpine AS production

WORKDIR /app

ENV NODE_ENV=production

COPY package*.json ./
RUN npm ci --omit=dev

COPY --from=builder /app/dist ./dist

# Copiar migraciones SQL al directorio correcto en dist
COPY src/db/migrations ./dist/db/migrations

EXPOSE 3000

CMD ["node", "dist/index.js"]
