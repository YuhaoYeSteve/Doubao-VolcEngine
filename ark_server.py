#!/usr/bin/env python3
# -*- coding: utf-8 -*-
import os
import configparser
from typing import List, Literal
from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

config = configparser.ConfigParser()
config.read("config.ini")

api_key = os.getenv("ARK_API_KEY") or config.get("ARK", "api_key", fallback=None)

app = FastAPI(
    title="Ark Chat API",
    description="Ark 文本对话 API",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class ChatMessage(BaseModel):
    role: Literal["system", "user", "assistant"]
    content: str

class ChatRequest(BaseModel):
    messages: List[ChatMessage]

class ChatResponse(BaseModel):
    content: str
    model: str
    response_id: str
    created: int
    usage: dict

@app.get("/")
def root():
    return FileResponse("chat.html")

@app.post("/api/chat", response_model=ChatResponse)
def chat(req: ChatRequest):
    if not api_key:
        raise HTTPException(status_code=500, detail="Missing ARK_API_KEY or config.ini ARK.api_key")
    try:
        from volcenginesdkarkruntime import Ark
        client = Ark(
            base_url="https://ark.cn-beijing.volces.com/api/v3",
            api_key=api_key,
        )
        messages = []
        for m in req.messages:
            messages.append({
                "role": m.role,
                "content": [
                    {"type": "text", "text": m.content}
                ]
            })
        resp = client.chat.completions.create(
            model="doubao-seed-1-8-251228",
            messages=messages
        )
        return ChatResponse(
            content=resp.choices[0].message.content,
            model=resp.model,
            response_id=resp.id,
            created=resp.created,
            usage={
                "prompt_tokens": resp.usage.prompt_tokens,
                "completion_tokens": resp.usage.completion_tokens,
                "total_tokens": resp.usage.total_tokens
            }
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
