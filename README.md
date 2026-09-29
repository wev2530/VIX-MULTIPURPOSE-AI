# VIX AI

A professional multipurpose AI assistant — general reasoning, math, science, engineering,
mechatronics, programming and general knowledge today, with speech, image and video on the roadmap.

Dark, mobile-first, installable PWA. Auth and data run on Supabase; the AI backend runs behind a
Netlify Function so no model or database secret ever reaches the browser.

## Stack

- **Frontend** — plain HTML/CSS/JS (ES modules), no build step. `css/`, `js/`, `pages/`.
- **Auth + database** — Supabase (Auth, Postgres, Row Level Security).
- **AI backend** — a Netlify Function (`netlify/functions/chat.mjs`) that verifies the caller's
  Supabase session, then calls your Hugging Face Space. The frontend only ever talks to `/api/chat`,
  so the backend can be swapped later without touching the UI.
- **PWA** — `manifest.webmanifest` + `sw.js` (offline app shell; API calls are never cached).

## Project structure

```
VIX-MULTIPURPOSE-AI/
├── index.html              Main app shell (chat, history, capabilities, settings)
├── manifest.webmanifest    PWA manifest
├── sw.js                   Service worker (offline app shell)
├── netlify.toml             Netlify build + /api/chat redirect
├── .gitignore
├── .env.example             Documents the environment variables — copy values into Netlify, not into git
├── css/
│   ├── styles.css          App shell styles
│   └── auth.css            Login / signup / forgot / reset styles
├── js/
│   ├── config.js           Public Supabase URL + publishable key, CHAT_ENDPOINT
│   ├── supabase.js         Supabase client
│   ├── auth.js             Login/signup/forgot/reset page logic
│   ├── app.js               Main app controller (chat, sidebar, settings, history)
│   ├── store.js             Supabase reads/writes + local cache fallback
│   └── api.js                Calls /api/chat with the user's Supabase access token
├── pages/
│   ├── login.html, signup.html, forgot.html, reset.html
├── assets/
│   ├── vix-logo.png                    App logo (used across the UI, favicon, PWA icon source)
│   ├── icons/                           Generated PWA icons (192, 512, maskable, apple-touch)
│   └── brand/                            Original logo files you supplied, for reference:
│       ├── vix-logo-lockup-dark.png / vix-logo-lockup-light.png   full logo + wordmark
│       └── mark-transparent-dark.png / mark-transparent-light.png  mark only, transparent background
└── netlify/functions/chat.mjs   Secure server-side call to the AI backend
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

`netlify/functions/chat.mjs` is the only thing that talks to the model. It's configured for
**`vg253044/Vix_AI`** — I pulled its actual `app.py` from the Hub, so this isn't guesswork:

```python
def chat_fn(message, history, max_tokens, temperature):
    ...
    return updated_history, ""   # updated_history is a list of {"role", "content"} dicts
```

The function sends `[message, history, max_tokens, temperature]` and reads the reply back out of
the returned history's last entry. These environment variables are **already set on your live
Netlify site** (I set them directly via the Netlify connector) and are documented in
`.env.example` for reference:

- `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` — so the function can verify who's calling it
- `MODEL_BACKEND=gradio`
- `HF_SPACE_URL=https://vg253044-vix-ai.hf.space`
- `HF_API_NAME=chat_fn`
- `HF_PAYLOAD=vix`
- `HF_MAX_TOKENS=1024`, `HF_TEMPERATURE=0.3`

**One thing I could not verify from here:** Vix_AI wires `chat_fn` to *two* Gradio events (a
button click and a textbox submit) without an explicit `api_name`, so Gradio auto-names them
`chat_fn` and `chat_fn_1`. `chat_fn` (the first-registered one) is the default here and should be
correct, but I had no way to hit the Space's live `/gradio_api/info` introspection endpoint from
this environment to confirm it. **If a chat message comes back with a "model backend could not
answer" error after everything else checks out, open the Space, scroll to the bottom, click "Use
via API", and check the endpoint name shown there against `HF_API_NAME`** — change it to
`chat_fn_1` in Netlify's environment variables if they don't match, and redeploy.

Also note this Space runs on Hugging Face's free **ZeroGPU** (`@spaces.GPU`) — the first request
after a period of inactivity can take a while to cold-start the GPU. If a message times out, try
again after the Space has had a few seconds to spin up (visit the Space's page directly to warm
it, or just retry in the app — the message won't be lost, there's a Retry button).

Swapping to a different backend entirely later only means editing `callModel()` in
`netlify/functions/chat.mjs`.

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
   automatically; there's no build step, just static files + one function).

3. **Environment variables — already set for you.** I configured all 8 on your live Netlify site
   directly (Site configuration → Environment variables) — `SUPABASE_URL`,
   `SUPABASE_PUBLISHABLE_KEY`, `MODEL_BACKEND`, `HF_SPACE_URL`, `HF_API_NAME`, `HF_PAYLOAD`,
   `HF_MAX_TOKENS`, `HF_TEMPERATURE`. Nothing to do here unless you switch Spaces or backends
   later — see `.env.example` for what each one does. If you connect a **new** Netlify site to the
   GitHub repo instead of reusing the existing one, you'll need to set these again there.

4. **(Optional) Enable Google sign-in** — Supabase dashboard → Authentication → Providers →
   Google, add your OAuth client ID/secret there, and add your Netlify URL to the provider's
   authorized redirect URIs. The UI's "Continue with Google" button will start working with no
   code changes; until then it shows a clear message instead of failing silently.

5. **Confirm email templates redirect correctly** — Supabase dashboard → Authentication → URL
   Configuration → set Site URL to your Netlify URL, so signup-confirmation and password-reset
   links land back on your deployed app.

## Verification performed before delivery

- Every file referenced by `index.html`, the auth pages, the manifest and the service worker
  exists at the path referenced (checked programmatically, see below).
- All JavaScript modules and the Netlify function pass `node --check` with no syntax errors.
- Supabase security advisor reports no RLS/security warnings on the schema.
- `.gitignore` excludes `.env` and other local/secret files; no service-role key or Hugging Face
  token appears anywhere in the project — only the public Supabase URL and publishable key, which
  are meant to ship in the browser.
- Not yet verified from here (couldn't be, in this environment): a live end-to-end signup → chat →
  reply round trip against your actual Hugging Face Space, and Netlify's own build of the function.
  Do a quick manual test of signup, login, and sending one chat message right after your first
  deploy.
