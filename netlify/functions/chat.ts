import type { Context } from "@netlify/functions";
import { getDeployStore } from "@netlify/blobs";
import OpenAI from "openai";

const CHAT_KEY = "current-chat";
const MODEL = process.env.OPENAI_MODEL ?? "gpt-4o-mini";

type Role = "user" | "assistant";
interface ChatMessage {
  role: Role;
  content: string;
}

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export const handler: Handler = async (req: Request, context: Context) => {
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  try {
    const { message, newConversation } = await req.json();
    const store = getDeployStore({ name: "chat-history" });

    if (newConversation) {
      // clear conversation
      await store.set(CHAT_KEY, JSON.stringify([]));
      return new Response("OK", {
        status: 200,
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      });
    }

    if (!message || typeof message !== "string" || !message.trim()) {
      return new Response("Message is required", { status: 400 });
    }

    const history =
      ((await store.get(CHAT_KEY, { type: "json" })) as ChatMessage[] | null) ??
      [];

    const updatedHistory: ChatMessage[] = [
      ...history,
      { role: "user", content: message.trim() },
    ];

    const stream = await openai.chat.completions.create({
      model: MODEL,
      messages: updatedHistory,
      stream: true,
    });

    return new Response(
      new ReadableStream({
        async start(controller) {
          const enc = new TextEncoder();
          let assistantMessage = "";

          try {
            for await (const chunk of stream) {
              const delta = chunk.choices?.[0]?.delta?.content ?? "";
              if (delta) {
                assistantMessage += delta;
                controller.enqueue(enc.encode(delta));
              }
            }

            await store.set(
              CHAT_KEY,
              JSON.stringify([
                ...updatedHistory,
                { role: "assistant", content: assistantMessage },
              ])
            );
          } finally {
            controller.close();
          }
        },
      }),
      {
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "Cache-Control": "no-cache",
          "Connection": "keep-alive",
        },
      }
    );
  } catch (err: any) {
    console.error("Function error:", err?.message ?? err);
    return new Response("Internal Server Error", { status: 500 });
  }
}
