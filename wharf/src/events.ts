import { EventEmitter } from "node:events";

export type WharfEvent =
  | { type: "message"; botId: string; payload: unknown }
  | { type: "approval"; botId: string; payload: unknown }
  | { type: "receipt"; botId: string; payload: unknown }
  | { type: "computer"; botId: string; payload: unknown }
  | { type: "delta"; botId: string; payload: { text: string } }
  | { type: "turn.completed"; botId: string; payload: unknown };

export class EventBus {
  private readonly emitter = new EventEmitter();

  constructor() {
    this.emitter.setMaxListeners(200);
  }

  emit(event: WharfEvent) {
    this.emitter.emit("event", event);
    this.emitter.emit(`bot:${event.botId}`, event);
  }

  subscribe(listener: (event: WharfEvent) => void): () => void {
    this.emitter.on("event", listener);
    return () => this.emitter.off("event", listener);
  }
}
