import test from "node:test";
import assert from "node:assert/strict";
import { overdue, validSignature } from "../apps/supervisor/src/github";
import { createHmac } from "node:crypto";
import {
  CHECK_INTERVAL,
  MaintenanceWatchdog,
  type WatchdogStorage,
} from "../apps/supervisor/src/maintenance";

class Storage implements WatchdogStorage {
  values = new Map<string, unknown>();
  alarm: number | null = null;
  async get<T>(key: string) {
    return this.values.get(key) as T | undefined;
  }
  async put<T>(key: string, value: T) {
    this.values.set(key, value);
  }
  async delete(key: string) {
    return this.values.delete(key);
  }
  async getAlarm() {
    return this.alarm;
  }
  async setAlarm(time: number) {
    this.alarm = time;
  }
}

test("watchdog bootstraps without cron and exposes stale monitoring", async () => {
  let now = Date.now();
  const storage = new Storage();
  const watchdog = new MaintenanceWatchdog(storage, {
    now: () => now,
    readReport: async () => ({
      lastSuccessfulCheck: new Date(now).toISOString(),
    }),
    openIncident: async () => {
      throw new Error("unexpected incident");
    },
    closeIncident: async () => {},
  });
  await watchdog.ensureAlarm();
  assert.equal(storage.alarm, now + 1_000);
  assert.equal((await watchdog.status()).watchdogOverdue, true);
  await watchdog.alarm();
  assert.equal(storage.alarm, now + CHECK_INTERVAL);
  assert.equal((await watchdog.status()).overdue, false);
  now += 2 * CHECK_INTERVAL + 1;
  assert.equal((await watchdog.status()).watchdogOverdue, true);
  assert.equal((await watchdog.status()).overdue, true);
});

test("concurrent cron/alarm checks publish one incident and recover after GitHub failure", async () => {
  let now = Date.now();
  let report: { lastSuccessfulCheck?: string } = {};
  let opens = 0,
    closes = 0;
  const storage = new Storage();
  const watchdog = new MaintenanceWatchdog(storage, {
    now: () => now,
    readReport: async () => report,
    openIncident: async () => {
      opens++;
      if (opens === 1) throw new Error("GitHub unavailable");
      return 42;
    },
    closeIncident: async (number) => {
      assert.equal(number, 42);
      closes++;
    },
  });
  await assert.rejects(watchdog.alarm(), /GitHub unavailable/);
  assert.equal(storage.alarm, now + CHECK_INTERVAL);
  assert.equal((await watchdog.status()).overdue, true);
  now += CHECK_INTERVAL;
  await Promise.all([watchdog.alarm(), watchdog.check(), watchdog.check()]);
  assert.equal(opens, 2);
  await watchdog.check();
  assert.equal(opens, 2);
  report = { lastSuccessfulCheck: new Date(now).toISOString() };
  await Promise.all([watchdog.alarm(), watchdog.check()]);
  assert.equal(closes, 1);
  assert.equal((await watchdog.status()).overdue, false);
});
test("missed checks and forged webhooks are rejected", async () => {
  const now = Date.now();
  assert.equal(overdue({}, now), true);
  assert.equal(
    overdue(
      { lastSuccessfulCheck: new Date(now - 4 * 3600_000).toISOString() },
      now
    ),
    true
  );
  assert.equal(
    overdue({ lastSuccessfulCheck: new Date(now).toISOString() }, now),
    false
  );
  const body = new TextEncoder().encode('{"repository":{"id":123}}');
  const signature =
    "sha256=" + createHmac("sha256", "shared-key").update(body).digest("hex");
  assert.equal(
    await validSignature(body.buffer, signature, "shared-key"),
    true
  );
  assert.equal(
    await validSignature(body.buffer, signature, "wrong-key"),
    false
  );
  assert.equal(await validSignature(body.buffer, null, "shared-key"), false);
});
