// Real Anvil + PostgreSQL + Ponder integration, with no production credentials.
import { spawn } from "node:child_process";
import { readFile, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import assert from "node:assert/strict";
import {
  createPublicClient,
  createWalletClient,
  http,
  parseEther,
  getContractAddress,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import pg from "../packages/database/node_modules/pg/lib/index.js";
const dbURL = process.env.INDEXER_TEST_DATABASE_URL;
if (!dbURL)
  throw new Error(
    "Set INDEXER_TEST_DATABASE_URL to a disposable PostgreSQL database"
  );
const database = new pg.Pool({ connectionString: dbURL });
const dir = await mkdtemp(join(tmpdir(), "poidh-indexer-test-"));
const children = [];
let indexer;
let proxyAvailable = true;
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, label, ms = 60000) {
  const end = Date.now() + ms;
  let last;
  while (Date.now() < end) {
    try {
      if (await fn()) return;
    } catch (e) {
      last = e;
    }
    await pause(500);
  }
  throw new Error("Timeout: " + label + (last ? " " + last.message : ""));
}
function start(command, args, env = {}) {
  const child = spawn(command, args, {
    cwd: resolve("apps/indexer"),
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let log = "";
  for (const stream of [child.stdout, child.stderr])
    stream.on("data", (chunk) => {
      log += chunk;
    });
  child.log = () => log;
  children.push(child);
  return child;
}
async function stop(child, signal = "SIGTERM") {
  if (child.exitCode !== null) return;
  child.kill(signal);
  await until(
    () => child.exitCode !== null || child.signalCode !== null,
    "process shutdown",
    20000
  );
}
const port = 18547;
const proxyPort = 18548;
const rpc = "http://127.0.0.1:" + port;
const privateKey =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const account = privateKeyToAccount(privateKey);
const transport = http(rpc);
const client = createPublicClient({ transport });
const wallet = createWalletClient({ account, transport });
const anvil = start("anvil", [
  "--port",
  String(port),
  "--chain-id",
  "8453",
  "--silent",
]);
const { createServer } = await import("node:http");
const proxy = createServer(async (req, res) => {
  if (!proxyAvailable) {
    res.writeHead(503);
    res.end("Simulated RPC outage");
    return;
  }
  const chunks = [];
  for await (const c of req) chunks.push(c);
  try {
    const response = await fetch(rpc, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: Buffer.concat(chunks),
    });
    res.writeHead(response.status, { "Content-Type": "application/json" });
    res.end(await response.text());
  } catch {
    res.writeHead(503);
    res.end();
  }
});
await new Promise((r) => proxy.listen(proxyPort, "127.0.0.1", r));
try {
  await until(async () => (await client.getChainId()) === 8453, "Anvil");
  const nftArtifact = JSON.parse(
    await readFile(
      "contracts/poidh-v3/out/PoidhClaimNFT.sol/PoidhClaimNFT.json",
      "utf8"
    )
  );
  const protocol = JSON.parse(
    await readFile("contracts/poidh-v3/out/PoidhV3.sol/PoidhV3.json", "utf8")
  );
  async function deploy(artifact, args) {
    const tx = await wallet.deployContract({
      abi: artifact.abi,
      bytecode: artifact.bytecode.object,
      args,
      chain: null,
    });
    return (await client.waitForTransactionReceipt({ hash: tx }))
      .contractAddress;
  }
  const predicted = getContractAddress({ from: account.address, nonce: 1n });
  const nft = await deploy(nftArtifact, ["Local proof", "TEST", predicted]);
  const contract = await deploy(protocol, [nft, account.address, 1n, 1n, 1n]);
  const cfg = `import {createConfig} from 'ponder';import {abi,nftAbi,legacyAbi} from '@poidh/protocol';export default createConfig({ordering:'multichain',chains:{base:{id:8453,rpc:'http://127.0.0.1:${proxyPort}',pollingInterval:200}},contracts:{Poidh:{abi,chain:'base',address:'${contract}',startBlock:0},NFT:{abi:nftAbi,chain:'base',address:'${nft}',startBlock:0},Legacy:{abi:legacyAbi,chain:'base',address:'0x0000000000000000000000000000000000000001',startBlock:0},LegacyNFT:{abi:nftAbi,chain:'base',address:'0x0000000000000000000000000000000000000002',startBlock:0}}});`;
  // Config stays under the app so Ponder resolves its packages, but is ignored by Git.
  const configPath = resolve("apps/indexer/.test.config.ts");
  await writeFile(configPath, cfg);
  const schema = "test_" + Date.now();
  const launch = () =>
    start(
      "pnpm",
      [
        "exec",
        "ponder",
        "start",
        "--config",
        ".test.config.ts",
        "--schema",
        schema,
        "--views-schema",
        "recovery_api",
        "--port",
        "42079",
      ],
      { DATABASE_URL: dbURL }
    );
  indexer = launch();
  const write = async (title) => {
    const hash = await wallet.writeContract({
      address: contract,
      abi: protocol.abi,
      functionName: "createSoloBounty",
      args: [title, "Local integration test"],
      value: parseEther("0.001"),
      chain: null,
    });
    return client.waitForTransactionReceipt({ hash });
  };
  const count = async () => {
    try {
      return Number(
        (await database.query("SELECT count(*) FROM recovery_api.bounty"))
          .rows[0].count
      );
    } catch {
      return -1;
    }
  };
  await write("Before restart");
  await until(async () => (await count()) === 1, "initial indexing");
  await stop(indexer);
  indexer = launch();
  await until(async () => (await count()) === 1, "restart without duplicates");
  await write("After restart");
  await until(async () => (await count()) === 2, "new events after restart");
  const snapshot = await client.request({ method: "evm_snapshot" });
  await write("Orphaned bounty");
  await until(async () => (await count()) === 3, "unfinalized event");
  await client.request({ method: "evm_revert", params: [snapshot] });
  await write("Replacement bounty");
  await client.request({ method: "anvil_mine", params: ["0x2"] });
  await until(async () => {
    const rows = (
      await database.query(
        "SELECT title FROM recovery_api.bounty ORDER BY on_chain_id"
      )
    ).rows;
    return rows.length === 3 && rows[2].title === "Replacement bounty";
  }, "reorg rollback and replacement");
  proxyAvailable = false;
  await write("During RPC outage");
  await pause(2000);
  assert.equal(await count(), 3);
  proxyAvailable = true;
  await until(async () => (await count()) === 4, "RPC recovery", 90000);
  await stop(indexer);
  indexer = launch();
  await until(
    async () => (await count()) === 4,
    "duplicate replay after second restart"
  );
  const unique = (
    await database.query(
      "SELECT count(*) AS total,count(DISTINCT id) AS unique FROM recovery_api.event"
    )
  ).rows[0];
  assert.equal(unique.total, unique.unique);
  console.log(
    "PASS: actual Ponder indexing, repeated restart, duplicate replay, reorg rollback, and RPC outage recovery"
  );
} catch (error) {
  if (indexer) await writeFile(join(dir, "ponder.log"), indexer.log());
  console.error("Indexer diagnostics:", dir);
  throw new Error(error.shortMessage ?? error.message);
} finally {
  for (const child of children.reverse())
    await stop(child).catch(() => child.kill("SIGKILL"));
  await new Promise((r) => proxy.close(r));
  await database.end();
}
