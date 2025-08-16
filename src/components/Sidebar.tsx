import { useEffect, useState } from "react";

type ConvMeta = { id: string; title: string; model: string; createdAt: number; updatedAt: number };

export default function Sidebar({ onSelect }: { onSelect?: (id: string) => void }) {
  const [items, setItems] = useState<ConvMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(() => {
    try { return localStorage.getItem("conversationId") } catch { return null; }
  });

  async function fetchList() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/.netlify/functions/conversations", { method: "GET" });
      const list: ConvMeta[] = await res.json();
      const sorted = Array.isArray(list) ? [...list].sort((a, b) => b.updatedAt - a.updatedAt) : [];
      setItems(sorted);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setLoading(false);
    }
  }
    const [editingId, setEditingId] = useState<string | null>(null);
    const [tempTitle, setTempTitle] = useState<string>("");

    useEffect(() => {
      function onUpdated() { fetchList(); }
      window.addEventListener("conversations-updated", onUpdated);
      return () => window.removeEventListener("conversations-updated", onUpdated);
    }, []);

    useEffect(() => { fetchList(); }, []);

  async function newChat() {
    try {
      const res = await fetch("/.netlify/functions/conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "New chat", model: "gpt-5-2025-08-07" }),
      });
      const data = await res.json().catch(() => ({} as any));
      const id = data?.id as string | undefined;
      if (id) {
        setActiveId(id);
        try { localStorage.setItem("conversationId", id); } catch {}
        if (onSelect) {
          onSelect(id);
        } else {
          // Fallback for older pages
          window.dispatchEvent(new CustomEvent("open-conversation", { detail: { id } }));
        }
      }
      // refresh list so the new chat appears at top
      fetchList();
    } catch {}
  }

  async function openChat(id: string) {
    try {
      setActiveId(id);
      try { localStorage.setItem("conversationId", id); } catch {}
      if (onSelect) {
        onSelect(id);
      } else {
        window.dispatchEvent(new CustomEvent("open-conversation", { detail: { id } }));
      }
    } catch {}
  }

  async function deleteChat(id: string) {
    try {
      await fetch(`/.netlify/functions/conversations?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      if (activeId === id) localStorage.removeItem("conversationId");
      fetchList();
    } catch {}
  }

  function formatUpdatedAt(ts: number) {
    try {
      return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(ts));
    } catch {
      return new Date(ts).toLocaleString();
    }
  }

  return (
    <div className="flex-1 flex flex-col">
      <div className="h-12 px-3 border-b border-zinc-800 flex items-center justify-between">
        <div className="text-xs uppercase tracking-wide text-zinc-400">Conversations</div>
        <button
          type="button"
          className="h-8 w-8 inline-flex items-center justify-center rounded-md border border-zinc-700 bg-zinc-800 hover:bg-zinc-700"
          onClick={newChat}
          title="New chat"
          aria-label="New chat"
        >+
        </button>
      </div>

      <div className="p-2">
        {loading && <div className="text-xs text-zinc-500">Loading…</div>}
        {error && <div className="text-xs text-red-600">{error}</div>}
        <nav className="space-y-1 text-sm">
          {items.map(item => (
            <div key={item.id} className="group flex items-center gap-2 rounded-md px-1">
              {editingId === item.id ? (
                <form
                  className="flex-1"
                  onSubmit={async (e) => {
                    e.preventDefault();
                    const title = (tempTitle || "New chat").trim();
                    try {
                      await fetch("/.netlify/functions/conversations", {
                        method: "PATCH",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ id: item.id, title }),
                      });
                      setEditingId(null);
                      setTempTitle("");
                      fetchList();
                      window.dispatchEvent(new CustomEvent("conversations-updated"));
                    } catch (err) {
                      console.error("rename failed", err);
                    }
                  }}
                >
                  <input
                    autoFocus
                    value={tempTitle}
                    onChange={(e) => setTempTitle(e.target.value)}
                    onBlur={async (e) => {
                      const title = e.target.value.trim();
                      if (!title) { setEditingId(null); setTempTitle(""); return; }
                      try {
                        await fetch("/.netlify/functions/conversations", {
                          method: "PATCH",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ id: item.id, title }),
                        });
                        setEditingId(null);
                        setTempTitle("");
                        fetchList();
                        window.dispatchEvent(new CustomEvent("conversations-updated"));
                      } catch (err) { console.error("rename failed", err); }
                    }}
                    className="w-full px-2 py-1 rounded-md bg-zinc-800 border border-zinc-700 text-zinc-100 text-sm"
                  />
                </form>
              ) : (
                <>
                  <a
                    className={`flex-1 block px-3 py-2 rounded-md transition-colors ${
                      activeId===item.id ? 'bg-zinc-800' : 'hover:bg-zinc-800/60'
                    } focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400`}
                    href="#"
                    onClick={(e)=>{e.preventDefault(); openChat(item.id);}}
                    title={formatUpdatedAt(item.updatedAt)}
                  >
                    <div className="truncate text-zinc-200">{item.title || 'New chat'}</div>
                    <div className="text-[11px] text-zinc-400">{item.model}</div>
                  </a>
                  <div className="flex items-center gap-1 transition-opacity opacity-100 md:opacity-0 md:group-hover:opacity-100 focus-within:opacity-100">
                    <button
                      className="h-7 w-7 rounded-md border border-zinc-700 hover:bg-zinc-800 text-zinc-300"
                      onClick={() => { setEditingId(item.id); setTempTitle(item.title || 'New chat'); }}
                      title="Rename"
                      aria-label="Rename"
                    >✎</button>
                    <button
                      className="h-7 w-7 rounded-md border border-zinc-700 hover:bg-zinc-800 text-zinc-300"
                      onClick={()=>deleteChat(item.id)}
                      title="Delete"
                      aria-label="Delete"
                    >✕</button>
                  </div>
                </>
              )}
            </div>
          ))}
          {!loading && !items.length && (
            <div className="text-sm text-zinc-400 px-2">No conversations yet.</div>
          )}
        </nav>
      </div>
    </div>
  );
}
