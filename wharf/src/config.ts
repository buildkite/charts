import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import type { ComputerProvider } from "./types.ts";

function env(name: string, fallback = ""): string {
  return process.env[name] ?? fallback;
}

export function loadDotEnv(file = join(process.cwd(), ".env")) {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (!(key in process.env)) process.env[key] = value;
  }
}

export interface Config {
  port: number;
  host: string;
  dataDir: string;
  defaultComputer: ComputerProvider;
  openaiBaseUrl: string;
  openaiApiKey: string;
  openaiModel: string;
  boxToken: string;
  boxApi: string;
  macBridgeUrl: string;
  dockerImage: string;
  idleMs: number;
  authToken: string;
  signupAllowlist: string[];
}

const PROVIDERS = new Set<ComputerProvider>(["docker", "box", "mac"]);

export function parseComputerProvider(raw: string | undefined): ComputerProvider {
  const value = (raw ?? "docker").trim().toLowerCase();
  if (PROVIDERS.has(value as ComputerProvider)) return value as ComputerProvider;
  return "docker";
}

export function loadConfig(): Config {
  loadDotEnv();
  const dataDir = resolve(env("WHARF_DATA_DIR", join(homedir(), ".wharf")));
  mkdirSync(dataDir, { recursive: true });
  mkdirSync(join(dataDir, "homes"), { recursive: true });
  mkdirSync(join(dataDir, "skills"), { recursive: true });
  mkdirSync(join(dataDir, "events"), { recursive: true });
  return {
    port: Number(env("WHARF_PORT", "8787")),
    host: env("WHARF_HOST", "127.0.0.1"),
    dataDir,
    defaultComputer: parseComputerProvider(env("WHARF_COMPUTER_PROVIDER", "docker")),
    openaiBaseUrl: env("OPENAI_BASE_URL", "https://openrouter.ai/api/v1").replace(/\/$/, ""),
    openaiApiKey: env("OPENAI_API_KEY"),
    openaiModel: env("OPENAI_MODEL", "openai/gpt-4.1-mini"),
    boxToken: env("BOX_TOKEN"),
    boxApi: env("BOX_API", "https://ascii.dev/api/box/v1").replace(/\/$/, ""),
    macBridgeUrl: env("WHARF_MAC_BRIDGE_URL"),
    dockerImage: env("WHARF_DOCKER_IMAGE", "wharf/computer:local"),
    idleMs: Number(env("WHARF_IDLE_MS", "600000")),
    authToken: env("WHARF_AUTH_TOKEN"),
    signupAllowlist: env("WHARF_SIGNUP_ALLOWLIST")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  };
}
