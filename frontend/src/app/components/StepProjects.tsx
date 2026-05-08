"use client";

import { useEffect, useState } from "react";
import {
  Plus,
  FolderOpen,
  Clock,
  ChevronRight,
  Loader2,
  HardHat,
} from "lucide-react";

interface ProjectSummary {
  id: string;
  name: string;
  updated_at: string;
  file_count: number;
  has_quote: boolean;
  section_names: string[];
}

function timeAgo(dateStr: string): string {
  if (!dateStr) return "";
  const d = new Date(dateStr.replace(" ", "T") + "Z");
  const diff = Math.floor((Date.now() - d.getTime()) / 1000);
  if (diff < 60) return "just nu";
  if (diff < 3600) return `${Math.floor(diff / 60)} min sedan`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} h sedan`;
  const days = Math.floor(diff / 86400);
  if (days === 1) return "igår";
  if (days < 7) return `${days} dagar sedan`;
  return d.toLocaleDateString("sv-SE", { day: "numeric", month: "short" });
}

export default function StepProjects({
  backend,
  onResume,
  onNew,
}: {
  backend: string;
  onResume: (id: string, hasQuote: boolean) => void;
  onNew: () => void;
}) {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`${backend}/api/projects`)
      .then((r) => r.json())
      .then((data) => {
        setProjects(Array.isArray(data) ? data : []);
      })
      .catch(() => setProjects([]))
      .finally(() => setLoading(false));
  }, [backend]);

  return (
    <div className="max-w-2xl mx-auto w-full p-6 space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-gray-900">Dina projekt</h2>
          <p className="text-sm text-gray-500">
            Fortsätt där du slutade eller skapa ett nytt.
          </p>
        </div>
        <button
          onClick={onNew}
          className="bg-green-700 hover:bg-green-800 text-white px-4 py-2.5 rounded-xl font-semibold flex items-center gap-2 text-sm transition-colors"
        >
          <Plus size={16} /> Nytt projekt
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16 text-gray-400 gap-2">
          <Loader2 size={20} className="animate-spin" /> Laddar projekt…
        </div>
      ) : projects.length === 0 ? (
        <div className="text-center py-16 space-y-4">
          <div className="bg-gray-100 rounded-full w-16 h-16 flex items-center justify-center mx-auto">
            <HardHat size={28} className="text-gray-400" />
          </div>
          <p className="text-gray-500">Inga projekt än.</p>
          <button
            onClick={onNew}
            className="bg-green-700 hover:bg-green-800 text-white px-5 py-2.5 rounded-xl font-semibold inline-flex items-center gap-2"
          >
            <Plus size={16} /> Skapa första projektet
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          {projects.map((p) => (
            <button
              key={p.id}
              onClick={() => onResume(p.id, p.has_quote)}
              className="w-full text-left bg-white border border-gray-200 hover:border-green-500 hover:shadow-sm rounded-xl p-4 flex items-center gap-4 transition-all group"
            >
              <div
                className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
                  p.has_quote
                    ? "bg-green-100 text-green-700"
                    : "bg-gray-100 text-gray-500"
                }`}
              >
                <FolderOpen size={18} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-gray-900 truncate">
                  {p.name}
                </div>
                <div className="text-xs text-gray-500 flex items-center gap-3 mt-0.5">
                  <span className="flex items-center gap-1">
                    <Clock size={11} /> {timeAgo(p.updated_at)}
                  </span>
                  {p.file_count > 0 && (
                    <span>{p.file_count} {p.file_count === 1 ? "fil" : "filer"}</span>
                  )}
                  {p.has_quote && p.section_names.length > 0 && (
                    <span className="text-green-700 font-medium truncate">
                      {p.section_names.join(", ")}
                    </span>
                  )}
                  {!p.has_quote && (
                    <span className="text-amber-600">Ofullständig</span>
                  )}
                </div>
              </div>
              <ChevronRight
                size={16}
                className="text-gray-300 group-hover:text-green-600 transition-colors shrink-0"
              />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
