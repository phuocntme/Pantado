# Build from the repo root: docker build -f keepers/auction-filler/Dockerfile .
FROM node:22-alpine
RUN corepack enable
WORKDIR /app
COPY . .
# one pnpm store shared by every image build (BuildKit cache): packages download once
RUN --mount=type=cache,id=pantado-pnpm,target=/pnpm-store,sharing=locked \
    --mount=type=cache,id=pantado-pnpm-meta,target=/root/.cache/pnpm,sharing=locked \
    pnpm install --frozen-lockfile --store-dir /pnpm-store --package-import-method copy --filter "@pantado/auction-filler..."
WORKDIR /app/keepers/auction-filler
ENV NODE_ENV=production
CMD ["pnpm", "start"]
