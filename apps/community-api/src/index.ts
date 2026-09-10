import { postgres } from "@poidh/database";
import { r2 } from "@poidh/storage";
import { createAPI } from "./app";
interface Env {
  DATABASE_URL: string;
  HYPERDRIVE?: { connectionString: string };
  PROOFS: any;
  CLIENT_ORIGINS: string;
  PROXY_KEYS: string;
  PUBLIC_STORAGE_URL: string;
  MODERATORS?: string;
}
export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: { waitUntil(p: Promise<unknown>): void }
  ) {
    const db = postgres(env.HYPERDRIVE?.connectionString ?? env.DATABASE_URL, {
      max: 2,
    });
    try {
      return await createAPI({
        db,
        storage: r2(env.PROOFS),
        origins: env.CLIENT_ORIGINS.split(","),
        proxyKeys: JSON.parse(env.PROXY_KEYS),
        publicStorageURL: env.PUBLIC_STORAGE_URL,
        moderators: (env.MODERATORS ?? "")
          .toLowerCase()
          .split(",")
          .filter(Boolean),
      }).fetch(request);
    } finally {
      ctx.waitUntil(db.close());
    }
  },
  async scheduled(_: unknown, env: Env) {
    const db = postgres(env.HYPERDRIVE?.connectionString ?? env.DATABASE_URL);
    try {
      await db.query("DELETE FROM community.challenges WHERE expires_at<now()");
      await db.query("DELETE FROM community.sessions WHERE expires_at<now()");
    } finally {
      await db.close();
    }
  },
};
