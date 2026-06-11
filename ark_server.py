#!/usr/bin/env python3
# -*- coding: utf-8 -*-
import os
import json
import time
import logging
import secrets
import configparser
from typing import List, Literal, Optional, Union, Any, Dict
from fastapi import FastAPI, HTTPException, Header
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from volcenginesdkarkruntime import Ark

# 基于文件位置计算绝对路径，避免依赖启动时的工作目录
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
CONFIG_PATH = os.path.join(BASE_DIR, "config.ini")
STATIC_DIR = os.path.join(BASE_DIR, "static")
CHAT_HTML = os.path.join(BASE_DIR, "chat.html")
ADMIN_HTML = os.path.join(BASE_DIR, "admin.html")
MONITOR_HTML = os.path.join(BASE_DIR, "monitor.html")

DEFAULT_BASE_URL = "https://ark.cn-beijing.volces.com/api/v3"
DEFAULT_MODEL_ID = "doubao-seed-1-8-251228"

# 默认管理员账号密码（可在 config.ini 的 [ADMIN] 段覆盖）
DEFAULT_ADMIN_USERNAME = "admin"
DEFAULT_ADMIN_PASSWORD = "admin"

# 登录后随机生成的有效令牌集合（内存维护）
_valid_tokens: set = set()

# 模型思考能力缓存：键为 model_id（接入点 ep 或模型名），
# 值为探测到的思考模式 "effort" | "toggle" | "none"。进程级内存缓存，重启失效。
_thinking_cap_cache: Dict[str, str] = {}


def build_thinking_candidates(effort: Optional[str]):
    """根据前端档位构造有序的思考请求候选列表。

    返回 [(capability_mode, extra_body), ...]，按优先级从高到低排列。
    后端会依次尝试，遇到火山 "unknown field" 类错误时降级到下一个候选，
    以兼容不同模型的思考能力（强度分级 / 开关 / 不支持）。
    """
    if effort in ("low", "medium", "high"):
        return [
            ("effort", {"reasoning_effort": effort}),
            ("toggle", {"thinking": {"type": "enabled"}}),
            ("none", {}),
        ]
    if effort == "minimal":
        return [
            ("effort", {"reasoning_effort": "minimal"}),
            ("toggle", {"thinking": {"type": "disabled"}}),
            ("none", {}),
        ]
    # 默认档位（未选择）：不下发任何思考参数，交给模型默认行为
    return [("none", {})]


def order_candidates_by_cache(model_id: str, candidates):
    """若缓存命中该模型的思考能力，把对应候选置顶为首选（其余作为兜底保留）。"""
    cached = _thinking_cap_cache.get(model_id)
    if not cached:
        return candidates
    preferred = [c for c in candidates if c[0] == cached]
    others = [c for c in candidates if c[0] != cached]
    return preferred + others if preferred else candidates


def is_unknown_field_error(exc: Exception) -> bool:
    """判断异常是否为火山 "未知字段 / 非法参数" 类错误（用于触发思考参数降级）。"""
    msg = str(exc).lower()
    return "unknown field" in msg or "invalidparameter" in msg

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
)
logger = logging.getLogger("ark_server")


def load_config() -> Dict[str, str]:
    """从 config.ini 读取配置（ARK 段 + ADMIN 段），单次调用只读一次盘。"""
    cfg = configparser.ConfigParser()
    cfg.read(CONFIG_PATH)
    return {
        "api_key": cfg.get("ARK", "api_key", fallback="") or "",
        "model_id": cfg.get("ARK", "model_id", fallback="") or "",
        "base_url": cfg.get("ARK", "base_url", fallback="") or "",
        "admin_username": cfg.get("ADMIN", "username", fallback="") or "",
        "admin_password": cfg.get("ADMIN", "password", fallback="") or "",
    }


def save_config(data: Dict[str, str]) -> None:
    """将大模型配置写入 config.ini 的 [ARK] 段。"""
    cfg = configparser.ConfigParser()
    cfg.read(CONFIG_PATH)
    if not cfg.has_section("ARK"):
        cfg.add_section("ARK")
    for key in ("api_key", "model_id", "base_url"):
        if key in data and data[key] is not None:
            cfg.set("ARK", key, str(data[key]))
    with open(CONFIG_PATH, "w", encoding="utf-8") as f:
        cfg.write(f)


