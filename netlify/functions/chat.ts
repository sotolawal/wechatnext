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

import OpenAI from "openai";

type Role = "user" | "assistant";
interface ChatMessage { role: Role; content: string; ts: number }
interface BodyIn {
  message?: string;
  newConversation?: boolean;
  conversationId?: string;
  model?: string;
}

const FALLBACK_MODEL = process.env.OPENAI_MODEL ?? "gpt-4o-mini";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

function keyFor(id: string) {
  return `conversations/${id}.json`;
}

export default async function (req: Request, _ctx: Context) {
  const store = makeStore("chat", req, _ctx);
  // Health check without touching OpenAI/Blobs
  const url = new URL(req.url);
  if (url.searchParams.get("ping") === "1") {
    return new Response("OK", {
      status: 200,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  if (!process.env.OPENAI_API_KEY) {
    console.error("Missing OPENAI_API_KEY");
    return new Response(
      JSON.stringify({ error: "Missing OPENAI_API_KEY" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }

  const debug = url.searchParams.get("debug") === "1";

  try {
    const { message, newConversation, conversationId, model }: BodyIn = await req.json();

    // Validate/resolve model
    const chosenModel = (typeof model === "string" && model.trim())
      ? model.trim()
      : FALLBACK_MODEL;
    // Light sanity check: allow any typical model id (letters, numbers, dashes, dots, underscores)
    if (!/^[a-zA-Z0-9._-]{1,200}$/.test(chosenModel)) {
      return new Response(
        JSON.stringify({ error: "invalid_model", message: "Model id has invalid characters." }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    // Determine conversation id
    let id = (typeof conversationId === "string" && conversationId.trim())
      ? conversationId.trim()
      : crypto.randomUUID();
    const blobKey = keyFor(id);

    if (newConversation) {
      await store.set(blobKey, JSON.stringify([]));
      return new Response("OK", {
        status: 200,
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "X-Conversation-Id": id,
        },
      });
    }

    if (!message || typeof message !== "string" || !message.trim()) {
      return new Response(
        JSON.stringify({ error: "Message is required" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    // Load history (may be null on first run)
    const history = (await store.get(blobKey, { type: "json" })) as ChatMessage[] | null ?? [];
    const now = Date.now();
    const updatedHistory: ChatMessage[] = [
      ...history,
      { role: "user", content: message.trim(), ts: now },
    ];

    // --- Non-stream debug path: return JSON so you can see real errors/status
    if (debug) {
      try {
        const completion = await openai.chat.completions.create({
          model: chosenModel,
          messages: updatedHistory.map(({ role, content }) => ({ role, content })),
          temperature: 0.2,
        });
        const reply = completion.choices[0]?.message?.content ?? "";
        const ts = Date.now();
        await store.set(
          blobKey,
          JSON.stringify([...updatedHistory, { role: "assistant", content: reply, ts }])
        );
        return new Response(JSON.stringify({ reply, conversationId: id }), {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            "X-Conversation-Id": id,
          },
        });
      } catch (e: any) {
        console.error("OpenAI error (debug):", e?.status, e?.message);
        return new Response(JSON.stringify({
          error: "openai",
          status: e?.status ?? 500,
          message: e?.message ?? String(e),
        }), { status: e?.status ?? 500, headers: { "Content-Type": "application/json" } });
      }
    }

    // --- Streaming path
    const stream = await openai.chat.completions.create({
      model: chosenModel,
      messages: updatedHistory.map(({ role, content }) => ({ role, content })),
      temperature: 0.2,
      stream: true,
    });

    return new Response(
      new ReadableStream({
        async start(controller) {
          const enc = new TextEncoder();
          let assistant = "";

          try {
            // Flush headers immediately to avoid 502/“status 0” if later errors happen
            controller.enqueue(enc.encode(""));

            for await (const chunk of stream) {
              const delta = chunk.choices?.[0]?.delta?.content ?? "";
              if (delta) {
                assistant += delta;
                controller.enqueue(enc.encode(delta));
              }
            }

            const ts = Date.now();
            await store.set(
              blobKey,
              JSON.stringify([...updatedHistory, { role: "assistant", content: assistant, ts }])
            );
          } catch (e) {
            console.error("Streaming error:", e);
            controller.enqueue(new TextEncoder().encode("\n[stream aborted]\n"));
          } finally {
            controller.close();
          }
        },
      }),
      {
        status: 200,
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "Cache-Control": "no-cache",
          "X-Conversation-Id": id,
        },
      }
    );
  } catch (err: any) {
    console.error("Function error:", err?.message ?? err, err);
    return new Response(
      JSON.stringify({ error: "Internal Server Error", message: err?.message ?? String(err) }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}
