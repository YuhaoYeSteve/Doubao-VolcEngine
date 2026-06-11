const LS_KEY = "ark_chat_conversations";
const LS_SETTINGS_KEY = "ark_chat_settings";
const LS_THINKING_CAPS_KEY = "ark_thinking_caps";
let conversations = [];
let currentId = null;
let pendingImages = []; // Store base64 images
let settings = { systemPrompt: "" };
let webSearchEnabled = false;
let reasoningEffort = ""; // 思考深度：""=默认 / minimal / low / medium / high
// 模型思考能力缓存：{模型名: "effort"|"toggle"|"none"}，按真实模型名持久化
let modelThinkingCaps = {};
// 当前菜单已应用的思考能力（默认 effort 全开，待后端探测后更新）
let currentThinkingMode = "effort";
// 各档位对应的按钮显示文案
const REASONING_LABELS = {
  "": "深度思考",
  "minimal": "关闭思考",
  "low": "轻量思考",
  "medium": "均衡思考",
  "high": "深度思考(high)",
};

function loadThinkingCaps() {
  try {
    modelThinkingCaps = JSON.parse(localStorage.getItem(LS_THINKING_CAPS_KEY) || "{}");
  } catch {
    modelThinkingCaps = {};
  }
}
function saveThinkingCaps() {
  localStorage.setItem(LS_THINKING_CAPS_KEY, JSON.stringify(modelThinkingCaps));
}

// 刷新思考按钮文案与高亮态
function refreshThinkingBtn() {
  const thinkingBtn = document.getElementById("thinking-btn");
  const thinkingLabel = document.getElementById("thinking-label");
  if (!thinkingBtn || !thinkingLabel) return;
  thinkingLabel.textContent = REASONING_LABELS[reasoningEffort] || "深度思考";
  // 选了非默认档位时高亮按钮
  if (reasoningEffort) {
    thinkingBtn.classList.remove("text-gray-500", "hover:bg-gray-100");
    thinkingBtn.classList.add("text-blue-600", "bg-blue-50", "hover:bg-blue-100");
  } else {
    thinkingBtn.classList.add("text-gray-500", "hover:bg-gray-100");
    thinkingBtn.classList.remove("text-blue-600", "bg-blue-50", "hover:bg-blue-100");
  }
  updateThinkingBadge();
}

// 计算并显示「真实生效的思考深度」徽章。
// 真实档位由模型能力(currentThinkingMode)与用户所选(reasoningEffort)共同决定：
//  - none：模型不支持思考 → 不支持
//  - toggle：仅开/关，minimal=已关闭，其余=已开启（无强度分级）
//  - effort：按所选强度精确显示
//  - 默认档位(未选)：交给模型默认行为
function updateThinkingBadge() {
  const badge = document.getElementById("thinking-badge");
  const text = document.getElementById("thinking-badge-text");
  if (!badge || !text) return;
  // 无会话时隐藏
  if (!currentId) {
    badge.classList.add("hidden");
    badge.classList.remove("inline-flex");
    return;
  }
  let label;
  if (currentThinkingMode === "none") {
    label = "不支持思考";
  } else if (!reasoningEffort) {
    label = "思考：模型默认";
  } else if (currentThinkingMode === "toggle") {
    label = reasoningEffort === "minimal" ? "思考：已关闭" : "思考：已开启";
  } else {
    // effort 模式：精确强度
    const map = { minimal: "思考：已关闭", low: "思考：轻量", medium: "思考：均衡", high: "思考：深度" };
    label = map[reasoningEffort] || "思考：模型默认";
  }
  text.textContent = label;
  badge.classList.remove("hidden");
  badge.classList.add("inline-flex");
}

// 根据探测到的思考能力，动态启用/禁用思考菜单档位
function applyThinkingCapability(mode) {
  currentThinkingMode = mode || "effort";
  const btn = document.getElementById("thinking-btn");
  const opts = document.querySelectorAll(".thinking-opt");
  // 先清除所有禁用态
  opts.forEach(o => o.classList.remove("opacity-40", "pointer-events-none"));
  if (btn) btn.classList.remove("opacity-40", "pointer-events-none");

  if (currentThinkingMode === "none") {
    // 模型不支持思考：禁用整个按钮，复位档位
    if (btn) btn.classList.add("opacity-40", "pointer-events-none");
    reasoningEffort = "";
  } else if (currentThinkingMode === "toggle") {
    // 仅支持开/关：禁用 low/medium 两档
    opts.forEach(o => {
      const eff = o.getAttribute("data-effort");
      if (eff === "low" || eff === "medium") {
        o.classList.add("opacity-40", "pointer-events-none");
      }
    });
    // 若当前档位落在被禁用项，回退到 high（深度思考=开启）
    if (reasoningEffort === "low" || reasoningEffort === "medium") {
      reasoningEffort = "high";
    }
  }
  // effort 模式：全部可用，无需额外处理
  if (typeof refreshThinkingBtn === "function") refreshThinkingBtn();
}


