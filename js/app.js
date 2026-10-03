// VIX AI — main application controller (auth guard, sidebar/views, chat, settings, history, capabilities).
import { supabase } from "./supabase.js";
import { sendChat } from "./api.js";
import * as store from "./store.js";

const $ = (id) => document.getElementById(id);
const escapeHtml = (s) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

let currentUser = null;
let currentConversationId = null;
let messages = []; // {role, content}
let sending = false;
let settings = { send_with_enter: true, show_timestamps: false };

// ---------- Boot / auth guard ----------
async function boot() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) { location.replace("/pages/login.html"); return; }
  currentUser = session.user;

  supabase.auth.onAuthStateChange((event) => {
    if (event === "SIGNED_OUT") location.replace("/pages/login.html");
  });

  const { profile } = await store.getProfile();
  const name = profile?.display_name || currentUser.user_metadata?.name || currentUser.email.split("@")[0];
  $("accountName").textContent = name;
  $("avatarInitial").textContent = name.trim()[0]?.toUpperCase() || "V";
  $("settingsName").textContent = name;
  $("settingsEmail").textContent = currentUser.email;

  settings = await store.getSettings();
  syncSwitch($("sendEnterSwitch"), settings.send_with_enter);
  syncSwitch($("timestampsSwitch"), settings.show_timestamps);

  setOnlineStatus(navigator.onLine);
  window.addEventListener("online", () => setOnlineStatus(true));
  window.addEventListener("offline", () => setOnlineStatus(false));

  renderCapabilities();
  renderThread();
  await refreshHistory();

  $("splash").classList.add("done");
  setTimeout(() => $("splash").remove(), 500);
  $("app").hidden = false;

  registerServiceWorker();
}

function setOnlineStatus(online) {
  const pill = $("statusPill");
  pill.classList.toggle("offline", !online);
  pill.lastChild.textContent = online ? "Online" : "Offline";
}

// ---------- Sidebar / navigation ----------
const sidebar = $("sidebar"), scrim = $("scrim"), menuBtn = $("menuBtn");
function openSidebar() { sidebar.classList.add("open"); scrim.hidden = false; menuBtn.setAttribute("aria-expanded", "true"); }
function closeSidebar() { sidebar.classList.remove("open"); scrim.hidden = true; menuBtn.setAttribute("aria-expanded", "false"); }
menuBtn.addEventListener("click", () => (sidebar.classList.contains("open") ? closeSidebar() : openSidebar()));
scrim.addEventListener("click", closeSidebar);

const titles = { chat: "VIX AI", history: "History", capabilities: "Capabilities", settings: "Settings" };
function showView(name) {
  document.querySelectorAll(".view-panel").forEach((el) => (el.hidden = true));
  $(`view-${name}`).hidden = false;
  $("topbarTitle").textContent = titles[name] || "VIX AI";
  document.querySelectorAll(".nav button").forEach((b) => b.toggleAttribute("aria-current", b.dataset.view === name));
  if (name === "history") refreshHistory();
  if (window.matchMedia("(max-width: 899px)").matches) closeSidebar();
}
document.querySelectorAll(".nav button[data-view]").forEach((b) => b.addEventListener("click", () => showView(b.dataset.view)));

// ---------- Toast ----------
let toastTimer;
function toast(msg) {
  const el = $("toast");
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 3200);
}

// ---------- Chat rendering ----------
const thread = $("thread"), emptyState = $("emptyState"), messagesEl = $("messages");

