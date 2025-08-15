import { useState, useRef, useEffect } from "react";

// Message shape
interface Message {
  role: "user" | "assistant";
  content: string;
  ts?: number;
}

// Friendly labels shown to the user, exact IDs sent to backend
const MODEL_CHOICES = [
  { id: "gpt-5-2025-08-07",            label: "GPT‑5" },
  { id: "o3-deep-research-2025-06-26", label: "o3 Deep Research" },
  { id: "gpt-4.1-2025-04-14",          label: "GPT‑4.1" },
] as const;
type ModelId = (typeof MODEL_CHOICES)[number]["id"] | string;

// Fallback pretty label if we ever load an unknown ID from storage
function prettyModelLabel(id: string): string {
  const withoutDate = id.replace(/-\d{4}-\d{2}-\d{2}$/, "");
  if (withoutDate.startsWith("o3-")) {
    const rest = withoutDate.split("-").slice(1).join(" ");
    return "o3 " + rest.replace(/\b\w/g, s => s.toUpperCase());
  }
  if (withoutDate.startsWith("gpt-")) {
    return withoutDate
      .replace(/^gpt-/, "GPT-")
      .replace(/-/g, " ")
      .replace(/\bmini\b/i, "mini");
  }
  return withoutDate.replace(/-/g, " ").replace(/\b[a-z]/g, (m) => m.toUpperCase());
}

