import type { EventBus } from "./events.ts";
import type { Runtime } from "./runtime/turn.ts";
import type { Store } from "./store.ts";

export function startWorker(opts: { store: Store; runtime: Runtime; events: EventBus; intervalMs?: number }) {
  const tick = async () => {
    const now = Date.now();
    for (const routine of opts.store.listRoutines()) {
      if (!routine.enabled) continue;
      const last = routine.lastRunAt ? Date.parse(routine.lastRunAt) : 0;
      if (now - last < routine.everyMs) continue;
      const bot = opts.store.getBot(routine.botId);
      if (!bot) continue;
      opts.store.touchRoutine(routine.id);
      try {
        const { text, receipt } = await opts.runtime.runTurn({ bot, text: routine.prompt });
        opts.store.addMessage({
          botId: bot.id,
          role: "assistant",
          text: `Routine “${routine.name}”:\n\n${text}`,
          meta: { receiptId: receipt.id, routineId: routine.id },
        });
        opts.events.emit({ type: "turn.completed", botId: bot.id, payload: { routine: routine.id, receipt } });
      } catch (err) {
        opts.events.emit({
          type: "receipt",
          botId: bot.id,
          payload: { error: err instanceof Error ? err.message : String(err), routine: routine.id },
        });
      }
    }
  };
  const handle = setInterval(tick, opts.intervalMs ?? 15_000);
  handle.unref?.();
  return () => clearInterval(handle);
}
