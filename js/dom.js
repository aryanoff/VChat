(function (global) {
    function el(tag, attrs, children) {
        const node = document.createElement(tag);
        if (attrs) {
            Object.keys(attrs).forEach((key) => {
                const value = attrs[key];
                if (value == null || value === false) return;
                if (key === "className") node.className = value;
                else if (key === "text") node.textContent = value;
                else if (key === "dataset") {
                    Object.keys(value).forEach((d) => { node.dataset[d] = value[d]; });
                } else if (key.startsWith("on") && typeof value === "function") {
                    node.addEventListener(key.slice(2).toLowerCase(), value);
                } else if (key === "hidden") node.hidden = !!value;
                else node.setAttribute(key, value === true ? "" : String(value));
            });
        }
        (children || []).forEach((child) => {
            if (child == null) return;
            node.appendChild(typeof child === "string" ? document.createTextNode(child) : child);
        });
        return node;
    }

    function clear(node) {
        if (!node) return;
        while (node.firstChild) node.removeChild(node.firstChild);
    }

    function initials(name) {
        if (!name) return "VC";
        return name.trim().split(/\s+/).slice(0, 2).map((w) => w.charAt(0).toUpperCase()).join("") || "VC";
    }

    function avatarClass(name) {
        const palette = ["avatar-green", "avatar-blue", "avatar-purple", "avatar-orange", "avatar-pink", "avatar-cyan"];
        let hash = 0;
        String(name || "").split("").forEach((ch) => { hash = (hash + ch.charCodeAt(0)) % palette.length; });
        return palette[hash] || "avatar-green";
    }

    function formatTime(iso) {
        if (!iso) return "";
        const date = new Date(iso);
        if (Number.isNaN(date.getTime())) return "";
        const now = new Date();
        const sameDay = date.toDateString() === now.toDateString();
        const yesterday = new Date(now);
        yesterday.setDate(now.getDate() - 1);
        if (sameDay) {
            return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
        }
        if (date.toDateString() === yesterday.toDateString()) return "Yesterday";
        return date.toLocaleDateString([], { month: "short", day: "numeric" });
    }

    function formatBytes(bytes) {
        if (!bytes && bytes !== 0) return "";
        if (bytes < 1024) return bytes + " B";
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
        return (bytes / (1024 * 1024)).toFixed(1) + " MB";
    }

    function showToast(targetClass, message, icon) {
        let toast = document.querySelector("." + targetClass);
        if (!toast) {
            toast = document.createElement("div");
            toast.className = targetClass;
            document.body.appendChild(toast);
        }
        clear(toast);
        const iconEl = document.createElement("i");
        iconEl.className = icon || "fa-solid fa-circle-info";
        const span = document.createElement("span");
        span.textContent = message;
        toast.appendChild(iconEl);
        toast.appendChild(span);
        toast.classList.add("show");
        clearTimeout(toast._timeout);
        toast._timeout = setTimeout(() => toast.classList.remove("show"), 3400);
        return toast;
    }

    global.VChatDom = { el, clear, initials, avatarClass, formatTime, formatBytes, showToast };
})(window);
