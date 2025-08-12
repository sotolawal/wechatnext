import type { Context } from "@netlify/functions";
import { getDeployStore } from "@netlify/blobs";
import OpenAI from "openai";

const CHAT_KEY = "current-chat";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const MODEL = process.env.OPENAI_MODEL ?? "gpt-4o-mini";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export default async function (req: Request, _ctx: Context) {
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  try {
    const { message, newConversation } = await req.json();

    const store = getDeployStore({ name: "chat-history" });

    if (newConversation) {
      await store.setJSON(CHAT_KEY, []);
      return new Response("OK", { status: 200 });
    }

    if (!message || typeof message !== "string" || !message.trim()) {
      return new Response("Message is required", { status: 400 });
    }

    const history =
      (await store.getJSON<ChatMessage[]>(CHAT_KEY)) ?? [];

    const updatedHistory: ChatMessage[] = [
      ...history,
      { role: "user", content: message.trim() },
    ];

    const stream = await openai.chat.completions.create({
      model: MODEL,
      messages: updatedHistory,
      temperature: 0.2,
      stream: true,
    });

    return new Response(
      new ReadableStream({
        async start(controller) {
          const enc = new TextEncoder();
          let assistant = "";

          try {
            for await (const chunk of stream) {
              const delta = chunk.choices?.[0]?.delta?.content ?? "";
              if (delta) {
                assistant += delta;
                controller.enqueue(enc.encode(delta));
              }
            }

            await store.setJSON(CHAT_KEY, [
              ...updatedHistory,
              { role: "assistant", content: assistant },
            ]);
          } finally {
            controller.close();
          }
        },
      }),
      {
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "Cache-Control": "no-cache",
        },
      }
    );
  } catch (err: any) {
    console.error("Function error:", err?.message ?? err);
    return new Response("Internal Server Error", { status: 500 });
  }
}
