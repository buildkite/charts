import { useEffect, useState } from "react";

type Provider = "docker" | "box" | "mac";

interface Bot {
  id: string;
  name: string;
  title: string;
  persona: string;
  model: string;
  color: string;
  computerProvider: Provider;
}

interface Message {
  id: string;
  role: string;
  text: string;
  createdAt: string;
  meta?: { receiptId?: string; status?: string };
}

interface Receipt {
  id: string;
  status: string;
  steps: Array<{ tool: string; summary: string; ok: boolean; gated?: boolean }>;
  costUsd: number;
  computer: string;
}

interface Approval {
  id: string;
  botId: string;
  tool: string;
  summary: string;
  status: string;
}

interface Settings {
  openaiModel: string;
  openaiKeyConfigured: boolean;
  dockerAvailable: boolean;
  boxConfigured: boolean;
  macConfigured: boolean;
  defaultComputer: Provider;
  computers: {
    options: Array<{ id: Provider; label: string; available: boolean; reason?: string }>;
  };
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return res.json();
}

export function App() {
  const [bots, setBots] = useState<Bot[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [computer, setComputer] = useState<Record<string, unknown> | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [showCreate, setShowCreate] = useState(false);

  const active = bots.find((b) => b.id === activeId) ?? null;

  async function refreshBots() {
    const list = await api<Bot[]>("/api/bots");
    setBots(list);
    setActiveId((id) => id ?? list[0]?.id ?? null);
  }

  async function refreshThread(id: string) {
    const [msgs, recs, comp, pending] = await Promise.all([
      api<Message[]>(`/api/bots/${id}/messages`),
      api<Receipt[]>(`/api/bots/${id}/receipts`),
      api<Record<string, unknown>>(`/api/bots/${id}/computer`).catch(() => null),
      api<Approval[]>("/api/approvals"),
    ]);
    setMessages(msgs);
    setReceipts(recs);
    setComputer(comp);
    setApprovals(pending.filter((a) => a.botId === id));
  }

  useEffect(() => {
    refreshBots();
    api<Settings>("/api/settings").then(setSettings).catch(() => setSettings(null));
    const es = new EventSource("/api/events");
    es.addEventListener("message", () => {
      if (activeId) refreshThread(activeId);
      refreshBots();
    });
    es.addEventListener("approval", () => {
      if (activeId) refreshThread(activeId);
    });
    es.addEventListener("receipt", () => {
      if (activeId) refreshThread(activeId);
    });
    es.addEventListener("turn.completed", () => {
      if (activeId) refreshThread(activeId);
    });
    return () => es.close();
  }, []);

  useEffect(() => {
    if (activeId) refreshThread(activeId);
  }, [activeId]);

  async function send() {
    if (!active || !draft.trim()) return;
    setBusy(true);
    try {
      await api(`/api/bots/${active.id}/turns`, { method: "POST", body: JSON.stringify({ text: draft }) });
      setDraft("");
      await refreshThread(active.id);
    } finally {
      setBusy(false);
    }
  }

  const latestReceipt = receipts[0];

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <h1>Wharf</h1>
          <p>Crew of bots · computers included</p>
        </div>
        <div className="bots">
          {bots.length === 0 && <div className="empty">No bots yet. Create a teammate.</div>}
          {bots.map((bot) => (
            <div key={bot.id} className={`bot ${bot.id === activeId ? "active" : ""}`} onClick={() => setActiveId(bot.id)}>
              <div className="avatar" style={{ background: bot.color }}>{bot.name.slice(0, 1).toUpperCase()}</div>
              <div className="bot-meta">
                <strong>{bot.name}</strong>
                <span>{bot.computerProvider} · {bot.model.split("/").pop()}</span>
              </div>
            </div>
          ))}
        </div>
        <div className="side-actions">
          <button className="primary" onClick={() => setShowCreate(true)}>New bot</button>
        </div>
      </aside>

      <main className="chat">
        {active ? (
          <>
            <div className="chat-head">
              <div>
                <strong>{active.name}</strong>
                <div style={{ color: "var(--muted)", fontSize: 12 }}>{active.title || active.persona || "Teammate"}</div>
              </div>
              <select
                style={{ width: 160 }}
                value={active.computerProvider}
                onChange={async (e) => {
                  await api(`/api/bots/${active.id}`, {
                    method: "PATCH",
                    body: JSON.stringify({ computerProvider: e.target.value }),
                  });
                  await refreshBots();
                  await refreshThread(active.id);
                }}
              >
                <option value="docker">Docker</option>
                <option value="box">Box VM</option>
                <option value="mac">This Mac</option>
              </select>
            </div>
            <div className="messages">
              {messages.map((m) => (
                <div key={m.id} className={`bubble ${m.role}`}>
                  {m.text}
                </div>
              ))}
              {approvals.map((a) => (
                <div key={a.id} className="bubble receipt">
                  Approval · {a.tool}: {a.summary}
                  <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                    <button className="allow" onClick={() => api(`/api/approvals/${a.id}`, { method: "POST", body: JSON.stringify({ decision: "allow" }) }).then(() => refreshThread(active.id))}>Allow</button>
                    <button className="danger" onClick={() => api(`/api/approvals/${a.id}`, { method: "POST", body: JSON.stringify({ decision: "deny" }) }).then(() => refreshThread(active.id))}>Deny</button>
                  </div>
                </div>
              ))}
            </div>
            <div className="composer">
              <textarea
                placeholder={`Message ${active.name}…  @ another bot from here.`}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    send();
                  }
                }}
              />
              <button className="primary" disabled={busy} onClick={send}>{busy ? "…" : "Send"}</button>
            </div>
          </>
        ) : (
          <div className="empty">Create a bot to start a thread.</div>
        )}
      </main>

      <aside className="computer">
        <div className="panel">
          <h2>Computer</h2>
          <div className="card">
            <h3>{active ? `${active.computerProvider} · ${String(computer?.state ?? "—")}` : "No bot"}</h3>
            <div className="kv"><span>Default</span><b>docker</b></div>
            <div className="kv"><span>Docker</span><b>{settings?.dockerAvailable ? "ready" : "offline"}</b></div>
            <div className="kv"><span>Box</span><b>{settings?.boxConfigured ? "token set" : "no token"}</b></div>
            <div className="kv"><span>Mac</span><b>{settings?.macConfigured ? "bridge" : "app only"}</b></div>
            {active && (
              <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                <button onClick={() => api(`/api/bots/${active.id}/computer/provision`, { method: "POST" }).then(() => refreshThread(active.id))}>Wake</button>
                <button onClick={() => api(`/api/bots/${active.id}/computer/join`, { method: "POST" }).then((j) => {
                  refreshThread(active.id);
                  const url = (j as { joinUrl?: string }).joinUrl;
                  if (url) window.open(url, "_blank");
                })}>Take control</button>
                <button onClick={() => api(`/api/bots/${active.id}/computer/sleep`, { method: "POST" }).then(() => refreshThread(active.id))}>Sleep</button>
              </div>
            )}
            {computer?.reason ? <p style={{ color: "var(--muted)", fontSize: 12 }}>{String(computer.reason)}</p> : null}
          </div>

          <h2>Receipt</h2>
          <div className="card">
            {latestReceipt ? (
              <>
                <div className="kv"><span>Status</span><b className={latestReceipt.status === "complete" ? "ok" : "bad"}>{latestReceipt.status}</b></div>
                <div className="kv"><span>Cost</span><b>${latestReceipt.costUsd.toFixed(4)}</b></div>
                {latestReceipt.steps.map((s, i) => (
                  <div key={i} className="step">
                    <span className={s.ok ? "ok" : "bad"}>{s.ok ? "ok" : "x"}</span> {s.tool} — {s.summary}
                    {s.gated ? " (gated)" : ""}
                  </div>
                ))}
              </>
            ) : (
              <div className="empty" style={{ padding: 8 }}>No sealed receipt yet.</div>
            )}
          </div>

          <h2>Model</h2>
          <div className="card">
            <div className="kv"><span>Key</span><b>{settings?.openaiKeyConfigured ? "configured" : "missing"}</b></div>
            <div className="kv"><span>Default</span><b>{settings?.openaiModel}</b></div>
          </div>
        </div>
      </aside>

      {showCreate && (
        <CreateBot
          defaultComputer={settings?.defaultComputer ?? "docker"}
          defaultModel={settings?.openaiModel ?? ""}
          onClose={() => setShowCreate(false)}
          onCreated={async (bot) => {
            setShowCreate(false);
            await refreshBots();
            setActiveId(bot.id);
          }}
        />
      )}
    </div>
  );
}

