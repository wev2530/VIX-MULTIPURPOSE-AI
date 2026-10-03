// Talks to VIX AI's Supabase Edge Function directly (see supabase/functions/chat/index.ts).
// No model credentials live in the browser — supabase.functions.invoke() sends the current
// user's session token automatically, and the Edge Function itself never returns it.
import { supabase } from "./supabase.js";

export async function sendChat(messages) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error("Your session expired. Please log in again.");

  const { data, error } = await supabase.functions.invoke("chat", { body: { messages } });

  if (error) {
    // supabase-js gives a generic error for non-2xx responses; pull our own message out of the
    // response body when we can, so the person sees why it actually failed.
    let detail = "";
    try { detail = (await error.context?.json())?.error; } catch { /* body already consumed or not JSON */ }
    throw new Error(detail || error.message || "The AI backend could not answer right now.");
  }
  if (!data?.reply) throw new Error("The AI backend could not answer right now.");
  return data.reply;
}
