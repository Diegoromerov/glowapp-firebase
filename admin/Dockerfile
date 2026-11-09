# Admin Dashboard (Next.js 15) — build multi-etapa.
# Base image desde el mirror público de AWS ECR (mismo contenido que
# docker.io/library/node:20-alpine) para evitar el rate-limit 429 de Docker Hub
# que tumbaba los deploys de Railway.

# Etapa build
FROM public.ecr.aws/docker/library/node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# Etapa runtime
FROM public.ecr.aws/docker/library/node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=builder --chown=node:node /app ./
USER node
EXPOSE 3001
# Respeta el PORT que inyecta Railway; por defecto 3001 (paridad con el deploy anterior).
CMD ["sh", "-c", "npx next start -p ${PORT:-3001}"]
