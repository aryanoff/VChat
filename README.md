# VChat

VChat is a fast, simple, and private messaging web application. It features a responsive UI, real-time messaging, user search, profile management, and a beautiful dark/light theme switch.

## Architecture

- **Frontend**: Pure HTML, CSS, Vanilla JavaScript. No heavy frontend framework to keep it incredibly lightweight and readable.
- **Backend**: Supabase (PostgreSQL, Auth, Realtime, Storage).
- **Security**: Supabase Row Level Security (RLS) policies ensure data privacy and cross-user isolation.

## Local Setup

1. **Clone the repository.**
2. **Install dependencies**: `npm install` (Only required for the local static development server).
3. **Configure Environment**:
   - Copy `.env.example` to `.env` and fill in your Supabase credentials.
   - Alternatively, copy `js/config.example.js` to `js/config.js` and add your public keys directly.
4. **Run Local Server**: `npm run dev` starts the static server on port 3000.
5. **Database Setup**: Execute the migration file in `supabase/migrations/` in your Supabase SQL editor.

## Documentation

- [Supabase Setup](docs/supabase-setup.md)
- [Google Auth Setup](docs/google-auth-setup.md)
- [Deployment Guide](docs/deployment.md)

## Development Mode Features

- **Mock OTP**: SMS mobile verification is difficult to implement without a paid provider (like Twilio). For local development, VChat includes a mock OTP system backed by a Postgres function that displays the generated code in a UI toast. Set `VCHAT_DEV_MOBILE_OTP=true` in configuration.

## Known Limitations

- **Video/Audio Calling**: The UI elements exist, but a WebRTC stack (or third-party media server) is required for real video/voice calls.
- **Real SMS Verification**: Requires connecting an external SMS provider (like Twilio, MessageBird) using Supabase Edge Functions.

## Deployment

VChat is fully static. It can be easily deployed to Cloudflare Pages or Vercel. See the [Deployment Guide](docs/deployment.md) for details.
