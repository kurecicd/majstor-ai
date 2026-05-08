"use client";

import {
  ChangeEvent,
  DragEvent,
  useRef,
  useState,
} from "react";
import {
  FolderOpen,
  Paperclip,
  FolderUp,
  FileText,
  Image as ImageIcon,
  Trash2,
  Loader2,
  Zap,
  HardHat,
} from "lucide-react";

export interface StoredFile {
  name: string;
  kind: string;
}

export default function StepDescribe({
  projectName,
  onProjectNameChange,
  description,
  onDescriptionChange,
  storedFiles,
  uploading,
  analyzing,
  onUpload,
  onDeleteFile,
  onAnalyze,
}: {
  projectName: string;
  onProjectNameChange: (s: string) => void;
  description: string;
  onDescriptionChange: (s: string) => void;
  storedFiles: StoredFile[];
  uploading: boolean;
  analyzing: boolean;
  onUpload: (files: FileList | File[]) => void;
  onDeleteFile: (name: string) => void;
  onAnalyze: () => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  function pick(e: ChangeEvent<HTMLInputElement>) {
    if (e.target.files) onUpload(e.target.files);
    e.target.value = "";
  }

  function drop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files?.length) onUpload(e.dataTransfer.files);
  }

  const ready =
    !analyzing && (storedFiles.length > 0 || description.trim().length > 0);

  return (
    <div
      className="max-w-2xl mx-auto w-full p-6 space-y-5"
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={drop}
    >
      {dragOver && (
        <div className="fixed inset-0 z-50 bg-green-700/10 border-4 border-dashed border-green-700 flex items-center justify-center pointer-events-none">
          <p className="text-2xl font-bold text-green-900">Släpp filer här</p>
        </div>
      )}

      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={pick}
      />
      <input
        ref={folderInputRef}
        type="file"
        multiple
        // @ts-expect-error non-standard
        webkitdirectory=""
        directory=""
        className="hidden"
        onChange={pick}
      />

      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="bg-green-700 text-white p-2.5 rounded-xl">
          <HardHat size={22} />
        </div>
        <div>
          <h2 className="text-xl font-bold text-gray-900">
            Steg 1 — Beskriv projektet
          </h2>
          <p className="text-sm text-gray-500">
            Skriv en beskrivning eller ladda upp ritningar och foton — eller
            båda.
          </p>
        </div>
      </div>

      {/* Project name */}
      <div>
        <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
          Projektnamn
        </label>
        <input
          value={projectName}
          onChange={(e) => onProjectNameChange(e.target.value)}
          placeholder="t.ex. Familjen Krečić — Terrass 2026"
          className="w-full border border-gray-300 rounded-xl px-4 py-3 text-base focus:outline-none focus:ring-2 focus:ring-green-600"
        />
      </div>

      {/* Description */}
      <div>
        <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
          Beskrivning av projektet
        </label>
        <textarea
          value={description}
          onChange={(e) => onDescriptionChange(e.target.value)}
          placeholder='t.ex. "Bygga terrass 15 m², horisontella granbrädor 28×120, räcke 12 m hög 90 cm. Befintlig betongplatta finns."'
          rows={5}
          className="w-full border border-gray-300 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-green-600 resize-y"
        />
      </div>

      {/* File upload */}
      <div>
        <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
          Filer & foton (valfritt)
        </label>
        <div
          className="border-2 border-dashed border-gray-200 rounded-xl p-5 text-center hover:border-green-500 transition-colors cursor-pointer"
          onClick={() => fileInputRef.current?.click()}
        >
          <FolderOpen size={28} className="mx-auto text-gray-300 mb-2" />
          <p className="text-sm text-gray-500">
            Släpp filer här eller klicka för att bläddra
          </p>
          <p className="text-xs text-gray-400 mt-1">
            PDF, Word, Excel, CSV, bilder
          </p>
          <div className="flex gap-2 justify-center mt-3">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                fileInputRef.current?.click();
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 border border-gray-200 rounded-lg text-xs text-gray-600 hover:bg-gray-50"
            >
              <Paperclip size={14} /> Filer
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                folderInputRef.current?.click();
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 border border-gray-200 rounded-lg text-xs text-gray-600 hover:bg-gray-50"
            >
              <FolderUp size={14} /> Mapp
            </button>
          </div>
        </div>

        {uploading && (
          <div className="flex items-center gap-2 text-sm text-gray-500 mt-2">
            <Loader2 size={16} className="animate-spin text-green-700" /> Laddar
            upp…
          </div>
        )}

        {storedFiles.length > 0 && (
          <div className="mt-3">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">
              {storedFiles.length}{" "}
              {storedFiles.length !== 1 ? "filer sparade" : "fil sparad"}
            </p>
            <div className="space-y-1 max-h-40 overflow-y-auto">
              {storedFiles.map((f, i) => (
                <div
                  key={i}
                  className="flex items-center gap-2 p-2 rounded-lg bg-gray-50 text-sm group"
                >
                  {f.kind === "image" ? (
                    <ImageIcon size={15} className="text-blue-500 shrink-0" />
                  ) : (
                    <FileText size={15} className="text-green-700 shrink-0" />
                  )}
                  <span className="flex-1 min-w-0 truncate text-gray-700">
                    {f.name}
                  </span>
                  <span className="text-[10px] text-gray-400 shrink-0">
                    {f.kind}
                  </span>
                  <button
                    onClick={() => onDeleteFile(f.name)}
                    className="opacity-0 group-hover:opacity-100 text-gray-300 hover:text-red-500 transition-all shrink-0"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Analyze */}
      <button
        onClick={onAnalyze}
        disabled={!ready}
        className="w-full flex items-center justify-center gap-2 bg-green-700 text-white py-3.5 rounded-xl font-semibold hover:bg-green-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors text-base"
      >
        {analyzing ? (
          <>
            <Loader2 size={18} className="animate-spin" /> Analyserar…
          </>
        ) : (
          <>
            <Zap size={18} /> Analysera & gå vidare
          </>
        )}
      </button>
    </div>
  );
}
