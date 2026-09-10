import { readFileSync } from "node:fs";
const data = JSON.parse(
  readFileSync(new URL("../infra/launch-gates.json", import.meta.url), "utf8")
);
const required = [
  "ci",
  "contract-deployments",
  "historical-backfill",
  "original-client-integration",
  "community-migration",
  "degen-archive",
  "production-rollback-rehearsal",
];
const pending = required.filter((id) => {
  const gates = data.gates.filter((g) => g.id === id);
  return (
    gates.length !== 1 ||
    gates[0].status !== "verified" ||
    !gates[0].evidence ||
    !gates[0].reviewedBy
  );
});
if (pending.length) {
  console.error("Shared production launch remains gated:", pending.join(", "));
  process.exitCode = 1;
} else console.log("All shared production launch gates have recorded review.");
