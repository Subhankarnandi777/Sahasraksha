from pydantic import BaseModel, Field


class ChatTurn(BaseModel):
    role: str = Field(..., examples=["user"])
    content: str = Field(..., min_length=1)


class ChatRequest(BaseModel):
    message: str = Field(..., min_length=1, max_length=2000, examples=["What does the tide heartbeat page show?"])
    history: list[ChatTurn] = Field(default_factory=list)


class ChatResponse(BaseModel):
    reply: str
