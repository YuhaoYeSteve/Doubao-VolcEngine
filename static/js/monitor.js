// 全流程监控页脚本（多轮对话版）
// 1B：每个节点可展开查看该阶段真实数据
// 2C：节点框背景用归属色（前端蓝/后端紫）填满，状态通过亮度+边框粗细区分
// 多轮改造：每轮一个独立 turn 对象，持有该轮的 DOM 与运行时状态，链路图按轮堆叠

const API_URL = "http://localhost:8000/api/chat";

const NODES = [
  { key: "click",        idx: 1,  side: "fe", name: "用户点击发送",       desc: "监控页输入框点击 / 回车" },
  { key: "assemble",     idx: 2,  side: "fe", name: "组装请求消息",       desc: "构建 messages / payload 完成" },
  { key: "fetch",        idx: 3,  side: "fe", name: "发起 fetch 请求",    desc: "fetch() 调用时刻" },
  { key: "headers",      idx: 4,  side: "fe", name: "收到响应头",         desc: "连接建立 (resp.ok)" },
  { key: "received",     idx: 5,  side: "be", name: "后端已收到请求",     desc: "SSE stage: received" },
  { key: "translating",  idx: 6,  side: "be", name: "后端消息格式翻译",   desc: "SSE stage: translating" },
  { key: "sdk_calling",  idx: 7,  side: "be", name: "调用 Ark SDK",       desc: "SSE stage: sdk_calling" },
  { key: "stream_start", idx: 8,  side: "be", name: "SDK 开始返回(流)",   desc: "SSE stage: stream_start" },
  { key: "ttft",         idx: 9,  side: "fe", name: "收到首个内容字",     desc: "首个 content delta (TTFT)" },
  { key: "streaming",    idx: 10, side: "fe", name: "持续接收增量",       desc: "后续 content delta" },
  { key: "typing",       idx: 11, side: "fe", name: "打字机渲染",         desc: "缓冲区驱动逐字渲染" },
  { key: "done",         idx: 12, side: "fe", name: "收到 usage / 完成",  desc: "usage 事件 + [DONE]" },
];

// ---------- 模块级状态 ----------
let history = [];      // 已完成轮次的 { role, content } 数组，初始为空
let turnCount = 0;     // 已创建的轮次数
let busy = false;      // 连续发送防抖标志

