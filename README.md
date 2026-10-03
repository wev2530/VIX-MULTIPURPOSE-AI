# VIX AI

A professional multipurpose AI assistant — general reasoning, math, science, engineering,
mechatronics, programming and general knowledge today, with speech, image and video on the roadmap.

Dark, mobile-first, installable PWA. Auth and data run on Supabase; the AI backend is a Supabase
Edge Function, so no model or database secret ever reaches the browser.

**Why Supabase and not a Netlify Function for the AI call:** the model behind this app
(`vg253044/Vix_AI`, a real 7B model on free Hugging Face ZeroGPU hardware) can legitimately take
up to ~2 minutes to reply. Netlify's free-tier functions are capped at a hard 10-second timeout —
there's no way around that short of upgrading to a paid Netlify plan. Supabase's Edge Functions
allow much longer execution, so the AI call lives there instead. Netlify still serves the entire
site (every HTML/CSS/JS file) and is still fully "GitHub → Netlify" deployable — only this one
call goes straight from the browser to Supabase instead of through Netlify.

## Stack

- **Frontend** — plain HTML/CSS/JS (ES modules), no build step. `css/`, `js/`, `pages/`.
- **Auth + database** — Supabase (Auth, Postgres, Row Level Security).
- **AI backend** — a Supabase Edge Function (`supabase/functions/chat/index.ts`) that Supabase
  only invokes for a signed-in user (`verify_jwt`), then calls your Hugging Face Space. The
  frontend calls it through `supabase.functions.invoke("chat", ...)` in `js/api.js` — that's the
  one place to edit if the backend changes later; nothing else in the UI has to change.
- **PWA** — `manifest.webmanifest` + `sw.js` (offline app shell).

## Project structure

```
VIX-MULTIPURPOSE-AI/
├── index.html              Main app shell (chat, history, capabilities, settings)
├── manifest.webmanifest    PWA manifest
├── sw.js                   Service worker (offline app shell)
├── netlify.toml             Netlify build config (static site — no Netlify Functions)
├── .gitignore
├── .env.example             Documents the Supabase URL/key used by the frontend
├── css/
│   ├── styles.css          App shell styles
│   └── auth.css            Login / signup / forgot / reset styles
├── js/
│   ├── config.js           Public Supabase URL + publishable key
│   ├── supabase.js         Supabase client
│   ├── auth.js             Login/signup/forgot/reset page logic
│   ├── app.js               Main app controller (chat, sidebar, settings, history)
│   ├── store.js             Supabase reads/writes + local cache fallback
│   └── api.js                Calls the "chat" Supabase Edge Function
├── pages/
│   ├── login.html, signup.html, forgot.html, reset.html
├── assets/
│   ├── vix-logo.png                    App logo (used across the UI, favicon, PWA icon source)
│   ├── icons/                           Generated PWA icons (192, 512, maskable, apple-touch)
│   └── brand/                            Original logo files you supplied, for reference:
│       ├── vix-logo-lockup-dark.png / vix-logo-lockup-light.png   full logo + wordmark
│       └── mark-transparent-dark.png / mark-transparent-light.png  mark only, transparent background
└── supabase/functions/chat/index.ts   Secure server-side call to the AI backend
```

## Replacing the logo later

Everywhere in the UI references **`/assets/vix-logo.png`** (a square mark on the dark brand
background) and the PWA icons in `/assets/icons/`. To swap the logo:

1. Drop your new square mark into `assets/vix-logo.png` (keep the same filename and roughly the
   same aspect ratio/padding).
2. Regenerate the PWA icon set from it (192, 512, maskable-512, apple-touch — same filenames in
   `assets/icons/`).

No HTML/CSS changes needed — nothing else about the UI has to change.

## Database (already set up)

A Supabase project **`vix-ai`** (region `eu-west-2`) has been created and migrated with:

- `profiles` — one row per user (display name, avatar), auto-created on signup.
- `user_settings` — theme, "send with Enter", "show timestamps", auto-created on signup.
- `conversations` — one row per chat, owned by `user_id`.
- `messages` — one row per message, linked to a conversation.

Row Level Security is enabled on every table: every policy restricts rows to
`user_id = auth.uid()`, so a user can only ever see or change their own data. This was verified
with Supabase's security advisor (no warnings) after migrating.

The frontend uses the **publishable** key only (`js/config.js`) — this key is designed to be public;
RLS is what actually protects the data. The **service-role key is never used or stored anywhere in
this project.**

## AI backend

`supabase/functions/chat/index.ts` is the only thing that talks to the model. It's deployed and
**active** on your Supabase project (`vix-ai`, id `yywrtzwfrlpasjqxatpw`) with `verify_jwt: true`,
so Supabase itself rejects any request that isn't from a signed-in user before the function code
even runs. It's configured for **`vg253044/Vix_AI`** — I pulled its actual `app.py` from the Hub,
so this isn't guesswork:

```python
def chat_fn(message, history, max_tokens, temperature):
    ...
    return updated_history, ""   # updated_history is a list of {"role", "content"} dicts
```

