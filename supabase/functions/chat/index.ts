// VIX AI — Supabase Edge Function
//
// Calls the Hugging Face Space directly and waits for the full reply. This runs here instead of
// in a Netlify Function because Netlify's free-tier functions have a hard 10-second timeout, and
// vg253044/Vix_AI is a real model with @spaces.GPU(duration=120) — a reply can legitimately take
// up to ~2 minutes. Supabase's Edge Function timeout is far longer, so the browser can just wait
// on one normal request again (see js/api.js) — no background job / polling needed.
//
// `verify_jwt` is enabled when this function is deployed, so Supabase already confirms the
// caller is a signed-in user before this code even runs. No service-role key is used anywhere.
//
// SETUP (do this yourself — never paste the token to Claude):
//   supabase secrets set HF_TOKEN=hf_xxxxxxxx --project-ref yywrtzwfrlpasjqxatpw
//   (or: Supabase dashboard -> Project Settings -> Edge Functions -> Secrets)
// A personal Hugging Face access token gets a much larger ZeroGPU quota than anonymous requests.
//
// TO CHANGE THE AI BACKEND LATER: this file is the one place that calls the model.

const HF_SPACE_URL = "https://vg253044-vix-ai.hf.space"; // vg253044/Vix_AI
const HF_API_NAME = "chat_fn"; // see the Space's "Use via API" page if this Space's endpoint name changes
const HF_API_PREFIX = "/gradio_api";
const HF_MAX_TOKENS = 1024;
const HF_TEMPERATURE = 0.3;
const CALL_TIMEOUT_MS = 140000; // a little under the Space's own 120s GPU budget + overhead
const MAX_MESSAGES = 30;
const MAX_CHARS = 8000;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });
}

/** An error whose message is safe and useful to show the user directly (vs. leaking internals). */
function userError(message: string) {
  return Object.assign(new Error(message), { userFacing: true });
}

/** Pull the assistant text out of whatever shape the Space returns. */
function extractText(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    for (let i = value.length - 1; i >= 0; i--) {
      const t = extractText(value[i]);
      if (t) return t;
    }
    return "";
  }
  if (value && typeof value === "object") {
    const v = value as Record<string, unknown>;
    return extractText(v.text ?? v.content ?? v.value ?? "");
  }
  return "";
}

/** Turns a Hugging Face ZeroGPU quota/rate-limit failure into a message that says so. */
function quotaAwareError(status: number, detail: string, when: string) {
  const hitQuota = status === 429 || /quota|gpu.*(quota|limit)|rate.?limit|exceeded/i.test(detail || "");
  if (hitQuota) {
    return userError(
      "The AI model has used up its free Hugging Face usage quota for now. " +
        "This Space runs on free ZeroGPU hardware — anonymous requests share a very small daily quota. " +
        "Set HF_TOKEN as a Supabase Edge Function secret to get a much larger per-account quota, " +
        "or wait for the quota to reset and try again."
    );
  }
  return userError(`Model Space returned ${status} when ${when}.`);
}

async function callGradio(messages: { role: string; content: string }[]) {
  const url = `${HF_SPACE_URL}${HF_API_PREFIX}/call/${HF_API_NAME}`;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const hfToken = Deno.env.get("HF_TOKEN");
  if (hfToken) headers.Authorization = `Bearer ${hfToken}`;

  const last = messages[messages.length - 1].content;
  const history = messages.slice(0, -1).map((m) => ({ role: m.role, content: m.content }));
  // vg253044/Vix_AI: chat_fn(message, history, max_tokens, temperature)
  const data = [last, history, HF_MAX_TOKENS, HF_TEMPERATURE];

  const start = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({ data }),
    signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
  });
  if (!start.ok) throw quotaAwareError(start.status, await start.text().catch(() => ""), "starting the request");
  const { event_id } = await start.json();

  const stream = await fetch(`${url}/${event_id}`, { headers, signal: AbortSignal.timeout(CALL_TIMEOUT_MS) });
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
      throw quotaAwareError(429, line.slice(5), "generating a reply");
    }
  }
  throw userError("The model returned an empty reply. Try rephrasing, or try again in a moment.");
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "Use POST." });

  try {
    let body: { messages?: unknown };
    try {
      body = await req.json();
    } catch {
      return json(400, { error: "Invalid request." });
    }

    const messages = (Array.isArray(body.messages) ? body.messages : [])
      .filter(
        (m: any) => m && ["user", "assistant"].includes(m.role) && typeof m.content === "string" && m.content.trim()
      )
      .slice(-MAX_MESSAGES)
      .map((m: any) => ({ role: m.role, content: String(m.content).slice(0, MAX_CHARS) }));

    if (!messages.length || messages[messages.length - 1].role !== "user") {
      return json(400, { error: "Send a message first." });
    }

    const reply = await callGradio(messages);
    return json(200, { reply });
  } catch (err) {
    const e = err as { name?: string; message?: string; userFacing?: boolean };
    const timedOut = e?.name === "TimeoutError" || e?.name === "AbortError";
    console.error("chat function error:", e?.message);
    if (timedOut) {
      return json(504, { error: "The model took too long to respond. It may be starting up; try again in a moment." });
    }
    return json(502, { error: e?.userFacing ? e.message! : "The AI backend could not answer right now." });
  }
});