function loadSettings() {
  try {
    const defaultSettings = { systemPrompt: "" };
    const saved = JSON.parse(localStorage.getItem(LS_SETTINGS_KEY) || '{}');
    settings = { ...defaultSettings, ...saved };
  } catch {
    settings = { systemPrompt: "" };
  }
}

function toggleSettings(show) {
  const modal = document.getElementById("settings-modal");
  if (show) {
    document.getElementById("setting-system-prompt").value = settings.systemPrompt || "";
    modal.classList.remove("hidden");
    modal.classList.add("flex");
  } else {
    modal.classList.add("hidden");
    modal.classList.remove("flex");
  }
}

function saveSettings() {
  settings.systemPrompt = document.getElementById("setting-system-prompt").value.trim();
  localStorage.setItem(LS_SETTINGS_KEY, JSON.stringify(settings));
  toggleSettings(false);
}

function uid() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}
function loadConversations() {
  try {
    conversations = JSON.parse(localStorage.getItem(LS_KEY) || "[]");
  } catch {
    conversations = [];
  }
}
function saveConversations() {
  localStorage.setItem(LS_KEY, JSON.stringify(conversations));
}
function renderConversationList() {
  const list = document.getElementById("conv-list");
  list.innerHTML = "";
  conversations.forEach(c => {
    const item = document.createElement("button");
    item.className = "w-full text-left px-3 py-2 rounded-lg text-sm text-gray-700 hover:bg-gray-200/50 transition-colors truncate mb-0.5";
    if (c.id === currentId) item.className = "w-full text-left px-3 py-2 rounded-lg text-sm bg-gray-200/60 text-gray-900 font-medium mb-0.5";
    item.textContent = c.title;
    item.onclick = () => selectConversation(c.id);
    list.appendChild(item);
  });
}
function selectConversation(id) {
  currentId = id;
  const c = conversations.find(x => x.id === id);
  document.getElementById("conv-title").textContent = c ? c.title : "未选择会话";
  renderConversationList();
  renderMessages();
  refreshModelBadge();
  refreshThinkingCapability();
  
  // Mobile: Close sidebar after selection
  document.body.classList.remove('sidebar-open');
}