The function sends `[message, history, max_tokens, temperature]` and reads the reply back out of
the returned history's last entry. The Space URL, endpoint name, max tokens and temperature are
hardcoded as constants at the top of `index.ts` (edit and redeploy — see below — if any of these
need to change).

**Set `HF_TOKEN` yourself** (never paste it to Claude) so you get a real per-account ZeroGPU quota
instead of the tiny shared anonymous one:
```bash
supabase secrets set HF_TOKEN=hf_xxxxxxxx --project-ref yywrtzwfrlpasjqxatpw
```
or via the dashboard: **Supabase → your project → Project Settings → Edge Functions → Secrets.**
Without this, you'll hit Hugging Face's anonymous quota quickly, and the app will tell you so
directly in the chat (that's a deliberate, specific error message, not a bug).

**To redeploy this function after editing it** (e.g. if you change the endpoint name or Space
URL), use the Supabase CLI: `supabase functions deploy chat --project-ref yywrtzwfrlpasjqxatpw`
from the project root (with `supabase/functions/chat/index.ts` in place) — or ask Claude to
redeploy it again via the Supabase connector.

**One thing I could not verify from here:** Vix_AI wires `chat_fn` to *two* Gradio events (a
button click and a textbox submit) without an explicit `api_name`, so Gradio auto-names them
`chat_fn` and `chat_fn_1`. `chat_fn` (the first-registered one) is what's deployed and should be
correct, but I had no way to hit the Space's live `/gradio_api/info` introspection endpoint from
this environment to confirm it. If a message ever fails with a 404/"not found"-style error, open
the Space, scroll to the bottom, click **"Use via API"**, check the endpoint name shown there, and
update `HF_API_NAME` in `index.ts` if it's actually `chat_fn_1`.

Also note this Space runs on Hugging Face's free **ZeroGPU** (`@spaces.GPU(duration=120)`) — a
reply can legitimately take up to two minutes, and the first request after inactivity can be
slower still while the GPU cold-starts. The app's "thinking" indicator shows a reassurance note
after ~12 seconds so this doesn't look broken — it's working, just waiting on a free, shared GPU.

Swapping to a different AI backend entirely later only means editing the `callGradio()`-equivalent
logic inside `supabase/functions/chat/index.ts` and redeploying.

## Setup after downloading

1. **Push to GitHub**
   ```bash
   cd VIX-MULTIPURPOSE-AI
   git init
   git add .
   git commit -m "Initial commit: VIX AI"
   git branch -M main
   git remote add origin https://github.com/wev2530/VIX-MULTIPURPOSE-AI.git
   git push -u origin main
   ```

2. **Deploy to Netlify** — "Import from Git", pick the repo (`netlify.toml` configures the build
   automatically; there's no build step and no Netlify Functions — just static files). This is
   already live at `vix-ai.netlify.app`.

3. **Set `HF_TOKEN` in Supabase** (the one secret this project needs — see "AI backend" above).
   Nothing else to configure: the Supabase project, database, and the `chat` Edge Function are
   already created and deployed; `SUPABASE_URL` / `SUPABASE_PUBLISHABLE_KEY` are public by design
   and already baked into `js/config.js`.
   > Note: earlier in this project's setup, several `HF_*` / `SUPABASE_*` variables were also set
   > directly on the Netlify site's environment variables. Those are now unused leftovers from a
   > Netlify-Functions-based approach this project no longer uses — harmless to leave, or you can
   > delete them from Netlify's Environment variables page for tidiness.

4. **(Optional) Enable Google sign-in** — Supabase dashboard → Authentication → Providers →
   Google, add your OAuth client ID/secret there, and add your Netlify URL to the provider's
   authorized redirect URIs. The UI's "Continue with Google" button will start working with no
   code changes; until then it shows a clear message instead of failing silently.

5. **Confirm email templates redirect correctly** — Supabase dashboard → Authentication → URL
   Configuration → set Site URL to your Netlify URL, so signup-confirmation and password-reset
   links land back on your deployed app.

## Verification performed before delivery

- Every file referenced by `index.html`, the auth pages, the manifest and the service worker
  exists at the path referenced (checked programmatically).
- All frontend JavaScript modules pass `node --check` with no syntax errors.
- The `chat` Edge Function is deployed and shows status `ACTIVE` on the `vix-ai` Supabase project
  (confirmed via the Supabase connector after deploying).
- Supabase security advisor reports no RLS/security warnings on the schema.
- `.gitignore` excludes `.env` and other local/secret files; no service-role key or Hugging Face
  token appears anywhere in the project — only the public Supabase URL and publishable key, which
  are meant to ship in the browser, and `HF_TOKEN` is a Supabase secret, never a file.
- **Not verified from here, because this environment has no network access to test it live:** an
  actual end-to-end signup → chat → reply round trip. The Edge Function's TypeScript was written
  carefully against Vix_AI's real `app.py` and deployed successfully, but I could not send it a
  real request and confirm the reply comes back correctly. Please test one real message after
  setting `HF_TOKEN` — if the endpoint name turns out to be `chat_fn_1` instead of `chat_fn` (see
  "AI backend" above), that's the one thing to fix and redeploy for.
