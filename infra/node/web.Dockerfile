FROM node:22-bookworm-slim AS build
RUN corepack enable && corepack prepare pnpm@10.33.4 --activate
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/web ./apps/web
COPY packages ./packages
RUN pnpm install --frozen-lockfile --filter @poidh/web...
ARG APP_ORIGIN=http://localhost:3000
ENV NEXT_PUBLIC_APP_URL=$APP_ORIGIN
RUN pnpm --filter @poidh/web build
FROM node:22-bookworm-slim
ENV NODE_ENV=production HOSTNAME=0.0.0.0 PORT=3000
WORKDIR /app
COPY --from=build /app/apps/web/.next/standalone ./
COPY --from=build /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build /app/apps/web/public ./apps/web/public
USER node
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
