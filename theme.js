/**
 * VChat Universal Theme Controller
 * Synchronizes Dark & Light theme across ALL pages (Home, Auth, Chat, Info, About)
 * Designed to prevent flash of wrong theme and sync live across browser tabs.
 */
(function () {
    const THEME_KEY = "vchatTheme";

    function getSavedTheme() {
        const saved = localStorage.getItem(THEME_KEY);
        if (saved === "dark" || saved === "light") {
            return saved;
        }
        return "light"; // Default initial brand theme
    }

    function applyTheme(theme) {
        const isDark = theme === "dark";
        const root = document.documentElement;
        const body = document.body;

        if (isDark) {
            root.classList.add("dark-theme");
            root.classList.remove("light-theme");
            if (body) {
                body.classList.add("dark-theme");
                body.classList.remove("light-theme");
            }
        } else {
            root.classList.add("light-theme");
            root.classList.remove("dark-theme");
            if (body) {
                body.classList.add("light-theme");
                body.classList.remove("dark-theme");
            }
        }

        // Update mobile browser toolbar color
        const metaTheme = document.querySelector('meta[name="theme-color"]');
        if (metaTheme) {
            metaTheme.setAttribute("content", isDark ? "#060708" : "#00c853");
        }

        // Update all toggle button icons & aria labels
        const toggleButtons = document.querySelectorAll(".theme-toggle-btn, #themeToggle, #themeToggleButton");
        toggleButtons.forEach(btn => {
            btn.setAttribute("aria-label", isDark ? "Switch to light theme" : "Switch to dark theme");
            btn.setAttribute("title", isDark ? "Switch to light theme" : "Switch to dark theme");
            const icon = btn.querySelector("i");
            if (icon) {
                icon.className = isDark ? "fa-solid fa-sun" : "fa-solid fa-moon";
            }
        });

        // Dispatch custom event for any listeners
        window.dispatchEvent(new CustomEvent("vchatThemeChanged", { detail: { theme, isDark } }));
    }

    // Apply immediately to prevent Flash of Unstyled Content (FOUC)
    const currentTheme = getSavedTheme();
    applyTheme(currentTheme);

    // Re-apply and bind controls once DOM is interactive
    document.addEventListener("DOMContentLoaded", () => {
        applyTheme(getSavedTheme());

        const toggleButtons = document.querySelectorAll(".theme-toggle-btn, #themeToggle, #themeToggleButton");
        toggleButtons.forEach(btn => {
            btn.addEventListener("click", () => {
                const current = localStorage.getItem(THEME_KEY) || getSavedTheme();
                const nextTheme = current === "dark" ? "light" : "dark";
                localStorage.setItem(THEME_KEY, nextTheme);
                applyTheme(nextTheme);

                // Show toast if available on the current page
                if (typeof showToast === "function") {
                    showToast(nextTheme === "dark" ? "Switched to Dark Theme" : "Switched to Light Theme", "fa-solid fa-palette");
                }
            });
        });
    });

    // Cross-tab live synchronization via storage event
    window.addEventListener("storage", (event) => {
        if (event.key === THEME_KEY) {
            applyTheme(event.newValue || "light");
        }
    });

    // Expose global helper
    window.setVChatTheme = function (theme) {
        localStorage.setItem(THEME_KEY, theme);
        applyTheme(theme);
    };
})();
