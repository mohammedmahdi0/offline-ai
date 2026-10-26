/* Offline AI — chat UI for local models (Ollama or llama-server)
   Designed & developed by Mohammed Mahdi (محمد مهدي) — Instagram @mo.79u
   MIT License — keep this notice when you share or modify the project. */

'use strict';

// ── Creator info (shown in the sidebar card and footer) ───────────────────────────────
const CREATOR = {
  name: 'محمد مهدي',
  nameEn: 'Mohammed Mahdi',
  bio: 'طالب هندسة ذكاء اصطناعي',
  instagram: 'mo.79u',
  phone: '+964 783 853 3230',   // shown as a WhatsApp link
};

const DEFAULTS = {
  engine: 'auto',                       // auto | ollama | llamacpp
  ollamaUrl: 'http://127.0.0.1:11434',
  llamaUrl: 'http://127.0.0.1:8089',
  model: 'qwen3.8:27b-q4_K_M',
  temperature: 0.7,
  system: '',
  numCtx: 8192,
};

const SUGGESTIONS = [
  { icon: 'i-pen',   title: 'اكتب لي',  text: 'اكتب كابشن إنستغرام جذاب عن الذكاء الاصطناعي المحلي' },
  { icon: 'i-book',  title: 'اشرح لي',  text: 'اشرح لي الشبكات العصبية بأسلوب يناسب طالبًا في المرحلة المتوسطة' },
  { icon: 'i-code',  title: 'برمجة',    text: 'اكتب كود بايثون يرتّب قائمة أسماء أبجدياً مع شرح' },
  { icon: 'i-image', title: 'حلّل صورة', text: 'ارفع صورة واسأل النموذج عنها', attach: true },
];

const MAX_IMAGE_SIDE = 1280;

// ── Storage (wrapped: private windows may block it) ───────────────────────────────────
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } },
};

const $ = (id) => document.getElementById(id);
const settings = { ...DEFAULTS, ...store.get('oq.settings', {}) };
// start-lowmem.bat opens the page with ?engine=llamacpp so it never falls back to Ollama
const forcedEngine = new URLSearchParams(location.search).get('engine');
if (forcedEngine === 'llamacpp' || forcedEngine === 'ollama') settings.engine = forcedEngine;
let chats = store.get('oq.chats', []);
let currentId = store.get('oq.current', null);
let pending = [];            // images attached to the next message (data URLs)
let thinking = store.get('oq.think', false);
let engine = null;           // resolved engine: 'ollama' | 'llamacpp' | null
let controller = null;       // AbortController of the running request

// ── Helpers ───────────────────────────────────────────────────────────────────────────
const esc = (s) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const icon = (id, cls = 'icon') => `<svg class="${cls}"><use href="#${id}"/></svg>`;
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const current = () => chats.find((c) => c.id === currentId);

