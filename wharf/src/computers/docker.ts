import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { Config } from "../config.ts";
import type { Bot, ComputerStatus, ExecResult } from "../types.ts";
import { containerName, type ComputerAdapter } from "./types.ts";

const execFileAsync = promisify(execFile);

export class DockerComputer implements ComputerAdapter {
  readonly provider = "docker" as const;

  constructor(
    private readonly config: Config,
    private readonly runner: DockerRunner = liveDockerRunner(),
  ) {}

  async available() {
    return this.runner.available();
  }

  home(bot: Bot): string {
    const dir = join(this.config.dataDir, "homes", bot.id);
    mkdirSync(dir, { recursive: true });
    return dir;
  }

  async provision(bot: Bot): Promise<ComputerStatus> {
    const name = containerName(bot.id);
    const home = this.home(bot);
    const avail = await this.available();
    if (!avail.ok) {
      writeFileSync(join(home, "README.txt"), `Workspace for ${bot.name} (docker unavailable: ${avail.reason})\n`);
      return {
        provider: "docker",
        state: "unavailable",
        ref: name,
        joinUrl: null,
        reason: avail.reason,
      };
    }
    await this.runner.ensure(name, home, this.config.dockerImage);
    return { provider: "docker", state: "running", ref: name, joinUrl: null };
  }

  async status(bot: Bot): Promise<ComputerStatus> {
    const name = bot.computerRef ?? containerName(bot.id);
    const avail = await this.available();
    if (!avail.ok) {
      return {
        provider: "docker",
        state: existsSync(this.home(bot)) ? "running" : "missing",
        ref: name,
        joinUrl: null,
        reason: `${avail.reason} — using host workspace ${this.home(bot)}`,
      };
    }
    const state = await this.runner.inspect(name);
    return { provider: "docker", state, ref: name, joinUrl: null };
  }

  async join(bot: Bot) {
    const status = await this.provision(bot);
    return { joinUrl: status.joinUrl, state: status.state };
  }

  async sleep(bot: Bot): Promise<ComputerStatus> {
    const name = bot.computerRef ?? containerName(bot.id);
    await this.runner.pause(name);
    return { provider: "docker", state: "paused", ref: name, joinUrl: null };
  }

  async exec(bot: Bot, command: string): Promise<ExecResult> {
    const name = bot.computerRef ?? containerName(bot.id);
    const avail = await this.available();
    if (!avail.ok) {
      return this.execLocal(bot, command);
    }
    const status = await this.status(bot);
    if (status.state === "paused" || status.state === "missing") await this.provision(bot);
    return this.runner.exec(name, command);
  }

  async readFile(bot: Bot, path: string): Promise<string> {
    const result = await this.exec(bot, `cat ${shellQuote(path)}`);
    if (result.exitCode !== 0) throw new Error(result.stderr || "read failed");
    return result.stdout;
  }

  async writeFile(bot: Bot, path: string, content: string): Promise<void> {
    const avail = await this.available();
    if (!avail.ok) {
      const abs = join(this.home(bot), path.replace(/^\//, ""));
      mkdirSync(join(abs, ".."), { recursive: true });
      writeFileSync(abs, content);
      return;
    }
    const b64 = Buffer.from(content).toString("base64");
    const result = await this.exec(bot, `mkdir -p "$(dirname ${shellQuote(path)})" && echo ${shellQuote(b64)} | base64 -d > ${shellQuote(path)}`);
    if (result.exitCode !== 0) throw new Error(result.stderr || "write failed");
  }

  private execLocal(bot: Bot, command: string): ExecResult {
    const home = this.home(bot);
    try {
      const stdout = execFileSync("bash", ["-lc", command], {
        cwd: home,
        encoding: "utf8",
        timeout: 30_000,
      });
      return { exitCode: 0, stdout, stderr: "" };
    } catch (err: unknown) {
      const error = err as { status?: number; stdout?: string; stderr?: string; message?: string };
      return {
        exitCode: error.status ?? 1,
        stdout: error.stdout ?? "",
        stderr: error.stderr ?? error.message ?? "exec failed",
      };
    }
  }
}

export interface DockerRunner {
  available(): Promise<{ ok: boolean; reason?: string }>;
  ensure(name: string, home: string, image: string): Promise<void>;
  inspect(name: string): Promise<ComputerStatus["state"]>;
  pause(name: string): Promise<void>;
  exec(name: string, command: string): Promise<ExecResult>;
}

export function liveDockerRunner(): DockerRunner {
  return {
    async available() {
      try {
        await execFileAsync("docker", ["info"], { timeout: 5000 });
        return { ok: true };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return { ok: false, reason: message.includes("ENOENT") ? "docker CLI not found" : "docker daemon not reachable" };
      }
    },
    async ensure(name, home, image) {
      const existing = await inspectName(name);
      if (existing === "paused") {
        await execFileAsync("docker", ["unpause", name]);
        return;
      }
      if (existing === "running") return;
      if (existing === "archived") {
        await execFileAsync("docker", ["start", name]);
        return;
      }
      try {
        await execFileAsync("docker", ["image", "inspect", image]);
      } catch {
        image = "ubuntu:24.04";
      }
      await execFileAsync("docker", [
        "run",
        "-d",
        "--name",
        name,
        "-v",
        `${home}:/home/bot`,
        "-w",
        "/home/bot",
        "--network",
        "none",
        image,
        "sleep",
        "infinity",
      ]);
    },
    async inspect(name) {
      return inspectName(name);
    },
    async pause(name) {
      try {
        await execFileAsync("docker", ["pause", name]);
      } catch {
        /* already paused or missing */
      }
    },
    async exec(name, command) {
      try {
        const { stdout, stderr } = await execFileAsync("docker", ["exec", name, "bash", "-lc", command], {
          timeout: 120_000,
          maxBuffer: 2_000_000,
        });
        return { exitCode: 0, stdout, stderr };
      } catch (err: unknown) {
        const error = err as { code?: number; stdout?: string; stderr?: string; message?: string };
        return {
          exitCode: typeof error.code === "number" ? error.code : 1,
          stdout: error.stdout ?? "",
          stderr: error.stderr ?? error.message ?? "exec failed",
        };
      }
    },
  };
}

async function inspectName(name: string): Promise<ComputerStatus["state"]> {
  try {
    const { stdout } = await execFileAsync("docker", [
      "inspect",
      "-f",
      "{{.State.Running}} {{.State.Paused}} {{.State.Status}}",
      name,
    ]);
    const [running, paused, status] = stdout.trim().split(" ");
    if (paused === "true") return "paused";
    if (running === "true") return "running";
    if (status === "exited") return "archived";
    return "missing";
  } catch {
    return "missing";
  }
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}
