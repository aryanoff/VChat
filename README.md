# VChat

VChat is a fast, simple, and private messaging web application. It features a responsive UI, real-time messaging, user search, profile management, and a beautiful dark/light theme switch.

## Architecture

- **Frontend**: Pure HTML, CSS, Vanilla JavaScript. No heavy frontend framework to keep it incredibly lightweight and readable.
- **Backend**: Supabase (PostgreSQL, Auth, Realtime, Storage).
- **Security**: Supabase Row Level Security (RLS) policies ensure data privacy and cross-user isolation.

## Identity & Discovery System (Production Usernames)

VChat uses a privacy-first, two-tier identity model:
- **Display Name**: The user's visible persona (e.g. `Aryan Singh`), non-unique, editable anytime, supports spaces and standard characters.
- **Unique Username (`@username`)**: Globally unique handle (e.g. `@aryansingh`), used for public search, starting conversations, and profile links.

### Key Principles:
1. **Phone Number Privacy**: User discovery by mobile number has been completely eliminated. Phone numbers remain private in account data and are never exposed in search or public profiles.
2. **Canonical Format**: 3–20 characters, lowercase `[a-z0-9_.]`, must contain at least one letter, no consecutive or leading/trailing periods or underscores.
3. **Database-Enforced 30-Day Cooldown**: Usernames can only be changed once every 30 days. This cooldown is strictly enforced at the database level by the `update_user_username` stored procedure.
4. **Reserved & Protected Usernames**: Sensitive and system names (e.g., `admin`, `support`, `vchat`, `security`) are protected. Released usernames are reserved for 30 days to prevent immediate impersonation.
5. **Search Ranking**: Public discovery prioritizes exact username matches first, then username prefix matches, then display name matches. Blocked contacts and the searching user are excluded.
6. **Shareable Profile Links & QR**: Direct profile URLs (`https://vchat-ckw.pages.dev/u/aryansingh` or `?u=aryansingh`) open directly to the user profile or chat prompt. A zero-dependency client-side QR generator enables instant profile sharing.

## Local Setup

1. **Clone the repository.**
2. **Install dependencies**: `npm install` (Only required for the local static development server).
3. **Configure Environment**:
   - Copy `.env.example` to `.env` and fill in your Supabase credentials.
   - Alternatively, copy `js/config.example.js` to `js/config.js` and add your public keys directly.
4. **Run Local Server**: `npm run dev` starts the static server on port 3000.
5. **Database Setup**: Execute the migration files in `supabase/migrations/` in order:
   - `20260408_vchat_complete_schema.sql` (Base tables, functions, RLS)
   - `20261006_vchat_username_identity.sql` (Username identity, uniqueness index, cooldown RPC, search RPC, backfill)

## Documentation

- [Supabase Setup](docs/supabase-setup.md)
- [Google Auth Setup](docs/google-auth-setup.md)
- [Deployment Guide](docs/deployment.md)

## Automated Tests

Run unit tests covering username validation, normalization, cooldown calculations, search ranking, and URL routing:
```bash
npm test
```

## Known Limitations

- **Video/Audio Calling**: UI elements exist; a WebRTC signaling stack or third-party media server is required for live voice/video calls.
- **Push Notifications**: Web Push Service Worker configuration is ready for VAPID key connection.

## Deployment

VChat is fully static and deployed to Cloudflare Pages (`https://vchat-ckw.pages.dev`). Direct `/u/*` profile URLs are handled by `_redirects` routing to `/Chat/chat.html`.

