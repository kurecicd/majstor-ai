"use client";

import { useState, useRef, useEffect, DragEvent, ChangeEvent } from "react";
import {
  Send,
  Loader2,
  HardHat,
  Paperclip,
  FolderUp,
  X,
  FileText,
  Image as ImageIcon,
  Calculator,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import QuotePanel, { Quote, extractQuoteFromResponse } from "./components/QuotePanel";

// ─── Types ────────────────────────────────────────────────────────────────────

type TextBlock = { type: "text"; text: string };
type ImageBlock = {
  type: "image";
  source: { type: "base64"; media_type: string; data: string };
};
type ContentBlock = TextBlock | ImageBlock;

interface Message {
  role: "user" | "assistant";
  content: string;
  blocks?: ContentBlock[];
}

type ExtractedFile =
  | { kind: "text" | "unsupported" | "error" | "skipped"; name: string; text: string }
  | { kind: "image"; name: string; media_type: string; data: string };

// ─── Constants ────────────────────────────────────────────────────────────────

const BACKEND = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:8000";

// ─── Markdown components ──────────────────────────────────────────────────────

const md = {
  h1: ({ children }: { children?: React.ReactNode }) => (
    <h1 className="text-xl font-bold mt-3 mb-1.5 text-gray-900">{children}</h1>
  ),
  h2: ({ children }: { children?: React.ReactNode }) => (
    <h2 className="text-base font-bold mt-4 mb-1.5 text-gray-800 border-b border-gray-200 pb-1">{children}</h2>
  ),
  h3: ({ children }: { children?: React.ReactNode }) => (
    <h3 className="text-sm font-bold mt-3 mb-1 text-gray-700">{children}</h3>
  ),
  p: ({ children }: { children?: React.ReactNode }) => (
    <p className="mb-2 leading-relaxed last:mb-0">{children}</p>
  ),
  ul: ({ children }: { children?: React.ReactNode }) => (
    <ul className="list-disc ml-4 mb-2 space-y-0.5">{children}</ul>
  ),
  ol: ({ children }: { children?: React.ReactNode }) => (
    <ol className="list-decimal ml-4 mb-2 space-y-0.5">{children}</ol>
  ),
  li: ({ children }: { children?: React.ReactNode }) => <li>{children}</li>,
  strong: ({ children }: { children?: React.ReactNode }) => (
    <strong className="font-bold">{children}</strong>
  ),
  em: ({ children }: { children?: React.ReactNode }) => <em className="italic">{children}</em>,
  hr: () => <hr className="my-3 border-gray-200" />,
  table: ({ children }: { children?: React.ReactNode }) => (
    <div className="overflow-x-auto my-3 rounded-lg border border-gray-200">
      <table className="text-xs border-collapse min-w-full">{children}</table>
    </div>
  ),
  thead: ({ children }: { children?: React.ReactNode }) => (
    <thead className="bg-gray-100 text-gray-700">{children}</thead>
  ),
  tbody: ({ children }: { children?: React.ReactNode }) => (
    <tbody className="divide-y divide-gray-100">{children}</tbody>
  ),
  th: ({ children }: { children?: React.ReactNode }) => (
    <th className="px-3 py-2 text-left font-semibold whitespace-nowrap border-b border-gray-200">
      {children}
    </th>
  ),
  td: ({ children }: { children?: React.ReactNode }) => (
    <td className="px-3 py-2 align-top">{children}</td>
  ),
  tr: ({ children }: { children?: React.ReactNode }) => (
    <tr className="hover:bg-gray-50 transition-colors">{children}</tr>
  ),
  blockquote: ({ children }: { children?: React.ReactNode }) => (
    <blockquote className="border-l-4 border-green-600 pl-3 my-2 text-gray-600 italic">{children}</blockquote>
  ),
};

// ─── Main component ───────────────────────────────────────────────────────────

export default function Home() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [attachments, setAttachments] = useState<ExtractedFile[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [showQuote, setShowQuote] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // ── File upload ─────────────────────────────────────────────────────────────

  async function uploadFiles(files: FileList | File[]) {
    const arr = Array.from(files);
    if (arr.length === 0) return;
    setUploading(true);
    try {
      const fd = new FormData();
      for (const f of arr) fd.append("files", f, f.name);
      const res = await fetch(`${BACKEND}/api/extract`, { method: "POST", body: fd });
      if (!res.ok) throw new Error(`upload failed: ${res.status}`);
      const data = (await res.json()) as { files: ExtractedFile[] };
      setAttachments((prev) => [...prev, ...data.files]);
    } catch (e) {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: `Upload error: ${(e as Error).message}` },
      ]);
    } finally {
      setUploading(false);
    }
  }

  function onPickFiles(e: ChangeEvent<HTMLInputElement>) {
    if (e.target.files) uploadFiles(e.target.files);
    e.target.value = "";
  }

  function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files?.length) uploadFiles(e.dataTransfer.files);
  }

  function removeAttachment(idx: number) {
    setAttachments((prev) => prev.filter((_, i) => i !== idx));
  }

  // ── Message building ────────────────────────────────────────────────────────

  function buildBlocks(text: string): ContentBlock[] {
    const blocks: ContentBlock[] = [];
    for (const a of attachments) {
      if (a.kind === "image") {
        blocks.push({ type: "image", source: { type: "base64", media_type: a.media_type, data: a.data } });
      }
    }
    const parts: string[] = [];
    if (text.trim()) parts.push(text.trim());
    for (const a of attachments) {
      if (a.kind !== "image") parts.push(`\n--- File: ${a.name} ---\n${a.text}`);
    }
    blocks.push({ type: "text", text: parts.join("\n\n") || "(no text)" });
    return blocks;
  }

  // ── Send ────────────────────────────────────────────────────────────────────

  async function sendMessage(e: React.FormEvent) {
    e.preventDefault();
    if (loading) return;
    if (!input.trim() && attachments.length === 0) return;

    const hasAttachments = attachments.length > 0;
    const displayText = hasAttachments
      ? `${input.trim()}${input.trim() ? "\n\n" : ""}📎 ${attachments.length} file(s): ${attachments.map((a) => a.name).join(", ")}`
      : input.trim();

    const userMsg: Message = {
      role: "user",
      content: displayText,
      blocks: hasAttachments ? buildBlocks(input) : undefined,
    };

    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setInput("");
    setAttachments([]);
    setLoading(true);

    try {
      const wireMessages = newMessages.map((m) => ({
        role: m.role,
        content: m.blocks ?? m.content,
      }));
      const res = await fetch(`${BACKEND}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: wireMessages }),
      });
      if (!res.ok) throw new Error((await res.text()) || `HTTP ${res.status}`);
      const data = await res.json();

      const { display, quote: newQuote } = extractQuoteFromResponse(data.message);
      setMessages([...newMessages, { role: "assistant", content: display }]);
      if (newQuote) {
        setQuote(newQuote);
        setShowQuote(true);
      }
    } catch (err) {
      setMessages([
        ...newMessages,
        { role: "assistant", content: `Error: ${(err as Error).message}` },
      ]);
    } finally {
      setLoading(false);
    }
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div
      className="flex h-screen overflow-hidden max-w-7xl mx-auto"
      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={onDrop}
    >
      {dragOver && (
        <div className="fixed inset-0 z-50 bg-green-700/20 border-4 border-dashed border-green-700 flex items-center justify-center pointer-events-none">
          <p className="text-2xl font-bold text-green-900">Drop files here</p>
        </div>
      )}

      {/* ── Chat column ── */}
      <div className="flex flex-col flex-1 min-w-0 px-4 py-6 max-w-3xl mx-auto w-full">

        {/* Header */}
        <div className="flex items-center gap-3 mb-6 shrink-0">
          <div className="bg-green-700 text-white p-2 rounded-xl">
            <HardHat size={28} />
          </div>
          <div className="flex-1">
            <h1 className="text-2xl font-bold text-gray-900">Majstor AI</h1>
            <p className="text-sm text-gray-500">AI assistant for builders</p>
          </div>
          {quote && (
            <button
              onClick={() => setShowQuote(!showQuote)}
              className={`flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-medium transition-colors border ${
                showQuote
                  ? "bg-green-700 text-white border-green-700"
                  : "bg-green-50 text-green-700 border-green-200 hover:bg-green-100"
              }`}
            >
              <Calculator size={16} />
              Quote
            </button>
          )}
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto space-y-4 mb-4 min-h-0">
          {messages.length === 0 && (
            <div className="text-center text-gray-400 mt-20">
              <HardHat size={48} className="mx-auto mb-4 opacity-30" />
              <p className="text-lg">Describe your job and I&apos;ll help you estimate materials and cost.</p>
              <p className="text-sm mt-2">Works in Swedish, Bosnian/Croatian, or English.</p>
              <p className="text-xs mt-4 text-gray-400">
                Attach PDFs, Word, Excel, CSV, images — single files, multiple, or whole folders.
              </p>
            </div>
          )}
          {messages.map((msg, i) => (
            <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
              <div
                className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm ${
                  msg.role === "user"
                    ? "bg-green-700 text-white whitespace-pre-wrap"
                    : "bg-white border border-gray-200 text-gray-800 shadow-sm"
                }`}
              >
                {msg.role === "user" ? (
                  msg.content
                ) : (
                  <ReactMarkdown remarkPlugins={[remarkGfm]} components={md}>
                    {msg.content}
                  </ReactMarkdown>
                )}
              </div>
            </div>
          ))}
          {loading && (
            <div className="flex justify-start">
              <div className="bg-white border border-gray-200 rounded-2xl px-4 py-3 shadow-sm">
                <Loader2 size={18} className="animate-spin text-green-700" />
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        {/* Attachment chips */}
        {(attachments.length > 0 || uploading) && (
          <div className="flex flex-wrap gap-2 mb-2 shrink-0">
            {attachments.map((a, i) => (
              <div
                key={i}
                className="flex items-center gap-1.5 bg-gray-100 border border-gray-200 rounded-lg px-2 py-1 text-xs text-gray-700"
              >
                {a.kind === "image" ? <ImageIcon size={14} /> : <FileText size={14} />}
                <span className="max-w-[180px] truncate">{a.name}</span>
                <button onClick={() => removeAttachment(i)} className="hover:text-red-600">
                  <X size={14} />
                </button>
              </div>
            ))}
            {uploading && (
              <div className="flex items-center gap-1.5 text-xs text-gray-500">
                <Loader2 size={14} className="animate-spin" /> uploading…
              </div>
            )}
          </div>
        )}

        {/* Input */}
        <form onSubmit={sendMessage} className="flex gap-2 items-end shrink-0">
          <input ref={fileInputRef} type="file" multiple className="hidden" onChange={onPickFiles} />
          <input
            ref={folderInputRef}
            type="file"
            multiple
            // @ts-expect-error non-standard but widely supported
            webkitdirectory=""
            directory=""
            className="hidden"
            onChange={onPickFiles}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading || loading}
            className="border border-gray-300 text-gray-600 p-3 rounded-xl hover:bg-gray-50 disabled:opacity-50"
            title="Attach files"
          >
            <Paperclip size={18} />
          </button>
          <button
            type="button"
            onClick={() => folderInputRef.current?.click()}
            disabled={uploading || loading}
            className="border border-gray-300 text-gray-600 p-3 rounded-xl hover:bg-gray-50 disabled:opacity-50"
            title="Attach folder"
          >
            <FolderUp size={18} />
          </button>
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Describe the job (e.g. paint a room 4x5m, lay terrace 20m²...)"
            className="flex-1 border border-gray-300 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-green-600 bg-white"
            disabled={loading}
          />
          <button
            type="submit"
            disabled={loading || uploading || (!input.trim() && attachments.length === 0)}
            className="bg-green-700 text-white px-4 py-3 rounded-xl hover:bg-green-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <Send size={18} />
          </button>
        </form>
      </div>

      {/* ── Quote panel ── */}
      {showQuote && quote && (
        <div className="w-[460px] flex-shrink-0 flex flex-col border-l border-gray-200 overflow-hidden">
          <QuotePanel quote={quote} onChange={setQuote} />
        </div>
      )}
    </div>
  );
}
