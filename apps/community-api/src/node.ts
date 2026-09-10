import { serve } from "@hono/node-server";
import { postgres } from "@poidh/database";
import { s3 } from "@poidh/storage";
import { createAPI } from "./app";
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
const db = postgres(process.env.DATABASE_URL);
const app = createAPI({
  db,
  storage: s3({
    endpoint: process.env.S3_ENDPOINT,
    bucket: process.env.S3_BUCKET ?? "poidh-proofs",
    accessKeyId: process.env.S3_ACCESS_KEY_ID,
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
  }),
  origins: (process.env.CLIENT_ORIGINS ?? "http://localhost:3000").split(","),
  proxyKeys: JSON.parse(process.env.PROXY_KEYS ?? "{}"),
  publicStorageURL:
    process.env.PUBLIC_STORAGE_URL ?? "http://localhost:8787/media",
  moderators: (process.env.MODERATORS ?? "")
    .toLowerCase()
    .split(",")
    .filter(Boolean),
});
const server = serve({
  fetch: app.fetch,
  port: Number(process.env.PORT ?? 8787),
});
for (const signal of ["SIGTERM", "SIGINT"])
  process.on(signal, () => {
    server.close(async () => {
      await db.close();
      process.exit(0);
    });
  });