def get_base_url() -> str:
    """读取配置的 base_url，未配置时回退默认值。"""
    return load_config().get("base_url") or DEFAULT_BASE_URL


def get_api_key() -> str:
    """获取 API Key：优先环境变量，其次配置文件。"""
    return os.getenv("ARK_API_KEY") or load_config().get("api_key", "")


def get_admin_credentials() -> Dict[str, str]:
    """获取管理员账号密码：优先配置文件，其次默认值。"""
    cfg = load_config()
    return {
        "username": cfg.get("admin_username") or DEFAULT_ADMIN_USERNAME,
        "password": cfg.get("admin_password") or DEFAULT_ADMIN_PASSWORD,
    }


def require_admin(authorization: Optional[str]) -> None:
    """校验管理员令牌，缺失或不在有效集合则抛 401。"""
    token = ""
    if authorization:
        token = authorization[7:] if authorization.startswith("Bearer ") else authorization
    if token not in _valid_tokens:
        raise HTTPException(status_code=401, detail="未授权，请先登录")


app = FastAPI(
    title="Ark Chat API",
    description="Ark 文本对话 API",
    version="1.0.0",
)

# Mount static files
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")

# 前端使用普通 fetch、不依赖 Cookie 凭证，因此关闭 allow_credentials，
# 这样才能与 allow_origins=["*"] 合法共存。
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
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
    # 思考深度：控制深度思考的工作量，取值越高越深、越慢、越耗 token
    #   minimal: 关闭思考，直接回答
    #   low:     轻量思考，侧重快速响应
    #   medium:  均衡模式（模型默认）
    #   high:    深度分析，处理复杂问题
    # 不传则交给模型默认行为
    reasoning_effort: Optional[Literal["minimal", "low", "medium", "high"]] = None

class ChatResponse(BaseModel):
    content: str
    model: str
    response_id: str
    created: int
    usage: dict

class AdminLoginRequest(BaseModel):
    username: str
    password: str

class AdminConfigRequest(BaseModel):
    api_key: Optional[str] = None
    model_id: Optional[str] = None
    base_url: Optional[str] = None

@app.get("/")
def root():
    return FileResponse(CHAT_HTML)

@app.get("/admin")
def admin_page():
    return FileResponse(ADMIN_HTML)

@app.get("/monitor")
def monitor_page():
    return FileResponse(MONITOR_HTML)

@app.post("/api/admin/login")
def admin_login(req: AdminLoginRequest):
    creds = get_admin_credentials()
    if req.username == creds["username"] and req.password == creds["password"]:
        token = secrets.token_urlsafe(32)
        _valid_tokens.add(token)
        return {"token": token}
    raise HTTPException(status_code=401, detail="账号或密码错误")

@app.get("/api/admin/config")
def get_admin_config(authorization: Optional[str] = Header(default=None)):
    require_admin(authorization)
    cfg = load_config()
    full_key = cfg.get("api_key", "")
    # API Key 掩码展示，仅显示尾部 4 位
    masked = ""
    if full_key:
        masked = ("*" * max(len(full_key) - 4, 0)) + full_key[-4:]
    return {
        "api_key_masked": masked,
        "has_api_key": bool(full_key),
        "model_id": cfg.get("model_id", ""),
        "base_url": cfg.get("base_url", "") or DEFAULT_BASE_URL,
    }

@app.post("/api/admin/config")
def update_admin_config(req: AdminConfigRequest, authorization: Optional[str] = Header(default=None)):
    require_admin(authorization)
    data: Dict[str, str] = {}
    # api_key 为空字符串时不覆盖原值，避免误清空
    if req.api_key:
        data["api_key"] = req.api_key
    if req.model_id is not None:
        data["model_id"] = req.model_id
    if req.base_url is not None:
        data["base_url"] = req.base_url
    save_config(data)
    return {"success": True}

