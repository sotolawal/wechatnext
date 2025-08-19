import { useState, useRef, useEffect } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypePrism from "rehype-prism-plus";

// Message shape
interface Message {
  role: "user" | "assistant";
  content: string;
  ts?: number;
}

// Friendly labels shown to the user, exact IDs sent to backend
const MODEL_CHOICES = [
  { id: "gpt-4.1-2025-04-14",          label: "GPT‑4.1" },
  { id: "gpt-5-2025-08-07",            label: "GPT‑5" },
  { id: "gpt-5-nano-2025-08-07",       label: "GPT-5 nano" },
] as const;
type ModelId = (typeof MODEL_CHOICES)[number]["id"] | string;

// Reasoning effort choices (sent as reasoning_effort to the API)
const REASONING = [
  { id: "minimal", label: "Minimal" },
  { id: "low",     label: "Low" },
  { id: "medium",  label: "Medium" },
  { id: "high",    label: "High" },
] as const;
type Effort = (typeof REASONING)[number]["id"];

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
  // Popover menu state and tempChat flag
  const [menuOpen, setMenuOpen] = useState(false);
  const [tempChat, setTempChat] = useState<boolean>(() => {
    try { return localStorage.getItem('temp_chat') === '1'; } catch { return false; }
  });
  // Wire up header menu button and close on outside click/Escape
  useEffect(() => {
    const btn = document.getElementById('model-menu-toggle');
    const onClick = () => setMenuOpen(v => !v);
    btn?.addEventListener('click', onClick);
    const onDoc = (e: MouseEvent) => {
      const m = document.getElementById('model-menu');
      if (menuOpen && m && !m.contains(e.target as Node) && e.target !== btn) setMenuOpen(false);
    };
    const onEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenuOpen(false); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onEsc);
    return () => {
      btn?.removeEventListener('click', onClick);
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onEsc);
    };
  }, [menuOpen]);

  // Refs
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

    // Smart scroll logic
  const [isAtBottom, setIsAtBottom] = useState(true);

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    function handleScroll() {
      const threshold = 40;
      const atBottom =
        container.scrollHeight - container.scrollTop - container.clientHeight < threshold;
      setIsAtBottom(atBottom);
    }

    container.addEventListener("scroll", handleScroll);
    handleScroll(); // initialize

    return () => container.removeEventListener("scroll", handleScroll);
  }, []);

  useEffect(() => {
    if (isAtBottom && messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, isAtBottom]);

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
        if (!tempChat) {
          try { localStorage.setItem("conversationId", id); } catch {}
        }
      }
    } catch (err) {
      console.error("Error creating conversation:", err);
      setMessages([]);
      setHasContext(false);
      setConversationId(null);
      if (!tempChat) {
        try { localStorage.removeItem("conversationId"); } catch {}
      }
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
 
    
  // Change active model, persist, and notify UI
  async function selectModel(next: ModelId) {
    setModelId(next);
    try { localStorage.setItem("model", String(next)); } catch {}

    // Notify header/other components immediately
    try {
      const label = prettyModelLabel(String(next));
      window.dispatchEvent(new CustomEvent("model-changed", { detail: { id: String(next), label } }));
    } catch {}

    // Disable effort UI if not GPT-5
    if (!/^gpt-5\b/i.test(String(next))) {
      setShowEffort(false);
      try { localStorage.setItem("effort_enabled", "0"); } catch {}
    }

    // Persist model on the active conversation (if any)
    if (conversationId) {
      try {
        await fetch("/.netlify/functions/conversations", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: conversationId, model: String(next) }),
        });
        // Let sidebar refresh if it listens for this
        window.dispatchEvent(new CustomEvent("conversations-updated"));
      } catch (e) {
        console.warn("model patch failed", e);
      }
    }
  }

 //On model change, disable reasoning selection
    function handleModelChange(e: React.ChangeEvent<HTMLSelectElement>) {
      const next = e.target.value as ModelId;
      setModelId(next);
      try { localStorage.setItem("model", next); } catch {}

      // Notify other UI (e.g., header) to update immediately
      try {
        const label = prettyModelLabel(String(next));
        window.dispatchEvent(new CustomEvent("model-changed", { detail: { id: String(next), label } }));
      } catch {}

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
        if (!tempChat) {
          try { localStorage.setItem("conversationId", cid); } catch {}
        }
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

  function renderMessage(m: Message, i: number) {
    const isUser = m.role === "user";
    return (
      <div key={i} className={`my-3 flex ${isUser ? "justify-end" : "justify-start"}`}>
        <div
          className={`${
            isUser
              ? "max-w-[85%] rounded-2xl px-4 py-3 shadow-sm bg-gray-500/20 text-zinc-100"
              : "w-full text-zinc-100"
          } leading-7`}
        >
          {isUser ? (
            <div className="overflow-x-hidden">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                rehypePlugins={[rehypePrism]}
                skipHtml
                components={{
                  p: ({ node, ...props }) => (
                    <p className="whitespace-pre-wrap break-words leading-7" {...props} />
                  ),
                  ul: ({ node, ...props }) => (
                    <ul className="list-disc ml-6 space-y-2 mb-3" {...props} />
                  ),
                  ol: ({ node, ...props }) => (
                    <ol className="list-decimal ml-6 space-y-2 mb-3" {...props} />
                  ),
                  li: ({ node, ...props }) => (
                    <li className="ml-1 [&>p]:my-0 whitespace-pre-wrap" {...props} />
                  ),
                  table: ({ node, ...props }) => (
                    <div className="overflow-x-auto -mx-4 sm:-mx-6 my-2">
                      <table className="min-w-full border-collapse text-sm" {...props} />
                    </div>
                  ),
                  thead: ({ node, ...props }) => (
                    <thead className="bg-zinc-900/60" {...props} />
                  ),
                  tbody: ({ node, ...props }) => <tbody {...props} />,
                  tr: ({ node, ...props }) => (
                    <tr className="border-b border-zinc-700/60" {...props} />
                  ),
                  th: ({ node, ...props }) => (
                    <th className="px-3 py-2 text-left font-medium border border-zinc-700 break-words" {...props} />
                  ),
                  td: ({ node, ...props }) => (
                    <td className="px-3 py-2 align-top border border-zinc-700 break-words" {...props} />
                  ),
                  img: ({ node, ...props }) => (
                    <img className="max-w-full h-auto rounded" {...props} />
                  ),
                  code: ({ inline, className, children, ...props }) => (
                    inline ? (
                      <code className="px-1 py-0.5 rounded bg-zinc-800/80 border border-zinc-700 text-[0.9em]" {...props}>{children}</code>
                    ) : (
                      <pre className="overflow-x-auto p-3 rounded-lg bg-zinc-900/80 border border-zinc-800 text-sm" {...props}>
                        <code>{children}</code>
                      </pre>
                    )
                  ),
                  a({ node, ...props }) {
                    return (
                      <a
                        {...props}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="underline hover:no-underline break-words"
                      />
                    );
                  },
                }}
              >
                {m.content}
              </ReactMarkdown>
            </div>
          ) : (
            <div className="mx-auto max-w-[88ch] px-2 sm:px-3 md:px-4">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                rehypePlugins={[rehypePrism]}
                skipHtml
                components={{
                   // custom <p> handler
                    p: ({ node, ...props }) => {
                  // detect if parent is a list item
                      if (node?.position?.start && node?.position?.end) {
                      const parent = node?.parent || node?.position?.parent
                      if (parent && parent.tagName === "li") {
                      // render inline span if inside <li>
                      return <span {...props} />;
                      }
                    }
                  return <p className="whitespace-pre-wrap break-words leading-7 mb-3" {...props} />;
                  },
                  p: ({ node, ...props }) => (
                    <p className="whitespace-pre-wrap break-words leading-7 mb-3" {...props} />
                  ),
                  ul: ({ node, ...props }) => (
                    <ul className="list-disc list-outside pl-6 mb-3" {...props} />
                  ),
                  ol: ({ node, ...props }) => (
                    <ol className="list-decimal list-outside pl-6 mb-3" {...props} />
                  ),
                  li: ({ node, children, ...props }) => (
                    <li className="align-top whitespace-pre-wrap my-1" {...props}>
                    {children}
                    </li>
                  ),
                  table: ({ node, ...props }) => (
                      <div className="overflow-x-auto -mx-2 sm:-mx-3 md:-mx-4 my-2">
                      <table className="min-w-full border-collapse text-sm" {...props} />
                    </div>
                  ),
                  hr: ({ node, ...props }) => (
                    <hr className="mb-6 border-t border-zinc-700" {...props} />
                  ),
                  thead: ({ node, ...props }) => (
                    <thead className="bg-zinc-900/60" {...props} />
                  ),
                  tbody: ({ node, ...props }) => <tbody {...props} />,
                  tr: ({ node, ...props }) => (
                    <tr className="border-b border-zinc-700/60" {...props} />
                  ),
                  th: ({ node, ...props }) => (
                    <th className="px-3 py-2 text-left font-medium border border-zinc-700 break-words" {...props} />
                  ),
                  td: ({ node, ...props }) => (
                    <td className="px-3 py-2 align-top border border-zinc-700 break-words" {...props} />
                  ),
                  img: ({ node, ...props }) => (
                    <img className="max-w-full h-auto rounded" {...props} />
                  ),
                  code: ({ inline, className, children, ...props }) => (
                    inline ? (
                      <code className="px-1 py-0.5 rounded bg-zinc-800/80 border border-zinc-700 text-[0.9em]" {...props}>{children}</code>
                    ) : (
                      <pre className="overflow-x-auto p-3 rounded-lg bg-zinc-900/80 border border-zinc-800 text-sm" {...props}>
                        <code>{children}</code>
                      </pre>
                    )
                  ),
                  a({ node, ...props }) {
                    return (
                      <a
                        {...props}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="underline hover:no-underline break-words"
                      />
                    );
                  },
                }}
              >
                {m.content}
              </ReactMarkdown>
            </div>
          )}
        </div>
      </div>
    );
  }
  async function loadConversation(id: string) {
    try {
      const r = await fetch(`/.netlify/functions/chat?id=${encodeURIComponent(id)}`);
      const rows = await r.json();
      setConversationId(id);
      if (!tempChat) {
        try { localStorage.setItem("conversationId", id); } catch {}
      }
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
        <div className="relative flex flex-col h-full max-h-[calc(100dvh-3rem)] mx-auto max-w-4xl px-2 md:px-3 lg:px-4 w-full text-zinc-100">
        {/* Spacer under top bar */}
        <div className="h-2 md:h-3" />

        {menuOpen && (
          <div id="model-menu" className="fixed z-50 top-16 left-1/2 -translate-x-1/2 w-80 rounded-xl border border-zinc-800 bg-zinc-900/95 backdrop-blur shadow-xl">
            {isGPT5 && (
              <div className="px-3 pt-3 mb-2">
                <details className="group">
                  <summary className="w-full text-sm cursor-pointer select-none text-zinc-300 flex items-center justify-center gap-1 py-1.5 rounded-md border border-zinc-800 bg-zinc-900/60 text-center [&::-webkit-details-marker]:hidden">
                    Reasoning <svg className="inline-block h-4 w-4 md:h-5 md:w-5 shrink-0 text-zinc-400 group-open:rotate-180 transition" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="m6 9 6 6 6-6" />
                    </svg>
                  </summary>
                  <div className="mt-2 space-y-2">
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="radio"
                        name="rg"
                        checked={showEffort && effort === 'minimal'}
                        onChange={() => { setShowEffort(true); setEffort('minimal'); try{localStorage.setItem('effort','minimal'); localStorage.setItem('effort_enabled','1');}catch{}; }}
                      />
                      <div>
                        <div>Minimal</div>
                        <div className="text-xs text-zinc-400">Shortest thinking time</div>
                      </div>
                    </label>
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="radio"
                        name="rg"
                        checked={showEffort && effort === 'low'}
                        onChange={() => { setShowEffort(true); setEffort('low'); try{localStorage.setItem('effort','low'); localStorage.setItem('effort_enabled','1');}catch{}; }}
                      />
                      <div>
                        <div>Low</div>
                        <div className="text-xs text-zinc-400">Faster answers</div>
                      </div>
                    </label>
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="radio"
                        name="rg"
                        checked={showEffort && effort === 'medium'}
                        onChange={() => { setShowEffort(true); setEffort('medium'); try{localStorage.setItem('effort','medium'); localStorage.setItem('effort_enabled','1');}catch{}; }}
                      />
                      <div>
                        <div>Medium</div>
                        <div className="text-xs text-zinc-400">Balanced speed & quality</div>
                      </div>
                    </label>
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="radio"
                        name="rg"
                        checked={showEffort && effort === 'high'}
                        onChange={() => { setShowEffort(true); setEffort('high'); try{localStorage.setItem('effort','high'); localStorage.setItem('effort_enabled','1');}catch{}; }}
                      />
                      <div>
                        <div>High</div>
                        <div className="text-xs text-zinc-400">Thinks longer for better answers</div>
                      </div>
                    </label>
                  </div>
                </details>
              </div>
            )}
            <div className="px-3 py-3">
              <details className="group">
                <summary className="w-full text-sm cursor-pointer select-none text-zinc-300 flex items-center justify-center gap-1 py-1.5 rounded-md border border-zinc-800 bg-zinc-900/60 text-center [&::-webkit-details-marker]:hidden">
                  More models <svg className="inline-block h-4 w-4 md:h-5 md:w-5 shrink-0 text-zinc-400 group-open:rotate-180 transition" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="m6 9 6 6 6-6" />
                  </svg>
                </summary>
                <div className="mt-2 space-y-2">
                  {MODEL_CHOICES.map(m => (
                    <button key={m.id} className={`w-full text-left text-sm px-2 py-1 rounded-md border border-transparent hover:border-zinc-700 ${modelId===m.id? 'bg-zinc-800' : ''}`}
                      onClick={() => { selectModel(m.id); setMenuOpen(false); }}>
                      {m.label}
                    </button>
                  ))}
                </div>
              </details>
            </div>
          </div>
        )}

        {/* Messages */}
        <div ref={scrollContainerRef} className="flex-1 min-h-0 overflow-y-auto px-2 md:px-3 lg:px-4 py-6">
          {messages.map(renderMessage)}
          <div ref={messagesEndRef} />
        </div>

        {/* Composer */}
        <form
          onSubmit={handleSubmit}
          className="sticky bottom-0 left-0 right-0 px-2 md:px-3 lg:px-4 pt-2 pb-3 bg-black-900/80 backdrop-blur supports-[backdrop-filter]:bg-black-900/60"
          style={{ paddingBottom: "max(env(safe-area-inset-bottom), 0px)" }}
        >
          <div className="w-full bg-zinc-800/90 border border-zinc-700 rounded-3xl px-3 py-2 flex items-end gap-2">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => {
                setInput(e.target.value);
                autoSize(e.currentTarget);
              }}
              onInput={(e) => autoSize(e.currentTarget)}
              placeholder="Ask anything…"
              rows={1}
              className="flex-1 max-h-40 resize-none bg-transparent border-0 focus:outline-none focus:ring-0 px-2 py-2 text-zinc-100 placeholder-zinc-400 leading-6"
              disabled={isLoading}
            />
            <button
              type="submit"
              disabled={isLoading || !input.trim()}
              className="ml-2 flex h-10 w-10 items-center justify-center rounded-md ring-1 ring-inset ring-zinc-700 bg-zinc-800 text-zinc-100 hover:bg-zinc-700 focus:outline-none focus:ring-2 focus:ring-zinc-500 p-1"
              title="Send"
            >
              {isLoading ? (
                "…"
              ) : (
                <svg className="h-5 w-5 flex-shrink-0 block overflow-visible" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <path d="M12 3a1 1 0 0 1 .707.293l6 6a1 1 0 1 1-1.414 1.414L13 6.414V20a1 1 0 1 1-2 0V6.414l-4.293 4.293A1 1 0 0 1 5.293 9.293l6-6A1 1 0 0 1 12 3z"/>
                </svg>
              )}
            </button>
          </div>
        </form>
      </div>
    );
}
