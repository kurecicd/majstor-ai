import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings
from app import storage
from app.routes import chat, pdf, extract, projects, scrape, search, library

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("majstor")
logger.info(
    "Project storage at %s — %d project(s) loaded",
    storage.storage_path(),
    len(projects._projects),
)

app = FastAPI(
    title="Majstor AI API",
    description="AI assistant for builders - price estimation and PDF quotes",
    version="0.1.0",
)

settings = get_settings()

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins.split(","),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(chat.router, prefix="/api/chat", tags=["chat"])
app.include_router(pdf.router, prefix="/api/pdf", tags=["pdf"])
app.include_router(extract.router, prefix="/api/extract", tags=["extract"])
app.include_router(projects.router, prefix="/api/projects", tags=["projects"])
app.include_router(scrape.router, prefix="/api/scrape", tags=["scrape"])
app.include_router(search.router, prefix="/api/search", tags=["search"])
app.include_router(library.router, prefix="/api/library", tags=["library"])


@app.get("/health")
def health():
    return {"status": "ok"}