// 根据当前会话的历史记录恢复思考能力（按消息 thinkingMode 或按模型名缓存）
function refreshThinkingCapability() {
  const c = conversations.find(x => x.id === currentId);
  let mode = "effort"; // 无记录时默认全开
  if (c) {
    for (let i = c.messages.length - 1; i >= 0; i--) {
      const m = c.messages[i];
      if (m.thinkingMode) { mode = m.thinkingMode; break; }
      if (m.model && modelThinkingCaps[m.model]) { mode = modelThinkingCaps[m.model]; break; }
    }
  }
  applyThinkingCapability(mode);
}
function renderMessages(checkUserScroll = false) {
  const box = document.getElementById("messages");
  
  // Capture current state for smart scrolling
  const previousScrollTop = box.scrollTop;
  const distToBottom = box.scrollHeight - box.scrollTop - box.clientHeight;
  const isNearBottom = distToBottom <= 100;

  box.innerHTML = "";
  const c = conversations.find(x => x.id === currentId);
  if (!c) return;
  c.messages.forEach(m => {
    const row = document.createElement("div");
    row.className = "flex w-full max-w-3xl mx-auto mb-6";
    const bubble = document.createElement("div");
    bubble.className = "px-4 py-3 rounded-2xl overflow-hidden max-w-[85%]";
    
    // Status/Thought Area (Initially hidden)
    const statusDiv = document.createElement("div");
    statusDiv.className = "hidden text-xs text-gray-500 mb-2 p-2 bg-gray-50 rounded border border-gray-100 flex items-center gap-2";
    statusDiv.innerHTML = `<span class="animate-pulse">✨</span> <span class="status-text">思考中...</span>`;
    bubble.appendChild(statusDiv);

    // 深度思考过程区（可折叠，仅当该消息有 reasoning 时显示）
    const reasoningWrap = document.createElement("details");
    reasoningWrap.className = "reasoning-wrap hidden mb-2 text-xs bg-gray-50 border border-gray-100 rounded-lg overflow-hidden";
    reasoningWrap.innerHTML = `<summary class="cursor-pointer select-none px-3 py-2 text-gray-500 hover:bg-gray-100">💭 思考过程</summary><div class="reasoning-body px-3 py-2 text-gray-600 whitespace-pre-wrap leading-relaxed border-t border-gray-100"></div>`;
    // 用户手动展开/收起时打标记，之后不再自动控制，尊重用户选择
    reasoningWrap.querySelector("summary").addEventListener("click", () => {
      reasoningWrap.dataset.userToggled = "1";
    });
    bubble.appendChild(reasoningWrap);
    if (m.role !== "user" && m.reasoning) {
      reasoningWrap.classList.remove("hidden");
      reasoningWrap.querySelector(".reasoning-body").textContent = m.reasoning;
    }
    
    // Markdown Container
    const markdownDiv = document.createElement("div");
    markdownDiv.className = "markdown-body text-sm leading-relaxed";

    let contentHtml = "";
    
    // Handle multi-modal content (array) or legacy string
    if (Array.isArray(m.content)) {
      m.content.forEach(part => {
        if (part.type === "text") {
          contentHtml += marked.parse(part.text);
        } else if (part.type === "image_url") {
          contentHtml += `<img src="${part.image_url.url}" class="max-w-full rounded-lg mb-2" />`;
        }
      });
    } else {
      contentHtml = marked.parse(m.content || "");
    }

    markdownDiv.innerHTML = contentHtml;
    bubble.appendChild(markdownDiv);

    // Highlight code blocks and add copy buttons
    markdownDiv.querySelectorAll('pre code').forEach((block) => {
       hljs.highlightElement(block);
    });
    markdownDiv.querySelectorAll('pre').forEach((pre) => {
      if (pre.querySelector('.copy-btn')) return;
      const btn = document.createElement('button');
      btn.className = 'copy-btn';
      btn.textContent = 'Copy';
      btn.onclick = () => {
         navigator.clipboard.writeText(pre.innerText).then(() => {
            btn.textContent = 'Copied!';
            setTimeout(() => btn.textContent = 'Copy', 2000);
         });
      };
      pre.appendChild(btn);
    });

    if (m.role === "user") {
      row.className += " justify-end";
      bubble.className += " user-bubble bg-[#EBF5FF] text-gray-900 rounded-2xl rounded-tr-sm"; 
      // Note: text color is handled by CSS now, but keeping inline override for safety if CSS fails to load
      // markdownDiv.style.color = '#111827'; 
    } else {
      row.className += " justify-start";
      // AI message: Transparent background, just text
      bubble.className += " bot-bubble bg-transparent pl-0 text-gray-900"; 
       // markdownDiv.style.color = '#1f2937';
       
       // Show status if present in message metadata (we'll need to store it in conversation)
       if (m.statusText) {
         statusDiv.classList.remove("hidden");
         statusDiv.querySelector(".status-text").textContent = m.statusText;
       }
    }
    box.appendChild(row);
    row.appendChild(bubble);
  });
  
  // Smart Scroll Logic
  if (checkUserScroll) {
      if (isNearBottom) {
          scrollToBottom();
      }
  } else {
      // Initial render or non-stream update: force scroll to bottom
      scrollToBottom();
      // Reset scroll state on full render
      userScrolledUp = false;
  }
}

// Scroll State Management
let userScrolledUp = false;
const msgBox = document.getElementById("messages");

msgBox.addEventListener('scroll', () => {
    const distToBottom = msgBox.scrollHeight - msgBox.scrollTop - msgBox.clientHeight;
    // Threshold to 20px to avoid precision issues
    userScrolledUp = distToBottom > 20; 
});

function scrollToBottom() {
    const box = document.getElementById("messages");
    box.scrollTop = box.scrollHeight;
}

