/**
 * Writes js/runtime-config.js from environment variables.
 * Used locally (with .env) and on Cloudflare Pages build.
 */
const fs = require("fs");
const path = require("path");

function loadDotEnv() {
    const envPath = path.join(__dirname, "..", ".env");
    if (!fs.existsSync(envPath)) return;
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

loadDotEnv();

const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
const key = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_ANON_KEY || "";
const publicUrl = process.env.VCHAT_PUBLIC_URL || "";
const devOtp = String(process.env.VCHAT_DEV_MOBILE_OTP || "true").toLowerCase() !== "false";

if (/SERVICE_ROLE|service_role/i.test(key)) {
    console.error("Refusing to write a service-role key into frontend config.");
    process.exit(1);
}

const body =
    "/** Generated from environment. Do not commit real keys. */\n" +
    "window.VCHAT_CONFIG = " +
    JSON.stringify({
        SUPABASE_URL: url,
        SUPABASE_PUBLISHABLE_KEY: key,
        PUBLIC_URL: publicUrl,
        DEV_MOBILE_OTP: devOtp
    }, null, 4) +
    ";\n";

const outRuntime = path.join(__dirname, "..", "js", "runtime-config.js");
fs.writeFileSync(outRuntime, body, "utf8");
if (url && key) {
    const outConfig = path.join(__dirname, "..", "js", "config.js");
    fs.writeFileSync(outConfig, body, "utf8");
    console.log("Wrote", outConfig);
}
console.log("Wrote", outRuntime);
