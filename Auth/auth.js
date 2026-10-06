/* =============================================
   VCHAT AUTHENTICATION — Production Supabase Auth
   Supports Email + Password with link verification,
   Google OAuth, and graceful error handling.
============================================= */

// DOM Elements — Forms & Navigation
const loginForm = document.getElementById("loginForm");
const signupForm = document.getElementById("signupForm");
const loginTab = document.getElementById("loginTab");
const signupTab = document.getElementById("signupTab");
const authTitle = document.getElementById("authTitle");
const authSubtitle = document.getElementById("authSubtitle");
const authTabs = document.querySelector(".auth-tabs");

// DOM Elements — Login Form
const loginEmail = document.getElementById("loginEmail");
const loginPassword = document.getElementById("loginPassword");
const forgotPasswordLink = document.getElementById("forgotPasswordLink");

// DOM Elements — Signup Form
const signupName = document.getElementById("signupName");
const signupMobile = document.getElementById("signupMobile");
const signupEmail = document.getElementById("signupEmail");
const signupPassword = document.getElementById("signupPassword");
const signupTerms = document.getElementById("signupTerms");

// DOM Elements — Alert Banner
const authAlertBanner = document.getElementById("authAlertBanner");
const authAlertIcon = document.getElementById("authAlertIcon");
const authAlertTitle = document.getElementById("authAlertTitle");
const authAlertMessage = document.getElementById("authAlertMessage");
const authAlertActions = document.getElementById("authAlertActions");
const alertResendBtn = document.getElementById("alertResendBtn");
const alertLoginBtn = document.getElementById("alertLoginBtn");
const authAlertClose = document.getElementById("authAlertClose");

// DOM Elements — Confirmation / Verification View
const otpSection = document.getElementById("otpSection");
const otpBackButton = document.getElementById("otpBackButton");
const emailOtpDestination = document.getElementById("emailOtpDestination");
const otpTimer = document.getElementById("otpTimer");
const resendOtp = document.getElementById("resendOtp");
const emailOtpStatus = document.getElementById("emailOtpStatus");
const alreadyConfirmedBtn = document.getElementById("alreadyConfirmedBtn");
const toggleManualCodeBtn = document.getElementById("toggleManualCodeBtn");
const manualCodeWrap = document.getElementById("manualCodeWrap");
const verifyBothOtp = document.getElementById("verifyBothOtp");

// Helpers & State
const V = window.VChatValidators;
const Dom = window.VChatDom;

let pendingAuth = { mode: "signup", name: "", mobile: "", email: "" };
let otpCountdown = 30;
let otpInterval = null;
let emailVerified = false;
let supabaseClient = null;

// =============================================
// ALERT BANNER & TOAST HELPERS
// =============================================

function showToast(message, icon) {
    if (Dom && Dom.showToast) {
        Dom.showToast("auth-toast", message, icon);
    } else {
        alert(message);
    }
}

