"use client";

import { useState, useRef, useEffect, DragEvent, ChangeEvent } from "react";
import { Send, Loader2, HardHat, Paperclip, FolderUp, X, FileText, Image as ImageIcon } from "lucide-react";

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

const BACKEND = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:8000";

export default function Home() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [attachments, setAttachments] = useState<ExtractedFile[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

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
        { role: "assistant", content: `Greška pri uploadu: ${(e as Error).message}` },
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
    const items = e.dataTransfer.files;
    if (items && items.length) uploadFiles(items);
  }

  function removeAttachment(idx: number) {
    setAttachments((prev) => prev.filter((_, i) => i !== idx));
  }

  function buildBlocks(text: string): ContentBlock[] {
    const blocks: ContentBlock[] = [];
    for (const a of attachments) {
      if (a.kind === "image") {
        blocks.push({
          type: "image",
          source: { type: "base64", media_type: a.media_type, data: a.data },
        });
      }
    }
    const textParts: string[] = [];
    if (text.trim()) textParts.push(text.trim());
    for (const a of attachments) {
      if (a.kind !== "image") {
        textParts.push(`\n--- File: ${a.name} ---\n${a.text}`);
      }
    }
    blocks.push({ type: "text", text: textParts.join("\n\n") || "(no text)" });
    return blocks;
  }

  async function sendMessage(e: React.FormEvent) {
    e.preventDefault();
    if (loading) return;
    if (!input.trim() && attachments.length === 0) return;

    const hasAttachments = attachments.length > 0;
    const displayText = hasAttachments
      ? `${input.trim()}${input.trim() ? "\n\n" : ""}📎 ${attachments.length} file(s): ${attachments
          .map((a) => a.name)
          .join(", ")}`
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
      if (!res.ok) {
        const errText = await res.text();
        throw new Error(errText || `HTTP ${res.status}`);
      }
      const data = await res.json();
      setMessages([...newMessages, { role: "assistant", content: data.message }]);
    } catch (err) {
      setMessages([
        ...newMessages,
        { role: "assistant", content: `Greška: ${(err as Error).message}` },
      ]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      className="flex flex-col h-screen max-w-3xl mx-auto px-4 py-6"
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={onDrop}
    >
      {dragOver && (
        <div className="fixed inset-0 z-50 bg-green-700/20 border-4 border-dashed border-green-700 flex items-center justify-center pointer-events-none">
          <p className="text-2xl font-bold text-green-900">Drop files here</p>
        </div>
      )}

      <div className="flex items-center gap-3 mb-6">
        <div className="bg-green-700 text-white p-2 rounded-xl">
          <HardHat size={28} />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Majstor AI</h1>
          <p className="text-sm text-gray-500">AI assistant for builders</p>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto space-y-4 mb-4">
        {messages.length === 0 && (
          <div className="text-center text-gray-400 mt-20">
            <HardHat size={48} className="mx-auto mb-4 opacity-30" />
            <p className="text-lg">
              Describe your job and I&apos;ll help you estimate materials and cost.
            </p>
            <p className="text-sm mt-2">Works in Swedish, Bosnian/Croatian, or English.</p>
            <p className="text-xs mt-4 text-gray-400">
              Attach PDFs, Word, Excel, CSV, images — single files, multiple, or whole folders.
            </p>
          </div>
        )}
        {messages.map((msg, i) => (
          <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
            <div
              className={`max-w-[80%] rounded-2xl px-4 py-3 text-sm whitespace-pre-wrap ${
                msg.role === "user"
                  ? "bg-green-700 text-white"
                  : "bg-white border border-gray-200 text-gray-800 shadow-sm"
              }`}
            >
              {msg.content}
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

      {(attachments.length > 0 || uploading) && (
        <div className="flex flex-wrap gap-2 mb-2">
          {attachments.map((a, i) => (
            <div
              key={i}
              className="flex items-center gap-1.5 bg-gray-100 border border-gray-200 rounded-lg px-2 py-1 text-xs text-gray-700"
              title={a.kind === "image" ? `${a.name} (image)` : `${a.name} (${a.kind})`}
            >
              {a.kind === "image" ? <ImageIcon size={14} /> : <FileText size={14} />}
              <span className="max-w-[180px] truncate">{a.name}</span>
              <button
                type="button"
                onClick={() => removeAttachment(i)}
                className="hover:text-red-600"
                aria-label="Remove"
              >
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

      <form onSubmit={sendMessage} className="flex gap-2 items-end">
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={onPickFiles}
        />
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
  );
}
