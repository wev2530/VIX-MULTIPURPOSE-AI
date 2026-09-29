// Talks to our own backend endpoint (see js/config.js -> CHAT_ENDPOINT). No model credentials live in the browser.
import { supabase } from "./supabase.js";
import { CHAT_ENDPOINT } from "./config.js";

export async function sendChat(messages) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error("Your session expired. Please log in again.");

  const res = await fetch(CHAT_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
    body: JSON.stringify({ messages }),
  });

  let body = {};
  try { body = await res.json(); } catch { /* non-JSON error page */ }
  if (!res.ok) throw new Error(body.error || "The AI backend could not answer right now.");
  return body.reply;
}
