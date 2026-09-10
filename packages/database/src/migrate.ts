import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { postgres } from "./index";
export async function migrate(db: ReturnType<typeof postgres>) {
  const dir = fileURLToPath(new URL("../migrations/", import.meta.url));
  await db.transaction(async (tx) => {
    await tx.query("SELECT pg_advisory_xact_lock(782619)");
    await tx.query(
      "CREATE TABLE IF NOT EXISTS public.ultra_migrations (name text PRIMARY KEY, applied_at timestamptz DEFAULT now())"
    );
    for (const name of (await readdir(dir))
      .filter((n) => n.endsWith(".sql"))
      .sort()) {
      const { rows } = await tx.query(
        "SELECT name FROM public.ultra_migrations WHERE name=$1",
        [name]
      );
      if (rows.length) continue;
      await tx.query(await readFile(dir + "/" + name, "utf8"));
      await tx.query("INSERT INTO public.ultra_migrations(name) VALUES($1)", [
        name,
      ]);
    }
  });
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (!process.env.DATABASE_URL)
    throw new Error(
      "Set DATABASE_URL to a migration-capable PostgreSQL connection"
    );
  const db = postgres(process.env.DATABASE_URL);
  try {
    await migrate(db);
    console.log("Community migrations applied");
  } finally {
    await db.close();
  }
}