function toast(msg) {
  const t = $('toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 2200);
}

function saveChats() {
  if (store.set('oq.chats', chats)) return;
  // quota hit: drop stored images from all but the newest chat, then retry
  chats.forEach((c, i) => { if (i > 0) c.messages.forEach((m) => { if (m.images?.length) { m.images = []; m.imgDropped = true; } }); });
  if (!store.set('oq.chats', chats)) toast('مساحة الحفظ ممتلئة — احذف بعض المحادثات القديمة');
}

// ── Minimal, safe markdown (escape first, then format) ────────────────────────────────
function inline(s) {
  return s
    .replace(/`([^`\n]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
    .replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
}

function markdown(src) {
  const blocks = [];
  let text = esc(src).replace(/```(\w*)\n?([\s\S]*?)(```|$)/g, (_, lang, code) => {
    blocks.push(`<pre>${lang ? `<span class="lang">${lang}</span>` : ''}<code>${code.replace(/\n$/, '')}</code></pre>`);
    return `\u0000${blocks.length - 1}\u0000`;
  });
  const out = [];
  let list = null;
  const closeList = () => { if (list) { out.push(`</${list}>`); list = null; } };
  let para = [];
  const flush = () => { if (para.length) { out.push(`<p>${inline(para.join('<br>'))}</p>`); para = []; } };

  for (const line of text.split('\n')) {
    let m;
    if (/^\u0000\d+\u0000$/.test(line.trim())) { flush(); closeList(); out.push(line.trim()); }
    else if ((m = line.match(/^(#{1,3})\s+(.*)/))) { flush(); closeList(); out.push(`<h${m[1].length}>${inline(m[2])}</h${m[1].length}>`); }
    else if ((m = line.match(/^\s*[-*•]\s+(.*)/))) { flush(); if (list !== 'ul') { closeList(); out.push('<ul>'); list = 'ul'; } out.push(`<li>${inline(m[1])}</li>`); }
    else if ((m = line.match(/^\s*(\d+)[.)]\s+(.*)/))) { flush(); if (list !== 'ol') { closeList(); out.push(`<ol start="${m[1]}">`); list = 'ol'; } out.push(`<li>${inline(m[2])}</li>`); }
    else if ((m = line.match(/^&gt;\s?(.*)/))) { flush(); closeList(); out.push(`<blockquote>${inline(m[1])}</blockquote>`); }
    else if (!line.trim()) { flush(); }                       // blank lines between items keep the list open
    else if (list && /^\s{2,}\S/.test(line)) { out[out.length - 1] = out.at(-1).replace(/<\/li>$/, `<br>${inline(line.trim())}</li>`); }
    else { closeList(); para.push(line); }
  }
  flush(); closeList();
  return out.join('').replace(/\u0000(\d+)\u0000/g, (_, i) => blocks[i]);
}

// Qwen may put its reasoning inline as <think>…</think>
function splitThink(content, thinkText = '') {
  const m = content.match(/<think>([\s\S]*?)(<\/think>|$)/);
  if (!m) return { answer: content, think: thinkText };
  return { answer: content.replace(m[0], '').trimStart(), think: (thinkText + m[1]).trim() };
}

// ── Rendering ─────────────────────────────────────────────────────────────────────────
function renderSidebar() {
  const list = $('chatList');
  if (!chats.length) { list.innerHTML = '<div class="chats-empty">لا توجد محادثات بعد.</div>'; return; }
  list.innerHTML = chats.map((c) => `
    <div class="chat-item ${c.id === currentId ? 'active' : ''}" data-id="${c.id}" role="button" tabindex="0">
      <span class="t" dir="auto">${esc(c.title || 'محادثة جديدة')}</span>
      <button class="del" data-del="${c.id}" title="حذف">${icon('i-trash', 'icon')}</button>
    </div>`).join('');
}

function messageHTML(m, i, last, enter = false) {
  const cls = enter ? ' enter' : '';
  if (m.role === 'user') {
    const imgs = m.images?.length ? `<div class="imgs">${m.images.map((s) => `<img src="${s}" alt="صورة مرفقة">`).join('')}</div>`
               : m.imgDropped ? '<div class="meta">(لم تُحفظ الصورة)</div>' : '';
    return `<div class="msg user${cls}"><div class="body" dir="auto">${imgs}${esc(m.content).replace(/\n/g, '<br>')}</div></div>`;
  }
  const { answer, think } = splitThink(m.content || '', m.thinking || '');
  const thinkBox = think ? `<details class="think"${m.streaming && !answer ? ' open' : ''}><summary>${icon('i-brain')} التفكير</summary><div class="tbody" dir="auto">${esc(think)}</div></details>` : '';
  let body = m.error ? `<p class="err">${esc(m.error)}</p>` : markdown(answer);
  let caret = '';
  if (m.streaming) {
    // keep the typing caret at the end of the last line instead of on its own line
    const at = body.search(/<\/(p|li|h\d|blockquote)>(?!.*<\/(p|li|h\d|blockquote)>)/s);
    if (at >= 0 && !/<\/pre>\s*$/.test(body)) body = body.slice(0, at) + '<span class="caret"></span>' + body.slice(at);
    else caret = '<span class="caret"></span>';
  }
  const stat = m.stats ? `<span class="stat">${m.stats.tps.toFixed(1)} توكن/ثانية · ${m.stats.tokens} توكن</span>` : '';
  const tools = m.streaming ? '' : `<div class="meta">
      <button data-copy="${i}">${icon('i-copy')}نسخ</button>
      ${last ? `<button data-regen="${i}">${icon('i-redo')}إعادة</button>` : ''}${stat}</div>`;
  return `<div class="msg bot${cls}"><div class="avatar"><svg><use href="#i-mark"/></svg></div>
    <div class="body md" dir="auto">${thinkBox}${body}${caret}${tools}</div></div>`;
}

function renderThread(stick = true, enterFrom = Infinity) {
  const c = current();
  const msgs = c?.messages || [];
  $('hero').style.display = msgs.length ? 'none' : '';
  $('thread').innerHTML = msgs.map((m, i) => messageHTML(m, i, i === msgs.length - 1, i >= enterFrom)).join('');
  if (stick) scrollToEnd();
}

function scrollToEnd() {
  const s = $('scroll');
  requestAnimationFrame(() => { s.scrollTop = s.scrollHeight; });
}

function renderAttachments() {
  $('attachments').innerHTML = pending.map((src, i) =>
    `<div class="thumb"><img src="${src}" alt=""><button type="button" data-rm="${i}" aria-label="إزالة">${icon('i-x')}</button></div>`).join('');
  updateSend();
}

function updateSend() {
  const busy = !!controller;
  const btn = $('sendBtn');
  btn.innerHTML = icon(busy ? 'i-stop' : 'i-send');
  btn.setAttribute('aria-label', busy ? 'إيقاف' : 'إرسال');
  btn.disabled = !busy && !$('input').value.trim() && !pending.length;
}

function renderCreator() {
  $('creatorName').textContent = CREATOR.name;
  $('creatorBio').textContent = CREATOR.bio;
  const ig = `https://instagram.com/${CREATOR.instagram}`;
  let links = `<a href="${ig}" target="_blank" rel="noopener">${icon('i-ig')}<span>@${CREATOR.instagram}</span></a>`;
  if (CREATOR.phone) {
    const digits = CREATOR.phone.replace(/\D/g, '');
    links += `<a href="https://wa.me/${digits}" target="_blank" rel="noopener">${icon('i-phone')}<span>${esc(CREATOR.phone)}</span></a>`;
  }
  $('creatorLinks').innerHTML = links;
  $('footnote').innerHTML = `يعمل محليًا على جهازك دون الحاجة إلى الإنترنت · تصميم وتطوير <a href="${ig}" target="_blank" rel="noopener">${CREATOR.name}</a> <bdi dir="ltr">@${CREATOR.instagram}</bdi>`;
}

function renderSuggestions() {
  $('suggestions').innerHTML = SUGGESTIONS.map((s, i) =>
    `<button type="button" class="sugg" data-sugg="${i}">${icon(s.icon)}<div><b>${s.title}</b><span>${s.text}</span></div></button>`).join('');
}

function renderTheme() {
  const dark = document.documentElement.dataset.theme !== 'light';
  $('themeBtn').innerHTML = `${icon(dark ? 'i-sun' : 'i-moon')}<span>${dark ? 'الوضع الفاتح' : 'الوضع الداكن'}</span>`;
}

// ── Engine detection & status ─────────────────────────────────────────────────────────
async function ping(url, ms = 2500, anyStatus = false) {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), ms);
  try { const r = await fetch(url, { signal: ctl.signal }); return r.ok || anyStatus ? r : null; } catch { return null; } finally { clearTimeout(t); }
}

function setStatus(kind, text) {
  $('status').className = `status ${kind}`;
  $('statusText').textContent = text;
}

async function detect() {
  let found = null, label = '', loading = false;
  if (settings.engine !== 'ollama') {
    // llama-server answers /health with 503 while the model is still loading:
    // wait for it instead of falling back to Ollama (which would try to load a second copy)
    const h = await ping(settings.llamaUrl + '/health', 2500, true);
    if (h?.ok) {
      found = 'llamacpp';
      const r = await ping(settings.llamaUrl + '/v1/models');
      try { label = (await r.json()).data?.[0]?.id || ''; } catch {}
    } else if (h) loading = true;
  }
  if (found === 'llamacpp') detect.sawLlama = true;
  // once this page has used llama-server, a restart of it must not silently switch to Ollama
  if (!found && detect.sawLlama && settings.engine === 'auto') loading = true;
  if (loading) {
    engine = null;
    setStatus('wait', 'النموذج قيد التحميل… (llama-server)');
    clearTimeout(detect.t); detect.t = setTimeout(detect, 2000);
    return;
  }
  if (!found && settings.engine !== 'llamacpp') {
    const r = await ping(settings.ollamaUrl + '/api/tags');
    if (r) {
      found = 'ollama';
      try {
        const models = (await r.json()).models || [];
        fillModels(models.map((m) => m.name));
        if (models.length && !models.some((m) => m.name === settings.model)) settings.model = models[0].name;
      } catch {}
      label = settings.model;
    }
  }
  engine = found;
  $('modelName').textContent = prettyModel(label || settings.model);
  if (found === 'llamacpp') setStatus('ok', 'جاهز · llama-server');
  else if (found === 'ollama') setStatus('ok', 'جاهز · Ollama');
  else if (settings.engine === 'llamacpp') setStatus('wait', 'ينتظر llama-server…');
  else setStatus('off', 'المحرّك غير مشغَّل — شغّل start.bat');
  clearTimeout(detect.t);
  detect.t = setTimeout(detect, found ? 20000 : settings.engine === 'llamacpp' ? 2000 : 4000);
}

function prettyModel(id) {
  if (!id) return '—';
  if (/sha256|[\\/]/.test(id)) return 'Local model';
  const m = id.match(/^qwen([\d.]+):(\d+(?:\.\d+)?b)(?:-(a\d+b))?/i);
  if (m) return `Qwen${m[1]}-${m[2].toUpperCase()}${m[3] ? '-' + m[3].toUpperCase() : ''}`;
  const g = id.match(/^gemma(\d+):(e?\d+b)/i);
  if (g) return `Gemma ${g[1]} ${g[2].toUpperCase()}`;
  const o = id.match(/^gpt-oss:(\d+b)/i);
  if (o) return `gpt-oss-${o[1]}`;
  return id;
}

function fillModels(names) {
  const sel = $('modelSelect');
  sel.innerHTML = names.map((n) => `<option ${n === settings.model ? 'selected' : ''}>${esc(n)}</option>`).join('')
    || '<option disabled>لا توجد نماذج — نزّل نموذجًا بالأمر ollama pull</option>';
}

// ── Chat flow ─────────────────────────────────────────────────────────────────────────
function newChat() {
  if (controller) return;
  const c = current();
  if (c && !c.messages.length) { $('input').focus(); return; }
  const chat = { id: uid(), title: '', messages: [], updated: Date.now() };
  chats.unshift(chat); currentId = chat.id;
  store.set('oq.current', currentId); saveChats();
  renderSidebar(); renderThread(); $('input').focus();
  closeNav();
}

function openChat(id) {
  if (controller) return;
  currentId = id; store.set('oq.current', id);
  renderSidebar(); renderThread(); closeNav();
}

function deleteChat(id) {
  chats = chats.filter((c) => c.id !== id);
  if (currentId === id) currentId = chats[0]?.id || null;
  store.set('oq.current', currentId); saveChats();
  if (!currentId) newChat(); else { renderSidebar(); renderThread(); }
}

async function send() {
  if (controller) { controller.abort(); return; }
  const text = $('input').value.trim();
  if (!text && !pending.length) return;
  await detect();             // engines can restart between messages: always re-check before sending
  if (!engine) {
    toast($('status').classList.contains('wait') ? 'النموذج قيد التحميل — انتظر بضع ثوانٍ ثم أرسل' : 'المحرّك غير مشغَّل — شغّل start.bat أولًا');
    return;
  }

  let c = current();
  if (!c) { newChat(); c = current(); }
  if (pending.length) {
    const caps = await modelCaps();
    if (caps && !caps.includes('vision')) {
      toast('هذا النموذج لا يفهم الصور — اختر نموذجًا يدعم الصور من «الإعدادات»');
      return;
    }
  }
  c.messages.push({ role: 'user', content: text, images: pending });
  if (!c.title) c.title = (text || 'صورة').slice(0, 48);
  $('input').value = ''; autosize(); pending = []; renderAttachments();
  await generate(c);
}

async function generate(c) {
  const reply = { role: 'assistant', content: '', thinking: '', streaming: true };
  c.messages.push(reply);
  c.updated = Date.now();
  chats = [c, ...chats.filter((x) => x !== c)];
  renderSidebar(); renderThread(true, c.messages.length - 2);

  controller = new AbortController(); updateSend();
  const t0 = performance.now();
  let lastPaint = 0;
  const paint = (force) => {
    const now = performance.now();
    if (!force && now - lastPaint < 60) return;
    lastPaint = now;
    const nodes = $('thread').querySelectorAll('.msg');
    const node = nodes[nodes.length - 1];
    const s = $('scroll');
    const atBottom = s.scrollHeight - s.scrollTop - s.clientHeight < 80;
    if (node) node.outerHTML = messageHTML(reply, c.messages.length - 1, true);
    if (atBottom) s.scrollTop = s.scrollHeight;
  };

  try {
    const history = c.messages.slice(0, -1).filter((m) => !m.error);
    const stats = engine === 'ollama'
      ? await streamOllama(history, reply, paint, controller.signal)
      : await streamLlama(history, reply, paint, controller.signal);
    reply.stats = stats || { tokens: 0, tps: 0 };
    if (!reply.stats.tps) {
      const secs = (performance.now() - t0) / 1000;
      reply.stats.tps = reply.stats.tokens / Math.max(secs, 0.001);
    }
  } catch (e) {
    if (e.name === 'AbortError') { if (!reply.content) reply.content = '_(أُوقف)_'; }
    else reply.error = friendlyError(String(e.message || e));
  } finally {
    delete reply.streaming;
    controller = null; updateSend();
    saveChats(); renderThread(false);
  }
}

function friendlyError(msg) {
  if (/out.of.memory|unable to allocate|CUDA_Host|cudaMalloc/i.test(msg)) {
    return engine === 'ollama'
      ? 'لم تكفِ الذاكرة لتحميل النموذج عبر Ollama.\nالحل: اختر نموذجًا أصغر من «الإعدادات»، أو أغلق هذه الصفحة وشغّل start-lowmem.bat بدلًا من start.bat.'
      : 'لم تكفِ ذاكرة بطاقة الرسوميات للنموذج.\nالحل: شغّل النموذج بعدد طبقات أقل، مثلًا:  start-lowmem.bat -GpuLayers 10';
  }
  if (/Failed to fetch|NetworkError|ECONNREFUSED/i.test(msg)) return 'انقطع الاتصال بالنموذج — تأكد من أن نافذة التشغيل (start.bat أو start-lowmem.bat) ما زالت مفتوحة.';
  return 'حدث خطأ: ' + msg.slice(0, 300);
}

function toOpenAI(history) {
  const msgs = [];
  if (settings.system.trim()) msgs.push({ role: 'system', content: settings.system.trim() });
  for (const m of history) {
    if (m.role === 'user' && m.images?.length) {
      msgs.push({ role: 'user', content: [
        ...m.images.map((url) => ({ type: 'image_url', image_url: { url } })),
        { type: 'text', text: m.content || 'صف هذه الصورة.' },
      ] });
    } else msgs.push({ role: m.role, content: m.role === 'assistant' ? splitThink(m.content).answer : m.content });
  }
  return msgs;
}

async function streamLlama(history, reply, paint, signal) {
  const r = await fetch(settings.llamaUrl + '/v1/chat/completions', {
    method: 'POST', signal, headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages: toOpenAI(history), stream: true, temperature: Number(settings.temperature),
      chat_template_kwargs: { enable_thinking: thinking }, timings_per_token: false,
    }),
  });
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
  let stats = null;
  await readLines(r, (line) => {
    if (!line.startsWith('data: ')) return;
    const data = line.slice(6).trim();
    if (data === '[DONE]') return;
    const j = JSON.parse(data);
    const d = j.choices?.[0]?.delta || {};
    if (d.reasoning_content) reply.thinking += d.reasoning_content;
    if (d.content) reply.content += d.content;
    if (j.timings) stats = { tokens: j.timings.predicted_n, tps: j.timings.predicted_per_second };
    paint();
  });
  paint(true);
  return stats;
}

