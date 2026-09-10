import { serve } from "../../apps/community-api/node_modules/@hono/node-server/dist/index.mjs";
import { createAPI } from "../../apps/community-api/src/app";
import { database, bountyId } from "../service-helpers";
import { key, deployments } from "../../packages/protocol/src/index";
const db = await database();
const objects = new Map();
const titles = [
  "Plant a little more green in your city",
  "Make a stranger’s day a little brighter",
  "Build something useful for your community",
  "Find a beautiful place off the beaten path",
  "Turn an everyday object into a work of art",
  "Teach someone a skill you love",
];
await db.query("DELETE FROM protocol_api.bounty");
for (let i = 0; i < titles.length; i++)
  await db.query(
    "INSERT INTO protocol_api.bounty VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'open',$11,$12,false,null)",
    [
      key(
        [8453, 42161, 1][i % 3],
        deployments[[1, 2, 0][i % 3]].address,
        String(i + 10)
      ),
      [8453, 42161, 1][i % 3],
      deployments[[1, 2, 0][i % 3]].address,
      String(i + 10),
      String(i + 10 + Number(deployments[[1, 2, 0][i % 3]].offset)),
      "0x0000000000000000000000000000000000000001",
      titles[i],
      [
        "The best ideas start small. Show us what you can make happen and share the story behind it.",
        "A mission for the curious. Bring your own perspective and surprise the community.",
      ][i % 2],
      ["10000000000000000", "50000000000000000", "200000000000000000"][i % 3],
      1700000000 + i,
      i % 2 === 0,
      i + 1,
    ]
  );
const app = createAPI({
  db,
  storage: {
    put: async (k, b, t) => {
      objects.set(k, { body: b, type: t });
    },
    get: async (k) => objects.get(k) ?? null,
  },
  origins: ["http://localhost:3000"],
  proxyKeys: { "http://localhost:3000": "local-browser-test" },
  publicStorageURL: "http://localhost:3000/media",
  moderators: [],
});
const server = serve({ fetch: app.fetch, port: 8787 });
process.on("SIGTERM", () =>
  server.close(async () => {
    await db.close();
    process.exit(0);
  })
);