function updateLastMessage(content, statusText, reasoning) {
  const box = document.getElementById("messages");
  const lastRow = box.lastElementChild;
  if (!lastRow) return;
  
  const bubble = lastRow.querySelector(".px-4"); 
  if (!bubble) return;

  // Update Status
  if (statusText) {
     const statusDiv = bubble.querySelector(".text-gray-500.mb-2");
     if (statusDiv) {
         statusDiv.classList.remove("hidden");
         statusDiv.querySelector(".status-text").textContent = statusText;
     }
  }

  // 更新思考过程（有内容才展开思考区）
  if (reasoning) {
     const wrap = bubble.querySelector(".reasoning-wrap");
     if (wrap) {
         wrap.classList.remove("hidden");
         // 思考进行中：自动展开（用户若手动操作过则尊重用户选择）
         if (!wrap.dataset.userToggled) wrap.open = true;
         wrap.querySelector(".reasoning-body").textContent = reasoning;
     }
  }

  // Update Content
  if (content !== undefined) {
     const markdownDiv = bubble.querySelector(".markdown-body");
     if (markdownDiv) {
         // 正式回答开始：思考已完成，自动收起思考区（用户若手动操作过则尊重用户选择）
         if (content) {
            const wrap = bubble.querySelector(".reasoning-wrap");
            if (wrap && !wrap.dataset.userToggled) wrap.open = false;
         }
         // Check if content is actually different to avoid unnecessary reflows? 
         // Actually marked.parse might return same HTML.
         // But for streaming, it always grows.
         markdownDiv.innerHTML = marked.parse(content);
         
         // Re-apply highlight
         markdownDiv.querySelectorAll('pre code').forEach((block) => {
             hljs.highlightElement(block);
         });
         // Re-apply copy buttons
         markdownDiv.querySelectorAll('pre').forEach((pre) => {
            if (pre.querySelector('.copy-btn')) return;
            const btn = document.createElement('button');
            btn.className = 'copy-btn';
            btn.textContent = 'Copy';
            btn.onclick = () => {
                navigator.clipboard.writeText(pre.innerText).then(() => {
                    btn.textContent = 'Copied!';
                    setTimeout(() => btn.textContent = 'Copy', 2000);
                });
            };
            pre.appendChild(btn);
         });
     }
  }

  // Smart Scroll: Only scroll if user hasn't scrolled up
  if (!userScrolledUp) {
      scrollToBottom();
  }
}

function createConversation() {
  const id = uid();
  const conv = { id, title: "新会话", messages: [] };
  conversations.unshift(conv);
  saveConversations();
  selectConversation(id);
  
  // Enable input if it was disabled (e.g., previous chat was stuck)
  const el = document.getElementById("input");
  const btn = document.getElementById("send-btn");
  el.disabled = false;
  btn.disabled = false;
  document.getElementById("upload-btn").disabled = false;
  btn.classList.remove("opacity-50", "cursor-not-allowed");
  el.focus();
}
function deleteConversation() {
  if (!currentId) return;
  conversations = conversations.filter(x => x.id !== currentId);
  saveConversations();
  currentId = conversations.length ? conversations[0].id : null;
  renderConversationList();
  selectConversation(currentId);
}
function renameConversation() {
  if (!currentId) return;
  const c = conversations.find(x => x.id === currentId);
  const t = prompt("输入新标题", c.title || "");
  if (t === null) return;
  c.title = t || "未命名会话";
  saveConversations();
  renderConversationList();
  document.getElementById("conv-title").textContent = c.title;
}
function showLoading() {
  const box = document.getElementById("messages");
  const row = document.createElement("div");
  row.className = "flex w-full max-w-3xl mx-auto mb-6 justify-start";
  row.id = "loading-bubble";
  const bubble = document.createElement("div");
  // Loading bubble can keep a subtle background or be transparent
  bubble.className = "px-0 py-3 flex items-center"; 
  bubble.innerHTML = `
    <div class="flex items-center gap-2 text-gray-400 text-xs">
       <div class="w-4 h-4 rounded-full overflow-hidden border border-gray-200">
         <img src="https://lf-flow-web-cdn.doubao.com/obj/flow-doubao/doubao/web/logo-icon.png" class="w-full h-full object-cover">
       </div>
       <span>思考中...</span>
    </div>
  `;
  row.appendChild(bubble);
  box.appendChild(row);
  scrollToBottom();
}
function removeLoading() {
  const el = document.getElementById("loading-bubble");
  if (el) el.remove();
}

