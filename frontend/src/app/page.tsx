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
  FolderOpen,
  ChevronLeft,
  Trash2,
  Zap,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import QuotePanel, { Quote, extractQuoteFromResponse } from "./components/QuotePanel";

// ─── Types ────────────────────────────────────────────────────────────────────

type Step = "new" | "upload" | "analyzing" | "chat";

interface Project {
  id: string;
  name: string;
}

interface StoredFile {
  name: string;
  kind: string;
}

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
    <th className="px-3 py-2 text-left font-semibold whitespace-nowrap border-b border-gray-200">{children}</th>
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
  const [step, setStep] = useState<Step>("new");
  const [project, setProject] = useState<Project | null>(null);
  const [storedFiles, setStoredFiles] = useState<StoredFile[]>([]);
  const [projectName, setProjectName] = useState("");
  const [creatingProject, setCreatingProject] = useState(false);

  // Chat state
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
  const uploadFileRef = useRef<HTMLInputElement>(null);
  const uploadFolderRef = useRef<HTMLInputElement>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);

  // Restore project from localStorage on mount
  useEffect(() => {
    const saved = localStorage.getItem("majstor_project");
    if (!saved) return;
    try {
      const p: Project = JSON.parse(saved);
      fetch(`${BACKEND}/api/projects/${p.id}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => {
          if (data) {
            setProject({ id: data.id, name: data.name });
            setStoredFiles(data.files);
            setStep("upload");
          } else {
            localStorage.removeItem("majstor_project");
          }
        })
        .catch(() => localStorage.removeItem("majstor_project"));
    } catch {
      localStorage.removeItem("majstor_project");
    }
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Focus name input on mount
  useEffect(() => {
    if (step === "new") setTimeout(() => nameInputRef.current?.focus(), 50);
  }, [step]);

  // ── Project management ──────────────────────────────────────────────────────

  async function createProject(e: React.FormEvent) {
    e.preventDefault();
    if (!projectName.trim() || creatingProject) return;
    setCreatingProject(true);
    try {
      const res = await fetch(`${BACKEND}/api/projects`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: projectName.trim() }),
      });
      const data = await res.json();
      setProject(data);
      localStorage.setItem("majstor_project", JSON.stringify(data));
      setStep("upload");
    } finally {
      setCreatingProject(false);
    }
  }

  function newProject() {
    setProject(null);
    setStoredFiles([]);
    setMessages([]);
    setQuote(null);
    setShowQuote(false);
    setProjectName("");
    setAttachments([]);
    setStep("new");
    localStorage.removeItem("majstor_project");
  }

  // ── Project file upload ─────────────────────────────────────────────────────

  async function uploadToProject(files: FileList | File[]) {
    if (!project) return;
    const arr = Array.from(files);
    if (!arr.length) return;
    setUploading(true);
    try {
      const fd = new FormData();
      for (const f of arr) fd.append("files", f, f.name);
      const res = await fetch(`${BACKEND}/api/projects/${project.id}/files`, {
        method: "POST",
        body: fd,
      });
      if (!res.ok) throw new Error(`Upload failed: ${res.status}`);
      const data = await res.json();
      setStoredFiles(data.files);
    } catch (err) {
      alert(`Upload error: ${(err as Error).message}`);
    } finally {
      setUploading(false);
    }
  }

  async function deleteProjectFile(name: string) {
    if (!project) return;
    const res = await fetch(
      `${BACKEND}/api/projects/${project.id}/files?name=${encodeURIComponent(name)}`,
      { method: "DELETE" }
    );
    const data = await res.json();
    setStoredFiles(data.files);
  }

  function onUploadPick(e: ChangeEvent<HTMLInputElement>) {
    if (e.target.files) uploadToProject(e.target.files);
    e.target.value = "";
  }

  function onUploadDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files?.length) uploadToProject(e.dataTransfer.files);
  }

  // ── Analyze ─────────────────────────────────────────────────────────────────

  async function analyzeProject() {
    if (!project) return;
    setStep("analyzing");
    try {
      const res = await fetch(`${BACKEND}/api/projects/${project.id}/analyze`, {
        method: "POST",
      });
      if (!res.ok) throw new Error((await res.text()) || `HTTP ${res.status}`);
      const data = await res.json();
      const { display, quote: newQuote } = extractQuoteFromResponse(data.message);
      const n = storedFiles.length;
      setMessages([
        { role: "user", content: `📋 Analyzing project: ${n} file${n !== 1 ? "s" : ""}` },
        { role: "assistant", content: display },
      ]);
      if (newQuote) {
        setQuote(newQuote);
        setShowQuote(true);
      }
      setStep("chat");
    } catch (err) {
      setMessages([{ role: "assistant", content: `Error: ${(err as Error).message}` }]);
      setStep("chat");
    }
  }

  // ── Chat file upload (ad hoc, not saved to project) ─────────────────────────

  async function uploadChatFiles(files: FileList | File[]) {
    const arr = Array.from(files);
    if (!arr.length) return;
    setUploading(true);
    try {
      const fd = new FormData();
      for (const f of arr) fd.append("files", f, f.name);
      const res = await fetch(`${BACKEND}/api/extract`, { method: "POST", body: fd });
      if (!res.ok) throw new Error(`Upload failed: ${res.status}`);
      const data = (await res.json()) as { files: ExtractedFile[] };
      setAttachments((prev) => [...prev, ...data.files]);
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: `Upload error: ${(err as Error).message}` },
      ]);
    } finally {
      setUploading(false);
    }
  }

  function onChatFilePick(e: ChangeEvent<HTMLInputElement>) {
    if (e.target.files) uploadChatFiles(e.target.files);
    e.target.value = "";
  }

  function onChatDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files?.length) uploadChatFiles(e.dataTransfer.files);
  }

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
      if (a.kind !== "image") parts.push(`\n--- ${a.name} ---\n${a.text}`);
    }
    blocks.push({ type: "text", text: parts.join("\n\n") || "(no text)" });
    return blocks;
  }

  // ── Send chat message ───────────────────────────────────────────────────────

  async function sendMessage(e: React.FormEvent) {
    e.preventDefault();
    if (loading || (!input.trim() && attachments.length === 0)) return;

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
      setMessages([...newMessages, { role: "assistant", content: `Error: ${(err as Error).message}` }]);
    } finally {
      setLoading(false);
    }
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  // ── STEP: New project ───────────────────────────────────────────────────────
  if (step === "new") {
    return (
      <div className="min-h-screen bg-gradient-to-br from-green-50 to-gray-100 flex items-center justify-center p-6">
        <div className="bg-white rounded-2xl shadow-xl p-8 w-full max-w-md">
          <div className="flex items-center gap-3 mb-8">
            <div className="bg-green-700 text-white p-2.5 rounded-xl">
              <HardHat size={28} />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Majstor AI</h1>
              <p className="text-sm text-gray-500">AI assistant for builders</p>
            </div>
          </div>

          <h2 className="text-lg font-semibold text-gray-800 mb-1">New Project</h2>
          <p className="text-sm text-gray-500 mb-4">Give it a name so you can find it later.</p>

          <form onSubmit={createProject} className="space-y-4">
            <input
              ref={nameInputRef}
              value={projectName}
              onChange={(e) => setProjectName(e.target.value)}
              placeholder="e.g. Ilija — Terasa 2026"
              className="w-full border border-gray-300 rounded-xl px-4 py-3 text-base focus:outline-none focus:ring-2 focus:ring-green-600"
            />
            <button
              type="submit"
              disabled={!projectName.trim() || creatingProject}
              className="w-full bg-green-700 text-white py-3 rounded-xl font-semibold hover:bg-green-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
            >
              {creatingProject ? <Loader2 size={18} className="animate-spin" /> : null}
              Create Project →
            </button>
          </form>
        </div>
      </div>
    );
  }

  // ── STEP: Upload files ──────────────────────────────────────────────────────
  if (step === "upload") {
    return (
      <div
        className="min-h-screen bg-gradient-to-br from-green-50 to-gray-100 flex items-center justify-center p-4"
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onUploadDrop}
      >
        {dragOver && (
          <div className="fixed inset-0 z-50 bg-green-700/20 border-4 border-dashed border-green-700 flex items-center justify-center pointer-events-none">
            <p className="text-2xl font-bold text-green-900">Drop files here</p>
          </div>
        )}

        <input ref={uploadFileRef} type="file" multiple className="hidden" onChange={onUploadPick} />
        <input
          ref={uploadFolderRef}
          type="file"
          multiple
          // @ts-expect-error non-standard
          webkitdirectory=""
          directory=""
          className="hidden"
          onChange={onUploadPick}
        />

        <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg overflow-hidden">
          {/* Header */}
          <div className="px-6 py-4 border-b border-gray-100 flex items-center gap-3">
            <div className="bg-green-700 text-white p-1.5 rounded-lg">
              <HardHat size={20} />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs text-gray-400 uppercase tracking-wide">Project</p>
              <h2 className="font-bold text-gray-900 truncate">{project?.name}</h2>
            </div>
            <button onClick={newProject} className="text-xs text-gray-400 hover:text-gray-600 underline shrink-0">
              Change
            </button>
          </div>

          <div className="p-6 space-y-4">
            {/* Drop zone */}
            <div
              className="border-2 border-dashed border-gray-200 rounded-xl p-6 text-center hover:border-green-500 transition-colors cursor-pointer"
              onClick={() => uploadFileRef.current?.click()}
            >
              <FolderOpen size={32} className="mx-auto text-gray-300 mb-2" />
              <p className="text-sm text-gray-500">Drop files here or click to browse</p>
              <p className="text-xs text-gray-400 mt-1">PDF, Word, Excel, CSV, images — everything works</p>
              <div className="flex gap-2 justify-center mt-3">
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); uploadFileRef.current?.click(); }}
                  className="flex items-center gap-1.5 px-3 py-1.5 border border-gray-200 rounded-lg text-xs text-gray-600 hover:bg-gray-50"
                >
                  <Paperclip size={14} /> Files
                </button>
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); uploadFolderRef.current?.click(); }}
                  className="flex items-center gap-1.5 px-3 py-1.5 border border-gray-200 rounded-lg text-xs text-gray-600 hover:bg-gray-50"
                >
                  <FolderUp size={14} /> Folder
                </button>
              </div>
            </div>

            {/* Uploading indicator */}
            {uploading && (
              <div className="flex items-center gap-2 text-sm text-gray-500">
                <Loader2 size={16} className="animate-spin text-green-700" /> Uploading…
              </div>
            )}

            {/* Stored files list */}
            {storedFiles.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">
                  {storedFiles.length} file{storedFiles.length !== 1 ? "s" : ""} stored
                </p>
                <div className="space-y-1 max-h-52 overflow-y-auto">
                  {storedFiles.map((f, i) => (
                    <div key={i} className="flex items-center gap-2 p-2 rounded-lg bg-gray-50 text-sm group">
                      {f.kind === "image" ? (
                        <ImageIcon size={15} className="text-blue-500 shrink-0" />
                      ) : (
                        <FileText size={15} className="text-green-700 shrink-0" />
                      )}
                      <span className="flex-1 min-w-0 truncate text-gray-700">{f.name}</span>
                      <span className="text-[10px] text-gray-400 shrink-0">{f.kind}</span>
                      <button
                        onClick={() => deleteProjectFile(f.name)}
                        className="opacity-0 group-hover:opacity-100 text-gray-300 hover:text-red-500 transition-all shrink-0"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Actions */}
            <div className="space-y-2 pt-1">
              <button
                onClick={analyzeProject}
                disabled={storedFiles.length === 0 || uploading}
                className="w-full flex items-center justify-center gap-2 bg-green-700 text-white py-3 rounded-xl font-semibold hover:bg-green-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                <Zap size={18} />
                Analyze All Files
              </button>
              <button
                onClick={() => setStep("chat")}
                className="w-full text-sm text-gray-400 hover:text-gray-600 py-2 transition-colors"
              >
                Skip → go to chat
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── STEP: Analyzing ─────────────────────────────────────────────────────────
  if (step === "analyzing") {
    return (
      <div className="min-h-screen bg-gradient-to-br from-green-50 to-gray-100 flex items-center justify-center p-6">
        <div className="text-center space-y-4">
          <div className="bg-green-700 text-white p-4 rounded-2xl inline-block">
            <Loader2 size={36} className="animate-spin" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-gray-900">Analyzing {storedFiles.length} files…</h2>
            <p className="text-sm text-gray-500 mt-1">
              Claude is scanning your files and preparing sections and cost estimates.
            </p>
          </div>
        </div>
      </div>
    );
  }

  // ── STEP: Chat ──────────────────────────────────────────────────────────────
  return (
    <div
      className="flex h-screen overflow-hidden max-w-7xl mx-auto"
      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={onChatDrop}
    >
      {dragOver && (
        <div className="fixed inset-0 z-50 bg-green-700/20 border-4 border-dashed border-green-700 flex items-center justify-center pointer-events-none">
          <p className="text-2xl font-bold text-green-900">Drop files here</p>
        </div>
      )}

      <input ref={fileInputRef} type="file" multiple className="hidden" onChange={onChatFilePick} />
      <input
        ref={folderInputRef}
        type="file"
        multiple
        // @ts-expect-error non-standard
        webkitdirectory=""
        directory=""
        className="hidden"
        onChange={onChatFilePick}
      />

      {/* ── Chat column ── */}
      <div className="flex flex-col flex-1 min-w-0 px-4 py-6 max-w-3xl mx-auto w-full">

        {/* Header */}
        <div className="flex items-center gap-3 mb-6 shrink-0">
          <div className="bg-green-700 text-white p-2 rounded-xl">
            <HardHat size={24} />
          </div>
          <div className="flex-1 min-w-0">
            <h1 className="text-lg font-bold text-gray-900 truncate">{project?.name ?? "Majstor AI"}</h1>
            <p className="text-xs text-gray-400">
              {storedFiles.length > 0 ? `${storedFiles.length} files stored` : "AI assistant for builders"}
            </p>
          </div>
          <button
            onClick={() => setStep("upload")}
            className="flex items-center gap-1.5 px-3 py-1.5 border border-gray-200 text-gray-600 rounded-xl text-sm hover:bg-gray-50 transition-colors"
            title="Manage project files"
          >
            <ChevronLeft size={15} />
            Files
          </button>
          {quote && (
            <button
              onClick={() => setShowQuote(!showQuote)}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-xl text-sm font-medium transition-colors border ${
                showQuote
                  ? "bg-green-700 text-white border-green-700"
                  : "bg-green-50 text-green-700 border-green-200 hover:bg-green-100"
              }`}
            >
              <Calculator size={15} />
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
              <p className="text-sm mt-1 text-gray-400">Or go back to Files and click Analyze All Files.</p>
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
                {a.kind === "image" ? <ImageIcon size={13} /> : <FileText size={13} />}
                <span className="max-w-[180px] truncate">{a.name}</span>
                <button onClick={() => setAttachments((p) => p.filter((_, j) => j !== i))} className="hover:text-red-600">
                  <X size={13} />
                </button>
              </div>
            ))}
            {uploading && (
              <div className="flex items-center gap-1.5 text-xs text-gray-500">
                <Loader2 size={13} className="animate-spin" /> uploading…
              </div>
            )}
          </div>
        )}

        {/* Input */}
        <form onSubmit={sendMessage} className="flex gap-2 items-end shrink-0">
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
            placeholder="Ask a follow-up question…"
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
        <div className="w-[560px] flex-shrink-0 flex flex-col border-l border-gray-200 overflow-hidden">
          <QuotePanel quote={quote} onChange={setQuote} />
        </div>
      )}
    </div>
  );
}
