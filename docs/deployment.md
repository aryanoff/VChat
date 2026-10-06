# VChat Deployment Guide

VChat is built as a static frontend application that connects directly to Supabase as its backend. It is optimized for static hosting platforms like Cloudflare Pages, Vercel, or GitHub Pages.

## Preparation for Hosting

1. **Relative Assets**: Ensure all image and script paths are correctly referenced.
2. **No Filesystem Assumptions**: The app runs entirely in the browser using the Supabase REST/Realtime API. No Node.js backend is required for production.
3. **No Secret Variables**: Do NOT expose `SUPABASE_SERVICE_ROLE_KEY` in `config.js` or `.env`. Only expose the publishable URL and Anon key.

## Deploying to Cloudflare Pages (Recommended)

1. **GitHub Repository**: Push your code to a GitHub repository.
2. **Cloudflare Pages**:
   - Log into Cloudflare and go to **Pages**.
   - Click **Connect to Git** and select your VChat repository.
   - **Framework Preset**: None / Static HTML.
   - **Build Command**: `npm run write-config` (if you are injecting variables) or leave empty if your `config.js` is committed with the public keys.
   - **Environment Variables**: Add `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` (if you use a build script to generate `config.js`).
3. **Deploy**: Click Save and Deploy.

## Post-Deployment Checklist

- **Supabase project URL**: Ensure the production origin is added to Supabase **Authentication -> URL Configuration -> Site URL**.
- **Google OAuth**: Add the new production URL to Google Cloud Console as an authorized JavaScript origin.
- **HTTPS**: Cloudflare handles SSL automatically. Ensure you only load resources over HTTPS.
- **Custom Domain**: You can attach a custom domain later in Cloudflare Pages settings.
