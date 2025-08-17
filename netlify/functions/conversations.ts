// netlify/functions/conversations.ts
import type { Context } from "@netlify/functions";

import { getStore, getDeployStore } from "@netlify/blobs";

function makeStore(name: string, req?: Request, ctx?: Context) {
  // 1) Prefer durable store when NETLIFY_BLOBS_CONTEXT is available
  const ctxJson = process.env.NETLIFY_BLOBS_CONTEXT;
  if (ctxJson) {
    try {
      const parsed = JSON.parse(ctxJson);
      const { siteID, token } = parsed || {};
      if (siteID && token) {
        return getStore({ name, siteID, token });
      }
    } catch {
      // fall through
    }
  }

  // 2) Try to discover a deploy ID from multiple sources
  const envDeploy =
    process.env.DEPLOY_ID ||
    process.env.NETLIFY_DEPLOY_ID ||
    process.env.COMMIT_REF; // sometimes present in builds

  const headerDeploy =
    (req && (req.headers.get("x-nf-deploy-id") || req.headers.get("x-nf-runtime-deploy-id"))) || null;

  // Some runtimes expose deployment on the Context object
  // @ts-ignore - not typed on Context in all versions
  const ctxDeploy = (ctx && ((ctx as any).deployment?.id || (ctx as any).deployID)) || null;

  const deployID = headerDeploy || ctxDeploy || envDeploy;
  if (deployID) {
    return getDeployStore({ name, deployID });
  }

  // 3) Fallback: attempt durable store without explicit context (works on some plans)
  try {
    return getStore({ name });
  } catch {
    throw new Error(
      "Netlify Blobs not configured. Run with `netlify dev` locally, or ensure NETLIFY_BLOBS_CONTEXT or DEPLOY_ID is set."
    );
  }
}

interface ConvMeta { id: string; title: string; model: string; createdAt: number; updatedAt: number }

const INDEX_KEY = "conversations/index.json";

async function loadIndex(store: ReturnType<typeof getStore> | ReturnType<typeof getDeployStore>): Promise<ConvMeta[]> {
  try {
    const raw = await store.get(INDEX_KEY, { type: "json" });
    return Array.isArray(raw) ? (raw as ConvMeta[]) : [];
  } catch (e) {
    // Corrupt/missing index → start fresh
    return [];
  }
}

async function saveIndex(store: ReturnType<typeof getStore> | ReturnType<typeof getDeployStore>, list: ConvMeta[]) {
  await store.set(INDEX_KEY, JSON.stringify(list));
}

export default async function (req: Request, _ctx: Context) {
  const store = makeStore("chat", req, _ctx);

  const url = new URL(req.url);
  const method = req.method.toUpperCase();

  try {
    if (method === "GET") {
      const list = await loadIndex(store);
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
      const model: string = (body?.model ?? (process.env.OPENAI_MODEL ?? "gpt-5-nano-2025-08-07")).toString();

      const id = crypto.randomUUID();
      const now = Date.now();
      const meta: ConvMeta = { id, title: title.slice(0, 60), model, createdAt: now, updatedAt: now };

      const list = await loadIndex(store);
      await saveIndex(store, [meta, ...list]);

      // Create empty conversation blob if not present
      await store.set(`conversations/${id}.json`, JSON.stringify([]));

      return new Response(JSON.stringify({ id }), {
        status: 200,
        headers: { "Content-Type": "application/json", "X-Conversation-Id": id },
      });
    }

    if (method === "PATCH") {
      let body: any = {};
      try { body = await req.json(); } catch {}
      const id = String(body?.id || "");
      const rawTitle = (typeof body?.title === "string" ? body.title : undefined);
      const rawModel = (typeof body?.model === "string" ? body.model : undefined);
      const title = typeof rawTitle === "string" ? rawTitle.slice(0, 60) : undefined;
      const model = typeof rawModel === "string" ? rawModel : undefined;

      if (!id || (!title && !model)) {
        return new Response(JSON.stringify({ error: "id and one of {title, model} required" }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }

      const list = await loadIndex(store);
      const idx = list.findIndex((x) => x.id === id);
      if (idx < 0) {
        return new Response(JSON.stringify({ error: "not_found" }), {
          status: 404,
          headers: { "Content-Type": "application/json" },
        });
      }

      // Update fields
      const now = Date.now();
      if (title !== undefined) list[idx].title = title;
      if (model !== undefined) list[idx].model = model;
      list[idx].updatedAt = now;
      await saveIndex(store, list);

      return new Response(JSON.stringify(list[idx]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
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

      const list = await loadIndex(store);
      const next = list.filter((x) => x.id !== id);
      await saveIndex(store, next);

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
