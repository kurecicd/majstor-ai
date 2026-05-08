from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import List, Union, Any
import anthropic

from app.config import get_settings

router = APIRouter()

SYSTEM_PROMPT = """You are an expert AI assistant for builders and contractors in Sweden.

Your job:
1. Estimate materials needed for construction/renovation jobs
2. Calculate quantities and costs in SEK
3. Suggest materials with prices from Swedish stores (Bauhaus, Hornbach, Byggmax, K-rauta)
4. Create professional quotes

Always respond in the same language as the user (Swedish, Bosnian/Croatian, English).
Be practical and concise. Show quantity and price per unit for each material.

STRUCTURED OUTPUT RULE: Whenever your response includes any material/cost list or price estimate, you MUST append a machine-readable quote block at the very end of your response. Nothing may follow after <<<END_QUOTE>>>.

<<<QUOTE>>>
{"sections":[{"name":"Section Name","items":[{"name":"Product full name with specs/dimensions","qty":10,"unit":"kom","stores":[{"name":"Bauhaus","price":185,"source":"Bauhaus.se catalog 2026","url":"https://www.bauhaus.se/..."},{"name":"Hornbach","price":179,"source":"Hornbach.se","url":"https://www.hornbach.se/..."},{"name":"Byggmax","price":192,"source":"market estimate"}]}],"labor":[{"name":"Carpentry","hours":8,"rate":450}]}]}
<<<END_QUOTE>>>

Rules for the quote block:
- Compact single-line JSON, no line breaks inside
- Include ALL items from your material list
- 2-3 real Swedish stores per item with realistic SEK prices (excl. VAT)
- For EACH store entry, include a "source" field explaining where the price came from (e.g. store catalog, prior project, market estimate). Add a "url" field to a real product page when you know one — otherwise omit url
- Add a "labor" array per section listing distinct work types (e.g. carpentry, painting, electrical) with realistic hour estimates and a default rate of 450 kr/h. Omit if labor is irrelevant
- Omit the entire block for pure Q&A responses that have no material/cost estimates
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
            messages=[{"role": m.role, "content": m.content} for m in request.messages],
        )
        # Concatenate all text blocks (model may return multiple)
        text_parts = [
            b.text for b in response.content if getattr(b, "type", None) == "text"
        ]
        return ChatResponse(message="".join(text_parts) or "")
    except anthropic.APIError as e:
        raise HTTPException(status_code=502, detail=f"Claude API error: {str(e)}")
