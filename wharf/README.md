# Wharf

Self-hosted **crew of AI bots** in a messaging app. Every bot gets a computer.

Wharf is a new system assembled from the best ideas in:

- [OpenMausBot](https://github.com/milind-soni/OpenMausBot) — roster of bots as contacts, permission broker, Box VMs, this Mac
- [Rakazo](https://github.com/elie222/rakazo) — self-host spine, Docker computers, routines, OpenAI-compatible models
- [AGNT](https://agnt.gg) — sealed receipts, durable memory, skills, a blocked run stays blocked

It does **not** vendor AGNT source (AGNT’s license forbids public SaaS / rebrand). Receipts, memory, and skills here are original implementations of those ideas.

Not affiliated with xAI, OpenMausBot, Rakazo, or AGNT Labs.

## What you get

| Idea | Source | In Wharf |
|---|---|---|
| Bots as a chat roster, each with a persona and model | OpenMausBot / Rakazo | Sidebar of teammates |
| **Default computer = Docker container** | Rakazo | Every new bot |
| Remote Ubuntu VM | OpenMausBot + [box.ascii.dev](https://box.ascii.dev) | Per-bot override |
| This Mac | OpenMausBot CUA bridge | Per-bot override, Mac app only |
| Allow / Deny before dangerous shell and file writes | OpenMausBot | Approval cards in the thread |
| `ask_bot` with recursion guard | OpenMausBot | Tool + depth cap |
| Self-host API + worker + data dir | Rakazo | `pnpm dev` or Compose |
| Routines that keep working | Rakazo | Interval worker |
| OpenRouter / Ollama / any OpenAI-compatible endpoint | Rakazo + AGNT | `OPENAI_BASE_URL` |
| Sealed receipt per turn (steps, cost, failures) | AGNT | Receipt panel |
| Memory: facts, preferences, corrections | AGNT | `remember` tool |
| Skills as markdown playbooks | AGNT | `skills/*.md` |
| Partial work is not “complete” | AGNT | Receipt status `blocked` / `failed` |

Computers you will **not** find: E2B, and “run on the API host”. Those are replaced by Box VMs and the Mac bridge.

## Quick start

```bash
cd wharf
cp .env.example .env
# set OPENAI_API_KEY, or point OPENAI_BASE_URL at Ollama
pnpm install
pnpm test
pnpm dev          # API + UI  http://127.0.0.1:8787
# optional hot UI:
pnpm dev:web      # http://127.0.0.1:5199  (proxies /api)
```

Create a bot. It wakes a **Docker** computer automatically. Switch that bot to **Box VM** or **This Mac** from the header.

```bash
curl -s http://127.0.0.1:8787/health
# computerDefault should be "docker"
```

### Docker Compose

```bash
docker compose up --build
# http://127.0.0.1:8787
```

The Compose service mounts the Docker socket so bot computers are sibling containers. Keep that host private.

### Box remote VMs

1. Create a token at [box.ascii.dev](https://box.ascii.dev)
2. Set `BOX_TOKEN` in `.env`
3. On a bot, set computer to **Box VM**

Wharf uses the same public Box API OpenMausBot does (`https://ascii.dev/api/box/v1`): one persistent VM per bot, `stop` archives (billing pauses, disk survives), Join always mints a **fresh** desktop URL.

### This Mac

The API never drives your Mac. A companion (Electron CUA bridge) must listen on `WHARF_MAC_BRIDGE_URL`. Until that app is connected, Mac shows as unavailable — which is correct on a VPS.

## Layout

```
wharf/
  src/computers/   docker (default), box, mac
  src/runtime/     turns, tools, receipts
  src/             API, store, worker, permissions
  skills/          markdown playbooks
  web/             messaging UI
  computer/        bot container image
```

## License

Apache-2.0. Inspired by MIT OpenMausBot and Apache-2.0 Rakazo. Do not copy AGNT into a public product.
