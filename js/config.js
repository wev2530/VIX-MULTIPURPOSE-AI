// Public configuration. The publishable key is designed to be exposed in the browser;
// Row Level Security in Supabase protects the data. NEVER put a service-role key here.
export const SUPABASE_URL = "https://yywrtzwfrlpasjqxatpw.supabase.co";
export const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_7f8t8QNFhgKM1diXZUKZvA_Bq2mDB8M";
export const CHAT_ENDPOINT = "/api/chat"; // AI backend lives behind this URL (see netlify/functions/chat.js)
