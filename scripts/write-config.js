/**
 * Writes js/runtime-config.js from environment variables.
 * Used locally (with .env) and on Cloudflare Pages build.
 */
const fs = require("fs");
const path = require("path");

function loadDotEnv() {
    const candidates = [".env.production", ".env.local", ".env.development", ".env"];
    for (const filename of candidates) {
        const envPath = path.join(__dirname, "..", filename);
        if (!fs.existsSync(envPath)) continue;
        const text = fs.readFileSync(envPath, "utf8");
        text.split(/\r?\n/).forEach((line) => {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith("#")) return;
            const eq = trimmed.indexOf("=");
            if (eq < 1) return;
            const key = trimmed.slice(0, eq).trim();
            let value = trimmed.slice(eq + 1).trim();
            if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
                value = value.slice(1, -1);
            }
            if (process.env[key] == null) process.env[key] = value;
        });
    }
}

loadDotEnv();

const defaultUrl = "https://zoxwltvpakyfyovpytpw.supabase.co";
const defaultKey = "sb_publishable_S2-Vcy8s391J5fvxL4QmeQ_ntJzcfxG";

const url = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || defaultUrl).trim();
const key = (process.env.SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || defaultKey).trim();
const publicUrl = (process.env.VITE_PRODUCTION_URL || process.env.VCHAT_PUBLIC_URL || "https://vchat-ckw.pages.dev").trim();
const rawOtp = process.env.VCHAT_DEV_MOBILE_OTP ?? process.env.DEV_MOBILE_OTP;
const devOtp = rawOtp != null ? String(rawOtp).toLowerCase() === "true" : false;

if (/SERVICE_ROLE|service_role/i.test(key)) {
    console.error("Refusing to write a service-role key into frontend config. Browser code must only use publishable/anon keys.");
    process.exit(1);
}

const configData = {
    SUPABASE_URL: url,
    SUPABASE_PUBLISHABLE_KEY: key,
    PUBLIC_URL: publicUrl,
    DEV_MOBILE_OTP: devOtp
};

const body =
    "/** Generated from environment. Do not commit real keys. */\n" +
    "window.VCHAT_CONFIG = " +
    JSON.stringify(configData, null, 4) +
    ";\n";

const outRuntime = path.join(__dirname, "..", "js", "runtime-config.js");
fs.writeFileSync(outRuntime, body, "utf8");
console.log("Wrote", outRuntime);

if (url && key) {
    const outConfig = path.join(__dirname, "..", "js", "config.js");
    fs.writeFileSync(outConfig, body, "utf8");
    console.log("Wrote", outConfig, `(SUPABASE_URL=${url})`);
} else {
    console.log("Notice: SUPABASE_URL and/or SUPABASE_PUBLISHABLE_KEY empty. Preserving js/config.js placeholder.");
}