export default function Chat() {
  // Conversation + UI state
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [hasContext, setHasContext] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [modelId, setModelId] = useState<ModelId>(() => {
    const saved = typeof window !== "undefined" ? localStorage.getItem("model") : null;
    return saved || MODEL_CHOICES[0].id;
  });

  // Refs
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Effects
  useEffect(() => {
    // restore conversation id if present
    const cid = typeof window !== "undefined" ? localStorage.getItem("conversationId") : null;
    if (cid) setConversationId(cid);
  }, []);
    
    function autoSize(el: HTMLTextAreaElement) {
      el.style.height = "auto";
      el.style.height = Math.min(el.scrollHeight, 160) + "px"; // cap ~10 lines
    }
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    if (!isLoading) inputRef.current?.focus();
  }, [isLoading]);

  // Handlers
  function handleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    setInput(e.target.value);
  }

  function handleModelChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const next = e.target.value as ModelId;
    setModelId(next);
    try { localStorage.setItem("model", next); } catch {}
  }

  // Start a brand-new conversation (clear history & id)
  async function startNewConversation() {
    try {
      await fetch("/.netlify/functions/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newConversation: true }),
      });
    } catch (err) {
      console.error("Error starting new conversation:", err);
    } finally {
      setMessages([]);
      setHasContext(false);
      setConversationId(null);
      try { localStorage.removeItem("conversationId"); } catch {}
    }
  }

  async function processStreamedResponse(reader: ReadableStreamDefaultReader<Uint8Array>) {
    let assistantMessage = "";
    // push a placeholder assistant message to stream into
    setMessages((prev) => [...prev, { role: "assistant", content: "" }]);

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const text = new TextDecoder().decode(value);
      if (!text) continue;

      assistantMessage += text;
      setMessages((prev) => [
        ...prev.slice(0, -1),
        { role: "assistant", content: assistantMessage },
      ]);
    }
  }

  // Submit user messages
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!input.trim() || isLoading) return;

    const userMessage: Message = { role: "user", content: input.trim(), ts: Date.now() };
    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setIsLoading(true);

    try {
      const response = await fetch("/.netlify/functions/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: userMessage.content,
          model: modelId, // send exact ID
          conversationId: conversationId ?? undefined,
        }),
      });

      // Save conversationId from response header if provided
      const cid = response.headers.get("X-Conversation-Id");
      if (cid && cid !== conversationId) {
        setConversationId(cid);
        try { localStorage.setItem("conversationId", cid); } catch {}
      }

      if (!response.ok || !response.body) {
        // Try to parse JSON error if present
        let detail = "";
        try { detail = await response.text(); } catch {}
        throw new Error(`Request failed (${response.status}) ${detail}`);
      }

      const reader = response.body.getReader();
      await processStreamedResponse(reader);
      setHasContext(true);
    } catch (error: any) {
      console.error("Chat submit error:", error);
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content:
            error?.message?.includes("429") ?
              "Quota exceeded. Please add credits or try again later." :
              "Sorry, there was an error processing your request.",
        },
      ]);
    } finally {
      setIsLoading(false);
    }
  }

  // Borderless, flowing message blocks
  function renderMessage(m: Message, i: number) {
    const roleLabel = m.role === "user" ? "You" : "Assistant";
    return (
      <div key={i} className="my-6 px-1">
        <div className="text-xs text-zinc-400 uppercase tracking-wide mb-2">{roleLabel}</div>
        <div className="whitespace-pre-wrap leading-7 text-zinc-100">{m.content}</div>
      </div>
    );
  }

    return (
      <div className="flex flex-col h-full max-h-[calc(100dvh-3rem)] max-w-3xl mx-auto w-full px-2 md:px-0 text-zinc-100">
      {/* Header (no borders) */}
      <div className="flex justify-between items-center px-6 md:px-8 py-4 gap-3">
        <span className="text-sm text-zinc-400">
          {hasContext ? "Conversation context: On" : "New conversation"}
          {conversationId ? ` · ${conversationId.slice(0, 8)}` : ""}
        </span>
        <div className="flex items-center gap-2">
          <label className="text-sm text-zinc-300" htmlFor="model">Model</label>
          <select
            id="model"
            value={modelId}
            onChange={handleModelChange}
            className="h-9 px-2 rounded-md border border-zinc-700 bg-zinc-800 text-sm text-zinc-100"
            disabled={isLoading}
          >
            {/* Ensure current value is visible even if not in MODEL_CHOICES */}
            {!MODEL_CHOICES.some(m => m.id === modelId) && (
              <option value={modelId}>{prettyModelLabel(modelId)}</option>
            )}
            {MODEL_CHOICES.map((m) => (
              <option key={m.id} value={m.id}>{m.label}</option>
            ))}
          </select>
          <button
            onClick={startNewConversation}
            className="px-3 py-1.5 text-sm text-zinc-100 border border-zinc-700 rounded-lg bg-zinc-800 transition hover:bg-zinc-700 focus:outline-none focus:ring-2 focus:ring-blue-400 disabled:opacity-60 disabled:cursor-not-allowed"
            disabled={isLoading}
            type="button"
          >
            New
          </button>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 min-h-0 overflow-y-auto px-6 md:px-8 py-6">
        {messages.map(renderMessage)}
        <div ref={messagesEndRef} />
      </div>

      {/* Composer (no border band) */}
          <form
            onSubmit={handleSubmit}
            className="sticky bottom-0 left-0 right-0 flex items-end gap-2 px-4 md:px-6 py-3 bg-zinc-900/80 backdrop-blur supports-[backdrop-filter]:bg-zinc-900/60"
            style={{ paddingBottom: "max(env(safe-area-inset-bottom), 0px)" }}
          >
            <textarea
              ref={inputRef as any}
              value={input}
              onChange={(e) => { setInput(e.target.value); autoSize(e.currentTarget); }}
              onInput={(e) => autoSize(e.currentTarget)}
              placeholder="Type your message…"
              rows={1}
              className="flex-1 max-h-40 resize-none px-3 py-2 border border-zinc-700 rounded-lg bg-zinc-800 text-zinc-100 leading-6 focus:outline-none focus:ring-2 focus:ring-blue-400"
              disabled={isLoading}
            />
            <button
              type="submit"
              disabled={isLoading || !input.trim()}
              className="shrink-0 px-4 py-2 bg-blue-500 text-white rounded-lg font-medium hover:bg-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-400 disabled:bg-blue-300"
            >
              {isLoading ? "Sending…" : "Send"}
            </button>
          </form>
    </div>
  );
}
