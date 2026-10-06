# Google Auth Setup for VChat

To enable "Continue with Google" in VChat, follow these exact manual steps in the Google Cloud Console and Supabase Dashboard.

## Google Cloud Console

1. **Create a Google Cloud Project**: Go to the Google Cloud Console, create a new project, and name it "VChat" (or similar).
2. **Google Auth Platform**: Navigate to **APIs & Services > OAuth consent screen**.
3. **Branding / Consent Screen**:
   - Choose **External** user type.
   - Fill in the application name, support email, and developer contact email.
   - You can skip scopes for now, just the default email/profile ones are sufficient.
   - Add test users if your app is in "Testing" mode. Publish it to "Production" when ready.
4. **OAuth Client**: Go to **Credentials > Create Credentials > OAuth client ID**. Choose "Web application".
5. **Authorized Origins**:
   - Add your local test URL: `http://localhost:3000` (or whatever local port you use).
   - Add your production URL: `https://your-production-url.pages.dev`
6. **Supabase Callback URI**:
   - In the "Authorized redirect URIs" section, add the Supabase Auth callback URL.
   - Format: `https://[YOUR_PROJECT_REF].supabase.co/auth/v1/callback`

## Supabase Dashboard

7. **Supabase Google Provider**:
   - Go to your Supabase Project > **Authentication > Providers > Google**.
   - Enable it.
   - Paste the **Client ID** and **Client Secret** obtained from Google Cloud Console.
   - Save the configuration.

## Testing and Production URLs

8. **localhost test**: Test login locally by running a local server on the origin you whitelisted.
9. **production URL**: Ensure your live deployment URL is in both Authorized Origins and the Supabase dashboard (Authentication -> URL Configuration -> Site URL and Redirect URLs).
10. **Troubleshooting `redirect_uri_mismatch`**:
   - This occurs if the exact redirect URL used by Supabase (with or without trailing slash) is not present in the Google Cloud Console "Authorized redirect URIs". Ensure they match perfectly.

**Important:** Do NOT place your Google Client Secret into your frontend code or Git repository!