@app.post("/api/chat", response_model=ChatResponse)
def chat(req: ChatRequest):
    # 记录"后端已收到请求"时刻（毫秒），供监控页阶段事件使用
    ts_received = int(time.time() * 1000)
    cfg = load_config()
    # Prioritize API key from request, fallback to env/config
    current_api_key = req.api_key or os.getenv("ARK_API_KEY") or cfg.get("api_key", "")

    if not current_api_key:
        raise HTTPException(status_code=500, detail="Missing ARK_API_KEY. Please set it in settings or environment variables.")
    try:
        client = Ark(
            base_url=cfg.get("base_url") or DEFAULT_BASE_URL,
            api_key=current_api_key,
        )

        # Use provided model or default from config
        model_id = req.model or cfg.get("model_id") or DEFAULT_MODEL_ID
        logger.info("Using Model ID: %s", model_id)

        # Use Responses API for all requests
        # 记录"开始消息格式翻译"时刻
        ts_translating = int(time.time() * 1000)
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

        # 思考深度：不同模型的思考能力不同（强度分级 reasoning_effort / 开关 thinking / 不支持）。
        # 这里按档位构造有序候选，运行时逐个尝试并自动降级，避免因思考参数不被识别而报错。
        # 若该模型此前已探测出能力，则把对应候选置顶为首选，减少无谓的失败请求。
        candidates = order_candidates_by_cache(
            model_id, build_thinking_candidates(req.reasoning_effort)
        )

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
            # 记录"调用 Ark SDK"时刻
            ts_sdk_calling = int(time.time() * 1000)
            resolved_base_url = cfg.get("base_url") or DEFAULT_BASE_URL

            def stream_generator():
                try:
                    # 先按真实先后顺序补报后端各处理阶段事件，
                    # 供监控页可视化（chat.js 不识别 stage 会自动忽略）
                    # 每个阶段附带 detail：展示该阶段真实处理内容，便于学习数据流
                    detail_received = {
                        "message_count": len(req.messages),
                        "stream": req.stream,
                        "web_search": req.web_search,
                        "model_requested": req.model or None,
                    }
                    yield f"data: {json.dumps({'type': 'stage', 'stage': 'received', 'ts': ts_received, 'detail': detail_received}, ensure_ascii=False)}\n\n"

                    detail_translating = {
                        "note": "前端简单 messages → Ark Responses API 格式（嵌套 input_text/input_image）",
                        "translated_input": responses_input,
                    }
                    yield f"data: {json.dumps({'type': 'stage', 'stage': 'translating', 'ts': ts_translating, 'detail': detail_translating}, ensure_ascii=False)}\n\n"

                    detail_sdk = {
                        "note": "以下为调用 client.responses.create() 实际发送给火山引擎 Ark 的完整请求体",
                        "base_url": resolved_base_url,
                        "endpoint": resolved_base_url.rstrip("/") + "/responses",
                        "request_payload": {
                            "model": model_id,
                            "input": responses_input,
                            "tools": tools,
                            "stream": True,
                            # 展示首选候选的思考字段（extra_body 会被 SDK 合并进请求体顶层）
                            **(candidates[0][1] if candidates else {}),
                        },
                    }
                    yield f"data: {json.dumps({'type': 'stage', 'stage': 'sdk_calling', 'ts': ts_sdk_calling, 'detail': detail_sdk}, ensure_ascii=False)}\n\n"
                    logger.info("Start streaming...")

                    # chunk 分发逻辑：first 与后续 chunk 共用，避免重复代码
                    def handle_chunk(chunk):
                        if not hasattr(chunk, "type"):
                            return
                        if chunk.type == "response.output_text.delta":
                            yield f"data: {json.dumps({'content': chunk.delta})}\n\n"
                        elif chunk.type == "response.reasoning_summary_text.delta":
                            # 模型的深度思考过程（增量），转发给前端单独展示
                            yield f"data: {json.dumps({'reasoning': chunk.delta})}\n\n"
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
                            # 透传火山实际使用的真实模型名（接入点 ep-xxx 背后绑定的模型）
                            model_used = getattr(chunk.response, "model", None)
                            if model_used:
                                yield f"data: {json.dumps({'model': model_used})}\n\n"
                            if hasattr(chunk.response, "usage") and chunk.response.usage:
                                usage = {
                                    "total_tokens": chunk.response.usage.total_tokens
                                }
                                yield f"data: {json.dumps({'usage': usage})}\n\n"

                    # 思考能力降级循环：依次尝试候选，遇到 "unknown field" 类错误就降级，
                    # 第一个能成功读到首个 chunk 的候选即视为该模型实际支持的思考模式。
                    # probe：仅当用户实际选了档位时才算"探测思考能力"。默认档位不发思考参数，
                    # 其 none 只代表"本次没用思考"，不代表模型能力，故不缓存、不回传能力事件。
                    probe = bool(req.reasoning_effort)
                    success = False
                    last_error: Optional[Exception] = None
                    for mode, extra in candidates:
                        try:
                            stream = client.responses.create(
                                model=model_id,
                                input=responses_input,
                                tools=tools,
                                stream=True,
                                extra_body=extra or None,
                            )
                            iterator = iter(stream)
                            first = next(iterator)  # 触发真实请求，可能在此抛出 BadRequest
                        except StopIteration:
                            # 空响应：视为成功（无内容），仍记录能力并结束
                            if probe:
                                _thinking_cap_cache[model_id] = mode
                                yield f"data: {json.dumps({'type': 'thinking_capability', 'mode': mode})}\n\n"
                            success = True
                            break
                        except Exception as e:
                            last_error = e
                            if is_unknown_field_error(e):
                                logger.info("思考候选 %s 不被支持，降级重试: %s", mode, e)
                                continue
                            raise

                        # 成功：写缓存、回传能力（仅探测时）、补发 stream_start 阶段事件
                        if probe:
                            _thinking_cap_cache[model_id] = mode
                            yield f"data: {json.dumps({'type': 'thinking_capability', 'mode': mode})}\n\n"

                        ts_stream_start = int(time.time() * 1000)
                        detail_stream = {
                            "first_chunk_type": getattr(first, "type", None),
                            "sdk_latency_ms": ts_stream_start - ts_sdk_calling,
                            "thinking_mode": mode,
                        }
                        yield f"data: {json.dumps({'type': 'stage', 'stage': 'stream_start', 'ts': ts_stream_start, 'detail': detail_stream}, ensure_ascii=False)}\n\n"

                        for line in handle_chunk(first):
                            yield line
                        for chunk in iterator:
                            for line in handle_chunk(chunk):
                                yield line
                        success = True
                        break

                    if not success:
                        # 所有候选都失败（通常是非思考相关错误）
                        err = str(last_error) if last_error else "当前模型不支持所选思考模式"
                        yield f"data: {json.dumps({'error': err})}\n\n"

                    yield "data: [DONE]\n\n"
                except Exception as e:
                    logger.exception("Stream Error")
                    yield f"data: {json.dumps({'error': str(e)})}\n\n"
                    yield "data: [DONE]\n\n"

            return StreamingResponse(stream_generator(), media_type="text/event-stream")
        else:
            # 非流式：同样用候选循环做思考能力降级，避免裸 500
            resp = None
            last_error: Optional[Exception] = None
            probe = bool(req.reasoning_effort)
            for mode, extra in candidates:
                try:
                    resp = client.responses.create(
                        model=model_id,
                        input=responses_input,
                        tools=tools,
                        extra_body=extra or None,
                    )
                    # 仅当用户实际选了档位时才缓存能力（默认档位不代表模型能力）
                    if probe:
                        _thinking_cap_cache[model_id] = mode
                    break
                except Exception as e:
                    last_error = e
                    if is_unknown_field_error(e):
                        logger.info("思考候选 %s 不被支持，降级重试: %s", mode, e)
                        continue
                    raise
            if resp is None:
                raise last_error or RuntimeError("当前模型不支持所选思考模式")

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
    except HTTPException:
        raise
    except Exception:
        # 详细堆栈仅记录到日志，对客户端只返回通用错误信息，避免泄露内部细节
        logger.exception("Chat request failed")
        raise HTTPException(status_code=500, detail="服务处理请求时发生错误，请稍后重试")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
