import { useState, useRef, useEffect } from "react";

// Create a type to help differentiate the source of a message and its content
interface Message {
  role: "user" | "assistant";
  content: string;
}

export default function Chat() {
  // We're storing our messages in an array in state so we can deliver structured conversation to Blob storage
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [hasContext, setHasContext] = useState(false);

  // These refs allow us to manage state for the input & scroll view
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  function scrollToBottom() {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }

  function handleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    setInput(e.target.value);
  }

  // Send a boolean that will clear the conversation's history
  async function startNewConversation() {
    try {
      await fetch("/.netlify/functions/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newConversation: true }),
      });
      setMessages([]);
      setHasContext(false);
    } catch (error) {
      console.error("Error starting new conversation:", error);
    }
  }

  /**
   * Processes a streamed response from our API, updating the messages state
   * incrementally as chunks of the response arrive. Creates an empty assistant
   * message first, then updates it with incoming content until the stream ends.
   */
  async function processStreamedResponse(reader: ReadableStreamDefaultReader<Uint8Array>) {
    let assistantMessage = "";
    setMessages((prev) => [...prev, { role: "assistant", content: "" }]);

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const text = new TextDecoder().decode(value);
      assistantMessage += text;
      setMessages((prev) => [
        ...prev.slice(0, -1),
        { role: "assistant", content: assistantMessage },
      ]);
    }
  }

  // Submit user messages and invoke `processStreamedResponse` to handle our bot's returned message as it streams
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!input.trim() || isLoading) return;

    const userMessage = { role: "user" as const, content: input.trim() };
    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setIsLoading(true);

    try {
      const response = await fetch("/.netlify/functions/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: userMessage.content }),
      });

      if (!response.ok) throw new Error("Network response was not ok");

      const reader = response.body?.getReader();
      if (!reader) throw new Error("No reader available");

      await processStreamedResponse(reader);
      setHasContext(true);
    } catch (error) {
      console.error("Error:", error);
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: "Sorry, there was an error processing your request.",
        },
      ]);
    } finally {
      setIsLoading(false);
    }
  }

  function renderMessage(message: Message, index: number) {
    return (
      <div
        key={index}
        className={`mb-3 px-4 py-3 rounded-2xl shadow ${
          message.role === "user"
            ? "ml-auto bg-blue-500 text-white"
            : "mr-auto bg-gray-200 text-gray-900"
        } max-w-[75%]`}
      >
        <strong>{message.role === "user" ? "You: " : "AI: "}</strong>
        <span>{message.content}</span>
      </div>
    );
  }

  // Separate  our effects to avoid unnecessary re-renders
  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  useEffect(() => {
    if (!isLoading) {
      inputRef.current?.focus();
    }
  }, [isLoading]);

  return (
    <div className="flex flex-col h-[600px] border border-gray-100 rounded-3xl bg-white shadow-lg max-w-2xl mx-auto">
      <div className="flex justify-between items-center px-6 py-4 border-b border-gray-100">
        <span className="text-sm text-gray-500">
          {hasContext ? "Conversation context: On" : "New conversation"}
        </span>
        <button
          onClick={startNewConversation}
          className="px-4 py-1.5 text-sm text-gray-700 border border-gray-300 rounded-lg bg-white transition hover:bg-gray-50 hover:text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-400 disabled:opacity-60 disabled:cursor-not-allowed"
          disabled={isLoading}>
          New Conversation
        </button>
      </div>
      <div className="flex-1 overflow-y-auto px-6 py-4">
        {messages.map(renderMessage)}
        <div ref={messagesEndRef} />
      </div>
      <form onSubmit={handleSubmit} className="flex items-center gap-3 px-6 py-4 border-t border-gray-100 bg-gray-50">
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={handleInputChange}
          placeholder="Type your message..."
          className="flex-1 px-4 py-2 border border-gray-200 rounded-lg text-base bg-white focus:outline-none focus:ring-2 focus:ring-blue-400 transition disabled:bg-gray-100 disabled:cursor-not-allowed"
          disabled={isLoading}
        />
        <button
          type="submit"
          disabled={isLoading}
          className="px-5 py-2 bg-blue-500 text-white rounded-lg shadow transition hover:bg-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-400 text-base disabled:bg-blue-300 disabled:cursor-not-allowed"
        >
          {isLoading ? "Sending..." : "Send"}
        </button>
      </form>
    </div>
  );
}
