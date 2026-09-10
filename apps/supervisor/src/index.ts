import { Container, getContainer } from "@cloudflare/containers";
import { DurableObject } from "cloudflare:workers";
import { github, validSignature, type GitHubCredentials } from "./github";
import { MaintenanceWatchdog } from "./maintenance";
interface Env extends GitHubCredentials {
  INDEXER_ENABLED?: string;
  INDEXER: DurableObjectNamespace<PoidhIndexer>;
  MAINTENANCE: DurableObjectNamespace<Maintenance>;
  DATABASE_URL: string;
  DATABASE_SCHEMA: string;
  MAINNET_RPC_URL: string;
  BASE_RPC_URL: string;
  ARBITRUM_RPC_URL: string;
  UPSTREAM_WEBHOOK_SECRET: string;
  UPSTREAM_REPOSITORY_IDS: string;
}
export class PoidhIndexer extends Container<Env> {
  defaultPort = 42069;
  sleepAfter = "5m";
  enableInternet = true;
  envVars = {
    NODE_ENV: "production",
    DATABASE_URL: this.env.DATABASE_URL,
    DATABASE_SCHEMA: this.env.DATABASE_SCHEMA,
    MAINNET_RPC_URL: this.env.MAINNET_RPC_URL,
    BASE_RPC_URL: this.env.BASE_RPC_URL,
    ARBITRUM_RPC_URL: this.env.ARBITRUM_RPC_URL,
  };
  override onError(error: unknown) {
    console.error("Indexer container failed", { error: String(error) });
  }
}
export class Maintenance extends DurableObject<Env> {
  private watchdog: MaintenanceWatchdog;
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.watchdog = new MaintenanceWatchdog(ctx.storage, {
      readReport: async () => {
        const response = await fetch(
          `https://raw.githubusercontent.com/${env.GITHUB_REPOSITORY}/maintenance-state/status.json`,
          {
            signal: AbortSignal.timeout(15_000),
            headers: { "Cache-Control": "no-cache" },
          }
        );
        if (!response.ok) throw new Error("No published maintenance report");
        return response.json();
      },
      openIncident: async (lastSuccessfulCheck) => {
        const marker = "<!-- poidh-ultra-watchdog -->";
        // Recover an issue created just before storage or process failure.
        let existing: any;
        for (let page = 1; ; page++) {
          const issues: any = await github(
            env,
            `/issues?state=open&per_page=100&page=${page}`
          );
          existing = issues.find(
            (issue: any) => !issue.pull_request && issue.body?.includes(marker)
          );
          if (existing || issues.length < 100) break;
        }
        const issue: any =
          existing ??
          (await github(env, "/issues", {
            title: "Upstream maintenance missed successful checks",
            body: `${marker}\nThe Cloudflare watchdog has not observed a successful check within 3 hours.\n\nLast successful check: ${
              lastSuccessfulCheck ?? "unknown"
            }\n\nInspect disabled schedules, workflow errors, GitHub App credentials, and the maintenance-state report. Pending updates must stay pending.`,
          }));
        console.error("upstream_check_overdue", { lastSuccessfulCheck });
        return issue.number;
      },
      closeIncident: async (number) => {
        await github(
          env,
          `/issues/${number}`,
          { state: "closed", state_reason: "completed" },
          "PATCH"
        );
      },
    });
    ctx.blockConcurrencyWhile(() => this.watchdog.ensureAlarm());
  }
  async check() {
    return this.watchdog.check();
  }
  async alarm() {
    await this.watchdog.alarm();
  }
  async dispatch(delivery: string) {
    // Serialized Durable Object storage prevents duplicate dispatch from concurrent webhook deliveries.
    return this.ctx.blockConcurrencyWhile(async () => {
      const seen = await this.ctx.storage.get<number>("delivery:" + delivery);
      if (seen) return false;
      await github(this.env, "/actions/workflows/upstream.yml/dispatches", {
        ref: "main",
      });
      await this.ctx.storage.put("delivery:" + delivery, Date.now());
      for (const [key, value] of await this.ctx.storage.list<number>({
        prefix: "delivery:",
      }))
        if (Date.now() - value > 7 * 86400_000)
          await this.ctx.storage.delete(key);
      return true;
    });
  }
  async status() {
    return this.watchdog.status();
  }
}
export default {
  async fetch(request: Request, env: Env) {
    const path = new URL(request.url).pathname;
    const maintenance = env.MAINTENANCE.get(
      env.MAINTENANCE.idFromName("upstream")
    );
    if (path === "/status") return Response.json(await maintenance.status());
    if (path === "/webhooks/upstream" && request.method === "POST") {
      if (Number(request.headers.get("content-length") ?? 0) > 2 * 1024 * 1024)
        return new Response("Too large", { status: 413 });
      const bytes = await request.arrayBuffer();
      if (bytes.byteLength > 2 * 1024 * 1024)
        return new Response("Too large", { status: 413 });
      if (
        !env.UPSTREAM_WEBHOOK_SECRET ||
        !(await validSignature(
          bytes,
          request.headers.get("x-hub-signature-256"),
          env.UPSTREAM_WEBHOOK_SECRET
        ))
      )
        return new Response("Invalid signature", { status: 401 });
      const payload = JSON.parse(new TextDecoder().decode(bytes));
      if (
        !env.UPSTREAM_REPOSITORY_IDS.split(",").includes(
          String(payload.repository?.id)
        )
      )
        return new Response("Unknown repository", { status: 403 });
      const delivery = request.headers.get("x-github-delivery");
      if (!delivery || !/^[a-zA-Z0-9-]{1,100}$/.test(delivery))
        return new Response("Invalid delivery", { status: 400 });
      if (
        !["push", "release", "pull_request", "repository"].includes(
          request.headers.get("x-github-event") ?? ""
        )
      )
        return new Response("Ignored", { status: 202 });
      await maintenance.dispatch(delivery);
      return new Response("Accepted", { status: 202 });
    }
    return new Response("Not found", { status: 404 });
  },
  async scheduled(
    controller: ScheduledController,
    env: Env,
    ctx: ExecutionContext
  ) {
    // One stable container name, one PostgreSQL writer. Crons keep it awake; process failures restart on fetch.
    if (env.INDEXER_ENABLED === "true")
      ctx.waitUntil(
        getContainer(env.INDEXER, "active")
          .fetch("http://container/health")
          .then((response) => {
            if (!response.ok) throw new Error("Indexer health check failed");
          })
      );
    if (new Date(controller.scheduledTime).getUTCMinutes() % 15 === 0)
      ctx.waitUntil(
        env.MAINTENANCE.get(env.MAINTENANCE.idFromName("upstream")).check()
      );
  },
};
