# Volcengine Ark Demo (火山引擎 Ark 大模型演示)

这是一个基于火山引擎 Ark SDK 的 AI 对话演示项目。它提供了一个类似“豆包”的简洁前端界面，支持多轮对话、会话管理以及 Token 用量统计。

![Preview](assets/screen_shot.png)

## ✨ 功能特性

- **多轮对话**：支持与 Ark 大模型（如 Doubao-pro/lite）进行上下文连贯的对话。
- **会话管理**：
  - 左侧侧栏管理历史会话。
  - 支持新建、切换、重命名和删除会话。
  - 会话数据保存在本地浏览器（LocalStorage），隐私安全。
- **界面友好**：
  - 仿豆包风格的 UI 设计。
  - 响应式布局，适配桌面与移动端。
  - 实时显示 Token 消耗情况。
- **易于扩展**：后端使用 FastAPI，结构清晰，方便二次开发。

## 🛠️ 技术栈

- **后端**：Python, FastAPI, Uvicorn, Volcengine Python SDK
- **前端**：HTML5, Tailwind CSS (CDN), Vanilla JavaScript

## 🚀 快速开始

### 1. 克隆项目

```bash
git clone https://github.com/YuhaoYeSteve/volcengine-examples.git
cd volcengine-examples
```

### 2. 安装依赖

确保你安装了 Python 3.9+。

```bash
pip install -r requirements.txt
```

### 3. 配置 API Key

你需要一个火山引擎的 API Key。

1. 复制配置文件模板：
   ```bash
   cp config.example.ini config.ini
   ```
2. 编辑 `config.ini`，填入你的 API Key：
   ```ini
   [ARK]
   api_key = 你的_API_KEY
   ```
   *或者，你也可以通过环境变量设置：*
   ```bash
   export ARK_API_KEY=你的_API_KEY
   ```

### 4. 启动服务

```bash
python -m uvicorn ark_server:app --host 0.0.0.0 --port 8000
```

### 5. 访问应用

打开浏览器访问：[http://localhost:8000](http://localhost:8000)

## 📂 项目结构

```
.
├── ark_server.py      # 主后端服务 (FastAPI)
├── chat.html          # 主前端页面
├── config.ini         # 配置文件 (需自行创建)
├── config.example.ini # 配置文件模板
├── requirements.txt   # 项目依赖
└── assets/            # 静态资源 (图片等)
```

## 📝 备注

- 本项目仅供学习和演示使用。
- 前端使用 CDN 加载 Tailwind CSS，请确保网络通畅。
- 默认使用的模型接入点为 `doubao-seed-1-8-251228`，如需更改请修改 `ark_server.py` 中的 `model` 参数。