// What the selected Ollama model supports ("vision", "thinking", …), so models from any
// company work without errors. null = unknown (older Ollama): assume everything.
const capsCache = {};
async function modelCaps() {
  if (engine !== 'ollama') return null;
  if (settings.model in capsCache) return capsCache[settings.model];
  try {
    const r = await fetch(settings.ollamaUrl + '/api/show', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model: settings.model }),
    });
    capsCache[settings.model] = r.ok ? (await r.json()).capabilities || null : null;
  } catch { capsCache[settings.model] = null; }
  return capsCache[settings.model];
}

async function streamOllama(history, reply, paint, signal) {
  const caps = await modelCaps();
  const vision = !caps || caps.includes('vision');
  const msgs = [];
  if (settings.system.trim()) msgs.push({ role: 'system', content: settings.system.trim() });
  for (const m of history) {
    const out = { role: m.role, content: m.role === 'assistant' ? splitThink(m.content).answer : (m.content || 'صف هذه الصورة.') };
    if (vision && m.images?.length) out.images = m.images.map((s) => s.split(',')[1]);
    msgs.push(out);
  }
  const body = {
    model: settings.model, messages: msgs, stream: true,
    options: { temperature: Number(settings.temperature), num_ctx: settings.numCtx },
  };
  if (!caps || caps.includes('thinking')) body.think = thinking;   // models without thinking reject the flag
  const r = await fetch(settings.ollamaUrl + '/api/chat', {
    method: 'POST', signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
  let stats = null;
  await readLines(r, (line) => {
    if (!line.trim()) return;
    const j = JSON.parse(line);
    if (j.error) throw new Error(j.error);
    if (j.message?.thinking) reply.thinking += j.message.thinking;
    if (j.message?.content) reply.content += j.message.content;
    if (j.done && j.eval_count) stats = { tokens: j.eval_count, tps: j.eval_count / (j.eval_duration / 1e9) };
    paint();
  });
  paint(true);
  return stats;
}

async function readLines(res, onLine) {
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split('\n'); buf = lines.pop();
    lines.forEach(onLine);
  }
  if (buf) onLine(buf);
}

function regenerate() {
  const c = current();
  if (!c || controller) return;
  if (c.messages.at(-1)?.role === 'assistant') c.messages.pop();
  generate(c);
}

// ── Images ────────────────────────────────────────────────────────────────────────────
async function addImages(files) {
  for (const f of files) {
    if (!f.type.startsWith('image/')) continue;
    try { pending.push(await shrink(f)); } catch { toast('تعذّرت قراءة الصورة'); }
  }
  renderAttachments();
  $('input').focus();
}

async function shrink(file) {
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, MAX_IMAGE_SIDE / Math.max(bmp.width, bmp.height));
  const cv = document.createElement('canvas');
  cv.width = Math.round(bmp.width * k); cv.height = Math.round(bmp.height * k);
  const g = cv.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, cv.width, cv.height);   // flatten transparency
  g.drawImage(bmp, 0, 0, cv.width, cv.height);
  return cv.toDataURL('image/jpeg', 0.9);
}

