import type { Config } from "../config.ts";
import type { Bot, ComputerStatus, ExecResult } from "../types.ts";
import { boxNameFor, type ComputerAdapter } from "./types.ts";

const READY = new Set(["idle", "ready", "running"]);

interface BoxRecord {
  id: string;
  name?: string;
  state?: string;
  desktopAvailable?: boolean;
}

export class BoxComputer implements ComputerAdapter {
  readonly provider = "box" as const;

  constructor(
    private readonly config: Config,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async available() {
    if (!this.config.boxToken) return { ok: false, reason: "BOX_TOKEN not set" };
    return { ok: true };
  }

  async provision(bot: Bot): Promise<ComputerStatus> {
    const avail = await this.available();
    if (!avail.ok) {
      return { provider: "box", state: "unavailable", ref: null, joinUrl: null, reason: avail.reason };
    }
    const vmName = await boxNameFor(bot.id);
    let box = await this.findBox(bot.id);
    if (!box) {
      const created = await this.json("/boxes", {
        method: "POST",
        body: JSON.stringify({ ttlSeconds: 8 * 60 * 60 }),
      });
      box = created.body?.box;
      if (!box?.id) throw new Error(`box create failed (${created.status})`);
      await this.json(`/boxes/${box.id}`, { method: "PATCH", body: JSON.stringify({ name: vmName }) });
    }
    const ready = await this.waitReady(box.id);
    if (!ready) throw new Error("box did not become ready within 90s");
    const joinUrl = await this.mintDesktopUrl(box.id);
    return { provider: "box", state: "running", ref: box.id, joinUrl };
  }

  async status(bot: Bot): Promise<ComputerStatus> {
    const avail = await this.available();
    if (!avail.ok) return { provider: "box", state: "unavailable", ref: null, joinUrl: null, reason: avail.reason };
    const box = await this.findBox(bot.id);
    if (!box) return { provider: "box", state: "missing", ref: null, joinUrl: null };
    const state = READY.has(box.state ?? "") ? "running" : box.state === "archived" ? "archived" : "provisioning";
    return { provider: "box", state, ref: box.id, joinUrl: null };
  }

  async join(bot: Bot) {
    const box = await this.findBox(bot.id);
    if (!box) throw new Error("no Box VM yet — provision it first");
    const ready = await this.waitReady(box.id);
    if (!ready) throw new Error("the box did not wake in time");
    return { joinUrl: await this.mintDesktopUrl(box.id), state: "running" as const };
  }

  async sleep(bot: Bot): Promise<ComputerStatus> {
    const avail = await this.available();
    if (!avail.ok) {
      return { provider: "box", state: "unavailable", ref: bot.computerRef, joinUrl: null, reason: avail.reason };
    }
    const box = await this.findBox(bot.id);
    if (!box) throw new Error("no computer for this bot");
    await this.json(`/boxes/${box.id}/stop`, { method: "POST" });
    return { provider: "box", state: "archived", ref: box.id, joinUrl: null };
  }

  async exec(bot: Bot, command: string): Promise<ExecResult> {
    const box = await this.findBox(bot.id);
    if (!box) throw new Error("no Box VM for this bot");
    await this.waitReady(box.id, 60_000);
    const res = await this.fetchImpl(`${this.config.boxApi}/boxes/${box.id}/commands`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ command }),
      signal: AbortSignal.timeout(120_000),
    });
    const body: { exitCode?: number; stdout?: string; stderr?: string } = await res.json().catch(() => ({}));
    return { exitCode: body.exitCode ?? (res.ok ? 0 : 1), stdout: body.stdout ?? "", stderr: body.stderr ?? "" };
  }

  async readFile(bot: Bot, path: string): Promise<string> {
    const box = await this.findBox(bot.id);
    if (!box) throw new Error("no Box VM");
    const { body } = await this.json(`/boxes/${box.id}/files?path=${encodeURIComponent(path)}&encoding=utf8`);
    if (typeof body?.content !== "string") throw new Error("could not read file from box");
    return body.content;
  }

  async writeFile(bot: Bot, path: string, content: string): Promise<void> {
    const box = await this.findBox(bot.id);
    if (!box) throw new Error("no Box VM");
    const result = await this.exec(bot, `mkdir -p "$(dirname ${shellQuote(path)})" && cat > ${shellQuote(path)} <<'WHARF_EOF'\n${content}\nWHARF_EOF`);
    if (result.exitCode !== 0) throw new Error(result.stderr || "write failed");
  }

  private headers(): Record<string, string> {
    return { authorization: `Bearer ${this.config.boxToken}`, "content-type": "application/json" };
  }

  private async json(path: string, opts: RequestInit = {}) {
    const res = await this.fetchImpl(`${this.config.boxApi}${path}`, { ...opts, headers: { ...this.headers(), ...(opts.headers ?? {}) } });
    const body: any = await res.json().catch(() => null);
    return { ok: res.ok && body?.ok !== false, status: res.status, body };
  }

  private async findBox(botId: string): Promise<BoxRecord | null> {
    const name = await boxNameFor(botId);
    const { body } = await this.json("/boxes");
    return (body?.boxes ?? []).find((b: BoxRecord) => b.name === name && b.state !== "error") ?? null;
  }

  private async waitReady(boxId: string, budgetMs = 90_000): Promise<BoxRecord | null> {
    const t0 = Date.now();
    while (Date.now() - t0 < budgetMs) {
      const { body } = await this.json(`/boxes/${boxId}`);
      const box = body?.box as BoxRecord | undefined;
      const state = box?.state;
      if (state && READY.has(state)) return box ?? null;
      if (state === "error") return null;
      if (state === "archived") await this.json(`/boxes/${boxId}/resume`, { method: "POST" });
      await new Promise((r) => setTimeout(r, 2500));
    }
    return null;
  }

  private async mintDesktopUrl(boxId: string, vncBudgetMs = 60_000): Promise<string | null> {
    const t0 = Date.now();
    while (Date.now() - t0 < vncBudgetMs) {
      const { body } = await this.json(`/boxes/${boxId}/desktop?vnc=1`, { method: "POST" });
      const url = body?.desktopUrl ?? body?.url;
      if (url) return url;
      if (!body?.provisioning) break;
      await new Promise((r) => setTimeout(r, 3000));
    }
    const { body } = await this.json(`/boxes/${boxId}/desktop`, { method: "POST" });
    return body?.desktopUrl ?? body?.url ?? null;
  }
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}
