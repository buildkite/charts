import type { Config } from "../config.ts";
import type { Bot, ComputerProvider, ComputerStatus, ExecResult } from "../types.ts";
import { BoxComputer } from "./box.ts";
import { DockerComputer } from "./docker.ts";
import { MacComputer } from "./mac.ts";
import type { ComputerAdapter } from "./types.ts";

export class ComputerRegistry {
  private readonly adapters: Record<ComputerProvider, ComputerAdapter>;

  constructor(config: Config, overrides?: Partial<Record<ComputerProvider, ComputerAdapter>>) {
    this.adapters = {
      docker: overrides?.docker ?? new DockerComputer(config),
      box: overrides?.box ?? new BoxComputer(config),
      mac: overrides?.mac ?? new MacComputer(config),
    };
  }

  get(provider: ComputerProvider): ComputerAdapter {
    return this.adapters[provider];
  }

  async catalog() {
    const docker = await this.adapters.docker.available();
    const box = await this.adapters.box.available();
    const mac = await this.adapters.mac.available();
    return {
      default: "docker" as const,
      options: [
        { id: "docker" as const, label: "Docker container (default)", available: docker.ok, reason: docker.reason },
        { id: "box" as const, label: "Box remote VM", available: box.ok, reason: box.reason },
        { id: "mac" as const, label: "This Mac", available: mac.ok, reason: mac.reason },
      ],
    };
  }

  async provision(bot: Bot): Promise<ComputerStatus> {
    return this.get(bot.computerProvider).provision(bot);
  }

  async status(bot: Bot): Promise<ComputerStatus> {
    return this.get(bot.computerProvider).status(bot);
  }

  async join(bot: Bot) {
    return this.get(bot.computerProvider).join(bot);
  }

  async sleep(bot: Bot) {
    return this.get(bot.computerProvider).sleep(bot);
  }

  async exec(bot: Bot, command: string): Promise<ExecResult> {
    return this.get(bot.computerProvider).exec(bot, command);
  }

  async readFile(bot: Bot, path: string) {
    return this.get(bot.computerProvider).readFile(bot, path);
  }

  async writeFile(bot: Bot, path: string, content: string) {
    return this.get(bot.computerProvider).writeFile(bot, path, content);
  }
}