// ---------- 创建一轮链路分组卡片 ----------
// turnIndex：第几轮（从 1 起）；summary：用户输入摘要
// 返回 turn 对象：{ root, nodeEls, connectorEls, timings, nodeData, activeKey, metricEls, replyEl, errorBarEl }
function createTurn(turnIndex, summary) {
  const turns = document.getElementById("turns");

  const root = document.createElement("div");
  root.className = "turn";

  // 轮次标题（第 N 轮 + 用户输入摘要）
  const title = document.createElement("div");
  title.className = "turn-title";
  const no = document.createElement("div");
  no.className = "turn-no";
  no.textContent = `第 ${turnIndex} 轮`;
  const sum = document.createElement("div");
  sum.className = "turn-summary";
  sum.textContent = summary;
  // 折叠/展开按钮
  const toggle = document.createElement("button");
  toggle.className = "turn-toggle";
  toggle.type = "button";
  toggle.setAttribute("aria-label", "收起/展开该轮");
  toggle.innerHTML = '<span class="chevron">▾</span> <span class="txt">收起</span>';
  toggle.onclick = (e) => {
    e.stopPropagation();
    const collapsed = root.classList.toggle("collapsed");
    toggle.querySelector(".txt").textContent = collapsed ? "展开" : "收起";
  };
  title.appendChild(no);
  title.appendChild(sum);
  title.appendChild(toggle);
  root.appendChild(title);

  // 指标面板（复用原 .metrics/.metric 结构与类名）
  const metrics = document.createElement("div");
  metrics.className = "metrics";
  metrics.innerHTML = `
    <div class="metric">
      <div class="label">首字延迟 TTFT</div>
      <div class="value"><span data-m="ttft">-</span> <span class="unit">ms</span></div>
    </div>
    <div class="metric">
      <div class="label">总耗时</div>
      <div class="value"><span data-m="total">-</span> <span class="unit">ms</span></div>
    </div>
    <div class="metric">
      <div class="label">总 Token</div>
      <div class="value"><span data-m="tokens">-</span></div>
    </div>
    <div class="metric">
      <div class="label">Token 速率</div>
      <div class="value"><span data-m="rate">-</span> <span class="unit">tok/s</span></div>
    </div>
  `;
  root.appendChild(metrics);

  // 12 节点流程图（复用原 .flow/.node/.connector 结构与类名）
  const flow = document.createElement("div");
  flow.className = "flow";
  root.appendChild(flow);

  // 错误条（复用 .error-bar）
  const errorBar = document.createElement("div");
  errorBar.className = "error-bar";
  root.appendChild(errorBar);

  // 回复预览（复用 .reply-preview）
  const replyPreview = document.createElement("div");
  replyPreview.className = "reply-preview";
  replyPreview.innerHTML = `
    <h3>模型回复内容</h3>
    <div class="content">（请求进行中…）</div>
  `;
  root.appendChild(replyPreview);

  // turn 对象：持有该轮全部 DOM 与运行时状态
  const turn = {
    root,
    nodeEls: {},
    connectorEls: [],
    timings: {},
    nodeData: {},
    activeKey: null,
    metricEls: {
      ttft: metrics.querySelector('[data-m="ttft"]'),
      total: metrics.querySelector('[data-m="total"]'),
      tokens: metrics.querySelector('[data-m="tokens"]'),
      rate: metrics.querySelector('[data-m="rate"]'),
    },
    replyEl: replyPreview.querySelector(".content"),
    errorBarEl: errorBar,
  };

  // 渲染 12 个节点 + 连接线
  NODES.forEach((n, i) => {
    const node = document.createElement("div");
    node.className = "node";
    node.dataset.key = n.key;
    node.innerHTML = `
      <div class="idx">${n.idx}</div>
      <div class="body">
        <div class="name">${n.name} <span class="side ${n.side}">${n.side === "fe" ? "前端" : "后端"}</span></div>
        <div class="desc">${n.desc}</div>
      </div>
      <div class="timing" data-timing="${n.key}">-</div>
      <div class="detail">
        <div class="detail-label">该阶段数据</div>
        <pre>（暂无数据）</pre>
      </div>
    `;
    // 点击节点展开/收起详情（绑定到该轮节点）
    node.onclick = () => toggleDetail(turn, n.key);
    flow.appendChild(node);
    turn.nodeEls[n.key] = node;

    if (i < NODES.length - 1) {
      const c = document.createElement("div");
      c.className = "connector";
      flow.appendChild(c);
      turn.connectorEls.push(c);
    }
  });

  turns.appendChild(root);
  return turn;
}

// ---------- 详情面板交互 ----------
function toggleDetail(turn, key) {
  const node = turn.nodeEls[key];
  if (!node) return;
  const detail = node.querySelector(".detail");
  detail.classList.toggle("open");
}

