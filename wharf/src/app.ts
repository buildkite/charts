import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { ApprovalBroker } from "./broker.ts";
import { ComputerRegistry } from "./computers/registry.ts";
import { parseComputerProvider, type Config } from "./config.ts";
import { EventBus } from "./events.ts";
import { Runtime } from "./runtime/turn.ts";
import { loadSkills } from "./skills.ts";
import type { Store } from "./store.ts";

export function createApp(opts: { config: Config; store: Store; computers: ComputerRegistry; events: EventBus }) {
  const { config, store, computers, events } = opts;
  const broker = new ApprovalBroker();
  const runtime = new Runtime(config, store, computers, events, (id) => broker.wait(id));
  const app = new Hono();

  app.use("/api/*", async (c, next) => {
    if (!config.authToken) return next();
    const header = c.req.header("authorization") ?? "";
    if (header === `Bearer ${config.authToken}`) return next();
    return c.json({ error: "unauthorized" }, 401);
  });

  app.get("/health", async (c) => {
    const catalog = await computers.catalog();
    return c.json({
      ok: true,
      product: "wharf",
      runtime: "openai-compatible",
      computerDefault: config.defaultComputer,
      sandbox: catalog.options.find((o) => o.id === "docker")?.available ? "docker" : "none",
      wakeup: "inline",
      box: catalog.options.find((o) => o.id === "box")?.available ?? false,
      mac: catalog.options.find((o) => o.id === "mac")?.available ?? false,
    });
  });

  app.get("/api/settings", async (c) => {
    const catalog = await computers.catalog();
    return c.json({
      openaiBaseUrl: config.openaiBaseUrl,
      openaiModel: config.openaiModel,
      openaiKeyConfigured: Boolean(config.openaiApiKey),
      boxConfigured: Boolean(config.boxToken),
      macConfigured: Boolean(config.macBridgeUrl),
      dockerAvailable: catalog.options.find((o) => o.id === "docker")?.available ?? false,
      defaultComputer: config.defaultComputer,
      computers: catalog,
    });
  });

  app.get("/api/skills", (c) => c.json(loadSkills(config.dataDir)));

  app.get("/api/bots", (c) => c.json(store.listBots()));

  app.post("/api/bots", async (c) => {
    const body = await c.req.json();
    const name = String(body.name ?? "").trim();
    if (!name) return c.json({ error: "name required" }, 400);
    const bot = store.createBot({
      name,
      title: String(body.title ?? ""),
      persona: String(body.persona ?? ""),
      model: String(body.model ?? config.openaiModel),
      computerProvider: parseComputerProvider(body.computerProvider ?? config.defaultComputer),
    });
    const computer = await computers.provision(bot);
    const saved = store.updateBot(bot.id, { computerRef: computer.ref });
    events.emit({ type: "computer", botId: bot.id, payload: computer });
    return c.json({ bot: saved, computer }, 201);
  });

  app.patch("/api/bots/:id", async (c) => {
    const bot = store.getBot(c.req.param("id"));
    if (!bot) return c.json({ error: "not found" }, 404);
    const body = await c.req.json();
    const nextProvider = body.computerProvider
      ? parseComputerProvider(body.computerProvider)
      : bot.computerProvider;
    if (nextProvider !== bot.computerProvider) {
      try {
        const current = computers.get(bot.computerProvider);
        if ((await current.available()).ok) await computers.sleep(bot);
      } catch {
        /* old computer may not exist */
      }
    }
    const updated = store.updateBot(bot.id, {
      name: body.name ?? bot.name,
      title: body.title ?? bot.title,
      persona: body.persona ?? bot.persona,
      model: body.model ?? bot.model,
      computerProvider: nextProvider,
      pinned: body.pinned ?? bot.pinned,
      archived: body.archived ?? bot.archived,
      computerRef: nextProvider === bot.computerProvider ? bot.computerRef : null,
    });
    return c.json(updated);
  });

  app.get("/api/bots/:id/messages", (c) => {
    const bot = store.getBot(c.req.param("id"));
    if (!bot) return c.json({ error: "not found" }, 404);
    return c.json(store.listMessages(bot.id));
  });

  app.get("/api/bots/:id/memory", (c) => {
    const bot = store.getBot(c.req.param("id"));
    if (!bot) return c.json({ error: "not found" }, 404);
    return c.json(store.listMemory(bot.id));
  });

  app.get("/api/bots/:id/receipts", (c) => {
    const bot = store.getBot(c.req.param("id"));
    if (!bot) return c.json({ error: "not found" }, 404);
    return c.json(store.listReceipts(bot.id));
  });

  app.get("/api/bots/:id/computer", async (c) => {
    const bot = store.getBot(c.req.param("id"));
    if (!bot) return c.json({ error: "not found" }, 404);
    return c.json(await computers.status(bot));
  });

  app.post("/api/bots/:id/computer/provision", async (c) => {
    const bot = store.getBot(c.req.param("id"));
    if (!bot) return c.json({ error: "not found" }, 404);
    const status = await computers.provision(bot);
    store.updateBot(bot.id, { computerRef: status.ref });
    events.emit({ type: "computer", botId: bot.id, payload: status });
    return c.json(status);
  });

  app.post("/api/bots/:id/computer/join", async (c) => {
    const bot = store.getBot(c.req.param("id"));
    if (!bot) return c.json({ error: "not found" }, 404);
    const joined = await computers.join(bot);
    events.emit({ type: "computer", botId: bot.id, payload: joined });
    return c.json(joined);
  });

  app.post("/api/bots/:id/computer/sleep", async (c) => {
    const bot = store.getBot(c.req.param("id"));
    if (!bot) return c.json({ error: "not found" }, 404);
    const status = await computers.sleep(bot);
    events.emit({ type: "computer", botId: bot.id, payload: status });
    return c.json(status);
  });

  app.post("/api/bots/:id/turns", async (c) => {
    const bot = store.getBot(c.req.param("id"));
    if (!bot) return c.json({ error: "not found" }, 404);
    const body = await c.req.json();
    const text = String(body.text ?? "").trim();
    if (!text) return c.json({ error: "text required" }, 400);
    const userMsg = store.addMessage({ botId: bot.id, role: "user", text });
    events.emit({ type: "message", botId: bot.id, payload: userMsg });
    const { text: reply, receipt } = await runtime.runTurn({ bot, text });
    const assistant = store.addMessage({
      botId: bot.id,
      role: "assistant",
      text: reply,
      meta: { receiptId: receipt.id, status: receipt.status },
    });
    events.emit({ type: "message", botId: bot.id, payload: assistant });
    events.emit({ type: "turn.completed", botId: bot.id, payload: { receipt } });
    return c.json({ message: assistant, receipt });
  });

  app.get("/api/approvals", (c) => c.json(store.pendingApprovals()));

  app.post("/api/approvals/:id", async (c) => {
    const approval = store.getApproval(c.req.param("id"));
    if (!approval) return c.json({ error: "not found" }, 404);
    const body = await c.req.json();
    const decision = body.decision === "allow" ? "allow" : "deny";
    const updated = store.setApproval(approval.id, decision);
    broker.resolve(updated, decision);
    events.emit({ type: "approval", botId: updated.botId, payload: updated });
    return c.json(updated);
  });

  app.get("/api/routines", (c) => c.json(store.listRoutines()));

  app.post("/api/routines", async (c) => {
    const body = await c.req.json();
    const bot = store.getBot(String(body.botId ?? ""));
    if (!bot) return c.json({ error: "bot not found" }, 404);
    const routine = store.createRoutine({
      botId: bot.id,
      name: String(body.name ?? "Routine"),
      prompt: String(body.prompt ?? ""),
      everyMs: Number(body.everyMs ?? 3_600_000),
      enabled: body.enabled !== false,
    });
    return c.json(routine, 201);
  });

  app.get("/api/events", (c) => {
    return streamSSE(c, async (stream) => {
      let open = true;
      const unsub = events.subscribe(async (event) => {
        if (!open) return;
        await stream.writeSSE({ event: event.type, data: JSON.stringify(event) });
      });
      await stream.writeSSE({ event: "hello", data: JSON.stringify({ ok: true }) });
      await new Promise<void>((resolve) => {
        stream.onAbort(() => {
          open = false;
          unsub();
          resolve();
        });
      });
    });
  });

  app.get("/*", async (c) => {
    const dist = join(process.cwd(), "web", "dist");
    const url = new URL(c.req.url);
    let path = url.pathname === "/" ? "/index.html" : url.pathname;
    const file = join(dist, path);
    if (existsSync(file) && file.startsWith(dist)) {
      const body = readFileSync(file);
      const type = path.endsWith(".js")
        ? "text/javascript"
        : path.endsWith(".css")
          ? "text/css"
          : path.endsWith(".svg")
            ? "image/svg+xml"
            : "text/html";
      return c.body(body, 200, { "content-type": type });
    }
    const index = join(dist, "index.html");
    if (existsSync(index)) return c.html(readFileSync(index, "utf8"));
    return c.html(devShell(config.port));
  });

  return { app, runtime, broker };
}

function devShell(port: number): string {
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Wharf</title>
<style>body{font-family:ui-sans-serif;background:#0b1220;color:#e2e8f0;padding:48px}</style>
</head><body>
<h1>Wharf API is running</h1>
<p>Web UI is not built yet. In another terminal:</p>
<pre>cd wharf && pnpm dev:web</pre>
<p>API: <a href="http://127.0.0.1:${port}/health">/health</a></p>
</body></html>`;
}

export function listen(config: Config, app: ReturnType<typeof createApp>["app"]) {
  return serve({ fetch: app.fetch, hostname: config.host, port: config.port });
}
