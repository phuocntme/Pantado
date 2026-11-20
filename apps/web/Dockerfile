# Build from the repo root: docker build -f apps/web/Dockerfile --build-arg PANTADO_PROFILE=contest .
FROM node:22-alpine AS build
RUN corepack enable
WORKDIR /app
COPY . .
# one pnpm store shared by every image build (BuildKit cache): packages download once
RUN --mount=type=cache,id=pantado-pnpm,target=/pnpm-store,sharing=locked \
    --mount=type=cache,id=pantado-pnpm-meta,target=/root/.cache/pnpm,sharing=locked \
    pnpm install --frozen-lockfile --store-dir /pnpm-store --package-import-method copy --filter "@pantado/web..."
ARG PANTADO_PROFILE=contest
ARG NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_AGENT_URL
ARG NEXT_PUBLIC_PRIVY_APP_ID
ENV PANTADO_PROFILE=$PANTADO_PROFILE NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL NEXT_PUBLIC_AGENT_URL=$NEXT_PUBLIC_AGENT_URL NEXT_PUBLIC_PRIVY_APP_ID=$NEXT_PUBLIC_PRIVY_APP_ID NEXT_TELEMETRY_DISABLED=1
RUN pnpm --filter @pantado/web build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0
COPY --from=build /app/apps/web/.next/standalone ./
COPY --from=build /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build /app/apps/web/public ./apps/web/public
CMD ["node", "apps/web/server.js"]
