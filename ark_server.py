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
    api_key: Optional[str] = None

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
    # Prioritize API key from request, fallback to env/config
    current_api_key = req.api_key if req.api_key else api_key
    
    if not current_api_key:
        raise HTTPException(status_code=500, detail="Missing ARK_API_KEY. Please set it in settings or environment variables.")
    try:
        from volcenginesdkarkruntime import Ark
        client = Ark(
            base_url="https://ark.cn-beijing.volces.com/api/v3",
            api_key=current_api_key,
        )
        
        # Use provided model or default from config
        config_model = config.get("ARK", "model_id", fallback="doubao-seed-1-8-251228")
        model_id = req.model if req.model else config_model
        print(f"Using Model ID: {model_id}") # Debug log

        # Use Responses API for all requests
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
        
        # Configure tools only if web_search is enabled
        tools = [{"type": "web_search"}] if req.web_search else None
        
        # Inject System Prompt for Web Search Citations
        if req.web_search:
            search_prompt = """
## 联网搜索引用要求
请在回答中引用搜索到的资料。
引用格式：在正文中相关句子后使用 `[序号]` 标记，并在回答末尾列出参考资料。
参考资料格式：
### 📚 参考资料
1. [标题](URL)
2. [标题](URL)
"""
            # Check if there is an existing system message
            system_found = False
            for item in responses_input:
                if item.get("role") == "system":
                    # Append to existing system message content
                    # Content is a list of dicts: [{"type": "input_text", "text": "..."}]
                    if isinstance(item["content"], list):
                        item["content"].append({"type": "input_text", "text": "\n" + search_prompt})
                    system_found = True
                    break
            
            if not system_found:
                # Prepend new system message
                responses_input.insert(0, {
                    "role": "system",
                    "content": [{"type": "input_text", "text": search_prompt}]
                })

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
                            # print(f"Chunk type: {chunk.type}")
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
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