// ── Settings modal ────────────────────────────────────────────────────────────────────
function openSettings() {
  $('ollamaUrl').value = settings.ollamaUrl;
  $('llamaUrl').value = settings.llamaUrl;
  $('temp').value = settings.temperature; $('tempVal').textContent = settings.temperature;
  $('system').value = settings.system;
  setSeg(settings.engine);
  $('settingsModal').classList.add('show');
  closeNav();
  ping(settings.ollamaUrl + '/api/tags').then(async (r) => {
    if (r) try { fillModels(((await r.json()).models || []).map((m) => m.name)); } catch {}
  });
}
function setSeg(v) {
  $('engineSeg').querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.v === v));
  $('engineSeg').dataset.v = v;
  $('modelField').style.display = v === 'llamacpp' ? 'none' : '';   // llama-server runs one fixed model
}
function saveSettingsForm() {
  settings.engine = $('engineSeg').dataset.v;
  settings.ollamaUrl = $('ollamaUrl').value.trim().replace(/\/$/, '') || DEFAULTS.ollamaUrl;
  settings.llamaUrl = $('llamaUrl').value.trim().replace(/\/$/, '') || DEFAULTS.llamaUrl;
  settings.temperature = Number($('temp').value);
  settings.system = $('system').value;
  if ($('modelSelect').value) settings.model = $('modelSelect').value;
  store.set('oq.settings', settings);
  if (forcedEngine) history.replaceState(null, '', location.pathname);   // the user's choice wins from now on
  $('settingsModal').classList.remove('show');
  toast('حُفظت الإعدادات'); detect();
}

