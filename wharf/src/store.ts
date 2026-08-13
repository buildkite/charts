import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Config } from "./config.ts";
import type {
  Approval,
  Bot,
  ComputerProvider,
  MemoryFact,
  Message,
  Receipt,
  Routine,
} from "./types.ts";
import { newId, nowIso } from "./ids.ts";

const COLORS = ["#5eead4", "#fbbf24", "#fb7185", "#a78bfa", "#38bdf8", "#f97316"];

export class Store {
  readonly db: DatabaseSync;

  constructor(config: Config) {
    mkdirSync(config.dataDir, { recursive: true });
    this.db = new DatabaseSync(join(config.dataDir, "wharf.sqlite"));
    this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec("PRAGMA foreign_keys = ON");
    this.migrate();
  }

  private migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS bots (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        title TEXT NOT NULL,
        persona TEXT NOT NULL,
        model TEXT NOT NULL,
        color TEXT NOT NULL,
        computer_provider TEXT NOT NULL,
        computer_ref TEXT,
        pinned INTEGER NOT NULL DEFAULT 0,
        archived INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        bot_id TEXT NOT NULL,
        role TEXT NOT NULL,
        text TEXT NOT NULL,
        created_at TEXT NOT NULL,
        meta TEXT,
        FOREIGN KEY (bot_id) REFERENCES bots(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS memory (
        id TEXT PRIMARY KEY,
        bot_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        text TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (bot_id) REFERENCES bots(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS receipts (
        id TEXT PRIMARY KEY,
        bot_id TEXT NOT NULL,
        turn_id TEXT NOT NULL,
        status TEXT NOT NULL,
        steps TEXT NOT NULL,
        cost_usd REAL NOT NULL DEFAULT 0,
        model TEXT NOT NULL,
        computer TEXT NOT NULL,
        created_at TEXT NOT NULL,
        sealed_at TEXT,
        FOREIGN KEY (bot_id) REFERENCES bots(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS approvals (
        id TEXT PRIMARY KEY,
        bot_id TEXT NOT NULL,
        turn_id TEXT NOT NULL,
        tool TEXT NOT NULL,
        summary TEXT NOT NULL,
        command TEXT,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS routines (
        id TEXT PRIMARY KEY,
        bot_id TEXT NOT NULL,
        name TEXT NOT NULL,
        prompt TEXT NOT NULL,
        every_ms INTEGER NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        last_run_at TEXT,
        FOREIGN KEY (bot_id) REFERENCES bots(id) ON DELETE CASCADE
      );
    `);
  }

  listBots(): Bot[] {
    const rows = this.db.prepare("SELECT * FROM bots WHERE archived = 0 ORDER BY pinned DESC, updated_at DESC").all();
    return rows.map(rowToBot);
  }

  getBot(id: string): Bot | null {
    const row = this.db.prepare("SELECT * FROM bots WHERE id = ?").get(id);
    return row ? rowToBot(row) : null;
  }

  createBot(input: {
    name: string;
    title?: string;
    persona?: string;
    model: string;
    computerProvider: ComputerProvider;
  }): Bot {
    const id = newId();
    const createdAt = nowIso();
    const color = COLORS[this.listBots().length % COLORS.length];
    this.db.prepare(
      `INSERT INTO bots (id, name, title, persona, model, color, computer_provider, computer_ref, pinned, archived, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, NULL, 0, 0, ?, ?)`,
    ).run(
      id,
      input.name,
      input.title ?? "",
      input.persona ?? "",
      input.model,
      color,
      input.computerProvider,
      createdAt,
      createdAt,
    );
    return this.getBot(id)!;
  }

  updateBot(id: string, patch: Partial<Pick<Bot, "name" | "title" | "persona" | "model" | "computerProvider" | "computerRef" | "pinned" | "archived">>): Bot {
    const bot = this.getBot(id);
    if (!bot) throw new Error("bot not found");
    const next: Bot = {
      ...bot,
      ...patch,
      updatedAt: nowIso(),
    };
    this.db.prepare(
      `UPDATE bots SET name=?, title=?, persona=?, model=?, computer_provider=?, computer_ref=?, pinned=?, archived=?, updated_at=? WHERE id=?`,
    ).run(
      next.name,
      next.title,
      next.persona,
      next.model,
      next.computerProvider,
      next.computerRef,
      next.pinned ? 1 : 0,
      next.archived ? 1 : 0,
      next.updatedAt,
      id,
    );
    return this.getBot(id)!;
  }

  listMessages(botId: string): Message[] {
    const rows = this.db.prepare("SELECT * FROM messages WHERE bot_id = ? ORDER BY created_at ASC").all(botId);
    return rows.map(rowToMessage);
  }

  addMessage(msg: Omit<Message, "id" | "createdAt"> & { id?: string; createdAt?: string }): Message {
    const full: Message = {
      id: msg.id ?? newId(),
      createdAt: msg.createdAt ?? nowIso(),
      botId: msg.botId,
      role: msg.role,
      text: msg.text,
      meta: msg.meta,
    };
    this.db.prepare("INSERT INTO messages (id, bot_id, role, text, created_at, meta) VALUES (?, ?, ?, ?, ?, ?)").run(
      full.id,
      full.botId,
      full.role,
      full.text,
      full.createdAt,
      full.meta ? JSON.stringify(full.meta) : null,
    );
    this.db.prepare("UPDATE bots SET updated_at = ? WHERE id = ?").run(full.createdAt, full.botId);
    return full;
  }

  listMemory(botId: string): MemoryFact[] {
    return this.db.prepare("SELECT * FROM memory WHERE bot_id = ? ORDER BY created_at DESC").all(botId).map(rowToMemory);
  }

  addMemory(botId: string, kind: MemoryFact["kind"], text: string): MemoryFact {
    const fact: MemoryFact = { id: newId(), botId, kind, text, createdAt: nowIso() };
    this.db.prepare("INSERT INTO memory (id, bot_id, kind, text, created_at) VALUES (?, ?, ?, ?, ?)").run(
      fact.id,
      botId,
      kind,
      text,
      fact.createdAt,
    );
    return fact;
  }

  saveReceipt(receipt: Receipt): Receipt {
    this.db.prepare(
      `INSERT INTO receipts (id, bot_id, turn_id, status, steps, cost_usd, model, computer, created_at, sealed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET status=excluded.status, steps=excluded.steps, cost_usd=excluded.cost_usd, sealed_at=excluded.sealed_at`,
    ).run(
      receipt.id,
      receipt.botId,
      receipt.turnId,
      receipt.status,
      JSON.stringify(receipt.steps),
      receipt.costUsd,
      receipt.model,
      receipt.computer,
      receipt.createdAt,
      receipt.sealedAt,
    );
    return receipt;
  }

  getReceipt(id: string): Receipt | null {
    const row = this.db.prepare("SELECT * FROM receipts WHERE id = ?").get(id);
    return row ? rowToReceipt(row) : null;
  }

  listReceipts(botId: string): Receipt[] {
    return this.db.prepare("SELECT * FROM receipts WHERE bot_id = ? ORDER BY created_at DESC LIMIT 50").all(botId).map(rowToReceipt);
  }

  addApproval(approval: Approval): Approval {
    this.db.prepare(
      `INSERT INTO approvals (id, bot_id, turn_id, tool, summary, command, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      approval.id,
      approval.botId,
      approval.turnId,
      approval.tool,
      approval.summary,
      approval.command ?? null,
      approval.status,
      approval.createdAt,
    );
    return approval;
  }

  getApproval(id: string): Approval | null {
    const row = this.db.prepare("SELECT * FROM approvals WHERE id = ?").get(id);
    return row ? rowToApproval(row) : null;
  }

  setApproval(id: string, status: "allow" | "deny"): Approval {
    this.db.prepare("UPDATE approvals SET status = ? WHERE id = ?").run(status, id);
    return this.getApproval(id)!;
  }

  pendingApprovals(botId?: string): Approval[] {
    const sql = botId
      ? "SELECT * FROM approvals WHERE status = 'pending' AND bot_id = ? ORDER BY created_at ASC"
      : "SELECT * FROM approvals WHERE status = 'pending' ORDER BY created_at ASC";
    const rows = botId ? this.db.prepare(sql).all(botId) : this.db.prepare(sql).all();
    return rows.map(rowToApproval);
  }

  listRoutines(): Routine[] {
    return this.db.prepare("SELECT * FROM routines ORDER BY name").all().map(rowToRoutine);
  }

  createRoutine(input: Omit<Routine, "id" | "lastRunAt">): Routine {
    const routine: Routine = { ...input, id: newId(), lastRunAt: null };
    this.db.prepare(
      `INSERT INTO routines (id, bot_id, name, prompt, every_ms, enabled, last_run_at) VALUES (?, ?, ?, ?, ?, ?, NULL)`,
    ).run(routine.id, routine.botId, routine.name, routine.prompt, routine.everyMs, routine.enabled ? 1 : 0);
    return routine;
  }

  touchRoutine(id: string) {
    this.db.prepare("UPDATE routines SET last_run_at = ? WHERE id = ?").run(nowIso(), id);
  }

  close() {
    this.db.close();
  }
}

function rowToBot(row: Record<string, unknown>): Bot {
  return {
    id: String(row.id),
    name: String(row.name),
    title: String(row.title),
    persona: String(row.persona),
    model: String(row.model),
    color: String(row.color),
    computerProvider: row.computer_provider as ComputerProvider,
    computerRef: row.computer_ref ? String(row.computer_ref) : null,
    pinned: Boolean(row.pinned),
    archived: Boolean(row.archived),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function rowToMessage(row: Record<string, unknown>): Message {
  return {
    id: String(row.id),
    botId: String(row.bot_id),
    role: row.role as Message["role"],
    text: String(row.text),
    createdAt: String(row.created_at),
    meta: row.meta ? JSON.parse(String(row.meta)) : undefined,
  };
}

function rowToMemory(row: Record<string, unknown>): MemoryFact {
  return {
    id: String(row.id),
    botId: String(row.bot_id),
    kind: row.kind as MemoryFact["kind"],
    text: String(row.text),
    createdAt: String(row.created_at),
  };
}

function rowToReceipt(row: Record<string, unknown>): Receipt {
  return {
    id: String(row.id),
    botId: String(row.bot_id),
    turnId: String(row.turn_id),
    status: row.status as Receipt["status"],
    steps: JSON.parse(String(row.steps)),
    costUsd: Number(row.cost_usd),
    model: String(row.model),
    computer: row.computer as ComputerProvider,
    createdAt: String(row.created_at),
    sealedAt: row.sealed_at ? String(row.sealed_at) : null,
  };
}

function rowToApproval(row: Record<string, unknown>): Approval {
  return {
    id: String(row.id),
    botId: String(row.bot_id),
    turnId: String(row.turn_id),
    tool: String(row.tool),
    summary: String(row.summary),
    command: row.command ? String(row.command) : undefined,
    status: row.status as Approval["status"],
    createdAt: String(row.created_at),
  };
}

function rowToRoutine(row: Record<string, unknown>): Routine {
  return {
    id: String(row.id),
    botId: String(row.bot_id),
    name: String(row.name),
    prompt: String(row.prompt),
    everyMs: Number(row.every_ms),
    enabled: Boolean(row.enabled),
    lastRunAt: row.last_run_at ? String(row.last_run_at) : null,
  };
}
