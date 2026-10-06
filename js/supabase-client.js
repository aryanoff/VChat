/**
 * Single shared Supabase browser client for VChat.
 * Uses the publishable (anon) key only. RLS is the security boundary.
 */
(function (global) {
    const PLACEHOLDER = /YOUR_PROJECT_REF|YOUR_SUPABASE_ANON_KEY|^$/;

    function getConfig() {
        const cfg = global.VCHAT_CONFIG || global.__ENV__ || {};
        const url = cfg.SUPABASE_URL || cfg.VITE_SUPABASE_URL || "";
        const key = cfg.SUPABASE_PUBLISHABLE_KEY || cfg.VITE_SUPABASE_PUBLISHABLE_KEY || cfg.SUPABASE_ANON_KEY || cfg.VITE_SUPABASE_ANON_KEY || "";
        const publicUrl = cfg.PUBLIC_URL || cfg.VITE_APP_URL || cfg.VITE_PRODUCTION_URL || "";
        const devOtp = cfg.DEV_MOBILE_OTP != null ? cfg.DEV_MOBILE_OTP : (cfg.VCHAT_DEV_MOBILE_OTP != null ? cfg.VCHAT_DEV_MOBILE_OTP : true);

        return {
            url: String(url).trim(),
            key: String(key).trim(),
            publicUrl: String(publicUrl).trim(),
            devMobileOtp: devOtp !== false
        };
    }

    function isConfigured() {
        const { url, key } = getConfig();
        return Boolean(url && key && !PLACEHOLDER.test(url) && !PLACEHOLDER.test(key) && !/service_role/i.test(key));
    }

    function authRedirectTo() {
        const { publicUrl } = getConfig();
        // Dynamically prioritize actual browser origin (works seamlessly on both localhost and Cloudflare Pages)
        const origin = (global.location && global.location.origin && global.location.origin !== "null" && !global.location.origin.startsWith("file:"))
            ? global.location.origin
            : (publicUrl || "https://vchat-ckw.pages.dev");
        return new URL("Auth/login-signup.html", origin.endsWith("/") ? origin : origin + "/").toString();
    }

    let client = null;

    function getClient() {
        if (client) return client;
        if (!global.supabase || typeof global.supabase.createClient !== "function") {
            throw new Error("Supabase library failed to load.");
        }
        if (!isConfigured()) {
            throw new Error("Supabase is not configured. Add your project URL and publishable key.");
        }
        const { url, key } = getConfig();
        client = global.supabase.createClient(url, key, {
            auth: {
                persistSession: true,
                autoRefreshToken: true,
                detectSessionInUrl: true,
                storageKey: "vchat-auth"
            },
            realtime: {
                params: { eventsPerSecond: 8 }
            }
        });
        return client;
    }

    function mapProfile(row) {
        if (!row) return null;
        return {
            id: row.id || row.user_id,
            name: row.full_name || row.display_name || row.name || "VChat User",
            about: row.about || row.bio || "Hey there! I am using VChat.",
            mobile: row.mobile || row.phone || "",
            email: row.email || "",
            avatarUrl: row.avatar_url || "",
            lastSeenAt: row.last_seen_at || null,
            mobileVerified: !!(row.mobile_verified || row.mobile_verified_at),
            emailVerified: !!(row.email_verified || row.email_verified_at)
        };
    }

    function setupError() {
        return "VChat is not connected to Supabase yet. Add SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY (see .env.example and docs/supabase-setup.md).";
    }

    global.VChat = global.VChat || {};
    global.VChat.supabase = {
        getConfig,
        isConfigured,
        getClient,
        authRedirectTo,
        mapProfile,
        setupError
    };
})(window);
