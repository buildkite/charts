import type { Config } from "../config.ts";
import type { ComputerRegistry } from "../computers/registry.ts";
import type { EventBus } from "../events.ts";
import { newId, nowIso } from "../ids.ts";
import { complete, TOOLS, type ChatMessage } from "../models.ts";
import { classifyCommand, pendingApproval } from "../permissions.ts";
import { loadSkills } from "../skills.ts";
import type { Store } from "../store.ts";
import type { Bot, Receipt, ReceiptStep } from "../types.ts";

export interface TurnInput {
  bot: Bot;
  text: string;
  depth?: number;
  fromBotId?: string;
}

const MAX_DEPTH = 1;
const MAX_TOOL_ITERS = 8;

export class Runtime {
  constructor(
    private readonly config: Config,
    private readonly store: Store,
    private readonly computers: ComputerRegistry,
    private readonly events: EventBus,
    private readonly waitForApproval: (id: string) => Promise<"allow" | "deny">,
  ) {}

  async runTurn(input: TurnInput): Promise<{ text: string; receipt: Receipt }> {
    const { bot } = input;
    const turnId = newId();
    const receipt: Receipt = {
      id: newId(),
      botId: bot.id,
      turnId,
      status: "running",
      steps: [],
      costUsd: 0,
      model: bot.model,
      computer: bot.computerProvider,
      createdAt: nowIso(),
      sealedAt: null,
    };
    this.store.saveReceipt(receipt);
    this.events.emit({ type: "receipt", botId: bot.id, payload: receipt });

    const computer = await this.computers.provision(bot);
    if (bot.computerRef !== computer.ref) {
      this.store.updateBot(bot.id, { computerRef: computer.ref });
      bot.computerRef = computer.ref;
    }
    this.addStep(receipt, {
      id: newId(),
      tool: "computer",
      summary: `Wake ${bot.computerProvider} (${computer.state})`,
      ok: computer.state === "running" || computer.state === "unavailable",
      output: computer.reason,
    });

    const skills = loadSkills(this.config.dataDir);
    const memory = this.store.listMemory(bot.id);
    const history = this.store.listMessages(bot.id).slice(-24);

    const messages: ChatMessage[] = [
      {
        role: "system",
        content: systemPrompt(bot, computer.reason, memory.map((m) => `${m.kind}: ${m.text}`), skills.map((s) => `${s.id} — ${s.description}`)),
      },
      ...history
        .filter((m) => m.role === "user" || m.role === "assistant")
        .map((m) => ({ role: m.role as "user" | "assistant", content: m.text })),
      { role: "user", content: input.text },
    ];

    let finalText = "";
    try {
      for (let i = 0; i < MAX_TOOL_ITERS; i++) {
        const result = await complete(this.config, { model: bot.model, messages, tools: TOOLS });
        if (result.usage) {
          receipt.costUsd += (result.usage.prompt * 0.00000015) + (result.usage.completion * 0.0000006);
        }
        if (result.toolCalls.length === 0) {
          finalText = result.text.trim() || "(no reply)";
          break;
        }
        messages.push({
          role: "assistant",
          content: result.text || "",
          tool_calls: result.toolCalls.map((call) => ({
            id: call.id,
            type: "function" as const,
            function: { name: call.name, arguments: call.arguments },
          })),
        });
        for (const call of result.toolCalls) {
          const args = safeJson(call.arguments);
          const { output, blocked } = await this.runTool(bot, turnId, receipt, call.name, args, input.depth ?? 0);
          messages.push({
            role: "tool",
            name: call.name,
            tool_call_id: call.id,
            content: output,
          });
          if (blocked) {
            receipt.status = "blocked";
            finalText = output;
            this.seal(receipt);
            return { text: finalText, receipt };
          }
        }
      }
      if (!finalText) finalText = "Turn stopped after too many tool calls.";
      receipt.status = "complete";
    } catch (err) {
      receipt.status = "failed";
      finalText = err instanceof Error ? err.message : String(err);
      this.addStep(receipt, { id: newId(), tool: "runtime", summary: "Turn failed", ok: false, error: finalText });
    }
    this.seal(receipt);
    return { text: finalText, receipt };
  }

