#!/usr/bin/env python3
# -*- coding: utf-8 -*-
import os
import json
import configparser
from typing import List, Literal, Optional, Union, Any, Dict
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
    content: Union[str, List[Dict[str, Any]]]

class ChatRequest(BaseModel):
    messages: List[ChatMessage]
    stream: Optional[bool] = False
    model: Optional[str] = None
    web_search: Optional[bool] = False

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
        
        # Use provided model or default from config
        config_model = config.get("ARK", "model_id", fallback="doubao-seed-1-8-251228")
        model_id = req.model if req.model else config_model
        print(f"Using Model ID: {model_id}") # Debug log

        if req.web_search:
            # Use Responses API for Web Search
            responses_input = []
            for m in req.messages:
                content_list = []
                if isinstance(m.content, str):
                    content_list.append({"type": "input_text", "text": m.content})
                else:
                    for item in m.content:
                        if isinstance(item, dict):
                            if item.get("type") == "text":
                                content_list.append({"type": "input_text", "text": item.get("text")})
                            elif item.get("type") == "image_url":
                                url = item.get("image_url", {}).get("url")
                                if url:
                                    content_list.append({"type": "input_image", "image_url": url})
                
                if content_list:
                    responses_input.append({
                        "role": m.role,
                        "content": content_list
                    })
            
            tools = [{"type": "web_search"}]

            if req.stream:
                stream = client.responses.create(
                    model=model_id,
                    input=responses_input,
                    tools=tools,
                    stream=True
                )

                def stream_generator():
                    try:
                        print("Start streaming...")
                        for chunk in stream:
                            # print(f"Chunk received: {chunk}") # Debug logging
                            if hasattr(chunk, "type"):
                                print(f"Chunk type: {chunk.type}")
                                if chunk.type == "response.output_text.delta":
                                    yield f"data: {json.dumps({'content': chunk.delta})}\n\n"
                                elif chunk.type == "response.web_search_call.searching":
                                    yield f"data: {json.dumps({'type': 'searching', 'status': 'start'})}\n\n"
                                elif chunk.type == "response.web_search_call.completed":
                                    yield f"data: {json.dumps({'type': 'searching', 'status': 'end'})}\n\n"
                                elif chunk.type == "response.output_item.added":
                                    # Capture search query if available in added item
                                    if hasattr(chunk, "item") and hasattr(chunk.item, "type") and chunk.item.type == "web_search_call":
                                        if hasattr(chunk.item, "action") and chunk.item.action and hasattr(chunk.item.action, "query"):
                                            query = chunk.item.action.query
                                            yield f"data: {json.dumps({'type': 'searching', 'status': 'query', 'query': query})}\n\n"
                                elif chunk.type == "response.failed":
                                    error_msg = "Unknown response failure"
                                    if hasattr(chunk, "response") and chunk.response and hasattr(chunk.response, "error") and chunk.response.error:
                                         error_msg = chunk.response.error.message
                                    elif hasattr(chunk, "error") and chunk.error:
                                        error_msg = chunk.error.message if hasattr(chunk.error, "message") else str(chunk.error)
                                    yield f"data: {json.dumps({'error': error_msg})}\n\n"
                                elif chunk.type == "error":
                                    error_msg = chunk.message if hasattr(chunk, "message") else "Unknown stream error"
                                    yield f"data: {json.dumps({'error': error_msg})}\n\n"
                                elif chunk.type == "response.completed":
                                    if hasattr(chunk.response, "usage") and chunk.response.usage:
                                        # Map usage fields if necessary, or just dump it
                                        usage = {
                                            "total_tokens": chunk.response.usage.total_tokens
                                        }
                                        yield f"data: {json.dumps({'usage': usage})}\n\n"
                        yield "data: [DONE]\n\n"
                    except Exception as e:
                         print(f"Stream Error: {e}")
                         yield f"data: {json.dumps({'error': str(e)})}\n\n"
                         yield "data: [DONE]\n\n"

                return StreamingResponse(stream_generator(), media_type="text/event-stream")
            else:
                resp = client.responses.create(
                    model=model_id,
                    input=responses_input,
                    tools=tools
                )
                
                content = ""
                if hasattr(resp, "output"):
                    for item in resp.output:
                        if getattr(item, "type", "") == "message":
                            for c in getattr(item, "content", []):
                                if getattr(c, "type", "") == "text":
                                    content += getattr(c, "text", "")
                
                return ChatResponse(
                    content=content,
                    model=resp.model,
                    response_id=resp.id,
                    created=resp.created_at, # Note: created_at vs created
                    usage={
                        "prompt_tokens": resp.usage.input_tokens if resp.usage else 0,
                        "completion_tokens": resp.usage.output_tokens if resp.usage else 0,
                        "total_tokens": resp.usage.total_tokens if resp.usage else 0
                    }
                )

        # Legacy / Standard Chat Completion path
        messages = []
        for m in req.messages:
            if isinstance(m.content, str):
                content = [{"type": "text", "text": m.content}]
            else:
                content = m.content
            
            messages.append({
                "role": m.role,
                "content": content
            })

        if req.stream:
            stream = client.chat.completions.create(
                model=model_id,
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
            model=model_id,
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
