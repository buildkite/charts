import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { createApp } from "../src/app.ts";
import { parseComputerProvider, type Config } from "../src/config.ts";
import { boxNameFor, isDangerousCommand } from "../src/computers/types.ts";
import { ComputerRegistry } from "../src/computers/registry.ts";
import type { ComputerAdapter } from "../src/computers/types.ts";
import { EventBus } from "../src/events.ts";
import { classifyCommand } from "../src/permissions.ts";
import { Store } from "../src/store.ts";
import type { Bot, ComputerStatus, ExecResult } from "../src/types.ts";

function testConfig(dataDir: string): Config {
  return {
    port: 0,
    host: "127.0.0.1",
    dataDir,
    defaultComputer: "docker",
    openaiBaseUrl: "http://127.0.0.1:9",
    openaiApiKey: "",
    openaiModel: "test-model",
    boxToken: "",
    boxApi: "https://ascii.dev/api/box/v1",
    macBridgeUrl: "",
    dockerImage: "wharf/computer:local",
    idleMs: 600000,
    authToken: "",
    signupAllowlist: [],
  };
}

class FakeDocker implements ComputerAdapter {
  readonly provider = "docker" as const;
  files = new Map<string, string>();
  lastCommand = "";
  async available() {
    return { ok: true };
  }
  async provision(bot: Bot): Promise<ComputerStatus> {
    return { provider: "docker", state: "running", ref: `wharf-bot-${bot.id.slice(0, 12)}`, joinUrl: null };
  }
  async status(bot: Bot) {
    return this.provision(bot);
  }
  async join(bot: Bot) {
    const status = await this.provision(bot);
    return { joinUrl: status.joinUrl, state: status.state };
  }
  async sleep(bot: Bot) {
    return { provider: "docker" as const, state: "paused" as const, ref: bot.computerRef, joinUrl: null };
  }
  async exec(_bot: Bot, command: string): Promise<ExecResult> {
    this.lastCommand = command;
    return { exitCode: 0, stdout: `ran:${command}`, stderr: "" };
  }
  async readFile(_bot: Bot, path: string) {
    return this.files.get(path) ?? "";
  }
  async writeFile(_bot: Bot, path: string, content: string) {
    this.files.set(path, content);
  }
}

describe("computer defaults", () => {
  it("defaults unknown providers to docker", () => {
    assert.equal(parseComputerProvider(undefined), "docker");
    assert.equal(parseComputerProvider("E2B"), "docker");
    assert.equal(parseComputerProvider("box"), "box");
    assert.equal(parseComputerProvider("mac"), "mac");
  });

  it("names Box VMs deterministically per bot", async () => {
    const a = await boxNameFor("11111111-aaaa-bbbb-cccc-ddddeeeeffff");
    const b = await boxNameFor("11111111-aaaa-bbbb-cccc-ddddeeeeffff");
    const c = await boxNameFor("22222222-aaaa-bbbb-cccc-ddddeeeeffff");
    assert.equal(a, b);
    assert.notEqual(a, c);
    assert.match(a, /^wharf-11111111-[0-9a-f]{6}$/);
  });

  it("gates dangerous shell", () => {
    assert.equal(isDangerousCommand("sudo rm -rf /"), true);
    assert.equal(classifyCommand("ls"), "allow");
    assert.equal(classifyCommand("rm -rf /tmp/x"), "ask");
  });
});

describe("wharf api", () => {
  let dir: string;
  let store: Store;
  let app: ReturnType<typeof createApp>["app"];

  before(() => {
    dir = mkdtempSync(join(tmpdir(), "wharf-"));
    const config = testConfig(dir);
    store = new Store(config);
    const computers = new ComputerRegistry(config, { docker: new FakeDocker() });
    ({ app } = createApp({ config, store, computers, events: new EventBus() }));
  });

  after(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("reports docker as the default computer", async () => {
    const res = await app.request("/health");
    const body = await res.json();
    assert.equal(body.computerDefault, "docker");
    assert.equal(body.product, "wharf");
    assert.equal(body.sandbox, "docker");
  });

  it("creates bots on docker computers by default", async () => {
    const res = await app.request("/api/bots", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Ops" }),
    });
    assert.equal(res.status, 201);
    const body = await res.json();
    assert.equal(body.bot.computerProvider, "docker");
    assert.equal(body.computer.provider, "docker");
    assert.equal(body.computer.state, "running");
  });

  it("runs a turn and seals a receipt", async () => {
    const created = await app.request("/api/bots", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Research" }),
    });
    const bot = (await created.json()).bot;
    const turn = await app.request(`/api/bots/${bot.id}/turns`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "Say hello and stop." }),
    });
    assert.equal(turn.status, 200);
    const body = await turn.json();
    assert.equal(body.receipt.computer, "docker");
    assert.ok(["complete", "failed", "blocked"].includes(body.receipt.status));
    assert.ok(body.receipt.sealedAt);
    assert.ok(body.message.text.length > 0);
  });

  it("can switch a bot to box or mac without dropping the roster", async () => {
    const created = await app.request("/api/bots", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Coder" }),
    });
    const bot = (await created.json()).bot;
    const patched = await app.request(`/api/bots/${bot.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ computerProvider: "box" }),
    });
    const next = await patched.json();
    assert.equal(next.computerProvider, "box");
    const back = await app.request(`/api/bots/${bot.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ computerProvider: "mac" }),
    });
    assert.equal((await back.json()).computerProvider, "mac");
  });
});
