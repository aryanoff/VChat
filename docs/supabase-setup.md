# Supabase Setup for VChat

Follow these steps to set up the Supabase backend for VChat.

## Project Creation

1. **Create Project**: Log into Supabase and create a new project.
2. **Environment Variables**:
   - Copy the **Project URL** and **anon / public** key.
   - Save them in a local `.env` file (based on `.env.example`).
   - Also, place them in `js/config.js` or configure your build tool to inject them.

## Database & Schema

1. **Database Schema**: Execute the migration SQL files located in `supabase/migrations/` via the Supabase SQL Editor.
2. **Row Level Security (RLS)**: Ensure RLS is enabled on all tables (`profiles`, `conversations`, `messages`, etc.). The migration files should automatically configure these.

## Authentication

1. **Email Auth**: Enable Email login in **Authentication > Providers**.
2. **Google Auth**: Follow the guide in `google-auth-setup.md`.

## Realtime

1. Go to **Database > Publications**.
2. Ensure the `supabase_realtime` publication includes the `messages`, `conversations`, and `notifications` tables.
3. This allows the frontend to subscribe to new messages and chat list updates.

## Storage

1. **Buckets**: Create the following buckets in **Storage**:
   - `chat-attachments` (Set to authenticated or use signed URLs)
   - `avatars` (Can be public for profiles)
2. **Policies**: Set up storage policies so users can only upload files up to 5MB, and can only select/insert into their own conversation folders.

## Edge Functions (Optional)

If your app requires server-side logic like sending a real SMS OTP, you will need to deploy a Supabase Edge Function and call it via `supabase.functions.invoke()`. Currently, SMS is mock-driven via SQL in development.