function showAuthAlert({ type = "error", title, message, showResend = false, showLogin = false, email = "" }) {
    if (!authAlertBanner) return;
    authAlertBanner.className = `auth-alert-banner ${type}`;
    if (authAlertTitle) authAlertTitle.textContent = title;
    if (authAlertMessage) authAlertMessage.textContent = message;

    if (authAlertIcon) {
        if (type === "success") {
            authAlertIcon.innerHTML = '<i class="fa-solid fa-circle-check"></i>';
        } else if (type === "warning") {
            authAlertIcon.innerHTML = '<i class="fa-solid fa-triangle-exclamation"></i>';
        } else {
            authAlertIcon.innerHTML = '<i class="fa-solid fa-circle-exclamation"></i>';
        }
    }

    if (authAlertActions) {
        const hasActions = showResend || showLogin;
        authAlertActions.hidden = !hasActions;
        if (alertResendBtn) {
            alertResendBtn.style.display = showResend ? "inline-flex" : "none";
            if (email) alertResendBtn.dataset.email = email;
        }
        if (alertLoginBtn) {
            alertLoginBtn.style.display = showLogin ? "inline-flex" : "none";
        }
    }

    authAlertBanner.hidden = false;
    authAlertBanner.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function hideAuthAlert() {
    if (authAlertBanner) authAlertBanner.hidden = true;
}

if (authAlertClose) {
    authAlertClose.addEventListener("click", hideAuthAlert);
}

if (alertLoginBtn) {
    alertLoginBtn.addEventListener("click", () => {
        hideAuthAlert();
        switchToLogin();
    });
}

if (alertResendBtn) {
    alertResendBtn.addEventListener("click", async () => {
        const client = requireClient();
        if (!client) return;

        const email = alertResendBtn.dataset.email
            || pendingAuth.email
            || (loginEmail ? loginEmail.value.trim() : "")
            || localStorage.getItem("vchat_last_signup_email")
            || "";

        if (!email || !V.isValidEmail(email)) {
            showToast("Please enter your email address to resend confirmation.", "fa-solid fa-envelope");
            switchToLogin();
            if (loginEmail) loginEmail.focus();
            return;
        }

        setBusy(alertResendBtn, true, "Sending...");
        try {
            const redirectUrl = `${window.location.origin}/Auth/login-signup.html`;
            const { error } = await client.auth.resend({
                type: "signup",
                email: email,
                options: { emailRedirectTo: redirectUrl }
            });

            setBusy(alertResendBtn, false, "Resend confirmation email");
            if (error) {
                showToast(error.message, "fa-solid fa-triangle-exclamation");
            } else {
                showToast(`Confirmation email sent to ${email}`, "fa-solid fa-paper-plane");
                showAuthAlert({
                    type: "success",
                    title: "Confirmation link sent!",
                    message: `We sent a fresh verification link to ${email}. Please check your inbox (and spam folder), then click the link to confirm your account.`,
                    showLogin: true
                });
            }
        } catch (err) {
            setBusy(alertResendBtn, false, "Resend confirmation email");
            showToast(err.message || "Could not resend email.", "fa-solid fa-triangle-exclamation");
        }
    });
}

// =============================================
// UI FORM VALIDATION & CONTROLS
// =============================================

function setBusy(button, busy, label) {
    if (!button) return;
    button.disabled = !!busy;
    if (label) {
        const span = button.querySelector("span");
        if (span) span.textContent = label;
    }
}

function setFieldError(inputElement, message) {
    if (!inputElement) return;
    clearFieldError(inputElement);
    const container = inputElement.closest(".input-wrapper")
        || inputElement.closest(".phone-input")
        || inputElement.closest(".check-row")
        || inputElement.parentElement;
    if (container) container.classList.add("has-error");

    const formGroup = inputElement.closest(".form-group") || inputElement.closest(".check-row")?.parentElement;
    if (formGroup) {
        const errorDiv = document.createElement("div");
        errorDiv.className = "form-error";
        const icon = document.createElement("i");
        icon.className = "fa-solid fa-circle-exclamation";
        const span = document.createElement("span");
        span.textContent = message;
        errorDiv.appendChild(icon);
        errorDiv.appendChild(span);
        formGroup.appendChild(errorDiv);
    }
}

function clearFieldError(inputElement) {
    if (!inputElement) return;
    const container = inputElement.closest(".input-wrapper")
        || inputElement.closest(".phone-input")
        || inputElement.closest(".check-row")
        || inputElement.parentElement;
    if (container) container.classList.remove("has-error");

    const formGroup = inputElement.closest(".form-group") || inputElement.closest(".check-row")?.parentElement;
    if (formGroup) {
        formGroup.querySelectorAll(".form-error").forEach((el) => el.remove());
    }
}

function clearAllErrors(form) {
    if (!form) return;
    form.querySelectorAll(".has-error").forEach((el) => el.classList.remove("has-error"));
    form.querySelectorAll(".form-error").forEach((el) => el.remove());
}

[loginEmail, loginPassword, signupName, signupMobile, signupEmail, signupPassword].filter(Boolean).forEach((input) => {
    input.addEventListener("input", () => clearFieldError(input));
});

if (signupTerms) {
    signupTerms.addEventListener("change", () => clearFieldError(signupTerms));
}

// =============================================
// TAB SWITCHING
// =============================================

function switchToLogin() {
    if (loginTab) loginTab.classList.add("active");
    if (signupTab) signupTab.classList.remove("active");
    if (loginForm) {
        loginForm.classList.add("active-form");
        loginForm.style.display = "block";
    }
    if (signupForm) {
        signupForm.classList.remove("active-form");
        signupForm.style.display = "none";
    }
    if (authTitle) authTitle.textContent = "Welcome back";
    if (authSubtitle) authSubtitle.textContent = "Sign in to continue your conversations.";
    if (otpSection) otpSection.hidden = true;
    if (authTabs) authTabs.style.display = "grid";
    clearAllErrors(loginForm);
    clearAllErrors(signupForm);
}

function switchToSignup() {
    if (signupTab) signupTab.classList.add("active");
    if (loginTab) loginTab.classList.remove("active");
    if (signupForm) {
        signupForm.classList.add("active-form");
        signupForm.style.display = "block";
    }
    if (loginForm) {
        loginForm.classList.remove("active-form");
        loginForm.style.display = "none";
    }
    if (authTitle) authTitle.textContent = "Create account";
    if (authSubtitle) authSubtitle.textContent = "Join VChat and start connecting today.";
    if (otpSection) otpSection.hidden = true;
    if (authTabs) authTabs.style.display = "grid";
    clearAllErrors(loginForm);
    clearAllErrors(signupForm);
}

if (loginTab && signupTab) {
    loginTab.addEventListener("click", switchToLogin);
    signupTab.addEventListener("click", switchToSignup);
}

// Password toggle buttons
document.querySelectorAll(".password-toggle").forEach((button) => {
    button.addEventListener("click", function () {
        const input = this.parentElement.querySelector("input");
        if (!input) return;
        const isPassword = input.type === "password";
        input.type = isPassword ? "text" : "password";
        const icon = this.querySelector("i");
        if (icon) icon.className = isPassword ? "fa-regular fa-eye-slash" : "fa-regular fa-eye";
        this.setAttribute("aria-label", isPassword ? "Hide password" : "Show password");
    });
});

// =============================================
// SUPABASE CLIENT INITIALIZATION
// =============================================

function requireClient() {
    const api = window.VChat && window.VChat.supabase;
    if (!api || !api.isConfigured()) {
        showToast(api ? api.setupError() : "Supabase client missing.", "fa-solid fa-triangle-exclamation");
        return null;
    }
    if (!supabaseClient) supabaseClient = api.getClient();
    return supabaseClient;
}

// =============================================
// CONFIRMATION TIMER & HELPERS
// =============================================

function startOtpTimer() {
    clearInterval(otpInterval);
    otpCountdown = 30;
    if (resendOtp) resendOtp.disabled = true;
    if (otpTimer) otpTimer.textContent = `Resend available in ${otpCountdown}s`;

    otpInterval = setInterval(() => {
        otpCountdown -= 1;
        if (otpCountdown <= 0) {
            clearInterval(otpInterval);
            if (otpTimer) otpTimer.textContent = "Didn't receive the email? Request a new one.";
            if (resendOtp) resendOtp.disabled = false;
            return;
        }
        if (otpTimer) otpTimer.textContent = `Resend available in ${otpCountdown}s`;
    }, 1000);
}

function showCheckEmailView(data) {
    pendingAuth = data || {};
    if (loginForm) loginForm.style.display = "none";
    if (signupForm) signupForm.style.display = "none";
    if (authTabs) authTabs.style.display = "none";
    if (otpSection) otpSection.hidden = false;

    if (emailOtpDestination) {
        emailOtpDestination.textContent = pendingAuth.email || "your email address";
    }

    if (manualCodeWrap) manualCodeWrap.hidden = true;
    if (toggleManualCodeBtn) toggleManualCodeBtn.classList.remove("active");

    // Clear any manual OTP inputs
    document.querySelectorAll(".otp-inputs input").forEach((input) => {
        input.value = "";
        input.classList.remove("verified");
    });

    startOtpTimer();
}

function goToChat() {
    window.location.replace("../Chat/chat.html");
}

// =============================================
// SUPABASE PROFILE SYNC (Task 9)
// =============================================

async function loadProfile(client) {
    try {
        const { data: { user } } = await client.auth.getUser();
        if (!user) return { user: null, profile: null };

        const { data } = await client
            .from("profiles")
            .select("id, full_name, display_name, name, about, bio, mobile, phone, email, avatar_url, last_seen_at, mobile_verified, mobile_verified_at, email_verified, email_verified_at")
            .eq("id", user.id)
            .maybeSingle();

        const mapper = window.VChat && window.VChat.supabase && window.VChat.supabase.mapProfile;
        return { user, profile: mapper ? mapper(data) : data };
    } catch (e) {
        console.warn("Could not load profile:", e);
        return { user: null, profile: null };
    }
}

async function ensureProfileMetadata(client, extra) {
    try {
        const { data: { user } } = await client.auth.getUser();
        if (!user) return;

        const meta = user.user_metadata || {};
        const payload = {};
        if (extra.name && !meta.full_name) payload.full_name = extra.name;
        if (extra.mobile && !meta.mobile) payload.mobile = extra.mobile;

        if (Object.keys(payload).length) {
            await client.auth.updateUser({ data: payload });
        }

        const { data: existing } = await client
            .from("profiles")
            .select("id, mobile, email_verified")
            .eq("id", user.id)
            .maybeSingle();

        const isEmailConfirmed = !!(user.email_confirmed_at || user.confirmed_at);

        if (!existing) {
            await client.from("profiles").insert({
                id: user.id,
                full_name: extra.name || meta.full_name || meta.name || user.email?.split("@")[0] || "VChat User",
                mobile: extra.mobile || meta.mobile || null,
                email: user.email,
                email_verified: isEmailConfirmed,
                email_verified_at: isEmailConfirmed ? (user.email_confirmed_at || new Date().toISOString()) : null
            });
        } else {
            const updates = {};
            if (!existing.mobile && extra.mobile) updates.mobile = extra.mobile;
            if (isEmailConfirmed && !existing.email_verified) {
                updates.email_verified = true;
                updates.email_verified_at = user.email_confirmed_at || new Date().toISOString();
            }
            if (Object.keys(updates).length) {
                await client.from("profiles").update(updates).eq("id", user.id);
            }
        }
    } catch (err) {
        console.warn("Profile sync error (non-fatal):", err);
    }
}

async function syncEmailVerifiedFlag(client, user) {
    const confirmed = !!(user && (user.email_confirmed_at || user.confirmed_at));
    emailVerified = confirmed;
    if (confirmed) {
        try {
            await client.from("profiles").update({
                email_verified: true,
                email_verified_at: user.email_confirmed_at || new Date().toISOString()
            }).eq("id", user.id);
        } catch (e) {
            console.warn("Error updating email_verified flag:", e);
        }
    }
    return confirmed;
}

async function afterAuthenticated(client, extras) {
    await ensureProfileMetadata(client, extras || {});
    const { user, profile } = await loadProfile(client);
    emailVerified = await syncEmailVerifiedFlag(client, user);

    const isGoogle = !!(user && user.app_metadata && user.app_metadata.provider === "google");
    if (emailVerified || isGoogle) {
        goToChat();
        return;
    }

    // User is logged in but hasn't confirmed email yet
    showCheckEmailView({
        mode: extras && extras.mode ? extras.mode : "login",
        name: (profile && profile.name) || (extras && extras.name) || "",
        mobile: (profile && profile.mobile) || (extras && extras.mobile) || "",
        email: user ? user.email : ""
    });
}

// =============================================
// FORGOT PASSWORD
// =============================================

if (forgotPasswordLink) {
    forgotPasswordLink.addEventListener("click", async (e) => {
        e.preventDefault();
        const client = requireClient();
        if (!client) return;

        const email = (loginEmail && loginEmail.value.trim()) || "";
        if (!V.isValidEmail(email)) {
            setFieldError(loginEmail, "Enter your account email first to reset your password.");
            return;
        }

        const redirectTo = `${window.location.origin}/Auth/login-signup.html`;
        const { error } = await client.auth.resetPasswordForEmail(email, {
            redirectTo: redirectTo
        });

        if (error) {
            showToast(error.message, "fa-solid fa-triangle-exclamation");
            return;
        }

        showToast("Password reset link sent! Check your inbox.", "fa-solid fa-envelope");
        showAuthAlert({
            type: "success",
            title: "Password reset link sent",
            message: `We sent instructions to ${email}. Click the link in that email to reset your password.`
        });
    });
}

// =============================================
// SOCIAL LOGINS (GOOGLE OAUTH)
// =============================================

document.querySelectorAll(".social-button").forEach((button) => {
    const isGoogle = button.textContent.toLowerCase().includes("google") || button.querySelector(".fa-google");
    if (isGoogle) {
        button.addEventListener("click", async () => {
            const client = requireClient();
            if (!client) return;

            const redirectTo = `${window.location.origin}/Auth/login-signup.html`;
            const { error } = await client.auth.signInWithOAuth({
                provider: "google",
                options: {
                    redirectTo: redirectTo,
                    queryParams: { access_type: "offline", prompt: "consent" }
                }
            });

            if (error) {
                showToast(error.message, "fa-solid fa-triangle-exclamation");
            }
        });
    } else {
        button.addEventListener("click", () => {
            showToast("Apple Sign In is not configured in this VChat deployment.", "fa-brands fa-apple");
        });
    }
});

// =============================================
// LOGIN FORM HANDLER (Email + Password)
// =============================================

if (loginForm) {
    loginForm.addEventListener("submit", async function (event) {
        event.preventDefault();
        clearAllErrors(this);
        hideAuthAlert();

        const client = requireClient();
        if (!client) return;

        const email = (loginEmail && loginEmail.value.trim()) || "";
        const password = (loginPassword && loginPassword.value) || "";
        let hasError = false;

        if (!email) {
            setFieldError(loginEmail, "Please enter your email address.");
            hasError = true;
        } else if (!V.isValidEmail(email)) {
            setFieldError(loginEmail, "Please enter a valid email address.");
            hasError = true;
        }

        if (!password) {
            setFieldError(loginPassword, "Please enter your password.");
            hasError = true;
        } else if (password.length < 6) {
            setFieldError(loginPassword, "Password must contain at least 6 characters.");
            hasError = true;
        }

        if (hasError) return;

        const submitBtn = loginForm.querySelector(".auth-submit");
        setBusy(submitBtn, true, "Signing in...");

        const { data, error } = await client.auth.signInWithPassword({ email, password });
        setBusy(submitBtn, false, "Sign in to VChat");

        if (error) {
            const msg = error.message || "";
            // Handle unconfirmed email gracefully
            if (msg.toLowerCase().includes("email not confirmed") || msg.toLowerCase().includes("not confirmed")) {
                showAuthAlert({
                    type: "warning",
                    title: "Email confirmation required",
                    message: "Your email address has not been confirmed yet. Please check your inbox or click below to receive a new confirmation link.",
                    showResend: true,
                    email: email
                });
                return;
            }

            if (msg.toLowerCase().includes("invalid login credentials")) {
                setFieldError(loginPassword, "Invalid email or password. Please verify and try again.");
                return;
            }

            showToast(msg, "fa-solid fa-triangle-exclamation");
            return;
        }

        if (!data.session) {
            showCheckEmailView({ mode: "login", email });
            showToast("Please confirm your email address before continuing.", "fa-solid fa-envelope");
            return;
        }

        await afterAuthenticated(client, { mode: "login", email });
    });
}

// =============================================
// SIGNUP FORM HANDLER (Tasks 2 & 4)
// =============================================

if (signupForm) {
    signupForm.addEventListener("submit", async function (event) {
        event.preventDefault();
        clearAllErrors(this);
        hideAuthAlert();

        const client = requireClient();
        if (!client) return;

        const name = (signupName && signupName.value.trim()) || "";
        const mobile = (signupMobile && signupMobile.value.trim()) || "";
        const email = (signupEmail && signupEmail.value.trim()) || "";
        const password = (signupPassword && signupPassword.value) || "";
        let hasError = false;

        if (!V.isValidName(name)) {
            setFieldError(signupName, "Please enter your full name (2–80 characters).");
            hasError = true;
        }

        // Mobile is optional in signup
        if (mobile && !V.isValidMobile(mobile)) {
            setFieldError(signupMobile, "Enter a valid 10-digit mobile number, or leave blank.");
            hasError = true;
        }

        if (!V.isValidEmail(email)) {
            setFieldError(signupEmail, "Please enter a valid email address.");
            hasError = true;
        }

        if (!V.isValidPassword(password, 8)) {
            setFieldError(signupPassword, "Password must contain at least 8 characters.");
            hasError = true;
        }

        if (signupTerms && !signupTerms.checked) {
            setFieldError(signupTerms, "You must agree to the Privacy Policy and Terms of Service.");
            hasError = true;
        }

        if (hasError) return;

        const submitBtn = signupForm.querySelector(".auth-submit");
        setBusy(submitBtn, true, "Creating account...");

        // Dynamic origin-aware redirect (Task 2)
        const redirectTo = `${window.location.origin}/Auth/login-signup.html`;

        const { data, error } = await client.auth.signUp({
            email,
            password,
            options: {
                data: {
                    full_name: name,
                    name: name,
                    mobile: mobile ? V.normalizeMobile(mobile) : null
                },
                emailRedirectTo: redirectTo
            }
        });

        setBusy(submitBtn, false, "Create my VChat account");

        if (error) {
            showToast(error.message, "fa-solid fa-triangle-exclamation");
            showAuthAlert({
                type: "error",
                title: "Signup could not be completed",
                message: error.message
            });
            return;
        }

        // Store last signup email in storage for easy resend
        localStorage.setItem("vchat_last_signup_email", email);

        pendingAuth = {
            mode: "signup",
            name,
            mobile: mobile ? V.normalizeMobile(mobile) : "",
            email
        };

        if (!data.session) {
            // Standard confirmation required flow
            emailVerified = false;
            showCheckEmailView(pendingAuth);
            showToast("Account created! We sent a confirmation link to " + email, "fa-solid fa-envelope");
            return;
        }

        // Autoconfirmed or immediate session
        await afterAuthenticated(client, pendingAuth);
    });
}

// =============================================
// CONFIRMATION VIEW ACTIONS (Task 3 & 4)
// =============================================

if (otpBackButton) {
    otpBackButton.addEventListener("click", () => {
        if (otpSection) otpSection.hidden = true;
        if (authTabs) authTabs.style.display = "grid";
        if (pendingAuth.mode === "signup") {
            switchToSignup();
        } else {
            switchToLogin();
        }
    });
}

if (alreadyConfirmedBtn) {
    alreadyConfirmedBtn.addEventListener("click", () => {
        if (otpSection) otpSection.hidden = true;
        if (authTabs) authTabs.style.display = "grid";
        switchToLogin();
        showToast("Enter your password to sign in.", "fa-solid fa-arrow-right-to-bracket");
    });
}

// Resend confirmation email button
if (resendOtp) {
    resendOtp.addEventListener("click", async () => {
        const client = requireClient();
        if (!client) return;

        const email = pendingAuth.email
            || (signupEmail && signupEmail.value.trim())
            || (loginEmail && loginEmail.value.trim())
            || localStorage.getItem("vchat_last_signup_email")
            || "";

        if (!email) {
            showToast("No email address found to resend to.", "fa-solid fa-triangle-exclamation");
            return;
        }

        resendOtp.disabled = true;
        try {
            const redirectUrl = `${window.location.origin}/Auth/login-signup.html`;
            const { error } = await client.auth.resend({
                type: "signup",
                email: email,
                options: { emailRedirectTo: redirectUrl }
            });

            if (error) {
                showToast(error.message, "fa-solid fa-triangle-exclamation");
                resendOtp.disabled = false;
                return;
            }

            showToast("A fresh confirmation email was sent to " + email, "fa-solid fa-paper-plane");
            startOtpTimer();
        } catch (err) {
            showToast(err.message || "Could not resend email.", "fa-solid fa-triangle-exclamation");
            resendOtp.disabled = false;
        }
    });
}

// Optional manual 6-digit code accordion
if (toggleManualCodeBtn && manualCodeWrap) {
    toggleManualCodeBtn.addEventListener("click", () => {
        const isCurrentlyHidden = manualCodeWrap.hidden;
        manualCodeWrap.hidden = !isCurrentlyHidden;
        toggleManualCodeBtn.classList.toggle("active", !isCurrentlyHidden);
        if (!isCurrentlyHidden) {
            const firstInput = manualCodeWrap.querySelector("input");
            if (firstInput) firstInput.focus();
        }
    });
}

// Manual OTP digit inputs
document.querySelectorAll(".otp-inputs").forEach((group) => {
    const inputs = Array.from(group.querySelectorAll("input"));
    inputs.forEach((input, index) => {
        input.addEventListener("input", function () {
            this.value = this.value.replace(/\D/g, "").slice(0, 1);
            if (this.value && index < inputs.length - 1) inputs[index + 1].focus();
        });
        input.addEventListener("keydown", function (event) {
            if (event.key === "Backspace" && !this.value && index > 0) inputs[index - 1].focus();
        });
        input.addEventListener("paste", function (event) {
            event.preventDefault();
            const pasted = (event.clipboardData || window.clipboardData).getData("text").replace(/\D/g, "");
            if (!pasted) return;
            pasted.split("").slice(0, inputs.length).forEach((char, i) => { inputs[i].value = char; });
            inputs[Math.min(pasted.length, inputs.length - 1)].focus();
        });
    });
});

if (verifyBothOtp) {
    verifyBothOtp.addEventListener("click", async function () {
        const client = requireClient();
        if (!client) return;

        const otpGroup = document.querySelector(".otp-inputs");
        const code = otpGroup ? Array.from(otpGroup.querySelectorAll("input")).map((i) => i.value).join("") : "";

        if (code.length !== 6) {
            showToast("Please enter a complete 6-digit verification code.", "fa-solid fa-triangle-exclamation");
            return;
        }

        const email = pendingAuth.email
            || (signupEmail && signupEmail.value.trim())
            || (loginEmail && loginEmail.value.trim())
            || localStorage.getItem("vchat_last_signup_email")
            || "";

        if (!email) {
            showToast("Email address unknown. Please sign in or sign up again.", "fa-solid fa-triangle-exclamation");
            return;
        }

        setBusy(this, true, "Verifying...");

        try {
            const { data, error } = await client.auth.verifyOtp({
                email: email,
                token: code,
                type: pendingAuth.mode === "signup" ? "signup" : "email"
            });

            if (error) {
                // Try fallback verification type
                const retry = await client.auth.verifyOtp({
                    email: email,
                    token: code,
                    type: "email"
                });
                if (retry.error) throw error;
            }

            let { data: { session } } = await client.auth.getSession();
            if (session) {
                const { data: { user } } = await client.auth.getUser();
                emailVerified = await syncEmailVerifiedFlag(client, user);
                await ensureProfileMetadata(client, pendingAuth);
                document.querySelectorAll(".otp-inputs input").forEach((i) => i.classList.add("verified"));
                showToast("Email verified! Opening your chats...", "fa-solid fa-circle-check");
                setTimeout(goToChat, 500);
            } else {
                showToast("Email verified successfully! Please log in to VChat.", "fa-solid fa-circle-check");
                setTimeout(switchToLogin, 1000);
            }
        } catch (err) {
            showToast(err.message || "Invalid or expired verification code.", "fa-solid fa-triangle-exclamation");
        } finally {
            setBusy(this, false, "Verify Code");
        }
    });
}

// =============================================
// URL PARAMETER & HASH PARSER (Task 5)
// =============================================

function parseAuthUrlParams() {
    const searchParams = new URLSearchParams(window.location.search || "");
    const hashString = (window.location.hash || "").replace(/^#/, "");
    const hashParams = new URLSearchParams(hashString);

    const get = (key) => hashParams.get(key) || searchParams.get(key) || "";

    return {
        error: get("error"),
        errorCode: get("error_code"),
        errorDescription: get("error_description"),
        type: get("type"),
        tokenHash: get("token_hash") || get("token"),
        accessToken: get("access_token"),
        hasFragmentData: Boolean(
            get("error") || get("error_code") || get("error_description") ||
            get("access_token") || get("token_hash") || get("type")
        )
    };
}

function cleanUrlFragment() {
    try {
        const cleanUrl = window.location.pathname;
        window.history.replaceState(null, document.title, cleanUrl);
    } catch (e) {
        // Fallback if replaceState is not supported
    }
}

// =============================================
// BOOTSTRAP AUTHENTICATION
// =============================================

(async function bootAuth() {
    const api = window.VChat && window.VChat.supabase;
    if (!api || !api.isConfigured()) {
        showToast(api ? api.setupError() : "Supabase library missing.", "fa-solid fa-triangle-exclamation");
        return;
    }

    try {
        const client = api.getClient();
        supabaseClient = client;

        // Parse any auth error or response tokens from URL query / hash
        const parsed = parseAuthUrlParams();

        if (parsed.hasFragmentData) {
            // 1. Handle error cases gracefully (Task 5)
            if (parsed.errorCode || parsed.error) {
                const code = (parsed.errorCode || "").toLowerCase();
                const desc = parsed.errorDescription || "";

                if (code === "otp_expired" || desc.toLowerCase().includes("expired") || desc.toLowerCase().includes("invalid")) {
                    const rememberedEmail = localStorage.getItem("vchat_last_signup_email") || "";
                    showAuthAlert({
                        type: "warning",
                        title: "Verification link invalid or already used",
                        message: "That verification link is invalid or has already been used. If your account was already confirmed, you can sign in directly. Otherwise, request a new confirmation email below.",
                        showResend: true,
                        showLogin: true,
                        email: rememberedEmail
                    });
                } else if (code === "access_denied") {
                    showAuthAlert({
                        type: "error",
                        title: "Access denied",
                        message: desc || "Access was denied during verification. Please request a new confirmation link.",
                        showResend: true,
                        showLogin: true
                    });
                } else {
                    showAuthAlert({
                        type: "error",
                        title: "Authentication notice",
                        message: desc || "An authentication error occurred. Please try signing in again.",
                        showLogin: true
                    });
                }

                // Clean the raw error from URL bar
                cleanUrlFragment();
            } else if (parsed.accessToken) {
                // Successful confirmation / OAuth redirect token received
                showToast("Email verified successfully! Connecting to VChat...", "fa-solid fa-circle-check");
                cleanUrlFragment();
            }
        }

        // Listen for live Supabase Auth events
        client.auth.onAuthStateChange(async (event, session) => {
            if (event === "PASSWORD_RECOVERY") {
                showToast("Password recovery session verified.", "fa-solid fa-key");
                const newPass = window.prompt("Enter your new VChat password (at least 8 chars):");
                if (newPass) {
                    if (V && V.isValidPassword && !V.isValidPassword(newPass)) {
                        showToast("Password must have at least 8 characters.", "fa-solid fa-triangle-exclamation");
                    } else {
                        const { error } = await client.auth.updateUser({ password: newPass });
                        if (error) {
                            showToast(error.message, "fa-solid fa-triangle-exclamation");
                        } else {
                            showToast("Password updated successfully! Logging you in...", "fa-solid fa-circle-check");
                            if (session) {
                                await afterAuthenticated(client, {
                                    mode: "login",
                                    email: session.user.email,
                                    name: session.user.user_metadata?.full_name || ""
                                });
                            }
                        }
                    }
                }
            } else if (event === "SIGNED_IN" && session) {
                cleanUrlFragment();
                await afterAuthenticated(client, {
                    mode: "login",
                    email: session.user.email,
                    name: session.user.user_metadata?.full_name || ""
                });
            }
        });

        // Check if an existing session is already active
        const { data: { session } } = await client.auth.getSession();
        if (session) {
            cleanUrlFragment();
            await afterAuthenticated(client, {
                mode: "login",
                email: session.user.email,
                name: session.user.user_metadata?.full_name || ""
            });
        }
    } catch (err) {
        showToast(err.message || "Could not start authentication.", "fa-solid fa-triangle-exclamation");
    }
})();