  private async runTool(
    bot: Bot,
    turnId: string,
    receipt: Receipt,
    name: string,
    args: Record<string, unknown>,
    depth: number,
  ): Promise<{ output: string; blocked: boolean }> {
    try {
      if (name === "shell") {
        const command = String(args.command ?? "");
        const decision = classifyCommand(command);
        if (decision === "ask") {
          const approval = pendingApproval({
            botId: bot.id,
            turnId,
            tool: "shell",
            summary: command.slice(0, 200),
            command,
          });
          this.store.addApproval(approval);
          this.events.emit({ type: "approval", botId: bot.id, payload: approval });
          this.addStep(receipt, {
            id: newId(),
            tool: "shell",
            summary: command.slice(0, 200),
            ok: false,
            gated: true,
          });
          const resolved = await this.waitForApproval(approval.id);
          if (resolved === "deny") {
            return { output: "Operator denied this command.", blocked: true };
          }
        }
        const result = await this.computers.exec(bot, command);
        const output = clip(`exit ${result.exitCode}\n${result.stdout}\n${result.stderr}`);
        this.addStep(receipt, { id: newId(), tool: "shell", summary: command.slice(0, 200), ok: result.exitCode === 0, output });
        return { output, blocked: false };
      }
      if (name === "read_file") {
        const path = String(args.path ?? "");
        const output = clip(await this.computers.readFile(bot, path));
        this.addStep(receipt, { id: newId(), tool: "read_file", summary: path, ok: true, output });
        return { output, blocked: false };
      }
      if (name === "write_file") {
        const path = String(args.path ?? "");
        const content = String(args.content ?? "");
        const approval = pendingApproval({
          botId: bot.id,
          turnId,
          tool: "write_file",
          summary: `Write ${path}`,
          command: path,
        });
        this.store.addApproval(approval);
        this.events.emit({ type: "approval", botId: bot.id, payload: approval });
        const resolved = await this.waitForApproval(approval.id);
        if (resolved === "deny") return { output: "Operator denied the write.", blocked: true };
        await this.computers.writeFile(bot, path, content);
        this.addStep(receipt, { id: newId(), tool: "write_file", summary: path, ok: true });
        return { output: `wrote ${path}`, blocked: false };
      }
      if (name === "remember") {
        const kind = (args.kind as "fact" | "preference" | "correction") ?? "fact";
        const text = String(args.text ?? "");
        this.store.addMemory(bot.id, kind, text);
        this.addStep(receipt, { id: newId(), tool: "remember", summary: text.slice(0, 160), ok: true });
        return { output: "remembered", blocked: false };
      }
      if (name === "ask_bot") {
        if (depth >= MAX_DEPTH) {
          return { output: "ask_bot recursion blocked.", blocked: false };
        }
        const botName = String(args.botName ?? "");
        const question = String(args.question ?? "");
        const peer = this.store.listBots().find((b) => b.name.toLowerCase() === botName.toLowerCase() || b.id === botName);
        if (!peer) return { output: `no bot named ${botName}`, blocked: false };
        if (peer.id === bot.id) return { output: "cannot ask yourself", blocked: false };
        const nested = await this.runTurn({ bot: peer, text: `From ${bot.name}: ${question}`, depth: depth + 1, fromBotId: bot.id });
        this.addStep(receipt, { id: newId(), tool: "ask_bot", summary: `${peer.name}: ${question.slice(0, 80)}`, ok: true, output: nested.text });
        return { output: nested.text, blocked: false };
      }
      if (name === "use_skill") {
        const skillId = String(args.skillId ?? "");
        const skill = loadSkills(this.config.dataDir).find((s) => s.id === skillId);
        if (!skill) return { output: `unknown skill ${skillId}`, blocked: false };
        this.addStep(receipt, { id: newId(), tool: "use_skill", summary: skill.name, ok: true });
        return { output: skill.body, blocked: false };
      }
      return { output: `unknown tool ${name}`, blocked: false };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      this.addStep(receipt, { id: newId(), tool: name, summary: name, ok: false, error });
      return { output: error, blocked: false };
    }
  }

  private addStep(receipt: Receipt, step: ReceiptStep) {
    receipt.steps.push(step);
    this.store.saveReceipt(receipt);
    this.events.emit({ type: "receipt", botId: receipt.botId, payload: receipt });
  }

  private seal(receipt: Receipt) {
    receipt.sealedAt = nowIso();
    this.store.saveReceipt(receipt);
    this.events.emit({ type: "receipt", botId: receipt.botId, payload: receipt });
  }
}

function systemPrompt(bot: Bot, computerNote: string | undefined, memory: string[], skills: string[]): string {
  return [
    `You are ${bot.name}${bot.title ? `, ${bot.title}` : ""}.`,
    bot.persona || "You are a teammate with a computer. Do the work. Do not pretend.",
    `Computer provider: ${bot.computerProvider} (default fleet computer is docker). ${computerNote ?? ""}`,
    "A blocked run stays blocked. Never label partial work complete.",
    "Ask before destructive shell or file writes — the harness will gate them.",
    memory.length ? `Memory:\n- ${memory.join("\n- ")}` : "No stored memory yet.",
    skills.length ? `Skills:\n- ${skills.join("\n- ")}` : "No skills installed.",
  ].join("\n\n");
}

function safeJson(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function clip(text: string, max = 8000): string {
  return text.length > max ? `${text.slice(0, max)}\n…truncated` : text;
}
