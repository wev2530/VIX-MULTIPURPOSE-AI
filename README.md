# VIX AI

A professional multipurpose AI assistant — general reasoning, math, science, engineering,
mechatronics, programming and general knowledge today, with speech, image and video on the roadmap.

Dark, mobile-first, installable PWA. Auth and data run on Supabase; the AI backend runs behind a
Netlify Function so no model or database secret ever reaches the browser.

## Stack

- **Frontend** — plain HTML/CSS/JS (ES modules), no build step. `css/`, `js/`, `pages/`.
- **Auth + database** — Supabase (Auth, Postgres, Row Level Security).
- **AI backend** — a Netlify Function (`netlify/functions/chat.js`) that verifies the caller's
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
└── netlify/functions/chat.js   Secure server-side call to the AI backend
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

`netlify/functions/chat.js` is the only thing that talks to the model. Configure it with
environment variables in **Netlify → Site configuration → Environment variables** (see
`.env.example` for the full list):

- `MODEL_BACKEND=gradio` (default) calls a Hugging Face Space via its Gradio API. Set
  `HF_SPACE_URL` to your Space, e.g. `https://vg253044-vix-ai.hf.space` for `vg253044/Vix_AI`, or
  the production Space `vg253044/GCV-AI`. Set `HF_API_NAME` to the endpoint name shown on the
  Space's **"Use via API"** page — this varies per Space, so check it there. If the Space is
  private, also set `HF_TOKEN`.
- `MODEL_BACKEND=openai` calls any OpenAI-compatible endpoint (e.g. a Hugging Face Inference
  Endpoint) via `MODEL_BASE_URL` / `MODEL_NAME` / `MODEL_API_KEY`.

I could not verify the exact request/response shape of `vg253044/Vix_AI` or `vg253044/GCV-AI` from
here (Hugging Face isn't reachable from this environment), so `callGradio()` handles the common
Gradio response shapes and exposes `HF_PAYLOAD` (`message` / `transcript` / `message_history`) in
case your Space expects the full conversation rather than just the latest message. **After you set
`HF_SPACE_URL`, open that Space's "Use via API" page once and confirm `HF_API_NAME` and the input
shape match — adjust `HF_PAYLOAD` if the first reply looks wrong.**

Swapping to a different backend entirely later only means editing `callModel()` in that one file.

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

3. **Set environment variables in Netlify** (Site configuration → Environment variables):
   - `SUPABASE_URL=https://yywrtzwfrlpasjqxatpw.supabase.co`
   - `SUPABASE_PUBLISHABLE_KEY=sb_publishable_7f8t8QNFhgKM1diXZUKZvA_Bq2mDB8M`
   - `MODEL_BACKEND=gradio`
   - `HF_SPACE_URL=` your chosen Space URL
   - `HF_API_NAME=` from that Space's "Use via API" page
   - `HF_TOKEN=` only if the Space is private
   - Redeploy after saving so the function picks them up.

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
