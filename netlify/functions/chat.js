/**
 * VIX AI chat endpoint  (public URL: POST /api/chat, see netlify.toml)
 *
 * The browser never sees model credentials. This function:
 *   1. checks the caller is a signed-in Supabase user (no anonymous access to the model),
 *   2. forwards the conversation to the configured AI backend,
 *   3. returns { reply } as JSON.
 *
 * TO CHANGE THE AI BACKEND LATER: only edit callModel() below (or set MODEL_BACKEND).
 * The frontend keeps talking to /api/chat and never changes.
 *
 * Environment variables (Netlify > Site configuration > Environment variables):
 *   SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY   – to verify the user's session
 *   MODEL_BACKEND   "gradio" (default) | "openai"
 *   -- gradio (Hugging Face Space) --
 *   HF_SPACE_URL    e.g. https://vg253044-vix-ai.hf.space
 *   HF_API_NAME     endpoint name shown on the Space's "Use via API" page (default "chat")
 *   HF_API_PREFIX   default "/gradio_api" (Gradio 5). Use "" for older Gradio 4 Spaces.
 *   HF_PAYLOAD      "message" (default) | "transcript" | "message_history"
 *   HF_TOKEN        only if the Space is private
 *   -- openai (any OpenAI-compatible endpoint, e.g. HF Inference Endpoints) --
 *   MODEL_BASE_URL, MODEL_NAME, MODEL_API_KEY
 */

const SYSTEM_PROMPT =
  "You are VIX AI, a professional multipurpose assistant. You reason carefully and help with " +
  "mathematics, science, engineering, mechatronics, programming, technology, education and general knowledge. " +
  "Be clear, accurate and concise, and say so when you are unsure.";

const MAX_MESSAGES = 30;
const MAX_CHARS = 8000;
const TIMEOUT_MS = 25000; // Netlify functions have a short default timeout; keep replies within it.

const json = (statusCode, body) => ({
  statusCode,
  headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  body: JSON.stringify(body),
});

async function verifyUser(authHeader) {
  const token = (authHeader || "").replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) throw new Error("Server auth is not configured.");
  const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { Authorization: `Bearer ${token}`, apikey: SUPABASE_PUBLISHABLE_KEY },
    signal: AbortSignal.timeout(8000),
  });
  return res.ok ? res.json() : null;
}

/** Pull the assistant text out of whatever shape a Gradio Space returns. */
function extractText(value) {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    for (let i = value.length - 1; i >= 0; i--) {
      const t = extractText(value[i]);
      if (t) return t;
    }
    return "";
  }
  if (value && typeof value === "object") return extractText(value.text ?? value.content ?? value.value ?? "");
  return "";
}

async function callGradio(messages) {
  const base = (process.env.HF_SPACE_URL || "").replace(/\/$/, "");
  if (!base) throw new Error("HF_SPACE_URL is not set.");
  const prefix = process.env.HF_API_PREFIX ?? "/gradio_api";
  const api = (process.env.HF_API_NAME || "chat").replace(/^\//, "");
  const url = `${base}${prefix}/call/${api}`;
  const headers = { "Content-Type": "application/json" };
  if (process.env.HF_TOKEN) headers.Authorization = `Bearer ${process.env.HF_TOKEN}`;

  const last = messages[messages.length - 1].content;
  const mode = process.env.HF_PAYLOAD || "message";
  let data;
  if (mode === "transcript") {
    data = [messages.map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`).join("\n") + "\nAssistant:"];
  } else if (mode === "message_history") {
    const pairs = [];
    for (let i = 0; i < messages.length - 1; i++) {
      if (messages[i].role === "user" && messages[i + 1]?.role === "assistant") pairs.push([messages[i].content, messages[i + 1].content]);
    }
    data = [last, pairs];
  } else {
    data = [last];
  }

  const start = await fetch(url, { method: "POST", headers, body: JSON.stringify({ data }), signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!start.ok) throw new Error(`Model Space returned ${start.status} when starting the request.`);
  const { event_id } = await start.json();

  const stream = await fetch(`${url}/${event_id}`, { headers, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!stream.ok) throw new Error(`Model Space returned ${stream.status} while reading the reply.`);
  const raw = await stream.text();

  // Server-sent events: "event: complete" followed by "data: [...]"
  let event = "";
  for (const line of raw.split("\n")) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:") && event === "complete") {
      const text = extractText(JSON.parse(line.slice(5)));
      if (text) return text;
    } else if (line.startsWith("data:") && event === "error") {
      throw new Error("The model reported an error.");
    }
  }
  throw new Error("The model returned an empty reply.");
}

async function callOpenAI(messages) {
  const { MODEL_BASE_URL, MODEL_NAME, MODEL_API_KEY } = process.env;
  if (!MODEL_BASE_URL) throw new Error("MODEL_BASE_URL is not set.");
  const res = await fetch(`${MODEL_BASE_URL.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(MODEL_API_KEY ? { Authorization: `Bearer ${MODEL_API_KEY}` } : {}) },
    body: JSON.stringify({ model: MODEL_NAME, messages: [{ role: "system", content: SYSTEM_PROMPT }, ...messages] }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Model endpoint returned ${res.status}.`);
  const out = await res.json();
  const text = out?.choices?.[0]?.message?.content;
  if (!text) throw new Error("The model returned an empty reply.");
  return text;
}

/** Single switch point for the AI backend. */
function callModel(messages) {
  return (process.env.MODEL_BACKEND || "gradio") === "openai" ? callOpenAI(messages) : callGradio(messages);
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return json(405, { error: "Use POST." });

  try {
    const user = await verifyUser(event.headers.authorization || event.headers.Authorization);
    if (!user) return json(401, { error: "Please sign in again." });

    let body;
    try { body = JSON.parse(event.body || "{}"); } catch { return json(400, { error: "Invalid request." }); }

    const messages = (Array.isArray(body.messages) ? body.messages : [])
      .filter((m) => m && ["user", "assistant"].includes(m.role) && typeof m.content === "string" && m.content.trim())
      .slice(-MAX_MESSAGES)
      .map((m) => ({ role: m.role, content: m.content.slice(0, MAX_CHARS) }));

    if (!messages.length || messages[messages.length - 1].role !== "user") return json(400, { error: "Send a message first." });

    const reply = await callModel(messages);
    return json(200, { reply });
  } catch (err) {
    const timedOut = err?.name === "TimeoutError" || err?.name === "AbortError";
    console.error("chat function error:", err?.message);
    return json(timedOut ? 504 : 502, {
      error: timedOut ? "The model took too long to respond. It may be starting up; try again in a moment." : "The AI backend could not answer right now.",
    });
  }
};