// Image Handling
function handleFiles(files) {
  Array.from(files).forEach(file => {
    if (!file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = e => {
      pendingImages.push(e.target.result);
      renderPreview();
    };
    reader.readAsDataURL(file);
  });
}

function renderPreview() {
  const container = document.getElementById("image-preview");
  container.innerHTML = "";
  pendingImages.forEach((src, idx) => {
    const wrap = document.createElement("div");
    wrap.className = "relative flex-shrink-0";
    wrap.innerHTML = `
      <img src="${src}" class="h-16 w-16 object-cover rounded border">
      <button class="absolute -top-1 -right-1 bg-red-500 text-white rounded-full p-0.5 w-4 h-4 flex items-center justify-center text-xs"
        onclick="removeImage(${idx})">×</button>
    `;
    container.appendChild(wrap);
  });
}

window.removeImage = function(idx) {
  pendingImages.splice(idx, 1);
  renderPreview();
}

async function sendMessage() {
  const el = document.getElementById("input");
  const btn = document.getElementById("send-btn");
  const text = el.value.trim();
  
  // Allow empty text if images are present
  if ((!text && pendingImages.length === 0)) return;
  // Do not block if disabled, just return (though UI should prevent this)
  if (el.disabled) return;
  
  // 禁用输入和按钮
  el.disabled = true;
  btn.disabled = true;
  btn.classList.add("opacity-50", "cursor-not-allowed");
  document.getElementById("upload-btn").disabled = true;

  // Ensure conversation exists
  if (!currentId) createConversation();
  
  // Re-fetch conversation object to ensure we have the latest reference
  let c = conversations.find(x => x.id === currentId);
  if (!c) {
      // Fallback if currentId is invalid for some reason
      createConversation();
      c = conversations.find(x => x.id === currentId);
  }

  // Construct Message Content
  let userContent;
  if (pendingImages.length > 0) {
    userContent = [];
    if (text) userContent.push({ type: "text", text: text });
    pendingImages.forEach(img => {
      userContent.push({ type: "image_url", image_url: { url: img } });
    });
  } else {
    userContent = text;
  }

  c.messages.push({ role: "user", content: userContent, created: Date.now() });
  
  // Clear inputs
  pendingImages = [];
  renderPreview();
  el.value = "";
  el.style.height = 'auto'; 
  
  saveConversations();
  renderMessages();
  
  setStatus("发送中...");
  showLoading();
  try {
    // Build messages with System Prompt if set
    let apiMessages = c.messages.map(m => ({ role: m.role === "assistant" ? "assistant" : m.role, content: m.content }));
    if (settings.systemPrompt) {
      apiMessages.unshift({ role: "system", content: settings.systemPrompt });
    }

    const req = { 
      messages: apiMessages,
      stream: true,
      web_search: webSearchEnabled
    };
    // 仅当用户选择了具体档位时才下发 reasoning_effort，否则交给模型默认行为
    if (reasoningEffort) {
      req.reasoning_effort = reasoningEffort;
    }
    const resp = await fetch("http://localhost:8000/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req)
    });
    if (!resp.ok) {
      const d = await resp.json().catch(() => ({}));
      throw new Error(d.detail || ("HTTP " + resp.status));
    }

    // 创建空的 assistant 消息（暂不渲染）
    const assistantMsg = { role: "assistant", content: "", created: Date.now() };

    // Reset scroll state before starting stream
    userScrolledUp = false;

    // 关键：不要在 fetch 返回后就清空"思考中"。
    // SSE 让 fetch 提前 resolve（响应头先到、内容未到），此时渲染空气泡会导致
    // "思考中"消失到首字出现之间出现几秒空白。
    // 改为：等首个有效数据（内容/搜索状态/错误）真正到达时，才移除"思考中"并渲染气泡。
    let bubbleReady = false;
    function showAssistantBubble() {
      if (bubbleReady) return;
      bubbleReady = true;
      c.messages.push(assistantMsg);
      saveConversations();
      removeLoading();
      renderMessages();
    }

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    // Typewriter Effect Queue
    let streamBuffer = ""; // Full content from backend
    let isStreamActive = true;
    let typeWriterLoop = null;
    
    // Start a dedicated render loop for smooth typing
    typeWriterLoop = setInterval(() => {
            if (assistantMsg.content.length < streamBuffer.length) {
                // Dynamic speed: if backlog is large, type faster
                const backlog = streamBuffer.length - assistantMsg.content.length;
                const step = backlog > 50 ? 5 : (backlog > 20 ? 2 : 1);
                
                assistantMsg.content += streamBuffer.slice(assistantMsg.content.length, assistantMsg.content.length + step);
                updateLastMessage(assistantMsg.content);
                saveConversations(); // Optional: save less frequently if needed
            } else if (!isStreamActive) {
                // Stream finished and buffer cleared
                clearInterval(typeWriterLoop);
                renderMessages();
                setStatus("完成");
            }
        }, 16); // ~60fps

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          
          let lines = buffer.split("\n\n");
          buffer = lines.pop(); 

          for (const line of lines) {
            if (line.startsWith("data: ")) {
              const dataStr = line.slice(6);
              if (dataStr === "[DONE]") break;
              try {
                const data = JSON.parse(dataStr);
                
                // Handle search status
                if (data.type === 'searching') {
                   // 首个有效事件到达，移除"思考中"并渲染气泡
                   showAssistantBubble();
                   // Status updates happen immediately, bypassing typewriter
                   if (data.status === 'start') {
                      assistantMsg.statusText = "正在分析请求，准备调用搜索工具...";
                      saveConversations();
                      updateLastMessage(undefined, assistantMsg.statusText);
                   } else if (data.status === 'query') {
                      assistantMsg.statusText = `正在搜索: "${data.query}"`;
                      saveConversations();
                      updateLastMessage(undefined, assistantMsg.statusText);
                   } else if (data.status === 'end') {
                      assistantMsg.statusText = "搜索完成，正在生成回答...";
                      saveConversations();
                      updateLastMessage(undefined, assistantMsg.statusText);
                   }
                }

                // 思考能力：后端探测出当前模型支持的思考模式，动态调整菜单
                if (data.type === 'thinking_capability') {
                  assistantMsg.thinkingMode = data.mode;
                  applyThinkingCapability(data.mode);
                }

                if (data.content) {
                  // 首字到达，移除"思考中"并渲染气泡
                  showAssistantBubble();
                  // Push to buffer, let the loop handle rendering
                  streamBuffer += data.content;
                }
                if (data.reasoning) {
                  // 思考过程：直接累加并实时渲染（不经打字机缓冲）
                  showAssistantBubble();
                  assistantMsg.reasoning += data.reasoning;
                  updateLastMessage(undefined, undefined, assistantMsg.reasoning);
                }
                if (data.usage) {
                  setStatus("tokens：" + data.usage.total_tokens);
                }
                if (data.model) {
                  // 后端透传的火山真实模型名，存入消息并显示到顶部徽章
                  assistantMsg.model = data.model;
                  // 按真实模型名持久化其思考能力，下次同模型立即应用
                  if (assistantMsg.thinkingMode) {
                    modelThinkingCaps[data.model] = assistantMsg.thinkingMode;
                    saveThinkingCaps();
                  }
                  saveConversations();
                  setModelBadge(data.model);
                }
                if (data.error) {
                  showAssistantBubble();
                  streamBuffer += `\n\n❌ Error: ${data.error}`;
                  setStatus("Error");
                }
              } catch (e) {
                console.error("解析流数据失败", e);
              }
            }
          }
        }
        isStreamActive = false; // Signal loop to finish up
        // 兜底：若整个流结束都没收到任何有效数据（空回复），也要移除"思考中"，避免卡住
        showAssistantBubble();
    } catch (e) {
        if (typeWriterLoop) clearInterval(typeWriterLoop);
        isStreamActive = false;
        
        removeLoading();
        setStatus("错误：" + e.message);
        // Show error in chat
        c.messages.push({ 
          role: "assistant", 
          content: `❌ 发送失败: ${e.message}`, 
          created: Date.now() 
        });
        saveConversations();
        renderMessages();
    } finally {
    // 恢复输入和按钮
    el.disabled = false;
    btn.disabled = false;
    document.getElementById("upload-btn").disabled = false;
    btn.classList.remove("opacity-50", "cursor-not-allowed");
    el.focus();
  }
}
function setStatus(s) {
  document.getElementById("status").textContent = s || "";
}