function renderInline(text) {
  let t = escapeHtml(text);
  t = t.replace(/`([^`]+)`/g, "<code>$1</code>");
  t = t.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  return t;
}
function renderMarkdownLite(text) {
  const parts = text.split(/```(\w*)\n?([\s\S]*?)```/g);
  let html = "";
  for (let i = 0; i < parts.length; i += 3) {
    const prose = parts[i];
    if (prose) html += prose.split(/\n{2,}/).map((p) => `<p>${renderInline(p)}</p>`).join("");
    if (parts[i + 2] !== undefined) html += `<pre><code>${escapeHtml(parts[i + 2].replace(/\n$/, ""))}</code></pre>`;
  }
  return html || `<p>${renderInline(text)}</p>`;
}

function messageNode(role, content, opts = {}) {
  const wrap = document.createElement("div");
  wrap.className = `msg ${role}${opts.error ? " error" : ""}`;
  if (role === "user") {
    const bubble = document.createElement("div");
    bubble.className = "bubble";
    bubble.textContent = content;
    wrap.appendChild(bubble);
  } else {
    const mark = document.createElement("img");
    mark.className = "mark"; mark.src = "/assets/vix-logo.png"; mark.alt = "";
    const body = document.createElement("div");
    body.className = "body";
    body.innerHTML = renderMarkdownLite(content);
    if (opts.error) {
      const retry = document.createElement("button");
      retry.type = "button"; retry.textContent = "Retry";
      retry.addEventListener("click", opts.onRetry);
      body.appendChild(retry);
    }
    wrap.append(mark, body);
  }
  return wrap;
}

function scrollToBottom() { messagesEl.scrollTop = messagesEl.scrollHeight; }

// ---------- Rotating starter prompts (empty-state only) ----------
const STARTER_PROMPTS = [
  { label: "Explain how a PID controller works", prompt: "Explain how a PID controller works and where I'd tune it on a small robot." },
  { label: "Solve a system of linear equations", prompt: "Walk me through solving a system of linear equations step by step." },
  { label: "Review a debounce function for bugs", prompt: "Review this idea for bugs and edge cases: a function that debounces API calls." },
  { label: "Build me a 6-week calculus study plan", prompt: "Give me a clear study plan to relearn calculus in 6 weeks." },
  { label: "Explain gear reduction in a drivetrain", prompt: "Explain how gear reduction works in a robotics drivetrain, with a worked torque example." },
  { label: "Debug a Python recursion error", prompt: "Help me debug a Python function that hits RecursionError — what usually causes it and how do I fix it?" },
  { label: "Summarize how neural networks learn", prompt: "Summarize, in plain language, how a neural network actually learns from data." },
  { label: "Compare series vs. parallel circuits", prompt: "Compare series and parallel circuits, with a simple example of when to use each." },
  { label: "Explain Big O notation with examples", prompt: "Explain Big O notation with a few concrete, worked examples." },
  { label: "Outline a mechatronics capstone project", prompt: "Outline a beginner-friendly mechatronics capstone project I could build in a semester." },
  { label: "Derive the quadratic formula", prompt: "Derive the quadratic formula step by step from completing the square." },
  { label: "Explain REST vs. GraphQL APIs", prompt: "Explain the practical differences between REST and GraphQL APIs, and when I'd pick each." },
  { label: "Explain Newton's three laws of motion", prompt: "Explain Newton's three laws of motion with a everyday example for each." },
  { label: "Walk through binary search step by step", prompt: "Walk me through how binary search works on a sorted array, step by step." },
  { label: "Explain the difference between AC and DC", prompt: "Explain the practical difference between AC and DC current, and where each is used." },
  { label: "Help me plan a simple Arduino project", prompt: "Suggest a simple beginner Arduino project that teaches sensors and motors together." },
  { label: "Explain how HTTPS keeps data secure", prompt: "Explain how HTTPS actually keeps data secure, in plain language." },
  { label: "Break down the water cycle", prompt: "Break down the water cycle and explain each stage simply." },
  { label: "Explain torque vs. horsepower", prompt: "Explain the difference between torque and horsepower with a real-world analogy." },
  { label: "Teach me the basics of recursion", prompt: "Teach me the basics of recursion in programming with a simple worked example." },
  { label: "Explain how a car's suspension works", prompt: "Explain how a car's suspension system works and why it matters." },
  { label: "Help me understand Ohm's law", prompt: "Help me understand Ohm's law with a simple circuit example." },
  { label: "Explain the difference between arrays and linked lists", prompt: "Explain the practical differences between arrays and linked lists, with when to use each." },
  { label: "Summarize the scientific method", prompt: "Summarize the scientific method as a clear step-by-step process." },
  { label: "Explain what a microcontroller does", prompt: "Explain what a microcontroller does and how it differs from a regular CPU." },
  { label: "Help me write a study schedule for finals", prompt: "Help me build a realistic one-week study schedule for final exams." },
  { label: "Explain how sorting algorithms compare", prompt: "Compare bubble sort, merge sort and quicksort in terms of speed and use cases." },
  { label: "Explain the basics of thermodynamics", prompt: "Explain the basics of the first and second laws of thermodynamics simply." },
  { label: "Explain how a database index speeds up queries", prompt: "Explain how a database index actually speeds up queries, and its trade-offs." },
  { label: "Explain projectile motion with an example", prompt: "Explain projectile motion and walk through a worked example." },
  { label: "Explain the difference between voltage and current", prompt: "Explain the difference between voltage and current using a water-pipe analogy." },
  { label: "Help me understand Git branching", prompt: "Help me understand Git branching and merging with a simple example workflow." },
  { label: "Explain how a 3D printer works", prompt: "Explain how an FDM 3D printer works, step by step." },
  { label: "Explain entropy in simple terms", prompt: "Explain entropy in simple, intuitive terms with an everyday example." },
  { label: "Help me understand Big-O for recursive functions", prompt: "Help me understand how to calculate Big-O time complexity for a recursive function." },
  { label: "Explain how sensors measure distance", prompt: "Explain how ultrasonic and infrared distance sensors work, and when to use each." },
];
let starterTimer = null, starterQueue = [];

function shuffledPool() {
  const pool = [...STARTER_PROMPTS];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool;
}
function nextStarterBatch() {
  if (starterQueue.length < 4) starterQueue = shuffledPool();
  return starterQueue.splice(0, 4);
}
function paintStarters() {
  const el = $("starters");
  el.innerHTML = nextStarterBatch().map((s) => `<button type="button" data-prompt="${escapeHtml(s.prompt)}">${escapeHtml(s.label)}</button>`).join("");
}
function startStarterRotation() {
  if (starterTimer) return;
  paintStarters();
  starterTimer = setInterval(() => {
    const el = $("starters");
    el.classList.add("swap");
    setTimeout(() => { paintStarters(); el.classList.remove("swap"); }, 300);
  }, 15000);
}
function stopStarterRotation() {
  clearInterval(starterTimer);
  starterTimer = null;
}
$("starters").addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-prompt]");
  if (btn) submitMessage(btn.dataset.prompt);
});

function renderThread() {
  thread.innerHTML = "";
  const hasMessages = messages.length > 0;
  emptyState.hidden = hasMessages;
  thread.hidden = !hasMessages;
  messages.forEach((m) => thread.appendChild(messageNode(m.role, m.content)));
  scrollToBottom();
  if (hasMessages) stopStarterRotation(); else startStarterRotation();
}

function addThinking() {
  const wrap = document.createElement("div");
  wrap.className = "msg assistant"; wrap.id = "thinkingRow";
  wrap.innerHTML = `<img class="mark" src="/assets/vix-logo.png" alt=""><div><div class="thinking"><i></i><i></i><i></i></div><div class="thinking-note" id="thinkingNote" hidden>Still working — longer replies can take up to a couple of minutes.</div></div>`;
  thread.appendChild(wrap); thread.hidden = false; emptyState.hidden = true;
  scrollToBottom();
  thinkingNoteTimer = setTimeout(() => { const n = $("thinkingNote"); if (n) { n.hidden = false; scrollToBottom(); } }, 12000);
}
function removeThinking() {
  clearTimeout(thinkingNoteTimer);
  $("thinkingRow")?.remove();
}
let thinkingNoteTimer = null;

// ---------- Sending ----------
async function ensureConversation() {
  if (currentConversationId) return currentConversationId;
  const conv = await store.createConversation();
  currentConversationId = conv.id;
  await refreshHistory();
  return currentConversationId;
}

async function submitMessage(text) {
  if (sending || !text.trim()) return;
  sending = true;
  updateSendState();

  messages.push({ role: "user", content: text });
  renderThread();

  const input = $("composerInput");
  input.value = ""; autoResize(input); updateSendState();

  try {
    const convId = await ensureConversation();
    await store.addMessage(currentUser.id, convId, "user", text);
    if (messages.filter((m) => m.role === "user").length === 1) {
      const title = text.slice(0, 60);
      store.renameConversation(convId, title);
    }

    addThinking();
    const reply = await sendChat(messages);
    removeThinking();

    messages.push({ role: "assistant", content: reply });
    renderThread();
    await store.addMessage(currentUser.id, convId, "assistant", reply);
    refreshHistory();
  } catch (err) {
    removeThinking();
    const failedText = text;
    thread.appendChild(messageNode("assistant", err.message || "Something went wrong.", {
      error: true,
      onRetry: () => { messages.pop(); submitMessage(failedText); },
    }));
    thread.hidden = false; emptyState.hidden = true;
    scrollToBottom();
  } finally {
    sending = false;
    updateSendState();
  }
}

function updateSendState() {
  $("sendBtn").disabled = sending || !$("composerInput").value.trim();
}
function autoResize(el) { el.style.height = "auto"; el.style.height = Math.min(el.scrollHeight, 180) + "px"; }

const composerForm = $("composerForm"), composerInput = $("composerInput");
composerInput.addEventListener("input", () => { autoResize(composerInput); updateSendState(); });
composerInput.addEventListener("keydown", (e) => {
  if (e.key !== "Enter" || e.shiftKey) return;
  if (!settings.send_with_enter) return;
  e.preventDefault();
  composerForm.requestSubmit();
});
composerForm.addEventListener("submit", (e) => { e.preventDefault(); submitMessage(composerInput.value); });

$("newChatBtn").addEventListener("click", () => {
  currentConversationId = null;
  messages = [];
  renderThread();
  showView("chat");
});

// Not-yet-available capabilities: never pretend these work.
$("micBtn").addEventListener("click", () => toast("Voice features are not available yet. Text-to-text is currently available."));
$("imageBtn").addEventListener("click", () => toast("Image understanding is not available yet. Text-to-text is currently available."));
$("videoBtn").addEventListener("click", () => toast("Video understanding is not available yet. Text-to-text is currently available."));

// ---------- History ----------
async function refreshHistory() {
  const list = await store.listConversations(currentUser.id);
  const recentList = $("recentList"), historyList = $("historyList");
  recentList.innerHTML = ""; historyList.innerHTML = "";

  if (!list.length) {
    historyList.innerHTML = `<p style="color:var(--muted)">No conversations yet. Start a new chat to see it here.</p>`;
  }

  list.slice(0, 8).forEach((c) => {
    const b = document.createElement("button");
    b.type = "button"; b.textContent = c.title || "New chat";
    b.className = c.id === currentConversationId ? "active" : "";
    b.addEventListener("click", () => openConversation(c.id));
    recentList.appendChild(b);
  });

  list.forEach((c) => {
    const row = document.createElement("div");
    row.className = "list-item";
    row.innerHTML = `<button type="button" class="grow" style="text-align:left"><span class="title">${escapeHtml(c.title || "New chat")}</span><small>${new Date(c.updated_at).toLocaleString()}</small></button>`;
    const del = document.createElement("button");
    del.className = "del"; del.type = "button"; del.setAttribute("aria-label", "Delete conversation");
    del.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/></svg>`;
    del.addEventListener("click", async (e) => {
      e.stopPropagation();
      if (!confirm("Delete this conversation? This cannot be undone.")) return;
      await store.deleteConversation(c.id);
      if (currentConversationId === c.id) { currentConversationId = null; messages = []; renderThread(); }
      refreshHistory();
    });
    row.querySelector("button.grow").addEventListener("click", () => openConversation(c.id));
    row.appendChild(del);
    historyList.appendChild(row);
  });
}

