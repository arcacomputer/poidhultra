FROM node:22-bookworm-slim
RUN corepack enable && corepack prepare pnpm@10.33.4 --activate
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages ./packages
COPY apps/community-api ./apps/community-api
COPY scripts/storage ./scripts/storage
RUN pnpm install --frozen-lockfile --filter @poidh/community-api... --filter poidhultra
CMD ["node", "--import", "tsx", "apps/community-api/src/node.ts"]
