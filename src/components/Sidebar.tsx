import { useEffect, useState } from "react";

type ConvMeta = { id: string; title: string; model: string; createdAt: number; updatedAt: number };

export default function Sidebar() {
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
      setItems(list);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { fetchList(); }, []);

  async function newChat() {
    try {
      await fetch("/.netlify/functions/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newConversation: true }),
      });
      localStorage.removeItem("conversationId");
      location.reload();
    } catch {}
  }

  async function openChat(id: string) {
    try {
      localStorage.setItem("conversationId", id);
      location.reload();
    } catch {}
  }

  async function deleteChat(id: string) {
    try {
      await fetch(`/.netlify/functions/conversations?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      if (activeId === id) localStorage.removeItem("conversationId");
      fetchList();
    } catch {}
  }

  return (
    <div className="flex-1 flex flex-col">
      <div className="p-4 border-b border-gray-100 dark:border-zinc-800 flex items-center justify-between">
        <div className="text-sm font-semibold">Conversations</div>
        <button
          type="button"
          className="px-2 py-1 text-xs rounded-md border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 hover:bg-gray-50 dark:hover:bg-zinc-700"
          onClick={newChat}
        >New</button>
      </div>

      <div className="p-2">
        {loading && <div className="text-xs text-gray-500">Loading…</div>}
        {error && <div className="text-xs text-red-600">{error}</div>}
        <nav className="space-y-1 text-sm">
          {items.map(item => (
            <div key={item.id} className="flex items-center gap-2">
              <a
                className={`flex-1 block px-3 py-2 rounded-lg hover:bg-gray-100 dark:hover:bg-zinc-800 ${activeId===item.id? 'bg-gray-100 dark:bg-zinc-800' : ''}`}
                href="#"
                onClick={(e)=>{e.preventDefault(); openChat(item.id);}}
                title={new Date(item.updatedAt).toLocaleString()}
              >
                <div className="truncate">{item.title || 'Untitled'}</div>
                <div className="text-xs text-gray-500 dark:text-zinc-400">{item.model}</div>
              </a>
              <button
                className="text-xs px-2 py-1 rounded border border-gray-300 dark:border-zinc-700 hover:bg-gray-100 dark:hover:bg-zinc-800"
                onClick={()=>deleteChat(item.id)}
                title="Delete"
              >✕</button>
            </div>
          ))}
          {!loading && !items.length && (
            <div className="text-sm text-gray-600 dark:text-zinc-300 px-2">No conversations yet.</div>
          )}
        </nav>
      </div>
    </div>
  );
}