// 顶部模型徽章：显示当前会话实际使用的火山模型；传入空值则隐藏
function setModelBadge(model) {
  const badge = document.getElementById("model-badge");
  const text = document.getElementById("model-badge-text");
  if (!badge || !text) return;
  if (model) {
    text.textContent = model;
    badge.classList.remove("hidden");
    badge.classList.add("inline-flex");
  } else {
    badge.classList.add("hidden");
    badge.classList.remove("inline-flex");
  }
}

// 根据指定会话的最后一条带 model 的消息恢复徽章
function refreshModelBadge() {
  const c = conversations.find(x => x.id === currentId);
  let model = "";
  if (c) {
    for (let i = c.messages.length - 1; i >= 0; i--) {
      if (c.messages[i].model) { model = c.messages[i].model; break; }
    }
  }
  setModelBadge(model);
}

// Sidebar Toggle Logic
function initSidebar() {
  const toggleBtn = document.getElementById('sidebar-toggle');
  const sidebar = document.querySelector('aside');
  const overlay = document.querySelector('.sidebar-overlay');
  
  if (toggleBtn && sidebar && overlay) {
    function toggleSidebar(show) {
      if (show) {
        document.body.classList.add('sidebar-open');
      } else {
        document.body.classList.remove('sidebar-open');
      }
    }
    
    toggleBtn.addEventListener('click', () => toggleSidebar(true));
    overlay.addEventListener('click', () => toggleSidebar(false));
  }
}