// ---------- JSON 语法高亮 ----------
// 纯前端实现，无第三方依赖：转义后用正则给不同 token 包裹 span
function highlightJSON(obj) {
  let json = JSON.stringify(obj, null, 2);
  // 先转义 HTML 特殊字符，防止内容里的 < > & 破坏结构
  json = json.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  // 匹配字符串(含键名)、布尔、null、数字，分别上色
  return json.replace(
    /("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d+)?(?:[eE][+\-]?\d+)?)/g,
    (match) => {
      let cls = "tok-num";
      if (/^"/.test(match)) {
        cls = /:$/.test(match) ? "tok-key" : "tok-str";
      } else if (/true|false/.test(match)) {
        cls = "tok-bool";
      } else if (/null/.test(match)) {
        cls = "tok-null";
      }
      return `<span class="${cls}">${match}</span>`;
    }
  );
}

function renderDetail(turn, key) {
  const data = turn.nodeData[key];
  const node = turn.nodeEls[key];
  if (!data || !node) return;
  const pre = node.querySelector(".detail pre");
  pre.innerHTML = highlightJSON(data);
}

// ---------- 节点状态控制 ----------
function enterNode(turn, key, ts) {
  const node = turn.nodeEls[key];
  if (!node) return;
  const def = NODES.find(n => n.key === key);

  if (turn.activeKey && turn.activeKey !== key) {
    completeNode(turn, turn.activeKey);
  }

  if (turn.timings[key] === undefined) {
    turn.timings[key] = (ts !== undefined ? ts : Date.now());
  }
  node.classList.add(def.side, "active");
  renderTiming(turn, key);
  renderDetail(turn, key);
  turn.activeKey = key;

  const reachedIdx = NODES.findIndex(n => n.key === key);
  for (let i = 0; i < reachedIdx; i++) turn.connectorEls[i].classList.add("passed");
}

function completeNode(turn, key) {
  const node = turn.nodeEls[key];
  if (!node) return;
  node.classList.remove("active");
  node.classList.add("done");
}

function renderTiming(turn, key) {
  const idx = NODES.findIndex(n => n.key === key);
  const cur = turn.timings[key];
  if (cur === undefined) return;
  // 基于 NODES 顺序找前一个有时间戳的节点（数据源为 turn.timings）
  let prevTs = null;
  for (let i = idx - 1; i >= 0; i--) {
    if (turn.timings[NODES[i].key] !== undefined) { prevTs = turn.timings[NODES[i].key]; break; }
  }
  const el = turn.nodeEls[key].querySelector(".timing");
  if (prevTs === null) {
    el.textContent = "起点";
  } else {
    el.textContent = `+${cur - prevTs} ms`;
  }
}

function markError(turn, message) {
  if (turn.activeKey && turn.nodeEls[turn.activeKey]) {
    turn.nodeEls[turn.activeKey].classList.remove("active", "done", "fe", "be");
    turn.nodeEls[turn.activeKey].classList.add("error");
  }
  const bar = turn.errorBarEl;
  bar.style.display = "block";
  bar.textContent = "❌ 错误：" + message;
}

// ---------- 指标渲染 ----------
function renderMetrics(turn, totalTokens) {
  const tFetch = turn.timings["fetch"];
  const tTtft = turn.timings["ttft"];
  const tDone = turn.timings["done"] || Date.now();

  if (tFetch !== undefined && tTtft !== undefined) {
    turn.metricEls.ttft.textContent = tTtft - tFetch;
  }
  if (tFetch !== undefined) {
    turn.metricEls.total.textContent = tDone - tFetch;
  }
  if (totalTokens !== undefined && totalTokens !== null) {
    turn.metricEls.tokens.textContent = totalTokens;
    if (tTtft !== undefined && tDone > tTtft) {
      const rate = (totalTokens / ((tDone - tTtft) / 1000)).toFixed(1);
      turn.metricEls.rate.textContent = rate;
    }
  }
}

// ---------- transcript 对话气泡 ----------
function appendBubble(role, text) {
  const transcript = document.getElementById("transcript");
  const bubble = document.createElement("div");
  bubble.className = "bubble " + role;
  bubble.textContent = text;
  transcript.appendChild(bubble);
  return bubble;
}

// ---------- 发送与 SSE 解析 ----------
async function sendMessage() {
  if (busy) return;
  const input = document.getElementById("input");
  const text = input.value.trim();
  if (!text) return;

  busy = true;
  const btn = document.getElementById("send-btn");
  btn.disabled = true;
  input.value = "";

  // 顶部气泡：用户气泡 + 空助手气泡（实时更新）
  appendBubble("user", text);
  const assistantBubble = appendBubble("assistant", "");

  // 新建本轮链路卡片
  turnCount += 1;
  const summary = text.length > 40 ? text.slice(0, 40) + "…" : text;
  const turn = createTurn(turnCount, summary);

  // 发送后自动滚动定位到当前轮链路图
  turn.root.scrollIntoView({ behavior: "smooth", block: "start" });

  // 节点1：用户点击发送
  turn.nodeData.click = { text };
  enterNode(turn, "click");

  // 节点2：组装请求消息（携带完整历史，实现多轮上下文记忆）
  const apiMessages = [...history, { role: "user", content: text }];
  const reqBody = { messages: apiMessages, stream: true, web_search: false };
  turn.nodeData.assemble = { messages: apiMessages, body: reqBody };
  enterNode(turn, "assemble");

  let replyText = "";
  let totalTokens = null;

  try {
    // 节点3：发起 fetch 请求
    turn.nodeData.fetch = { url: API_URL, method: "POST", headers: { "Content-Type": "application/json" }, body: reqBody };
    enterNode(turn, "fetch");
    const resp = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(reqBody),
    });

    // 节点4：收到响应头
    turn.nodeData.headers = { status: resp.status, statusText: resp.statusText };
    enterNode(turn, "headers");
    if (!resp.ok) {
      const d = await resp.json().catch(() => ({}));
      throw new Error(d.detail || ("HTTP " + resp.status));
    }

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let gotFirstContent = false;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let lines = buffer.split("\n\n");
      buffer = lines.pop();

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const dataStr = line.slice(6);
        if (dataStr === "[DONE]") {
          turn.nodeData.done = { event: "[DONE]", timestamp: Date.now(), usage: totalTokens !== null ? { total_tokens: totalTokens } : null };
          enterNode(turn, "done");
          completeNode(turn, "done");
          break;
        }
        let data;
        try { data = JSON.parse(dataStr); } catch { continue; }

        // 后端阶段事件（节点 5-8）
        if (data.type === "stage") {
          if (turn.nodeEls[data.stage]) {
            turn.nodeData[data.stage] = {
              stage: data.stage,
              timestamp: data.ts,
              source: "backend_sse",
              ...(data.detail ? { detail: data.detail } : {}),
            };
            enterNode(turn, data.stage, data.ts);
          }
          continue;
        }
        // 联网搜索事件（可选）
        if (data.type === "searching") {
          continue;
        }
        // 内容增量
        if (data.content) {
          if (!gotFirstContent) {
            turn.nodeData.ttft = { firstDelta: data.content, timestamp: Date.now() };
            enterNode(turn, "ttft");
            gotFirstContent = true;
          } else {
            if (!turn.nodeData.streaming) turn.nodeData.streaming = { deltas: [] };
            turn.nodeData.streaming.deltas.push({ content: data.content, at: Date.now() });
            if (turn.nodeData.streaming.deltas.length > 5) turn.nodeData.streaming.deltas.shift();
            enterNode(turn, "streaming");
          }
          replyText += data.content;
          turn.nodeData.typing = { renderedLength: replyText.length, text: replyText, timestamp: Date.now() };
          turn.replyEl.textContent = replyText;
          assistantBubble.textContent = replyText;  // 实时更新顶部助手气泡
          enterNode(turn, "typing");
        }
        // usage
        if (data.usage) {
          totalTokens = data.usage.total_tokens;
        }
        // 错误
        if (data.error) {
          throw new Error(data.error);
        }
      }
    }

    if (turn.activeKey) completeNode(turn, turn.activeKey);
    if (turn.timings["done"] === undefined) {
      turn.nodeData.done = { event: "stream_end", timestamp: Date.now(), usage: totalTokens !== null ? { total_tokens: totalTokens } : null };
      enterNode(turn, "done"); completeNode(turn, "done");
    }
    renderMetrics(turn, totalTokens);
    if (!replyText) {
      turn.replyEl.textContent = "（无文本内容）";
      assistantBubble.textContent = "（无文本内容）";
    }

    // 本轮成功结束：把 user / assistant 追加进 history（多轮上下文记忆）
    history.push({ role: "user", content: text });
    history.push({ role: "assistant", content: replyText });
  } catch (e) {
    markError(turn, e.message);
    renderMetrics(turn, totalTokens);
    // 出错轮次不污染 history（不追加该轮）
    assistantBubble.textContent = "❌ " + e.message;
  } finally {
    busy = false;
    btn.disabled = false;
  }
}

// ---------- 清空会话 ----------
function clearConversation() {
  if (busy) return;
  history = [];
  turnCount = 0;
  document.getElementById("transcript").innerHTML = "";
  document.getElementById("turns").innerHTML = "";
}

// ---------- 初始化 ----------
document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("send-btn").onclick = sendMessage;
  document.getElementById("clear-btn").onclick = clearConversation;
  const input = document.getElementById("input");
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (busy) return;  // busy 期间回车不触发
      sendMessage();
    }
  });
});
