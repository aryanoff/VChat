# VChat Production Deployment Guide

VChat is built as an environment-aware, static full-stack frontend application connected directly to Supabase. It is deployed and hosted on **Cloudflare Pages** at **`https://vchat-ckw.pages.dev`** with automated deployments connected to the GitHub repository `aryanoff/VChat` on branch `main`.

---

## 1. Cloudflare Pages Configuration

The repository contains an automated build step that injects your Supabase credentials into `js/config.js` securely at build time without ever committing secrets to Git.

### Build & Output Settings
1. Go to your **Cloudflare Dashboard** -> **Workers & Pages** -> **vchat-ckw**.
2. Navigate to **Settings** -> **Builds & deployments**.
3. Configure the following:
   - **Framework preset**: `None`
   - **Build command**: `npm run build`
   - **Build output directory**: `/` (root directory)
   - **Root directory**: `/` (root directory)

### Environment Variables
In Cloudflare Pages, go to **Settings** -> **Environment variables**. Under **Production** (and optionally **Preview**), add:

| Variable Name | Example Value | Description |
|---|---|---|
| `VITE_SUPABASE_URL` *(or `SUPABASE_URL`)* | `https://your-ref.supabase.co` | Your Supabase Project API URL |
| `VITE_SUPABASE_PUBLISHABLE_KEY` *(or `SUPABASE_PUBLISHABLE_KEY`)* | `eyJhbGciOi...` | Supabase Publishable (anon) key |
| `VITE_PRODUCTION_URL` | `https://vchat-ckw.pages.dev` | Production live URL |
| `VCHAT_DEV_MOBILE_OTP` | `false` | Disable mock OTP in production |

> **Security Note**: Never add `SUPABASE_SERVICE_ROLE_KEY` or database passwords to Cloudflare Pages environment variables. The build script specifically checks and rejects service-role keys.

---

## 2. Google OAuth & Google Cloud Setup

To allow users to sign in with Google on both Localhost and Production:

### In Google Cloud Console (APIs & Services -> Credentials)
1. Edit your **OAuth 2.0 Client ID** (Web application).
2. **Authorized JavaScript origins**:
   - `http://localhost:3000`
   - `https://vchat-ckw.pages.dev`
3. **Authorized redirect URIs**:
   - Must be the exact Supabase provider callback URL:
     `https://<YOUR_SUPABASE_PROJECT_REF>.supabase.co/auth/v1/callback`

### In Supabase Dashboard (Authentication -> Providers -> Google)
1. Ensure **Google** is enabled.
2. Enter your **Client ID** and **Client Secret** obtained from Google Cloud Console.
3. Save changes.

---

## 3. Supabase Auth URL Configuration

In Supabase Dashboard -> **Authentication** -> **URL Configuration**:

1. **Site URL**:
   `https://vchat-ckw.pages.dev`

2. **Redirect URLs** (Add each as an authorized redirect):
   - `https://vchat-ckw.pages.dev/Auth/login-signup.html`
   - `http://localhost:3000/Auth/login-signup.html`

> **Dynamic Origin Support**: VChat automatically computes the current active domain in the browser (`window.location.origin`). When running locally on `http://localhost:3000`, OAuth returns to localhost; when on `https://vchat-ckw.pages.dev`, OAuth returns to production automatically.

---

## 4. Local Development vs Production

- **Local Development**:
  1. Create a `.env` file in the project root:
     ```env
     SUPABASE_URL=https://your-ref.supabase.co
     SUPABASE_PUBLISHABLE_KEY=your-publishable-key
     VCHAT_DEV_MOBILE_OTP=true
     ```
  2. Run `npm start` or `npm run dev`.
  3. The local server (`server.js`) automatically parses `.env` and serves runtime configuration dynamically at `http://localhost:3000` without modifying git-tracked files.

- **Production Deployment**:
  1. Commit and push your code to GitHub `main`:
     ```bash
     git push origin main
     ```
  2. Cloudflare Pages automatically detects the commit, runs `npm run build`, injects the environment variables from Cloudflare Pages settings into `js/config.js`, and deploys to `https://vchat-ckw.pages.dev`.
