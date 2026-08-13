import type { Approval } from "./types.ts";
import { newId, nowIso } from "./ids.ts";
import { isDangerousCommand } from "./computers/types.ts";

export type GateDecision = "allow" | "deny" | "ask";

export function classifyCommand(command: string): GateDecision {
  if (isDangerousCommand(command)) return "ask";
  if (/^\s*(ls|pwd|whoami|date|cat |head |tail |echo )\b/.test(command)) return "allow";
  if (/\b(rm |mv |chmod |chown |kill |pkill |reboot|shutdown|dd )\b/.test(command)) return "ask";
  return "ask";
}

export function pendingApproval(input: {
  botId: string;
  turnId: string;
  tool: string;
  summary: string;
  command?: string;
}): Approval {
  return {
    id: newId(),
    botId: input.botId,
    turnId: input.turnId,
    tool: input.tool,
    summary: input.summary,
    command: input.command,
    status: "pending",
    createdAt: nowIso(),
  };
}
