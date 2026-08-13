export type ComputerProvider = "docker" | "box" | "mac";

export type ComputerState =
  | "missing"
  | "provisioning"
  | "running"
  | "paused"
  | "archived"
  | "unavailable"
  | "error";

export interface ComputerStatus {
  provider: ComputerProvider;
  state: ComputerState;
  ref: string | null;
  joinUrl: string | null;
  reason?: string;
  lastUsedAt?: string | null;
}

export interface ExecResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

export interface Bot {
  id: string;
  name: string;
  title: string;
  persona: string;
  model: string;
  color: string;
  computerProvider: ComputerProvider;
  computerRef: string | null;
  pinned: boolean;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Message {
  id: string;
  botId: string;
  role: "user" | "assistant" | "system" | "tool" | "receipt";
  text: string;
  createdAt: string;
  meta?: Record<string, unknown>;
}

export interface MemoryFact {
  id: string;
  botId: string;
  kind: "fact" | "preference" | "correction";
  text: string;
  createdAt: string;
}

export interface ReceiptStep {
  id: string;
  tool: string;
  summary: string;
  ok: boolean;
  costUsd?: number;
  output?: string;
  error?: string;
  gated?: boolean;
}

export interface Receipt {
  id: string;
  botId: string;
  turnId: string;
  status: "running" | "complete" | "blocked" | "failed";
  steps: ReceiptStep[];
  costUsd: number;
  model: string;
  computer: ComputerProvider;
  createdAt: string;
  sealedAt: string | null;
}

export interface Approval {
  id: string;
  botId: string;
  turnId: string;
  tool: string;
  summary: string;
  command?: string;
  status: "pending" | "allow" | "deny";
  createdAt: string;
}

export interface Routine {
  id: string;
  botId: string;
  name: string;
  prompt: string;
  everyMs: number;
  enabled: boolean;
  lastRunAt: string | null;
}

export interface Skill {
  id: string;
  name: string;
  description: string;
  body: string;
}

export interface AppSettings {
  openaiBaseUrl: string;
  openaiModel: string;
  openaiKeyConfigured: boolean;
  boxConfigured: boolean;
  macConfigured: boolean;
  dockerAvailable: boolean;
  defaultComputer: ComputerProvider;
}

export interface Health {
  ok: true;
  product: "wharf";
  runtime: "openai-compatible";
  computerDefault: ComputerProvider;
  sandbox: "docker" | "none";
  wakeup: "inline";
  box: boolean;
  mac: boolean;
}
