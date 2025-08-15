import { useState, useRef, useEffect } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

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

// Reasoning effort choices (sent as reasoning_effort to the API)
const REASONING = [
  { id: "minimal", label: "Minimal" },
  { id: "low",     label: "Low" },
  { id: "medium",  label: "Medium" },
  { id: "high",    label: "High" },
] as const;
type Effort = typeof REASONING[number]["id"];

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
  const [_hasContext, setHasContext] = useState(false); // no longer rendered
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [modelId, setModelId] = useState<ModelId>(() => {
    const saved = typeof window !== "undefined" ? localStorage.getItem("model") : null;
    return saved || MODEL_CHOICES[0].id;
  });
  const [effort, setEffort] = useState<Effort>(() => {
    const saved = typeof window !== "undefined" ? localStorage.getItem("effort") : null;
    return (saved as Effort) || "medium";
  });

  // Refs
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

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
    
    //Add more state/helpers
    const [showEffort, setShowEffort] = useState<boolean>(() => {
      const s = typeof window !== "undefined" ? localStorage.getItem("effort_enabled") : null;
      return s === "1";
    });
    const isGPT5 = /^gpt-5\b/i.test(modelId);

//Handlers
  function handleEffortChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const next = e.target.value as Effort;
    setEffort(next);
    try { localStorage.setItem("effort", next); } catch {}
    // If on mobile and GPT-5, auto-enable so requests include reasoning_effort
    if (isGPT5 && typeof window !== 'undefined' && window.matchMedia('(max-width: 767px)').matches) {
      setShowEffort(true);
      try { localStorage.setItem('effort_enabled', '1'); } catch {}
    }
  }

  // Start a brand-new conversation (create index entry and clear UI)
  async function startNewConversation() {
    try {
      const r = await fetch("/.netlify/functions/conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "New chat", model: modelId }),
      });
      const data = await r.json().catch(() => ({}));
      const id = (data && data.id) ? String(data.id) : null;
      setMessages([]);
      setHasContext(false);
      setConversationId(id);
      if (id) {
        try { localStorage.setItem("conversationId", id); } catch {}
      }
    } catch (err) {
      console.error("Error creating conversation:", err);
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
      function inferTitleFrom(firstUser: string, firstAssistant: string) {
        // Prefer the user's first message; fall back to first assistant tokens
        const base = (firstUser || firstAssistant || "New chat")
          .replace(/\s+/g, " ")
          .trim();

        // A few simple cleanups
        const noPunct = base.replace(/[“”"':]+/g, "").replace(/\s*[-–—]\s*/g, " - ");
        const words = noPunct.split(" ").slice(0, 10).join(" "); // cap ~10 words
        const title = words.length > 56 ? words.slice(0, 53) + "…" : words;

        // Capitalize first letter
        return title.charAt(0).toUpperCase() + title.slice(1);
      }
      
      // Heuristic title after first assistant reply
      if (assistantMessage && messages.length === 1 && conversationId) {
        const firstUser = messages[0]?.content || "";
        const title = inferTitleFrom(firstUser, assistantMessage);

        try {
          await fetch("/.netlify/functions/conversations", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id: conversationId, title }),
          });
          // let the sidebar refresh its list
          window.dispatchEvent(new CustomEvent("conversations-updated"));
        } catch (e) {
          console.warn("title patch failed", e);
        }
      }
  }
 
    
 //On model change, disable reasoning selection
    function handleModelChange(e: React.ChangeEvent<HTMLSelectElement>) {
      const next = e.target.value as ModelId;
      setModelId(next);
      try { localStorage.setItem("model", next); } catch {}
      if (!/^gpt-5\b/i.test(next)) {
        setShowEffort(false);
        try { localStorage.setItem("effort_enabled", "0"); } catch {}
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
          model: modelId,
          ...(isGPT5 && showEffort ? { reasoning_effort: effort } : {}),
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
        <ReactMarkdown
          className="leading-7 text-zinc-100 [&_code]:rounded [&_code]:bg-zinc-800 [&_code]:px-1.5 [&_code]:py-0.5 [&_pre]:bg-zinc-900/70 [&_pre]:p-3 [&_pre]:rounded-lg [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:list-decimal [&_ol]:pl-6 [&_blockquote]:border-l-4 [&_blockquote]:border-zinc-700 [&_blockquote]:pl-3 [&_blockquote]:text-zinc-300"
          remarkPlugins={[remarkGfm]}
          skipHtml
          linkTarget="_blank"
          components={{
            a({node, ...props}) {
              return <a {...props} rel="noopener noreferrer" className="underline hover:no-underline" />;
            }
          }}
        >
          {m.content}
        </ReactMarkdown>
      </div>
    );
  }

  async function loadConversation(id: string) {
    try {
      const r = await fetch(`/.netlify/functions/chat?id=${encodeURIComponent(id)}`);
      const rows = await r.json();
      setConversationId(id);
      try { localStorage.setItem("conversationId", id); } catch {}
      setMessages(Array.isArray(rows) ? (rows as Message[]) : []);
    } catch (e) {
      console.error("loadConversation error", e);
    }
  }

  useEffect(() => {
    function onOpen(ev: any) {
      const id = ev?.detail?.id;
      if (typeof id === "string" && id) loadConversation(id);
    }
    window.addEventListener("open-conversation", onOpen as any);
    return () => window.removeEventListener("open-conversation", onOpen as any);
  }, []);

    return (
      <div className="relative flex flex-col h-full max-h-[calc(100dvh-3rem)] max-w-3xl mx-auto w-full px-2 md:px-0 text-zinc-100">
        {/* Header */}
        <div className="flex items-center justify-between px-3 md:px-6 py-3">
          <div className="w-14" /> {/* left spacer for balance */}

          {/* centered controls */}
          <div className="flex items-center justify-center gap-3 w-full">
            {/* Desktop controls */}
            <div className="hidden md:flex items-center justify-center gap-3">
              <label className="text-sm text-zinc-300" htmlFor="model">Model</label>
              <select
                id="model"
                value={modelId}
                onChange={handleModelChange}
                className="h-9 px-2 rounded-md border border-zinc-700 bg-zinc-800 text-sm text-zinc-100"
                disabled={isLoading}
              >
                {!MODEL_CHOICES.some(m => m.id === modelId) && (
                  <option value={modelId}>{prettyModelLabel(modelId)}</option>
                )}
                {MODEL_CHOICES.map((m) => (
                  <option key={m.id} value={m.id}>{m.label}</option>
                ))}
              </select>

              {/* Reasoning toggle (only for GPT-5) */}
              <button
                type="button"
                onClick={() => {
                  if (!isGPT5) return;
                  const next = !showEffort;
                  setShowEffort(next);
                  try { localStorage.setItem("effort_enabled", next ? "1" : "0"); } catch {}
                }}
                className={`h-9 px-3 rounded-md border text-sm
                  ${isGPT5
                    ? (showEffort
                      ? "border-blue-500 bg-blue-500/10 text-blue-300"
                      : "border-zinc-700 bg-zinc-800 text-zinc-200 hover:bg-zinc-700")
                    : "border-zinc-800 bg-zinc-900 text-zinc-600 cursor-not-allowed"
                  }`}
                disabled={!isGPT5 || isLoading}
                title={isGPT5 ? "Toggle reasoning options" : "Reasoning available only for GPT-5"}
              >
                Reasoning
              </button>

              {isGPT5 && showEffort && (
                <>
                  <label className="text-sm text-zinc-300" htmlFor="effort">Level</label>
                  <select
                    id="effort"
                    value={effort}
                    onChange={handleEffortChange}
                    className="h-9 px-2 rounded-md border border-zinc-700 bg-zinc-800 text-sm text-zinc-100"
                    disabled={isLoading}
                  >
                    {REASONING.map(r => <option key={r.id} value={r.id}>{r.label}</option>)}
                  </select>
                </>
              )}
            </div>

            {/* Mobile controls */}
            <div className="flex md:hidden items-center justify-center gap-2">
              <label className="text-sm text-zinc-300" htmlFor="model-m">Model</label>
              <select
                id="model-m"
                value={modelId}
                onChange={handleModelChange}
                className="h-9 px-2 rounded-md border border-zinc-700 bg-zinc-800 text-sm text-zinc-100"
                disabled={isLoading}
              >
                {!MODEL_CHOICES.some(m => m.id === modelId) && (
                  <option value={modelId}>{prettyModelLabel(modelId)}</option>
                )}
                {MODEL_CHOICES.map((m) => (
                  <option key={m.id} value={m.id}>{m.label}</option>
                ))}
              </select>

              <label className="text-sm text-zinc-300" htmlFor="effort-mobile">Reasoning</label>
              <select
                id="effort-mobile"
                value={effort}
                onChange={handleEffortChange}
                disabled={!/^gpt-5\b/i.test(modelId) || isLoading}
                className="h-9 px-2 rounded-md border border-zinc-700 bg-zinc-800 text-sm text-zinc-100"
              >
                {REASONING.map(r => <option key={r.id} value={r.id}>{r.label}</option>)}
              </select>
            </div>
          </div>

          {/* right cluster (New) */}
          <div className="flex items-center gap-2">
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 min-h-0 overflow-y-auto px-4 md:px-6 py-6">
          {messages.map(renderMessage)}
          <div ref={messagesEndRef} />
        </div>

        {/* Composer */}
        <form
          onSubmit={handleSubmit}
          className="sticky bottom-0 left-0 right-0 flex items-end gap-2 px-4 md:px-6 py-3 bg-zinc-900/80 backdrop-blur supports-[backdrop-filter]:bg-zinc-900/60"
          style={{ paddingBottom: "max(env(safe-area-inset-bottom), 0px)" }}
        >
          <textarea
            ref={inputRef}
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
