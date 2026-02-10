#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Ark Demo 后端 API 服务
"""

import os
import configparser
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from volcenginesdkarkruntime import Ark

# 加载配置文件
config = configparser.ConfigParser()
config.read('config.ini')

# 初始化 Ark 客户端
api_key = config.get('ARK', 'api_key')
client = Ark(
    base_url='https://ark.cn-beijing.volces.com/api/v3',
    api_key=api_key,
)

# 创建 FastAPI 应用
app = FastAPI(
    title="Ark Demo API",
    description="Ark 图片识别 Demo API",
    version="1.0.0"
)

# 配置 CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # 生产环境建议指定具体域名
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 请求模型
class ImageRequest(BaseModel):
    image_url: str
    prompt: str

# 响应模型
class ImageResponse(BaseModel):
    content: str
    model: str
    response_id: str
    created: int
    usage: dict

# 测试接口
@app.get("/")
def root():
    return {"message": "Ark Demo API is running"}

# 图片识别接口
@app.post("/api/analyze-image", response_model=ImageResponse)
def analyze_image(request: ImageRequest):
    """
    分析图片内容
    - **image_url**: 图片 URL
    - **prompt**: 提问内容
    """
    try:
        # 调用 Ark API
        response = client.chat.completions.create(
            model="doubao-seed-1-8-251228",
            messages=[
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "text",
                            "text": request.prompt
                        },
                        {
                            "type": "image_url",
                            "image_url": {
                                "url": request.image_url
                            }
                        }
                    ]
                }
            ]
        )
        
        # 构造响应
        return ImageResponse(
            content=response.choices[0].message.content,
            model=response.model,
            response_id=response.id,
            created=response.created,
            usage={
                "prompt_tokens": response.usage.prompt_tokens,
                "completion_tokens": response.usage.completion_tokens,
                "total_tokens": response.usage.total_tokens
            }
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# 启动服务
if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)