// ── Misc UI ───────────────────────────────────────────────────────────────────────────
function autosize() { const t = $('input'); t.style.height = 'auto'; t.style.height = Math.min(t.scrollHeight, 220) + 'px'; updateSend(); }
function closeNav() { $('app').classList.remove('nav-open'); }

function bind() {
  $('composer').addEventListener('submit', (e) => { e.preventDefault(); send(); });
  $('input').addEventListener('input', autosize);
  $('input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); if (!controller) send(); }
  });
  $('input').addEventListener('paste', (e) => {
    const files = [...(e.clipboardData?.files || [])].filter((f) => f.type.startsWith('image/'));
    if (files.length) { e.preventDefault(); addImages(files); }
  });
  $('attachBtn').onclick = () => $('fileInput').click();
  $('fileInput').onchange = (e) => { addImages([...e.target.files]); e.target.value = ''; };
  $('attachments').onclick = (e) => { const b = e.target.closest('[data-rm]'); if (b) { pending.splice(+b.dataset.rm, 1); renderAttachments(); } };

  $('thinkBtn').setAttribute('aria-pressed', thinking);
  $('thinkBtn').onclick = () => { thinking = !thinking; store.set('oq.think', thinking); $('thinkBtn').setAttribute('aria-pressed', thinking); toast(thinking ? 'التفكير العميق: مفعَّل (أبطأ وأدق)' : 'التفكير العميق: متوقف (أسرع)'); };

  $('newChat').onclick = newChat;
  $('chatList').onclick = (e) => {
    const del = e.target.closest('[data-del]');
    if (del) { e.stopPropagation(); deleteChat(del.dataset.del); return; }
    const item = e.target.closest('[data-id]'); if (item) openChat(item.dataset.id);
  };
  $('chatList').onkeydown = (e) => { const item = e.target.closest('[data-id]'); if (item && e.key === 'Enter') openChat(item.dataset.id); };

  $('thread').onclick = async (e) => {
    const cp = e.target.closest('[data-copy]');
    if (cp) {
      const m = current().messages[+cp.dataset.copy];
      try { await navigator.clipboard.writeText(splitThink(m.content).answer); cp.innerHTML = icon('i-check') + 'تم النسخ'; } catch { toast('تعذّر النسخ'); }
      setTimeout(() => { cp.innerHTML = icon('i-copy') + 'نسخ'; }, 1500);
    }
    if (e.target.closest('[data-regen]')) regenerate();
  };
  $('suggestions').onclick = (e) => {
    const b = e.target.closest('[data-sugg]'); if (!b) return;
    const s = SUGGESTIONS[+b.dataset.sugg];
    if (s.attach) { $('fileInput').click(); return; }
    $('input').value = s.text; autosize(); send();
  };

  $('themeBtn').onclick = () => {
    const next = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem('oq.theme', next); } catch {}
    renderTheme();
  };
  $('settingsBtn').onclick = openSettings;
  $('saveSettings').onclick = saveSettingsForm;
  $('engineSeg').onclick = (e) => { const b = e.target.closest('button'); if (b) setSeg(b.dataset.v); };
  $('temp').oninput = (e) => { $('tempVal').textContent = e.target.value; };
  $('clearAll').onclick = () => {
    if (!confirm('هل تريد حذف جميع المحادثات؟')) return;
    chats = []; currentId = null; saveChats(); $('settingsModal').classList.remove('show'); newChat();
  };
  $('settingsModal').onclick = (e) => { if (e.target.id === 'settingsModal') e.target.classList.remove('show'); };

  $('menuBtn').onclick = () => $('app').classList.add('nav-open');
  $('scrim').onclick = closeNav;

  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); newChat(); }
    if (e.key === 'Escape') {
      if ($('settingsModal').classList.contains('show')) $('settingsModal').classList.remove('show');
      else if (controller) controller.abort();
    }
  });

  // drag & drop images anywhere on the chat
  let depth = 0;
  const main = $('main');
  main.addEventListener('dragenter', (e) => { if ([...e.dataTransfer.types].includes('Files')) { depth++; $('dropzone').classList.add('show'); } });
  main.addEventListener('dragleave', () => { if (--depth <= 0) { depth = 0; $('dropzone').classList.remove('show'); } });
  main.addEventListener('dragover', (e) => e.preventDefault());
  main.addEventListener('drop', (e) => { e.preventDefault(); depth = 0; $('dropzone').classList.remove('show'); addImages([...e.dataTransfer.files]); });
}

// ── Boot ──────────────────────────────────────────────────────────────────────────────
renderCreator(); renderSuggestions(); renderTheme(); bind();
if (!current()) { currentId = null; newChat(); } else { renderSidebar(); renderThread(); }
updateSend();
detect();
if (location.hash === '#settings') openSettings();
