// netlify/functions/conversations.ts
import type { Context } from "@netlify/functions";
import { getStore } from "@netlify/blobs";
const store = getStore({ name: "chat" });

interface ConvMeta { id: string; title: string; model: string; createdAt: number; updatedAt: number }

const store = getDeployStore({ name: "chat" });
const INDEX_KEY = "conversations/index.json";

async function loadIndex(): Promise<ConvMeta[]> {
  try {
    const raw = await store.get(INDEX_KEY, { type: "json" });
    return Array.isArray(raw) ? (raw as ConvMeta[]) : [];
  } catch (e) {
    // Corrupt/missing index → start fresh
    return [];
  }
}

async function saveIndex(list: ConvMeta[]) {
  await store.set(INDEX_KEY, JSON.stringify(list));
}

export default async function (req: Request, _ctx: Context) {
  const url = new URL(req.url);
  const method = req.method.toUpperCase();

  try {
    if (method === "GET") {
      const list = await loadIndex();
      list.sort((a, b) => b.updatedAt - a.updatedAt);
      return new Response(JSON.stringify(list), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (method === "POST") {
      let body: any = {};
      try { body = await req.json(); } catch {}

      const title: string = (body?.title ?? "New chat").toString();
      const model: string = (body?.model ?? (process.env.OPENAI_MODEL ?? "gpt-4o-mini")).toString();

      const id = crypto.randomUUID();
      const now = Date.now();
      const meta: ConvMeta = { id, title: title.slice(0, 60), model, createdAt: now, updatedAt: now };

      const list = await loadIndex();
      await saveIndex([meta, ...list]);

      // Create empty conversation blob if not present
      await store.set(`conversations/${id}.json`, JSON.stringify([]));

      return new Response(JSON.stringify({ id }), {
        status: 200,
        headers: { "Content-Type": "application/json", "X-Conversation-Id": id },
      });
    }

    if (method === "DELETE") {
      const id = url.searchParams.get("id");
      if (!id) {
        return new Response(JSON.stringify({ error: "id required" }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }

      const list = await loadIndex();
      const next = list.filter((x) => x.id !== id);
      await saveIndex(next);

      try {
        // optional: delete the conversation blob if supported by SDK
        // @ts-ignore
        if (typeof (store as any).delete === "function") {
          // @ts-ignore
          await (store as any).delete(`conversations/${id}.json`);
        }
      } catch {}

      return new Response("OK", {
        status: 200,
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      });
    }

    return new Response("Method Not Allowed", { status: 405 });
  } catch (err: any) {
    console.error("conversations error:", err?.message ?? err);
    return new Response(
      JSON.stringify({ error: "server", message: err?.message ?? String(err) }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}
