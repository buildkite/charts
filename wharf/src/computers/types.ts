import type { Bot, ComputerProvider, ComputerStatus, ExecResult } from "../types.ts";

export interface ComputerAdapter {
  readonly provider: ComputerProvider;
  available(): Promise<{ ok: boolean; reason?: string }>;
  provision(bot: Bot): Promise<ComputerStatus>;
  status(bot: Bot): Promise<ComputerStatus>;
  join(bot: Bot): Promise<{ joinUrl: string | null; state: ComputerStatus["state"] }>;
  sleep(bot: Bot): Promise<ComputerStatus>;
  exec(bot: Bot, command: string): Promise<ExecResult>;
  readFile(bot: Bot, path: string): Promise<string>;
  writeFile(bot: Bot, path: string, content: string): Promise<void>;
}

export function containerName(botId: string): string {
  return `wharf-bot-${botId.slice(0, 12).toLowerCase()}`;
}

export async function boxNameFor(botId: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(botId));
  const hash = [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 6);
  return `wharf-${botId.slice(0, 8).toLowerCase().replace(/[^a-z0-9]/g, "")}-${hash}`;
}

export function isDangerousCommand(command: string): boolean {
  const c = command.trim();
  if (!c) return true;
  return (
    /\bsudo\b/i.test(c) ||
    /\brm\s+-rf\b/i.test(c) ||
    /\bmkfs\b/i.test(c) ||
    /\bdd\s+if=/i.test(c) ||
    /\bshutdown\b/i.test(c) ||
    /\breboot\b/i.test(c) ||
    /\bcurl\b.*\|\s*(sh|bash)/i.test(c) ||
    /\bchmod\s+777\b/i.test(c)
  );
}
