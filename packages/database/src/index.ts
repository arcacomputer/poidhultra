import pg from "pg";
export interface SQL {
  query<T = Record<string, unknown>>(
    text: string,
    values?: unknown[]
  ): Promise<{ rows: T[] }>;
}
export interface Database extends SQL {
  transaction<T>(fn: (tx: SQL) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}
export function postgres(
  url: string,
  { max = 5 }: { max?: number } = {}
): Database {
  const pool = new pg.Pool({
    connectionString: url,
    max,
    connectionTimeoutMillis: 10_000,
    idleTimeoutMillis: 10_000,
  });
  return {
    query: async <T>(text: string, values?: unknown[]) => ({
      rows: (await pool.query(text, values)).rows as T[],
    }),
    transaction: async (fn) => {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const result = await fn(client);
        await client.query("COMMIT");
        return result;
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    },
    close: () => pool.end(),
  };
}
export async function serial<T>(tx: SQL, scope: string, fn: () => Promise<T>) {
  await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
    scope,
  ]);
  return fn();
}
