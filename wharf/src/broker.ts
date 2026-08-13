import type { Approval } from "./types.ts";

export class ApprovalBroker {
  private readonly waiters = new Map<string, (decision: "allow" | "deny") => void>();

  wait(id: string, timeoutMs = 10 * 60 * 1000): Promise<"allow" | "deny"> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.waiters.delete(id);
        resolve("deny");
      }, timeoutMs);
      this.waiters.set(id, (decision) => {
        clearTimeout(timer);
        resolve(decision);
      });
    });
  }

  resolve(approval: Approval, decision: "allow" | "deny") {
    this.waiters.get(approval.id)?.(decision);
    this.waiters.delete(approval.id);
  }
}
