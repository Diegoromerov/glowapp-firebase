# Etapa de construccin (Builder)
FROM public.ecr.aws/docker/library/node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production --legacy-peer-deps

# Etapa de produccin
FROM public.ecr.aws/docker/library/node:20-alpine
ENV TZ=America/Bogota
ENV NODE_ENV=production
WORKDIR /app

# Copiar de builder a prod (cuidado con los permisos)
COPY --from=builder --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node . .

# Copiar explícitamente las migraciones (por si el COPY anterior no las incluye)
COPY --chown=node:node migrations ./migrations
COPY --chown=node:node scripts ./scripts

# Entrypoint script para migraciones
COPY --chown=node:node entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh

# Usar el usuario sin privilegios que provee la imagen node
USER node

EXPOSE 8080
ENTRYPOINT ["/app/entrypoint.sh"]
