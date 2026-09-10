FROM node:22-bookworm-slim
RUN corepack enable && corepack prepare pnpm@10.33.4 --activate
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/protocol ./packages/protocol
COPY apps/indexer ./apps/indexer
RUN pnpm install --frozen-lockfile --filter @poidh/indexer...
WORKDIR /app/apps/indexer
RUN pnpm exec ponder codegen
ENV NODE_ENV=production
EXPOSE 42069
STOPSIGNAL SIGTERM
CMD ["pnpm", "exec", "ponder", "start", "--views-schema", "protocol_api"]
