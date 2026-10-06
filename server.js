/**
 * VChat Local Development Server
 * 
 * Production-quality, portable HTTP server for local testing and development.
 * Designed to run on any machine without hardcoded absolute paths.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const ROOT = path.resolve(__dirname);

// Comprehensive MIME type map
const MIME_TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.webp': 'image/webp',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.ttf': 'font/ttf',
    '.webmanifest': 'application/manifest+json'
};

// Route shortcuts for convenient access
const ROUTE_ALIASES = {
    '/': '/index.html',
    '/auth': '/Auth/login-signup.html',
    '/auth/': '/Auth/login-signup.html',
    '/login': '/Auth/login-signup.html',
    '/signup': '/Auth/login-signup.html',
    '/confirm': '/Auth/confirm.html',
    '/confirm/': '/Auth/confirm.html',
    '/chat': '/Chat/chat.html',
    '/chat/': '/Chat/chat.html',
    '/info': '/info/info.html',
    '/info/': '/info/info.html',
    '/about': '/About/about.html',
    '/about/': '/About/about.html'
};

/**
 * Validates and resolves a requested URL path securely within the ROOT directory.
 * Defends against encoded traversal, separator exploits, and escaping ROOT.
 */
function resolveSafePath(urlPath) {
    let cleanPath = urlPath.split('?')[0].split('#')[0];

    try {
        cleanPath = decodeURIComponent(cleanPath);
    } catch {
        return null;
    }

    // Check aliases
    if (ROUTE_ALIASES[cleanPath]) {
        cleanPath = ROUTE_ALIASES[cleanPath];
    }

    // Standardize leading slash
    if (!cleanPath.startsWith('/')) {
        cleanPath = '/' + cleanPath;
    }

    // Resolve absolute path relative to ROOT
    const targetPath = path.resolve(ROOT, '.' + cleanPath);

    // Verify targetPath is strictly inside ROOT
    const relative = path.relative(ROOT, targetPath);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
        return null; // Path traversal attempted
    }

    return targetPath;
}

function parseDotEnv() {
    const candidates = ['.env.local', '.env.development', '.env'];
    const result = {};
    candidates.forEach((filename) => {
        const envPath = path.join(ROOT, filename);
        if (!fs.existsSync(envPath)) return;
        fs.readFileSync(envPath, 'utf8').split(/\r?\n/).forEach((line) => {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith('#')) return;
            const eq = trimmed.indexOf('=');
            if (eq < 1) return;
            let value = trimmed.slice(eq + 1).trim();
            if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
                value = value.slice(1, -1);
            }
            const key = trimmed.slice(0, eq).trim();
            if (result[key] == null) result[key] = value;
        });
    });
    return result;
}

const server = http.createServer((req, res) => {
    // Only accept GET and HEAD methods for static development server
    if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.writeHead(405, { 'Content-Type': 'text/plain' });
        res.end('Method Not Allowed');
        return;
    }

    const rawPath = (req.url || '/').split('?')[0];
    if (/\.env($|\.)/i.test(rawPath) || rawPath.includes('node_modules') || rawPath.includes('.git')) {
        res.writeHead(403, { 'Content-Type': 'text/plain' });
        res.end('403 Forbidden');
        return;
    }

    if (rawPath === '/js/config.js' || rawPath === '/js/runtime-config.js') {
        const env = { ...parseDotEnv(), ...process.env };
        const url = (env.SUPABASE_URL || env.VITE_SUPABASE_URL || '').trim();
        const key = (env.SUPABASE_PUBLISHABLE_KEY || env.VITE_SUPABASE_PUBLISHABLE_KEY || env.SUPABASE_ANON_KEY || env.VITE_SUPABASE_ANON_KEY || '').trim();
        const publicUrl = (env.VCHAT_PUBLIC_URL || env.VITE_APP_URL || ('http://localhost:' + PORT)).trim();
        const rawOtp = env.VCHAT_DEV_MOBILE_OTP ?? env.DEV_MOBILE_OTP;
        const devOtp = rawOtp == null ? true : String(rawOtp).toLowerCase() !== 'false';

        if (url && key && !/service_role/i.test(key)) {
            const body = 'window.VCHAT_CONFIG = ' + JSON.stringify({
                SUPABASE_URL: url,
                SUPABASE_PUBLISHABLE_KEY: key,
                PUBLIC_URL: publicUrl,
                DEV_MOBILE_OTP: devOtp
            }, null, 4) + ';\n';
            res.writeHead(200, {
                'Content-Type': 'application/javascript; charset=utf-8',
                'Cache-Control': 'no-store'
            });
            if (req.method !== 'HEAD') res.end(body);
            else res.end();
            return;
        }
    }

    const safeFilePath = resolveSafePath(req.url);

    if (!safeFilePath) {
        res.writeHead(403, { 'Content-Type': 'text/plain' });
        res.end('403 Forbidden: Invalid or unauthorized path');
        return;
    }

    fs.stat(safeFilePath, (err, stats) => {
        if (err) {
            res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(`
                <!DOCTYPE html>
                <html lang="en">
                <head>
                    <meta charset="UTF-8">
                    <title>404 — Page Not Found | VChat</title>
                    <style>
                        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #0b0e11; color: #e9edef; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
                        .card { text-align: center; max-width: 440px; padding: 40px; background: #111b21; border-radius: 12px; border: 1px solid #202c33; box-shadow: 0 12px 30px rgba(0,0,0,0.4); }
                        h1 { color: #00c853; margin-bottom: 8px; font-size: 32px; }
                        p { color: #8696a0; font-size: 15px; line-height: 1.5; }
                        a { display: inline-block; margin-top: 20px; padding: 10px 24px; background: #00c853; color: #000; text-decoration: none; border-radius: 8px; font-weight: 600; }
                        a:hover { background: #00e676; }
                    </style>
                </head>
                <body>
                    <div class="card">
                        <h1>404</h1>
                        <p>The requested file could not be found on this VChat server.</p>
                        <a href="/">Return to VChat Homepage</a>
                    </div>
                </body>
                </html>
            `);
            return;
        }

        // If directory, look for index.html inside
        let finalPath = safeFilePath;
        if (stats.isDirectory()) {
            finalPath = path.join(safeFilePath, 'index.html');
            if (!fs.existsSync(finalPath)) {
                res.writeHead(404, { 'Content-Type': 'text/plain' });
                res.end('404 Not Found: Directory index not found');
                return;
            }
        }

        const ext = path.extname(finalPath).toLowerCase();
        const contentType = MIME_TYPES[ext] || 'application/octet-stream';

        // Add security and caching headers suitable for development
        res.writeHead(200, {
            'Content-Type': contentType,
            'X-Content-Type-Options': 'nosniff',
            'Cache-Control': 'no-cache, must-revalidate'
        });

        if (req.method === 'HEAD') {
            res.end();
            return;
        }

        const stream = fs.createReadStream(finalPath);
        stream.on('error', (streamErr) => {
            if (!res.headersSent) {
                res.writeHead(500, { 'Content-Type': 'text/plain' });
            }
            res.end('500 Internal Server Error');
        });
        stream.pipe(res);
    });
});

server.listen(PORT, () => {
    console.log(`====================================================`);
    console.log(`  VChat Development Server Active`);
    console.log(`  Root: ${ROOT}`);
    console.log(`  Local URL: http://localhost:${PORT}`);
    console.log(`====================================================`);
});
