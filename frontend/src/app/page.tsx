"use client";

import { useState, useEffect } from "react";
import { HardHat } from "lucide-react";
import {
  Quote,
  extractQuoteFromResponse,
  parseAiQuote,
} from "./components/QuotePanel";
import Stepper, { WizardStep } from "./components/Stepper";
import StepProjects from "./components/StepProjects";
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

type AppStep = "projects" | WizardStep;

export default function Home() {
  const [step, setStep] = useState<AppStep>("projects");
  const [wizardStep, setWizardStep] = useState<WizardStep>(1);
  const [furthest, setFurthest] = useState<WizardStep>(1);

  const [project, setProject] = useState<Project | null>(null);
  const [projectName, setProjectName] = useState("");
  const [description, setDescription] = useState("");
  const [storedFiles, setStoredFiles] = useState<StoredFile[]>([]);
  const [uploading, setUploading] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [analyzeHint, setAnalyzeHint] = useState<string | null>(null);

  // ── No localStorage restore on mount — project list is the landing page ─

  // ── Project helpers ─────────────────────────────────────────────────────

  async function createProject(): Promise<Project> {
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

  async function ensureProject(): Promise<Project> {
    if (project) return project;
    return createProject();
  }

  function handleProjectGone() {
    setProject(null);
    setStoredFiles([]);
    setQuote(null);
    setWizardStep(1);
    setFurthest(1);
    setStep(1);
    alert(
      "Servern startade om och förlorade dina filer. Ladda upp filerna igen och försök på nytt."
    );
  }

  function newProject() {
    setProject(null);
    setProjectName("");
    setDescription("");
    setStoredFiles([]);
    setQuote(null);
    setAnalyzeHint(null);
    setWizardStep(1);
    setFurthest(1);
    setStep(1);
  }

  function backToProjects() {
    setProject(null);
    setProjectName("");
    setDescription("");
    setStoredFiles([]);
    setQuote(null);
    setAnalyzeHint(null);
    setWizardStep(1);
    setFurthest(1);
    setStep("projects");
  }

  async function resumeProject(id: string, hasQuote: boolean) {
    try {
      const res = await fetch(`${BACKEND}/api/projects/${id}`);
      if (!res.ok) return;
      const data = await res.json();
      setProject({ id: data.id, name: data.name });
      setProjectName(data.name);
      setStoredFiles(data.files || []);
      if (hasQuote && data.saved_quote) {
        setQuote(data.saved_quote as Quote);
        setWizardStep(2);
        setFurthest(2);
        setStep(2);
      } else {
        setWizardStep(1);
        setFurthest(1);
        setStep(1);
      }
    } catch {
      setStep(1);
    }
  }

  async function saveQuoteToBackend(q: Quote) {
    if (!project) return;
    try {
      await fetch(`${BACKEND}/api/projects/${project.id}/quote`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quote: q }),
      });
    } catch {
      // non-critical
    }
  }

  // ── File operations ─────────────────────────────────────────────────────

  async function uploadFiles(files: FileList | File[]) {
    const arr = Array.from(files);
    if (!arr.length) return;
    setUploading(true);
    try {
      let p = await ensureProject();
      const fd = () => {
        const f = new FormData();
        for (const file of arr) f.append("files", file, file.name);
        return f;
      };
      let res = await fetch(`${BACKEND}/api/projects/${p.id}/files`, {
        method: "POST",
        body: fd(),
      });
      if (res.status === 404) {
        // Server lost the project — recreate and retry once
        p = await createProject();
        res = await fetch(`${BACKEND}/api/projects/${p.id}/files`, {
          method: "POST",
          body: fd(),
        });
      }
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
    if (res.status === 404) {
      handleProjectGone();
      return;
    }
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
      if (res.status === 404) {
        handleProjectGone();
        return;
      }
      if (!res.ok) {
        throw new Error((await res.text()) || `HTTP ${res.status}`);
      }

      // Read SSE stream — backend streams chunks so the connection stays
      // alive even when Claude takes 60-120s on large PDFs.
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let fullMessage = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n\n");
        buffer = parts.pop() ?? "";
        for (const part of parts) {
          const line = part.trim();
          if (!line.startsWith("data: ")) continue;
          try {
            const data = JSON.parse(line.slice(6));
            if (data.type === "done") fullMessage = data.message;
            if (data.type === "error") throw new Error(data.message);
          } catch (parseErr) {
            if (parseErr instanceof SyntaxError) continue;
            throw parseErr;
          }
        }
      }

      if (!fullMessage) throw new Error("Inget svar från servern");

      const { quote: newQuote } = extractQuoteFromResponse(fullMessage);
      if (newQuote && newQuote.sections.length > 0) {
        setQuote(newQuote);
        saveQuoteToBackend(newQuote);
        goTo(2);
      } else if (fullMessage.length > 100) {
        // Claude analysed but QUOTE block was missing (token limit etc.)
        // Go to step 2 with empty quote — user can add rows manually
        setQuote({ sections: [] });
        goTo(2);
      } else {
        setAnalyzeHint("AI:n fick inget svar. Kontrollera att filen innehåller relevant innehåll och försök igen.");
      }
    } catch (err) {
      alert(`Analys misslyckades: ${(err as Error).message}`);
    } finally {
      setAnalyzing(false);
    }
  }

  // ── Navigation ──────────────────────────────────────────────────────────

  function goTo(s: WizardStep) {
    setWizardStep(s);
    setStep(s);
    setFurthest((f) => (s > f ? s : f));
  }

  // ── Render ──────────────────────────────────────────────────────────────

  const inWizard = step !== "projects";

  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-50 to-gray-100 flex flex-col">
      {/* App header */}
      <header className="bg-white border-b border-gray-200 px-5 py-3 flex items-center gap-3">
        <button
          onClick={inWizard ? backToProjects : undefined}
          className={`bg-green-700 text-white p-2 rounded-xl ${inWizard ? "hover:bg-green-800 cursor-pointer" : ""}`}
          title={inWizard ? "Tillbaka till projekt" : undefined}
        >
          <HardHat size={20} />
        </button>
        <div className="flex-1 min-w-0">
          <h1 className="text-base font-bold text-gray-900 truncate">
            {inWizard ? (projectName || "Nytt projekt") : "Majstor AI"}
          </h1>
          <p className="text-xs text-gray-500">
            {inWizard ? "AI-assistent för svenska byggjobb" : "Välj ett projekt eller skapa ett nytt"}
          </p>
        </div>
        {inWizard && (
          <button
            onClick={backToProjects}
            className="text-xs text-gray-400 hover:text-gray-700 underline shrink-0"
          >
            ← Alla projekt
          </button>
        )}
      </header>

      {/* Stepper — only shown inside wizard */}
      {inWizard && (
        <Stepper current={wizardStep} furthest={furthest} onJump={goTo} />
      )}

      {/* Step body */}
      <main className="flex-1 overflow-y-auto">
        {step === "projects" && (
          <StepProjects
            backend={BACKEND}
            onResume={resumeProject}
            onNew={newProject}
          />
        )}

        {step === 1 && (
          <StepDescribe
            projectName={projectName}
            onProjectNameChange={setProjectName}
            description={description}
            onDescriptionChange={(s) => { setDescription(s); setAnalyzeHint(null); }}
            storedFiles={storedFiles}
            uploading={uploading}
            analyzing={analyzing}
            analyzeHint={analyzeHint}
            onUpload={uploadFiles}
            onDeleteFile={deleteFile}
            onAnalyze={analyze}
          />
        )}

        {step === 2 && quote && (
          <StepMaterials
            quote={quote}
            onChange={(q) => { setQuote(q); saveQuoteToBackend(q); }}
            onBack={() => goTo(1)}
            onContinue={() => goTo(3)}
          />
        )}
        {step === 2 && !quote && <NoQuoteFallback onBack={() => goTo(1)} />}

        {step === 3 && quote && (
          <StepPricing
            quote={quote}
            onChange={(q) => { setQuote(q); saveQuoteToBackend(q); }}
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
