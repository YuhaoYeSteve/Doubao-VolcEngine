const LS_KEY = "ark_chat_conversations";
const LS_SETTINGS_KEY = "ark_chat_settings";
let conversations = [];
let currentId = null;
let pendingImages = []; // Store base64 images
let settings = { systemPrompt: "", apiKey: "", modelId: "" };
let webSearchEnabled = false;

function loadSettings() {
  try {
    const defaultSettings = { systemPrompt: "", apiKey: "", modelId: "" };
    const saved = JSON.parse(localStorage.getItem(LS_SETTINGS_KEY) || '{}');
    settings = { ...defaultSettings, ...saved };
  } catch {
    settings = { systemPrompt: "", apiKey: "", modelId: "" };
  }
}

function toggleSettings(show) {
  const modal = document.getElementById("settings-modal");
  if (show) {
    document.getElementById("setting-api-key").value = settings.apiKey || "";
    document.getElementById("setting-model-id").value = settings.modelId || "";
    document.getElementById("setting-system-prompt").value = settings.systemPrompt || "";
    modal.classList.remove("hidden");
    modal.classList.add("flex");
  } else {
    modal.classList.add("hidden");
    modal.classList.remove("flex");
  }
}

function saveSettings() {
  settings.apiKey = document.getElementById("setting-api-key").value.trim();
  settings.modelId = document.getElementById("setting-model-id").value.trim();
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
  
  // Mobile: Close sidebar after selection
  document.body.classList.remove('sidebar-open');
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

function updateLastMessage(content, statusText) {
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

  // Update Content
  if (content !== undefined) {
     const markdownDiv = bubble.querySelector(".markdown-body");
     if (markdownDiv) {
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
      web_search: webSearchEnabled,
      api_key: settings.apiKey || undefined,
      model: settings.modelId || undefined
    };
    const resp = await fetch("http://localhost:8000/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req)
    });
    if (!resp.ok) {
      const d = await resp.json().catch(() => ({}));
      throw new Error(d.detail || ("HTTP " + resp.status));
    }

    // 创建空的 assistant 消息
    const assistantMsg = { role: "assistant", content: "", created: Date.now() };
    c.messages.push(assistantMsg);
    saveConversations();
    
    // Reset scroll state before starting stream
    userScrolledUp = false;
    
    // IMPORTANT: Render the empty bubble FIRST so updateLastMessage has a target
    renderMessages();

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

                if (data.content) {
                  // Push to buffer, let the loop handle rendering
                  streamBuffer += data.content;
                }
                if (data.usage) {
                  setStatus("tokens：" + data.usage.total_tokens);
                }
                if (data.error) {
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
    
    // Global function expose for settings modal (onclick attributes in HTML)
    window.toggleSettings = toggleSettings;
    window.saveSettings = saveSettings;

    loadSettings();
    loadConversations();
    renderConversationList();
    selectConversation(conversations.length ? conversations[0].id : null);
    initSidebar();
});
