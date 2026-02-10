#!/usr/bin/env python3
# -*- coding: utf-8 -*-
import os
import json
import configparser
from typing import List, Literal, Optional
from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse, StreamingResponse
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
    stream: Optional[bool] = False

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

        if req.stream:
            stream = client.chat.completions.create(
                model="doubao-seed-1-8-251228",
                messages=messages,
                stream=True
            )

            def stream_generator():
                for chunk in stream:
                    if chunk.choices and len(chunk.choices) > 0:
                        content = chunk.choices[0].delta.content
                        if content:
                            yield f"data: {json.dumps({'content': content})}\n\n"
                    # 检查 usage 信息 (通常在最后一个 chunk)
                    if hasattr(chunk, 'usage') and chunk.usage:
                         yield f"data: {json.dumps({'usage': {'total_tokens': chunk.usage.total_tokens}})}\n\n"
                yield "data: [DONE]\n\n"

            return StreamingResponse(stream_generator(), media_type="text/event-stream")

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
