"use client";

import { useState, useRef, useEffect } from "react";
import {
  Send,
  Loader2,
  Sparkles,
  X,
  MessageCircle,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface Message {
  role: "user" | "assistant";
  content: string;
}

const md = {
  p: ({ children }: { children?: React.ReactNode }) => (
    <p className="mb-2 leading-relaxed last:mb-0">{children}</p>
  ),
  ul: ({ children }: { children?: React.ReactNode }) => (
    <ul className="list-disc ml-4 mb-2 space-y-0.5">{children}</ul>
  ),
  ol: ({ children }: { children?: React.ReactNode }) => (
    <ol className="list-decimal ml-4 mb-2 space-y-0.5">{children}</ol>
  ),
  strong: ({ children }: { children?: React.ReactNode }) => (
    <strong className="font-bold">{children}</strong>
  ),
  table: ({ children }: { children?: React.ReactNode }) => (
    <div className="overflow-x-auto my-2 rounded border border-gray-200">
      <table className="text-xs border-collapse min-w-full">{children}</table>
    </div>
  ),
  th: ({ children }: { children?: React.ReactNode }) => (
    <th className="px-2 py-1.5 text-left font-semibold bg-gray-100 border-b border-gray-200">
      {children}
    </th>
  ),
  td: ({ children }: { children?: React.ReactNode }) => (
    <td className="px-2 py-1.5 align-top border-b border-gray-100">
      {children}
    </td>
  ),
};

export default function ChatDrawer({ backend }: { backend: string }) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, open]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    if (open) window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (loading || !input.trim()) return;
    const newMessages: Message[] = [
      ...messages,
      { role: "user", content: input.trim() },
    ];
    setMessages(newMessages);
    setInput("");
    setLoading(true);
    try {
      const res = await fetch(`${backend}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: newMessages.map((m) => ({
            role: m.role,
            content: m.content,
          })),
        }),
      });
      const data = await res.json();
      // Strip the <<<QUOTE>>> block — chat drawer only shows display text.
      const text = String(data.message || "");
      const S = "<<<QUOTE>>>";
      const E = "<<<END_QUOTE>>>";
      const si = text.indexOf(S);
      const ei = text.indexOf(E);
      const display =
        si !== -1 && ei !== -1 && ei > si
          ? (text.slice(0, si) + text.slice(ei + E.length)).trim()
          : text;
      setMessages([...newMessages, { role: "assistant", content: display }]);
    } catch (err) {
      setMessages([
        ...newMessages,
        { role: "assistant", content: `Fel: ${(err as Error).message}` },
      ]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      {!open && (
        <button
          onClick={() => setOpen(true)}
          className="fixed bottom-5 right-5 z-30 bg-green-700 hover:bg-green-800 text-white rounded-full shadow-lg pl-4 pr-5 py-3 flex items-center gap-2 font-semibold transition-all"
        >
          <Sparkles size={18} />
          Fråga AI
        </button>
      )}

      {open && (
        <div className="fixed inset-0 z-40 flex">
          <div
            className="flex-1 bg-black/30"
            onClick={() => setOpen(false)}
          />
          <div className="w-full max-w-md bg-white shadow-2xl flex flex-col h-full">
            {/* Header */}
            <div className="px-4 py-3 border-b flex items-center gap-2">
              <div className="bg-green-700 text-white p-1.5 rounded-lg">
                <MessageCircle size={16} />
              </div>
              <div className="flex-1">
                <h3 className="font-bold text-gray-900">Fråga AI</h3>
                <p className="text-xs text-gray-500">
                  Hjälp med material, mängder eller svenska bygginköp
                </p>
              </div>
              <button
                onClick={() => setOpen(false)}
                className="text-gray-400 hover:text-gray-700"
              >
                <X size={18} />
              </button>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {messages.length === 0 && (
                <div className="text-center text-gray-400 mt-12 px-4">
                  <Sparkles size={32} className="mx-auto mb-2 opacity-30" />
                  <p className="text-sm">
                    Ställ en fråga om materialet, mängder eller installation.
                  </p>
                </div>
              )}
              {messages.map((m, i) => (
                <div
                  key={i}
                  className={`flex ${
                    m.role === "user" ? "justify-end" : "justify-start"
                  }`}
                >
                  <div
                    className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm ${
                      m.role === "user"
                        ? "bg-green-700 text-white whitespace-pre-wrap"
                        : "bg-gray-100 text-gray-800"
                    }`}
                  >
                    {m.role === "user" ? (
                      m.content
                    ) : (
                      <ReactMarkdown
                        remarkPlugins={[remarkGfm]}
                        components={md}
                      >
                        {m.content}
                      </ReactMarkdown>
                    )}
                  </div>
                </div>
              ))}
              {loading && (
                <div className="flex justify-start">
                  <div className="bg-gray-100 rounded-2xl px-3 py-2">
                    <Loader2
                      size={14}
                      className="animate-spin text-green-700"
                    />
                  </div>
                </div>
              )}
              <div ref={bottomRef} />
            </div>

            {/* Input */}
            <form
              onSubmit={send}
              className="p-3 border-t bg-gray-50 flex gap-2"
            >
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Skriv en fråga…"
                className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 bg-white"
                disabled={loading}
              />
              <button
                type="submit"
                disabled={loading || !input.trim()}
                className="bg-green-700 hover:bg-green-800 disabled:opacity-50 text-white px-3 py-2 rounded-lg"
              >
                <Send size={16} />
              </button>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