// Initialization
document.addEventListener('DOMContentLoaded', () => {
    document.getElementById("new-btn").onclick = createConversation;
    document.getElementById("delete-btn").onclick = deleteConversation;
    document.getElementById("rename-btn").onclick = renameConversation;
    document.getElementById("send-btn").onclick = sendMessage;
    
    const inputEl = document.getElementById("input");
    inputEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
      }
    });
    // Auto-resize textarea
    inputEl.addEventListener("input", function() {
      this.style.height = 'auto';
      this.style.height = (this.scrollHeight) + 'px';
    });
    // Paste image support
    inputEl.addEventListener('paste', (e) => {
      const items = (e.clipboardData || e.originalEvent.clipboardData).items;
      const files = [];
      for (let item of items) {
        if (item.kind === 'file' && item.type.startsWith('image/')) {
          files.push(item.getAsFile());
        }
      }
      if (files.length > 0) {
        handleFiles(files);
      }
    });

    // Upload Button
    document.getElementById("upload-btn").onclick = () => {
      document.getElementById("file-input").click();
    };
    document.getElementById("file-input").onchange = (e) => {
      handleFiles(e.target.files);
      e.target.value = ''; // Reset to allow selecting same file again
    };
    
    document.getElementById("settings-btn").onclick = () => toggleSettings(true);

    document.getElementById("web-search-btn").onclick = function() {
      webSearchEnabled = !webSearchEnabled;
      const btn = document.getElementById("web-search-btn");
      if (webSearchEnabled) {
        btn.classList.remove("text-gray-500", "hover:bg-gray-100");
        btn.classList.add("text-blue-600", "bg-blue-50", "hover:bg-blue-100");
      } else {
        btn.classList.add("text-gray-500", "hover:bg-gray-100");
        btn.classList.remove("text-blue-600", "bg-blue-50", "hover:bg-blue-100");
      }
    };

    // 深度思考：点击按钮展开/收起档位菜单
    const thinkingBtn = document.getElementById("thinking-btn");
    const thinkingMenu = document.getElementById("thinking-menu");

    thinkingBtn.onclick = function(e) {
      e.stopPropagation();
      const willShow = thinkingMenu.classList.contains("hidden");
      if (willShow) {
        // fixed 定位：脱离输入框卡片的 overflow-hidden 裁切，按按钮位置弹在其正上方
        thinkingMenu.classList.remove("hidden");
        const r = thinkingBtn.getBoundingClientRect();
        thinkingMenu.style.left = r.left + "px";
        thinkingMenu.style.top = (r.top - thinkingMenu.offsetHeight - 8) + "px";
      } else {
        thinkingMenu.classList.add("hidden");
      }
    };

    document.querySelectorAll(".thinking-opt").forEach(opt => {
      opt.onclick = function(e) {
        e.stopPropagation();
        reasoningEffort = this.getAttribute("data-effort") || "";
        refreshThinkingBtn();
        thinkingMenu.classList.add("hidden");
      };
    });

    // 点击页面其它地方关闭菜单
    document.addEventListener("click", () => thinkingMenu.classList.add("hidden"));
    
    // Global function expose for settings modal (onclick attributes in HTML)
    window.toggleSettings = toggleSettings;
    window.saveSettings = saveSettings;

    loadSettings();
    loadThinkingCaps();
    loadConversations();
    renderConversationList();
    selectConversation(conversations.length ? conversations[0].id : null);
    initSidebar();
});
