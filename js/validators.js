(function (global) {
    function digitsOnly(value) {
        return String(value || "").replace(/\D/g, "");
    }

    function normalizeMobile(value) {
        let digits = digitsOnly(value);
        if (digits.length === 12 && digits.startsWith("91")) digits = digits.slice(2);
        if (digits.length === 11 && digits.startsWith("0")) digits = digits.slice(1);
        return digits;
    }

    function isValidMobile(value) {
        const cleaned = normalizeMobile(value);
        return cleaned.length === 10 && /^[6-9]\d{9}$/.test(cleaned);
    }

    function isValidEmail(value) {
        return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || "").trim());
    }

    function isValidName(value) {
        const name = String(value || "").trim();
        return name.length >= 2 && name.length <= 80;
    }

    function isValidPassword(value, min) {
        return String(value || "").length >= (min || 8);
    }

    function isValidUuid(value) {
        return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ""));
    }

    function isAllowedAttachment(file) {
        if (!file) return { ok: false, error: "No file selected." };
        const maxBytes = 8 * 1024 * 1024;
        if (file.size > maxBytes) return { ok: false, error: "File is larger than 8 MB." };
        const name = String(file.name || "file").toLowerCase();
        const ext = name.includes(".") ? name.slice(name.lastIndexOf(".") + 1) : "";
        const allowedExt = ["png", "jpg", "jpeg", "gif", "webp", "pdf", "txt", "zip", "doc", "docx"];
        const allowedMime = [
            "image/png", "image/jpeg", "image/gif", "image/webp",
            "application/pdf", "text/plain", "application/zip",
            "application/msword",
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            ""
        ];
        if (!allowedExt.includes(ext)) return { ok: false, error: "That file type is not allowed." };
        if (file.type && !allowedMime.includes(file.type) && !file.type.startsWith("image/")) {
            return { ok: false, error: "That file type is not allowed." };
        }
        return { ok: true, isImage: (file.type || "").startsWith("image/") || ["png", "jpg", "jpeg", "gif", "webp"].includes(ext) };
    }

    function isAllowedAvatar(file) {
        if (!file) return { ok: false, error: "No image selected." };
        if (file.size > 2 * 1024 * 1024) return { ok: false, error: "Avatar must be 2 MB or smaller." };
        const okType = ["image/png", "image/jpeg", "image/webp", "image/gif"].includes(file.type);
        if (!okType) return { ok: false, error: "Use a PNG, JPEG, WebP, or GIF image." };
        return { ok: true };
    }

    global.VChatValidators = {
        digitsOnly,
        normalizeMobile,
        isValidMobile,
        isValidEmail,
        isValidName,
        isValidPassword,
        isValidUuid,
        isAllowedAttachment,
        isAllowedAvatar
    };
})(window);
