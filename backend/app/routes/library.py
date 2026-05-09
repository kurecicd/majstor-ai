from fastapi import APIRouter
from pydantic import BaseModel
from app import storage

router = APIRouter()


class PickRequest(BaseModel):
    query: str
    store: str
    name: str
    price: float
    url: str = ""


@router.post("")
async def add_pick(body: PickRequest):
    storage.save_pick(body.query, body.store, body.name, body.price, body.url)
    return {"ok": True}