function CreateBot(props: {
  defaultComputer: Provider;
  defaultModel: string;
  onClose: () => void;
  onCreated: (bot: Bot) => void;
}) {
  const [name, setName] = useState("Ops");
  const [title, setTitle] = useState("Chief of staff");
  const [persona, setPersona] = useState("You run the crew. Ask specialists. Bring back decisions, not noise.");
  const [computerProvider, setComputerProvider] = useState<Provider>(props.defaultComputer);
  return (
    <div className="modal-bg" onClick={props.onClose}>
      <form
        className="modal"
        onClick={(e) => e.stopPropagation()}
        onSubmit={async (e) => {
          e.preventDefault();
          const bot = (await api<{ bot: Bot }>("/api/bots", {
            method: "POST",
            body: JSON.stringify({ name, title, persona, computerProvider, model: props.defaultModel }),
          })).bot;
          props.onCreated(bot);
        }}
      >
        <h3 style={{ margin: 0 }}>New teammate</h3>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" />
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Role" />
        <textarea value={persona} onChange={(e) => setPersona(e.target.value)} />
        <select value={computerProvider} onChange={(e) => setComputerProvider(e.target.value as Provider)}>
          <option value="docker">Docker container (default)</option>
          <option value="box">Box remote VM</option>
          <option value="mac">This Mac</option>
        </select>
        <button className="primary" type="submit">Create</button>
      </form>
    </div>
  );
}