async function openConversation(id) {
  currentConversationId = id;
  const rows = await store.listMessages(currentUser.id, id);
  messages = rows.map((r) => ({ role: r.role, content: r.content }));
  renderThread();
  showView("chat");
}

// ---------- Capabilities ----------
function renderCapabilities() {
  const items = [
    ["General AI / Reasoning", true],
    ["Speech-to-Text", false],
    ["Image Understanding", false],
    ["Voice-to-Voice", false],
    ["Image Generation", false],
    ["Video Understanding", false],
    ["Video Generation", false],
  ];
  $("capList").innerHTML = items.map(([label, on]) =>
    `<div class="list-item"><span class="title">${label}</span><span class="badge${on ? " on" : ""}">${on ? "Available" : "Coming soon"}</span></div>`
  ).join("");
}

// ---------- Settings ----------
function syncSwitch(el, on) { el.setAttribute("aria-checked", String(!!on)); }
function wireSwitch(el, key) {
  el.addEventListener("click", async () => {
    const next = el.getAttribute("aria-checked") !== "true";
    syncSwitch(el, next);
    settings[key] = next;
    await store.updateSettings({ [key]: next });
  });
}
wireSwitch($("sendEnterSwitch"), "send_with_enter");
wireSwitch($("timestampsSwitch"), "show_timestamps");

$("clearCacheBtn").addEventListener("click", () => {
  store.clearLocalCache(currentUser.id);
  toast("Local cache cleared.");
});

$("logoutBtn").addEventListener("click", async () => {
  await supabase.auth.signOut();
  location.replace("/pages/login.html");
});

// ---------- PWA ----------
function registerServiceWorker() {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("/sw.js").catch(() => { /* offline shell is best-effort */ });
  }
}

boot();
