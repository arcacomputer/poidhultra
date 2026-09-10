import { Hono } from "hono";
// Ponder supplies /health, /ready, /status and /metrics. Indexed data is read through stable SQL views.
export default new Hono().get("/", (c) =>
  c.json({ service: "poidh indexer", reads: "protocol_api schema" })
);
