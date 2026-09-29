// Auth pages controller (login, signup, forgot, reset). Uses Supabase Auth.
import { supabase } from "./supabase.js";

const page = document.body.dataset.page;
const form = document.getElementById("form");
const notice = document.getElementById("notice");
const submit = document.getElementById("submit");
const $ = (id) => document.getElementById(id);

function show(msg, type = "error") {
  notice.textContent = msg;
  notice.className = `notice ${type}`;
  notice.hidden = false;
}
function busy(on, label) {
  if (!submit) return;
  submit.disabled = on;
  if (label) submit.dataset.label = submit.dataset.label || submit.textContent;
  submit.textContent = on ? label : submit.dataset.label || submit.textContent;
}
function friendly(err) {
  const m = (err?.message || "").toLowerCase();
  if (m.includes("invalid login")) return "Email or password is incorrect.";
  if (m.includes("not confirmed")) return "Confirm your email first. Check your inbox for the link.";
  if (m.includes("already registered")) return "An account with this email already exists. Log in instead.";
  if (m.includes("rate limit") || m.includes("too many")) return "Too many attempts. Wait a minute and try again.";
  if (m.includes("provider is not enabled") || m.includes("unsupported provider")) return "Google sign-in is not set up yet.";
  if (m.includes("fetch") || m.includes("network")) return "Cannot reach the server. Check your connection.";
  return err?.message || "Something went wrong. Try again.";
}

// Show/hide password
document.querySelectorAll("[data-toggle-pw]").forEach((btn) => {
  btn.addEventListener("click", () => {
    const input = $(btn.dataset.togglePw);
    const showing = input.type === "text";
    input.type = showing ? "password" : "text";
    btn.textContent = showing ? "Show" : "Hide";
    btn.setAttribute("aria-label", showing ? "Show password" : "Hide password");
  });
});

// Google (works once the provider is enabled in Supabase; see README)
$("googleBtn")?.addEventListener("click", async () => {
  const { error } = await supabase.auth.signInWithOAuth({ provider: "google", options: { redirectTo: `${location.origin}/` } });
  if (error) show(friendly(error));
});

const valid = (email) => /^\S+@\S+\.\S+$/.test(email);

async function init() {
  const { data: { session } } = await supabase.auth.getSession();
  // Signed-in users skip the auth pages (except reset, which needs the recovery session).
  if (session && page !== "reset") return location.replace("/");

  if (page === "reset") {
    const ready = () => { form.hidden = false; notice.hidden = true; };
    if (session) ready();
    supabase.auth.onAuthStateChange((event) => { if (event === "PASSWORD_RECOVERY") ready(); });
    setTimeout(() => { if (form.hidden) show("This reset link is invalid or has expired. Request a new one."); }, 2500);
  }

  form?.addEventListener("submit", async (e) => {
    e.preventDefault();
    notice.hidden = true;
    const email = $("email")?.value.trim();
    const password = $("password")?.value;

    try {
      if (page === "login") {
        if (!valid(email) || !password) return show("Enter your email and password.");
        busy(true, "Logging in…");
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        location.replace("/");
      } else if (page === "signup") {
        const name = $("name").value.trim();
        if (!name) return show("Enter your name.");
        if (!valid(email)) return show("Enter a valid email address.");
        if (password.length < 8) return show("Use a password with at least 8 characters.");
        if (password !== $("confirm").value) return show("Passwords do not match.");
        busy(true, "Creating account…");
        const { data, error } = await supabase.auth.signUp({ email, password, options: { data: { name }, emailRedirectTo: `${location.origin}/` } });
        if (error) throw error;
        if (data.user && data.user.identities?.length === 0) throw new Error("already registered");
        if (data.session) return location.replace("/");
        form.reset();
        show("Account created. Check your email and confirm your address, then log in.", "ok");
      } else if (page === "forgot") {
        if (!valid(email)) return show("Enter a valid email address.");
        busy(true, "Sending…");
        const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${location.origin}/pages/reset.html` });
        if (error) throw error;
        show("If an account exists for that email, a reset link is on its way.", "ok");
      } else if (page === "reset") {
        if (password.length < 8) return show("Use a password with at least 8 characters.");
        if (password !== $("confirm").value) return show("Passwords do not match.");
        busy(true, "Saving…");
        const { error } = await supabase.auth.updateUser({ password });
        if (error) throw error;
        location.replace("/");
      }
    } catch (err) {
      show(friendly(err));
    } finally {
      busy(false);
    }
  });
}
init();
