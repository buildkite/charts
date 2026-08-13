import type { Config } from "../config.ts";
import type { Bot, ComputerStatus, ExecResult } from "../types.ts";
import type { ComputerAdapter } from "./types.ts";

/**
 * This Mac — OpenMausBot-style local computer.
 * The API never drives the Mac directly. Electron (or a companion) hosts
 * the CUA / screen-capture bridge and Wharf only talks to that loopback URL.
 */
export class MacComputer implements ComputerAdapter {
  readonly provider = "mac" as const;

  constructor(
    private readonly config: Config,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async available() {
    if (!this.config.macBridgeUrl) {
      return { ok: false, reason: "Mac bridge not connected — open the Wharf Mac app" };
    }
    try {
      const res = await this.fetchImpl(new URL("/health", this.config.macBridgeUrl), { signal: AbortSignal.timeout(2000) });
      if (!res.ok) return { ok: false, reason: "Mac bridge unhealthy" };
      return { ok: true };
    } catch {
      return { ok: false, reason: "Mac bridge not reachable" };
    }
  }

  async provision(bot: Bot): Promise<ComputerStatus> {
    const avail = await this.available();
    if (!avail.ok) return { provider: "mac", state: "unavailable", ref: "local-mac", joinUrl: null, reason: avail.reason };
    return { provider: "mac", state: "running", ref: "local-mac", joinUrl: this.config.macBridgeUrl };
  }

  async status(bot: Bot): Promise<ComputerStatus> {
    return this.provision(bot);
  }

  async join(bot: Bot) {
    const status = await this.provision(bot);
    return { joinUrl: status.joinUrl, state: status.state };
  }

  async sleep(_bot: Bot): Promise<ComputerStatus> {
    return { provider: "mac", state: "paused", ref: "local-mac", joinUrl: null, reason: "Mac stays yours; CUA disconnected" };
  }

  async exec(bot: Bot, command: string): Promise<ExecResult> {
    return this.bridge("/exec", { botId: bot.id, command });
  }

  async readFile(bot: Bot, path: string): Promise<string> {
    const result = await this.bridge("/read", { botId: bot.id, path });
    return result.stdout;
  }

  async writeFile(bot: Bot, path: string, content: string): Promise<void> {
    const result = await this.bridge("/write", { botId: bot.id, path, content });
    if (result.exitCode !== 0) throw new Error(result.stderr || "write failed");
  }

  private async bridge(path: string, body: Record<string, unknown>): Promise<ExecResult> {
    const avail = await this.available();
    if (!avail.ok) return { exitCode: 1, stdout: "", stderr: avail.reason ?? "mac unavailable" };
    const res = await this.fetchImpl(new URL(path, this.config.macBridgeUrl), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60_000),
    });
    const json: ExecResult = await res.json().catch(() => ({ exitCode: 1, stdout: "", stderr: "bad mac bridge response" }));
    return json;
  }
}
