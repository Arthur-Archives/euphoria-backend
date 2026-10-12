FROM node:24-alpine AS build
WORKDIR /app
RUN npm install --global pnpm@11.25.0
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,target=/pnpm/store pnpm install --frozen-lockfile --store-dir /pnpm/store
COPY tsconfig.json ./
COPY config ./config
COPY routes ./routes
COPY scripts ./scripts
COPY server.ts ./
COPY handlers ./handlers
COPY middleware ./middleware
COPY public ./public
RUN pnpm run build && pnpm prune --prod --config.confirmModulesPurge=false

FROM node:24-alpine
WORKDIR /app
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/package.json ./
USER node
CMD ["node", "dist/scripts/telemetryPreview.js"]
