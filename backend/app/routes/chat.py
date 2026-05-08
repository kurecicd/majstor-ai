from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import List, Union, Any
import anthropic

from app.config import get_settings

router = APIRouter()

SYSTEM_PROMPT = """You are an expert AI assistant for builders and contractors in Sweden.
Your job is to help builders:
1. Estimate materials needed for a job
2. Calculate quantities (area, volume, number of items)
3. Suggest material lists with approximate prices in SEK
4. Create professional quotes for customers

Always respond in the same language the user writes in (Swedish, Bosnian/Croatian, English).
Be practical and concise. When listing materials, always include quantity and estimated price in SEK.
"""


class Message(BaseModel):
    role: str  # "user" or "assistant"
    # str for plain text, or a list of Anthropic content blocks
    # (e.g. {"type":"text","text":"..."} or {"type":"image","source":{...}})
    content: Union[str, List[Any]]


class ChatRequest(BaseModel):
    messages: List[Message]


class ChatResponse(BaseModel):
    message: str


@router.post("", response_model=ChatResponse)
async def chat(request: ChatRequest):
    settings = get_settings()
    client = anthropic.Anthropic(api_key=settings.anthropic_api_key)

    try:
        response = client.messages.create(
            model="claude-opus-4-5",
            max_tokens=2048,
            system=SYSTEM_PROMPT,
        # Concatenate all text blocks in case the model returns multiple
        text_parts = [b.text for b in response.content if getattr(b, "type", None) == "text"]
        return ChatResponse(message="".join(text_parts) or "" for m in request.messages],
        )
        return ChatResponse(message=response.content[0].text)
    except anthropic.APIError as e:
        raise HTTPException(status_code=502, detail=f"Claude API error: {str(e)}")
