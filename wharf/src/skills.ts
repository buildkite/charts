import { readdirSync, readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Skill } from "./types.ts";

const bundledDir = join(dirname(fileURLToPath(import.meta.url)), "..", "skills");

export function loadSkills(dataDir: string): Skill[] {
  const userDir = join(dataDir, "skills");
  mkdirSync(userDir, { recursive: true });
  seedIfEmpty(userDir);
  const dirs = [bundledDir, userDir].filter((d) => existsSync(d));
  const skills: Skill[] = [];
  const seen = new Set<string>();
  for (const dir of dirs) {
    for (const file of readdirSync(dir).filter((f) => f.endsWith(".md"))) {
      const id = file.replace(/\.md$/, "");
      if (seen.has(id)) continue;
      seen.add(id);
      const body = readFileSync(join(dir, file), "utf8");
      const name = body.match(/^#\s+(.+)$/m)?.[1] ?? id;
      const description = body.match(/^>\s+(.+)$/m)?.[1] ?? "";
      skills.push({ id, name, description, body });
    }
  }
  return skills;
}

function seedIfEmpty(userDir: string) {
  if (readdirSync(userDir).some((f) => f.endsWith(".md"))) return;
  if (!existsSync(bundledDir)) return;
  for (const file of readdirSync(bundledDir).filter((f) => f.endsWith(".md"))) {
    writeFileSync(join(userDir, file), readFileSync(join(bundledDir, file)));
  }
}
