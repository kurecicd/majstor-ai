# Majstor AI

AI assistant for builders and contractors (primarily Swedish market, Croatian/Bosnian-speaking craftsmen) that estimates materials, calculates costs, and generates professional PDF quotes from a project description or uploaded files.

Concept goal: cut quote preparation from 2-3 hours down to 10-15 minutes.

## Tech stack

**Backend** — Python 3.12, FastAPI, Anthropic Claude (`claude-opus-4-5`), pypdf / python-docx / openpyxl for parsing, reportlab for PDF generation, Pydantic v2.

**Frontend** — Next.js 14, React 18, TypeScript, Tailwind CSS, lucide-react, react-markdown.

**Deploy** — Railway (backend, Dockerfile) + Vercel (frontend), GitHub Actions (`.github/workflows/deploy.yml`) trigger per-folder.

## Architecture

REST API. Frontend reaches backend via `NEXT_PUBLIC_BACKEND_URL`.

**Backend routes** ([backend/app/main.py](backend/app/main.py)):
- `POST /api/chat` — multi-turn chat with Claude (system prompt tuned for Swedish building supplies, multilingual sv/hr/en)
- `POST /api/extract` — multi-file upload, parses PDF / DOCX / XLSX / CSV / TXT and base64-encodes images (25 MB limit, up to 20 images)
- `POST /api/pdf/generate` — formatted PDF quotes (PONUDA / OFFERT, SEK, 25% VAT)
- `POST /api/projects` + `GET/POST/DELETE /api/projects/{id}/...` — project CRUD, file management, analyze endpoint
- `GET /health` — Railway health check

**Frontend flow** ([frontend/src/app/page.tsx](frontend/src/app/page.tsx) — single-file state machine):
1. New project → 2. Upload files → 3. Analyzing (Claude) → 4. Chat + live quote builder ([QuotePanel.tsx](frontend/src/app/components/QuotePanel.tsx))

## Notable patterns

- **Quote-in-chat protocol** — Claude embeds a `<<<QUOTE>>>...<<<END_QUOTE>>>` JSON block inside chat replies; the frontend parses it and renders the interactive QuotePanel.
- **Multimodal** — images and text are both sent to Claude in the same message.
- **In-memory project store** — `_projects` dict in [backend/app/routes/projects.py](backend/app/routes/projects.py); projects die with the process. No DB yet.
- **Swedish localisation baked in** — SEK currency, 25% VAT, default labor rate 450 kr/h, hardcoded store knowledge.

## Concept vs. current code

The concept document (May 2026) describes a 3-phase product. Current code covers most of Phase 1 plus some Phase 2 pieces.

**Already implemented**
- Chat with Claude, file/photo upload, multi-format extraction
- PDF quote generation
- Quote builder with multi-store columns
- 450 kr/h labor default + 25% VAT
- Multilingual prompt (sv / hr / en)

**Gaps between concept and code**

| Concept (PDF) | Code reality |
|---|---|
| Stores: Bauhaus, Hornbach, Jula, Clas Ohlson | Code uses Bauhaus, Hornbach, Byggmax, K-rauta |
| "Pre-loaded price DB, updated weekly" (Phase 1) | No price DB — Claude estimates from training data |
| Live price scraping (Phase 2) | Not started |
| Logo + majstor business data on PDF top | No business profile / logo upload |
| Quote number, customer name+address, validity period, travel costs, "inkl. moms" label | Not in current PDF / quote builder |
| Save projects, browse history (Phase 2) | In-memory only |
| Email / WhatsApp sending | Not started |
| Domain `app.aimajstor.se`, `kontakt@aimajstor.se` | Not configured |

**Roadmap implication** — before showing to a craftsman, the highest-leverage fixes are: (1) reconcile the store list, (2) upgrade the PDF template to match the example in the concept doc, (3) add a majstor profile (logo + contact), (4) add quote numbering, (5) add a real persistence layer.

## Repo layout

```
backend/
  app/
    main.py           FastAPI entry, CORS, route registration
    routes/
      chat.py         Claude chat + system prompt
      projects.py     Project CRUD + analyze (in-memory store)
      extract.py      Multi-format file parsing
      pdf.py          PDF quote generation (reportlab)
frontend/
  src/app/
    page.tsx          Main UI state machine (~730 lines)
    components/
      QuotePanel.tsx  Interactive quote builder
.github/workflows/
  deploy.yml          Railway (backend) + Vercel (frontend) deploys
railway.toml          Backend deploy config
```

## Local development

Backend:

```bash
cd backend
pip install -r requirements.txt
export ANTHROPIC_API_KEY=...
uvicorn app.main:app --reload --port 8000
```

Frontend:

```bash
cd frontend
npm install
echo "NEXT_PUBLIC_BACKEND_URL=http://localhost:8000" > .env.local
npm run dev
```

## Deployment

Pushes to `main` trigger:
- `backend/**` changes → Railway deploy via CLI (requires `RAILWAY_TOKEN`)
- `frontend/**` changes → Vercel deploy via CLI (requires `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`)

Backend health check is wired to `/health` with `ON_FAILURE` restart (max 5).

### Project persistence (Railway volume)

Projects are written to disk as one JSON file per project (atomic temp-file
+ rename). Storage path:
- `PROJECTS_DIR` env var if set
- `/data/projects` when `/data` exists (Railway volume mount convention)
- `./data/projects` otherwise (local dev)

**On Railway you MUST attach a volume** at mount path `/data` for projects to
survive across deploys. Without it the container's filesystem is ephemeral
and projects vanish on every redeploy.

Configure in the Railway dashboard:
- Service → Settings → Volumes → Add volume
- Mount path: `/data`
- Size: 1 GB is plenty for now (each project is well under 25 MB)

Verify on the next backend deploy: the container logs print
`Project storage at /data/projects — N project(s) loaded` on startup.
