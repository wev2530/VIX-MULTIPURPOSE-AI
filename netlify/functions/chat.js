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
 *   HF_SPACE_URL     e.g. https://vg253044-vix-ai.hf.space (the vg253044/Vix_AI Space)
 *   HF_API_NAME      endpoint name from the Space's "Use via API" page. Vix_AI wires its
 *                    chat_fn to two events (a button click and a textbox submit) without an
 *                    explicit api_name, so Gradio auto-names them "chat_fn" and "chat_fn_1" —
 *                    "chat_fn" (the default here) is the first-registered one and should work,
 *                    but confirm on that page if replies fail with a 404/"not found" error.
 *   HF_API_PREFIX    default "/gradio_api" (Gradio 5). Use "" for older Gradio 4 Spaces.
 *   HF_PAYLOAD       "vix" (default, matches vg253044/Vix_AI: chat_fn(message, history,
 *                     max_tokens, temperature), reply read from the returned history) |
 *                     "history_maxtokens" (message, history, max_tokens) | "message" | "transcript"
 *   HF_MAX_TOKENS    default 1024 (Vix_AI's slider default)
 *   HF_TEMPERATURE   default 0.3 (Vix_AI's example rows use 0.2–0.3)
 *   HF_TOKEN         only if the Space is private
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

/** An error whose message is safe and useful to show the caller directly (vs. leaking internals). */
function userError(message) {
  return Object.assign(new Error(message), { userFacing: true });
}

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
  if (!base) throw userError("HF_SPACE_URL is not set.");
  const prefix = process.env.HF_API_PREFIX ?? "/gradio_api";
  const api = (process.env.HF_API_NAME || "chat_fn").replace(/^\//, "");
  const url = `${base}${prefix}/call/${api}`;
  const headers = { "Content-Type": "application/json" };
  if (process.env.HF_TOKEN) headers.Authorization = `Bearer ${process.env.HF_TOKEN}`;

  const last = messages[messages.length - 1].content;
  const history = messages.slice(0, -1).map((m) => ({ role: m.role, content: m.content }));
  const maxTokens = Number(process.env.HF_MAX_TOKENS || 1024);
  const temperature = Number(process.env.HF_TEMPERATURE ?? 0.3);

  const mode = process.env.HF_PAYLOAD || "vix";
  let data;
  if (mode === "transcript") {
    data = [messages.map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`).join("\n") + "\nAssistant:"];
  } else if (mode === "history_maxtokens") {
    data = [last, history, maxTokens];
  } else if (mode === "message") {
    data = [last];
  } else {
    // "vix" (default): vg253044/Vix_AI's chat_fn(message, history, max_tokens, temperature)
    data = [last, history, maxTokens, temperature];
  }

  const start = await fetch(url, { method: "POST", headers, body: JSON.stringify({ data }), signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!start.ok) throw quotaAwareError(start.status, await start.text().catch(() => ""), "starting the request");
  const { event_id } = await start.json();

  const stream = await fetch(`${url}/${event_id}`, { headers, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!stream.ok) throw quotaAwareError(stream.status, await stream.text().catch(() => ""), "reading the reply");
  const raw = await stream.text();

  // Server-sent events: "event: complete" followed by "data: [...]"
  let event = "";
  for (const line of raw.split("\n")) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:") && event === "complete") {
      const text = extractText(JSON.parse(line.slice(5)));
      if (text) return text;
    } else if (line.startsWith("data:") && event === "error") {
      const detail = line.slice(5);
      throw quotaAwareError(429, detail, "generating a reply");
    }
  }
  throw userError("The model returned an empty reply. Try rephrasing, or try again in a moment.");
}

/** Turns a Hugging Face ZeroGPU quota/rate-limit failure into a message that says so, instead of a bare status code. */
function quotaAwareError(status, detail, when) {
  const hitQuota = status === 429 || /quota|gpu.*(quota|limit)|rate.?limit|exceeded/i.test(detail || "");
  if (hitQuota) {
    return userError(
      "The AI model has used up its free Hugging Face usage quota for now. " +
      "This Space runs on free ZeroGPU hardware — anonymous requests share a very small daily quota. " +
      "Set HF_TOKEN (a personal Hugging Face access token) in Netlify's environment variables to get a much larger " +
      "per-account quota, or wait for the quota to reset and try again."
    );
  }
  return userError(`Model Space returned ${status} when ${when}.`);
}

async function callOpenAI(messages) {
  const { MODEL_BASE_URL, MODEL_NAME, MODEL_API_KEY } = process.env;
  if (!MODEL_BASE_URL) throw userError("MODEL_BASE_URL is not set.");
  const res = await fetch(`${MODEL_BASE_URL.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(MODEL_API_KEY ? { Authorization: `Bearer ${MODEL_API_KEY}` } : {}) },
    body: JSON.stringify({ model: MODEL_NAME, messages: [{ role: "system", content: SYSTEM_PROMPT }, ...messages] }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw quotaAwareError(res.status, await res.text().catch(() => ""), "answering");
  const out = await res.json();
  const text = out?.choices?.[0]?.message?.content;
  if (!text) throw userError("The model returned an empty reply. Try rephrasing, or try again in a moment.");
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
    if (timedOut) {
      return json(504, { error: "The model took too long to respond. It may be starting up; try again in a moment." });
    }
    return json(502, { error: err?.userFacing ? err.message : "The AI backend could not answer right now." });
  }
};
