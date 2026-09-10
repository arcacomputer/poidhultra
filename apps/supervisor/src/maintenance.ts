import { overdue } from "./github";

export const CHECK_INTERVAL = 15 * 60_000;
type Report = { lastSuccessfulCheck?: string | null };
type Status = {
  checkedAt: string | null;
  lastSuccessfulCheck: string | null;
  overdue: boolean;
};
export interface WatchdogStorage {
  get<T>(key: string): Promise<T | undefined>;
  put<T>(key: string, value: T): Promise<void>;
  delete(key: string): Promise<unknown>;
  getAlarm(): Promise<number | null>;
  setAlarm(time: number): Promise<void>;
}

// The Durable Object alarm is independent of Worker cron delivery. Neither an
// HTTP request nor a delayed cron is needed to keep an initialized watchdog alive.
export class MaintenanceWatchdog {
  private checking?: Promise<Status>;
  constructor(
    private storage: WatchdogStorage,
    private options: {
      readReport(): Promise<Report>;
      openIncident(lastSuccessfulCheck: string | null): Promise<number>;
      closeIncident(number: number): Promise<void>;
      now?: () => number;
    }
  ) {}
  private now() {
    return this.options.now?.() ?? Date.now();
  }
  async ensureAlarm() {
    if ((await this.storage.getAlarm()) === null)
      await this.storage.setAlarm(this.now() + 1_000);
  }
  async alarm() {
    // Keep the next check scheduled even if GitHub is unavailable or credentials
    // need repair. Cloudflare can also retry the failed alarm delivery.
    await this.storage.setAlarm(this.now() + CHECK_INTERVAL);
    return this.check();
  }
  check(): Promise<Status> {
    if (!this.checking)
      this.checking = this.runCheck().finally(() => {
        this.checking = undefined;
      });
    return this.checking;
  }
  private async runCheck(): Promise<Status> {
    let report: Report;
    try {
      report = await this.options.readReport();
    } catch {
      report = { lastSuccessfulCheck: null };
    }
    const state: Status = {
      checkedAt: new Date(this.now()).toISOString(),
      lastSuccessfulCheck: report.lastSuccessfulCheck ?? null,
      overdue: overdue(report, this.now()),
    };
    await this.storage.put("status", state);
    const issue = await this.storage.get<number>("incident");
    if (state.overdue && !issue) {
      const number = await this.options.openIncident(state.lastSuccessfulCheck);
      await this.storage.put("incident", number);
    } else if (!state.overdue && issue) {
      await this.options.closeIncident(issue);
      await this.storage.delete("incident");
    }
    return state;
  }
  async status() {
    const state = (await this.storage.get<Status>("status")) ?? {
      checkedAt: null,
      lastSuccessfulCheck: null,
      overdue: true,
    };
    const watchdogOverdue = overdue(
      { lastSuccessfulCheck: state.checkedAt },
      this.now(),
      CHECK_INTERVAL * 2
    );
    return {
      ...state,
      overdue: watchdogOverdue || overdue(state, this.now()),
      watchdogOverdue,
      nextCheckAt: await this.storage.getAlarm(),
    };
  }
}
