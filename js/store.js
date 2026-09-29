// Data layer: Supabase is the source of truth; localStorage is a fast local cache/fallback
// (per RLS, every row is already scoped to auth.uid(), so caching it locally is safe for that user).
import { supabase } from "./supabase.js";

const cacheKey = (userId) => `vix.cache.${userId}`;

function loadCache(userId) {
  try { return JSON.parse(localStorage.getItem(cacheKey(userId)) || "{}"); }
  catch { return {}; }
}
function saveCache(userId, data) {
  try { localStorage.setItem(cacheKey(userId), JSON.stringify(data)); } catch { /* storage full/unavailable */ }
}

export function clearLocalCache(userId) {
  try {
    localStorage.removeItem(cacheKey(userId));
    localStorage.removeItem("vix.settings.cache");
  } catch { /* ignore */ }
}

export async function listConversations(userId) {
  const { data, error } = await supabase
    .from("conversations").select("id, title, updated_at").order("updated_at", { ascending: false });
  if (error) {
    const cache = loadCache(userId);
    return cache.conversations || [];
  }
  const cache = loadCache(userId); cache.conversations = data; saveCache(userId, cache);
  return data;
}

export async function createConversation(title = "New chat") {
  const { data: { user } } = await supabase.auth.getUser();
  const { data, error } = await supabase
    .from("conversations").insert({ title, user_id: user.id }).select().single();
  if (error) throw new Error("Could not start a new chat. Check your connection and try again.");
  return data;
}

export async function renameConversation(id, title) {
  await supabase.from("conversations").update({ title }).eq("id", id);
}

export async function deleteConversation(id) {
  const { error } = await supabase.from("conversations").delete().eq("id", id);
  if (error) throw new Error("Could not delete that conversation.");
}

export async function listMessages(userId, conversationId) {
  const { data, error } = await supabase
    .from("messages").select("id, role, content, created_at")
    .eq("conversation_id", conversationId).order("created_at", { ascending: true });
  if (error) {
    const cache = loadCache(userId);
    return (cache.messages && cache.messages[conversationId]) || [];
  }
  const cache = loadCache(userId);
  cache.messages = cache.messages || {};
  cache.messages[conversationId] = data;
  saveCache(userId, cache);
  return data;
}

export async function addMessage(userId, conversationId, role, content) {
  const { data: { user } } = await supabase.auth.getUser();
  const { data, error } = await supabase
    .from("messages").insert({ conversation_id: conversationId, user_id: user.id, role, content })
    .select().single();
  if (error) throw new Error("Could not save that message.");
  const cache = loadCache(userId);
  cache.messages = cache.messages || {};
  cache.messages[conversationId] = [...(cache.messages[conversationId] || []), data];
  saveCache(userId, cache);
  return data;
}

export async function getSettings() {
  const { data: { user } } = await supabase.auth.getUser();
  const { data, error } = await supabase.from("user_settings").select("*").eq("user_id", user.id).maybeSingle();
  if (error || !data) return { theme: "dark", send_with_enter: true, show_timestamps: false };
  return data;
}

export async function updateSettings(patch) {
  const { data: { user } } = await supabase.auth.getUser();
  await supabase.from("user_settings").update(patch).eq("user_id", user.id);
}

export async function getProfile() {
  const { data: { user } } = await supabase.auth.getUser();
  const { data } = await supabase.from("profiles").select("*").eq("id", user.id).maybeSingle();
  return { user, profile: data };
}
