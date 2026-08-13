import type { Config } from "./config.ts";

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  name?: string;
  tool_call_id?: string;
  tool_calls?: Array<{ id: string; type: "function"; function: { name: string; arguments: string } }>;
}

export interface ToolSpec {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface ModelResult {
  text: string;
  toolCalls: Array<{ id: string; name: string; arguments: string }>;
  usage?: { prompt: number; completion: number };
}

export async function complete(config: Config, input: {
  model: string;
  messages: ChatMessage[];
  tools: ToolSpec[];
}): Promise<ModelResult> {
  if (!config.openaiApiKey) {
    return localFallback(input.messages);
  }
  const res = await fetch(`${config.openaiBaseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${config.openaiApiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: input.model,
      messages: input.messages,
      tools: input.tools,
      temperature: 0.3,
    }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`model error ${res.status}: ${err.slice(0, 400)}`);
  }
  const body: any = await res.json();
  const choice = body.choices?.[0]?.message ?? {};
  const toolCalls = (choice.tool_calls ?? []).map((c: any) => ({
    id: c.id ?? `tool-${Math.random().toString(36).slice(2)}`,
    name: c.function?.name ?? "",
    arguments: c.function?.arguments ?? "{}",
  }));
  return {
    text: choice.content ?? "",
    toolCalls,
    usage: body.usage
      ? { prompt: body.usage.prompt_tokens ?? 0, completion: body.usage.completion_tokens ?? 0 }
      : undefined,
  };
}

function localFallback(messages: ChatMessage[]): ModelResult {
  const last = [...messages].reverse().find((m) => m.role === "user")?.content ?? "";
  return {
    text: `No model key is configured. I still have a computer and can run tools once you add OPENAI_API_KEY (or point OPENAI_BASE_URL at Ollama).\n\nYou said: ${last.slice(0, 400)}`,
    toolCalls: [],
  };
}

export const TOOLS: ToolSpec[] = [
  {
    type: "function",
    function: {
      name: "shell",
      description: "Run a shell command on this bot's computer (docker container, Box VM, or Mac).",
      parameters: {
        type: "object",
        properties: { command: { type: "string" } },
        required: ["command"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "read_file",
      description: "Read a file from the bot computer.",
      parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
    },
  },
  {
    type: "function",
    function: {
      name: "write_file",
      description: "Write a file on the bot computer.",
      parameters: {
        type: "object",
        properties: { path: { type: "string" }, content: { type: "string" } },
        required: ["path", "content"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "remember",
      description: "Store a durable fact, preference, or correction for this bot.",
      parameters: {
        type: "object",
        properties: {
          kind: { type: "string", enum: ["fact", "preference", "correction"] },
          text: { type: "string" },
        },
        required: ["kind", "text"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "ask_bot",
      description: "Delegate a question to another bot on the roster. Recursion is blocked.",
      parameters: {
        type: "object",
        properties: { botName: { type: "string" }, question: { type: "string" } },
        required: ["botName", "question"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "use_skill",
      description: "Load a named skill playbook into this turn.",
      parameters: { type: "object", properties: { skillId: { type: "string" } }, required: ["skillId"] },
    },
  },
];
