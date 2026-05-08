"use client";

import { useState, useEffect } from "react";
import { HardHat } from "lucide-react";
import {
  Quote,
  extractQuoteFromResponse,
} from "./components/QuotePanel";
import Stepper, { WizardStep } from "./components/Stepper";
import StepDescribe, { StoredFile } from "./components/StepDescribe";
import StepMaterials from "./components/StepMaterials";
import StepPricing from "./components/StepPricing";
import StepSummary from "./components/StepSummary";
import ChatDrawer from "./components/ChatDrawer";

interface Project {
  id: string;
  name: string;
}

const BACKEND = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:8000";

export default function Home() {
  const [step, setStep] = useState<WizardStep>(1);
  const [furthest, setFurthest] = useState<WizardStep>(1);

  const [project, setProject] = useState<Project | null>(null);
  const [projectName, setProjectName] = useState("");
  const [description, setDescription] = useState("");
  const [storedFiles, setStoredFiles] = useState<StoredFile[]>([]);
  const [uploading, setUploading] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [quote, setQuote] = useState<Quote | null>(null);

  // ── Restore project on mount ────────────────────────────────────────────
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
            setProjectName(data.name);
            setStoredFiles(data.files);
          } else {
            localStorage.removeItem("majstor_project");
          }
        })
        .catch(() => localStorage.removeItem("majstor_project"));
    } catch {
      localStorage.removeItem("majstor_project");
    }
  }, []);

  // ── Project helpers ─────────────────────────────────────────────────────

  async function ensureProject(): Promise<Project> {
    if (project) return project;
    const name =
      projectName.trim() ||
      `Projekt ${new Date().toLocaleDateString("sv-SE")}`;
    const res = await fetch(`${BACKEND}/api/projects`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    const data = await res.json();
    const p = { id: data.id, name: data.name };
    setProject(p);
    if (!projectName.trim()) setProjectName(p.name);
    localStorage.setItem("majstor_project", JSON.stringify(p));
    return p;
  }

  function newProject() {
    setProject(null);
    setProjectName("");
    setDescription("");
    setStoredFiles([]);
    setQuote(null);
    setStep(1);
    setFurthest(1);
    localStorage.removeItem("majstor_project");
  }

  // ── File operations ─────────────────────────────────────────────────────

  async function uploadFiles(files: FileList | File[]) {
    const arr = Array.from(files);
    if (!arr.length) return;
    setUploading(true);
    try {
      const p = await ensureProject();
      const fd = new FormData();
      for (const f of arr) fd.append("files", f, f.name);
      const res = await fetch(`${BACKEND}/api/projects/${p.id}/files`, {
        method: "POST",
        body: fd,
      });
      if (!res.ok) throw new Error(`Upload failed: ${res.status}`);
      const data = await res.json();
      setStoredFiles(data.files);
    } catch (err) {
      alert(`Uppladdning misslyckades: ${(err as Error).message}`);
    } finally {
      setUploading(false);
    }
  }

  async function deleteFile(name: string) {
    if (!project) return;
    const res = await fetch(
      `${BACKEND}/api/projects/${project.id}/files?name=${encodeURIComponent(name)}`,
      { method: "DELETE" }
    );
    const data = await res.json();
    setStoredFiles(data.files);
  }

  // ── Analyze ─────────────────────────────────────────────────────────────

  async function analyze() {
    setAnalyzing(true);
    try {
      const p = await ensureProject();
      const res = await fetch(`${BACKEND}/api/projects/${p.id}/analyze`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description: description.trim() }),
      });
      if (!res.ok) {
        const errText = await res.text();
        throw new Error(errText || `HTTP ${res.status}`);
      }
      const data = await res.json();
      const { quote: newQuote } = extractQuoteFromResponse(data.message);
      if (newQuote && newQuote.sections.length > 0) {
        setQuote(newQuote);
        goTo(2);
      } else {
        alert(
          "Analysen gav inget materiallista. Lägg till mer information eller en bild."
        );
      }
    } catch (err) {
      alert(`Analys misslyckades: ${(err as Error).message}`);
    } finally {
      setAnalyzing(false);
    }
  }

  // ── Navigation ──────────────────────────────────────────────────────────

  function goTo(s: WizardStep) {
    setStep(s);
    setFurthest((f) => (s > f ? s : f));
  }

  // ── Render ──────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-50 to-gray-100 flex flex-col">
      {/* App header */}
      <header className="bg-white border-b border-gray-200 px-5 py-3 flex items-center gap-3">
        <div className="bg-green-700 text-white p-2 rounded-xl">
          <HardHat size={20} />
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="text-base font-bold text-gray-900 truncate">
            {projectName || "Majstor AI"}
          </h1>
          <p className="text-xs text-gray-500">
            AI-assistent för svenska byggjobb
          </p>
        </div>
        {project && (
          <button
            onClick={newProject}
            className="text-xs text-gray-400 hover:text-gray-700 underline shrink-0"
          >
            Nytt projekt
          </button>
        )}
      </header>

      {/* Stepper */}
      <Stepper current={step} furthest={furthest} onJump={goTo} />

      {/* Step body */}
      <main className="flex-1 overflow-y-auto">
        {step === 1 && (
          <StepDescribe
            projectName={projectName}
            onProjectNameChange={setProjectName}
            description={description}
            onDescriptionChange={setDescription}
            storedFiles={storedFiles}
            uploading={uploading}
            analyzing={analyzing}
            onUpload={uploadFiles}
            onDeleteFile={deleteFile}
            onAnalyze={analyze}
          />
        )}

        {step === 2 && quote && (
          <StepMaterials
            quote={quote}
            onChange={setQuote}
            onBack={() => goTo(1)}
            onContinue={() => goTo(3)}
          />
        )}
        {step === 2 && !quote && <NoQuoteFallback onBack={() => goTo(1)} />}

        {step === 3 && quote && (
          <StepPricing
            quote={quote}
            onChange={setQuote}
            backend={BACKEND}
            onBack={() => goTo(2)}
            onContinue={() => goTo(4)}
          />
        )}
        {step === 3 && !quote && <NoQuoteFallback onBack={() => goTo(1)} />}

        {step === 4 && quote && (
          <StepSummary
            quote={quote}
            projectName={projectName}
            description={description}
            backend={BACKEND}
            onBack={() => goTo(3)}
          />
        )}
        {step === 4 && !quote && <NoQuoteFallback onBack={() => goTo(1)} />}
      </main>

      {/* Floating chat */}
      <ChatDrawer backend={BACKEND} />
    </div>
  );
}

function NoQuoteFallback({ onBack }: { onBack: () => void }) {
  return (
    <div className="max-w-md mx-auto p-8 text-center space-y-3 mt-12">
      <p className="text-gray-600">
        Inget projekt analyserat ännu. Gå tillbaka till Steg 1.
      </p>
      <button
        onClick={onBack}
        className="bg-green-700 hover:bg-green-800 text-white px-5 py-2.5 rounded-xl font-semibold"
      >
        ← Till Steg 1
      </button>
    </div>
  );
}
