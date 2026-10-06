/* =============================================
   VCHAT AUTHENTICATION — Supabase Auth
============================================= */

const loginForm = document.getElementById("loginForm");
const signupForm = document.getElementById("signupForm");
const loginTab = document.getElementById("loginTab");
const signupTab = document.getElementById("signupTab");
const authTitle = document.getElementById("authTitle");
const authSubtitle = document.getElementById("authSubtitle");
const authTabs = document.querySelector(".auth-tabs");

const loginMobile = document.getElementById("loginMobile");
const loginEmail = document.getElementById("loginEmail");
const loginPassword = document.getElementById("loginPassword");

const signupName = document.getElementById("signupName");
const signupMobile = document.getElementById("signupMobile");
const signupEmail = document.getElementById("signupEmail");
const signupPassword = document.getElementById("signupPassword");
const signupTerms = document.getElementById("signupTerms");

const loginOtpButton = document.getElementById("loginOtpButton");
const forgotPasswordLink = document.getElementById("forgotPasswordLink");

const otpSection = document.getElementById("otpSection");
const otpBackButton = document.getElementById("otpBackButton");
const verifyBothOtp = document.getElementById("verifyBothOtp");
const mobileOtpDestination = document.getElementById("mobileOtpDestination");
const emailOtpDestination = document.getElementById("emailOtpDestination");
const otpTimer = document.getElementById("otpTimer");
const resendOtp = document.getElementById("resendOtp");
const mobileOtpStatus = document.getElementById("mobileOtpStatus");
const emailOtpStatus = document.getElementById("emailOtpStatus");
const otpNote = document.querySelector(".otp-note");
const otpIntro = otpSection ? otpSection.querySelector(".otp-header p") : null;

const V = window.VChatValidators;
const Dom = window.VChatDom;

let pendingAuth = { mode: "login", name: "", mobile: "", email: "" };
let otpCountdown = 30;
let otpInterval = null;
let emailVerified = false;
let mobileVerified = false;
let supabaseClient = null;

function showToast(message, icon) {
    Dom.showToast("auth-toast", message, icon);
}

function setBusy(button, busy, label) {
    if (!button) return;
    button.disabled = !!busy;
    if (label) {
        const span = button.querySelector("span");
        if (span) span.textContent = label;
    }
}

function setFieldError(inputElement, message) {
    clearFieldError(inputElement);
    const container = inputElement.closest(".input-wrapper") || inputElement.closest(".phone-input") || inputElement.closest(".check-row") || inputElement.parentElement;
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
    const container = inputElement.closest(".input-wrapper") || inputElement.closest(".phone-input") || inputElement.closest(".check-row") || inputElement.parentElement;
    if (container) container.classList.remove("has-error");
    const formGroup = inputElement.closest(".form-group") || inputElement.closest(".check-row")?.parentElement;
    if (formGroup) formGroup.querySelectorAll(".form-error").forEach((el) => el.remove());
}

function clearAllErrors(form) {
    if (!form) return;
    form.querySelectorAll(".has-error").forEach((el) => el.classList.remove("has-error"));
    form.querySelectorAll(".form-error").forEach((el) => el.remove());
}

[loginMobile, loginEmail, loginPassword, signupName, signupMobile, signupEmail, signupPassword].forEach((input) => {
    if (input) input.addEventListener("input", () => clearFieldError(input));
});
if (signupTerms) signupTerms.addEventListener("change", () => clearFieldError(signupTerms));

function switchToLogin() {
    loginTab.classList.add("active");
    signupTab.classList.remove("active");
    loginForm.classList.add("active-form");
    loginForm.style.display = "block";
    signupForm.classList.remove("active-form");
    signupForm.style.display = "none";
    authTitle.textContent = "Welcome back";
    authSubtitle.textContent = "Sign in to continue your conversations.";
    clearAllErrors(loginForm);
    clearAllErrors(signupForm);
}

function switchToSignup() {
    signupTab.classList.add("active");
    loginTab.classList.remove("active");
    signupForm.classList.add("active-form");
    signupForm.style.display = "block";
    loginForm.classList.remove("active-form");
    loginForm.style.display = "none";
    authTitle.textContent = "Create account";
    authSubtitle.textContent = "Join VChat and start connecting today.";
    clearAllErrors(loginForm);
    clearAllErrors(signupForm);
}

if (loginTab && signupTab) {
    loginTab.addEventListener("click", switchToLogin);
    signupTab.addEventListener("click", switchToSignup);
}

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

function requireClient() {
    const api = window.VChat && window.VChat.supabase;
    if (!api || !api.isConfigured()) {
        showToast(api ? api.setupError() : "Supabase client missing.", "fa-solid fa-triangle-exclamation");
        return null;
    }
    if (!supabaseClient) supabaseClient = api.getClient();
    return supabaseClient;
}

function maskMobile(mobile) {
    const clean = V.normalizeMobile(mobile);
    if (clean.length < 4) return "+91 " + clean;
    return "+91 " + clean.slice(0, 2) + "******" + clean.slice(-2);
}

function maskEmail(email) {
    const parts = String(email || "").split("@");
    if (parts.length !== 2) return email;
    const [name, domain] = parts;
    if (name.length <= 2) return name[0] + "*@" + domain;
    return name.slice(0, 2) + "*".repeat(Math.max(name.length - 2, 2)) + "@" + domain;
}

function getOtp(group) {
    if (!group) return "";
    return Array.from(group.querySelectorAll("input")).map((i) => i.value).join("");
}

function startOtpTimer() {
    clearInterval(otpInterval);
    otpCountdown = 30;
    if (resendOtp) resendOtp.disabled = true;
    if (otpTimer) otpTimer.textContent = `Resend available in ${otpCountdown}s`;
    otpInterval = setInterval(() => {
        otpCountdown -= 1;
        if (otpCountdown <= 0) {
            clearInterval(otpInterval);
            if (otpTimer) otpTimer.textContent = "You can now request a new code.";
            if (resendOtp) resendOtp.disabled = false;
            return;
        }
        if (otpTimer) otpTimer.textContent = `Resend available in ${otpCountdown}s`;
    }, 1000);
}

function setVerifyStatus(el, ok, label) {
    if (!el) return;
    el.textContent = label;
    el.style.color = ok ? "#00c853" : "";
}

async function loadProfile(client) {
    const { data: { user } } = await client.auth.getUser();
    if (!user) return { user: null, profile: null };
    const { data } = await client
        .from("profiles")
        .select("id, full_name, display_name, name, about, bio, mobile, phone, email, avatar_url, last_seen_at, mobile_verified, mobile_verified_at, email_verified, email_verified_at")
        .eq("id", user.id)
        .maybeSingle();
    return { user, profile: window.VChat.supabase.mapProfile(data) };
}

function goToChat() {
    window.location.replace("../Chat/chat.html");
}

async function ensureProfileMetadata(client, extra) {
    const { data: { user } } = await client.auth.getUser();
    if (!user) return;
    const meta = user.user_metadata || {};
    const payload = {};
    if (extra.name && !meta.full_name) payload.full_name = extra.name;
    if (extra.mobile && !meta.mobile) payload.mobile = extra.mobile;
    if (Object.keys(payload).length) {
        await client.auth.updateUser({ data: payload });
    }
    const { data: existing } = await client.from("profiles").select("id, mobile").eq("id", user.id).maybeSingle();
    if (!existing) {
        await client.from("profiles").insert({
            id: user.id,
            full_name: extra.name || meta.full_name || meta.name || user.email,
            mobile: extra.mobile || meta.mobile || null,
            email: user.email
        });
    } else if (!existing.mobile && extra.mobile) {
        await client.from("profiles").update({ mobile: extra.mobile }).eq("id", user.id);
    }
}

async function sendMobileCode(client) {
    const { data, error } = await client.rpc("send_mobile_otp");
    if (error) throw error;
    const cfg = window.VChat.supabase.getConfig();
    if (data && data.dev_code && cfg.devMobileOtp) {
        showToast("Development mock mobile code (not SMS): " + data.dev_code, "fa-solid fa-flask");
        if (otpIntro) {
            otpIntro.textContent = "Email uses your Supabase inbox. Mobile uses a development mock code shown here — this is not real SMS.";
        }
    } else if (data && data.channel === "pending_sms_provider") {
        showToast("Mobile SMS is not configured yet. Enable development mock OTP in SQL (app_runtime_config) or connect an SMS provider.", "fa-solid fa-circle-info");
    }
    return data;
}

async function syncEmailVerifiedFlag(client, user) {
    const confirmed = !!(user && (user.email_confirmed_at || user.confirmed_at));
    emailVerified = confirmed;
    if (confirmed) {
        await client.from("profiles").update({
            email_verified: true,
            email_verified_at: user.email_confirmed_at || new Date().toISOString()
        }).eq("id", user.id);
        setVerifyStatus(emailOtpStatus, true, "Verified");
    }
    return confirmed;
}

function maybeContinue() {
    if (emailVerified && mobileVerified) {
        showToast("Verified. Opening your chats...", "fa-solid fa-circle-check");
        setTimeout(goToChat, 400);
        return true;
    }
    return false;
}

function showOtpVerification(data) {
    pendingAuth = data;
    loginForm.style.display = "none";
    signupForm.style.display = "none";
    if (authTabs) authTabs.style.display = "none";
    otpSection.hidden = false;
    if (mobileOtpDestination) mobileOtpDestination.textContent = maskMobile(data.mobile);
    if (emailOtpDestination) emailOtpDestination.textContent = maskEmail(data.email);
    document.querySelectorAll(".otp-inputs input").forEach((input) => {
        input.value = "";
        input.classList.remove("verified");
    });
    const firstInput = document.querySelector(".otp-inputs input");
    if (firstInput) firstInput.focus();
    setVerifyStatus(mobileOtpStatus, mobileVerified, mobileVerified ? "Verified" : "Not verified");
    setVerifyStatus(emailOtpStatus, emailVerified, emailVerified ? "Verified" : "Not verified");
    if (otpNote) {
        otpNote.textContent = "";
        const lock = document.createElement("i");
        lock.className = "fa-solid fa-lock";
        otpNote.appendChild(lock);
        otpNote.appendChild(document.createTextNode(" Email and mobile must both be verified before chat access."));
    }
    startOtpTimer();
}

async function afterAuthenticated(client, extras) {
    await ensureProfileMetadata(client, extras || {});
    const { user, profile } = await loadProfile(client);
    emailVerified = await syncEmailVerifiedFlag(client, user);
    mobileVerified = !!(profile && profile.mobileVerified);
    if (emailVerified && mobileVerified) {
        goToChat();
        return;
    }
    showOtpVerification({
        mode: extras && extras.mode ? extras.mode : "login",
        name: (profile && profile.name) || (extras && extras.name) || "",
        mobile: (profile && profile.mobile) || (extras && extras.mobile) || "",
        email: user.email
    });
    const capture = document.getElementById("otpMobileCapture");
    if (capture) {
        capture.hidden = !!(profile && profile.mobile);
        if (profile && profile.mobile) capture.value = profile.mobile;
    }
    if (!mobileVerified) {
        try {
            if (!(profile && profile.mobile) && extras && extras.mobile) {
                await client.from("profiles").update({ mobile: V.normalizeMobile(extras.mobile) }).eq("id", user.id);
            }
            if ((profile && profile.mobile) || (extras && extras.mobile)) {
                await sendMobileCode(client);
            } else {
                showToast("Enter your 10-digit mobile number below, then tap Resend OTP.", "fa-solid fa-mobile-screen");
            }
        } catch (err) {
            showToast(err.message || "Could not send mobile verification.", "fa-solid fa-triangle-exclamation");
        }
    }
}

if (forgotPasswordLink) {
    forgotPasswordLink.addEventListener("click", async (e) => {
        e.preventDefault();
        const client = requireClient();
        if (!client) return;
        const email = (loginEmail && loginEmail.value.trim()) || "";
        if (!V.isValidEmail(email)) {
            setFieldError(loginEmail, "Enter the email for your account first.");
            return;
        }
        const { error } = await client.auth.resetPasswordForEmail(email, {
            redirectTo: window.VChat.supabase.authRedirectTo()
        });
        if (error) {
            showToast(error.message, "fa-solid fa-triangle-exclamation");
            return;
        }
        showToast("If that email is registered, a reset link is on its way.", "fa-solid fa-envelope");
    });
}

document.querySelectorAll(".social-button").forEach((button) => {
    const isGoogle = button.textContent.toLowerCase().includes("google") || button.querySelector(".fa-google");
    if (isGoogle) {
        button.id = button.id || (button.closest("#signupForm") ? "googleSignupBtn" : "googleLoginBtn");
        button.addEventListener("click", async () => {
            const client = requireClient();
            if (!client) return;
            const { error } = await client.auth.signInWithOAuth({
                provider: "google",
                options: {
                    redirectTo: window.VChat.supabase.authRedirectTo(),
                    queryParams: { access_type: "offline", prompt: "consent" }
                }
            });
            if (error) showToast(error.message, "fa-solid fa-triangle-exclamation");
        });
    } else {
        button.addEventListener("click", () => {
            showToast("Apple Sign In is not enabled in this VChat version.", "fa-brands fa-apple");
        });
    }
});

if (loginForm) {
    loginForm.addEventListener("submit", async function (event) {
        event.preventDefault();
        clearAllErrors(this);
        const client = requireClient();
        if (!client) return;

        const mobile = loginMobile.value.trim();
        const email = loginEmail.value.trim();
        const password = loginPassword.value;
        let hasError = false;

        if (mobile && !V.isValidMobile(mobile)) {
            setFieldError(loginMobile, "Enter a valid 10-digit Indian mobile number.");
            hasError = true;
        }
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
            showToast(error.message, "fa-solid fa-triangle-exclamation");
            return;
        }
        if (!data.session) {
            showToast("Check your email to confirm this account, then sign in again.", "fa-solid fa-envelope");
            showOtpVerification({ mode: "login", name: "", mobile, email });
            return;
        }
        await afterAuthenticated(client, { mode: "login", mobile, email });
    });
}

if (loginOtpButton) {
    loginOtpButton.addEventListener("click", async () => {
        const client = requireClient();
        if (!client) return;
        const { data: { session } } = await client.auth.getSession();
        if (!session) {
            showToast("Passwordless SMS login needs a production SMS provider. Sign in with email and password, or use Google.", "fa-solid fa-circle-info");
            return;
        }
        await afterAuthenticated(client, {
            mode: "login",
            mobile: loginMobile.value.trim(),
            email: loginEmail.value.trim() || session.user.email
        });
    });
}

if (signupForm) {
    signupForm.addEventListener("submit", async function (event) {
        event.preventDefault();
        clearAllErrors(this);
        const client = requireClient();
        if (!client) return;

        const name = signupName.value.trim();
        const mobile = signupMobile.value.trim();
        const email = signupEmail.value.trim();
        const password = signupPassword.value;
        let hasError = false;

        if (!V.isValidName(name)) {
            setFieldError(signupName, "Please enter your full name (2–80 characters).");
            hasError = true;
        }
        if (!V.isValidMobile(mobile)) {
            setFieldError(signupMobile, "Enter a valid 10-digit mobile number.");
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
        const { data, error } = await client.auth.signUp({
            email,
            password,
            options: {
                data: { full_name: name, name, mobile: V.normalizeMobile(mobile) },
                emailRedirectTo: window.VChat.supabase.authRedirectTo()
            }
        });
        setBusy(submitBtn, false, "Create my VChat account");
        if (error) {
            showToast(error.message, "fa-solid fa-triangle-exclamation");
            return;
        }
        pendingAuth = { mode: "signup", name, mobile, email };
        if (!data.session) {
            emailVerified = false;
            mobileVerified = false;
            showOtpVerification(pendingAuth);
            showToast("Account created. Enter the email code from Supabase, then verify mobile.", "fa-solid fa-envelope");
            return;
        }
        await afterAuthenticated(client, { mode: "signup", name, mobile, email });
    });
}

if (otpBackButton) {
    otpBackButton.addEventListener("click", () => {
        otpSection.hidden = true;
        if (authTabs) authTabs.style.display = "grid";
        if (pendingAuth.mode === "signup") switchToSignup();
        else switchToLogin();
    });
}

if (resendOtp) {
    resendOtp.addEventListener("click", async () => {
        const client = requireClient();
        if (!client) return;
        try {
            if (!emailVerified && pendingAuth.email) {
                await client.auth.resend({ type: "signup", email: pendingAuth.email });
            }
            const { data: { session } } = await client.auth.getSession();
            const capture = document.getElementById("otpMobileCapture");
            if (session && capture && capture.value && V.isValidMobile(capture.value)) {
                await client.from("profiles").update({ mobile: V.normalizeMobile(capture.value) }).eq("id", session.user.id);
            }
            if (session && !mobileVerified) await sendMobileCode(client);
            showToast("A new verification email/code was requested.", "fa-solid fa-paper-plane");
            startOtpTimer();
        } catch (err) {
            showToast(err.message || "Could not resend.", "fa-solid fa-triangle-exclamation");
        }
    });
}

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
        const otpGroups = document.querySelectorAll(".otp-inputs");
        const mobileOtp = getOtp(otpGroups[0]);
        const emailOtp = getOtp(otpGroups[1]);

        this.disabled = true;
        const label = this.querySelector("span");
        const previous = label ? label.textContent : "";
        if (label) label.textContent = "Verifying...";

        try {
            let { data: { session } } = await client.auth.getSession();

            if (!emailVerified) {
                if (emailOtp.length === 6) {
                    const { error } = await client.auth.verifyOtp({
                        email: pendingAuth.email,
                        token: emailOtp,
                        type: pendingAuth.mode === "signup" ? "signup" : "email"
                    });
                    if (error) {
                        const retry = await client.auth.verifyOtp({
                            email: pendingAuth.email,
                            token: emailOtp,
                            type: "email"
                        });
                        if (retry.error) throw error;
                    }
                    ({ data: { session } } = await client.auth.getSession());
                } else if (!session) {
                    throw new Error("Enter the 6-digit email code from your inbox (or open the confirmation link).");
                }
            }

            if (session) {
                const { data: { user } } = await client.auth.getUser();
                emailVerified = await syncEmailVerifiedFlag(client, user);
                await ensureProfileMetadata(client, pendingAuth);
                if (!mobileVerified && mobileOtp.length === 6) {
                    const { error } = await client.rpc("verify_mobile_otp", { p_code: mobileOtp });
                    if (error) throw error;
                    mobileVerified = true;
                    setVerifyStatus(mobileOtpStatus, true, "Verified");
                } else if (!mobileVerified) {
                    throw new Error("Enter the complete 6-digit mobile code.");
                }
            }

            document.querySelectorAll(".otp-inputs input").forEach((i) => i.classList.add("verified"));
            if (!maybeContinue()) {
                showToast(
                    !emailVerified ? "Email is not verified yet." : "Mobile is not verified yet.",
                    "fa-solid fa-triangle-exclamation"
                );
            }
        } catch (err) {
            showToast(err.message || "Verification failed.", "fa-solid fa-triangle-exclamation");
        } finally {
            this.disabled = false;
            if (label) label.textContent = previous || "Verify & Continue";
        }
    });
}

(async function bootAuth() {
    const api = window.VChat && window.VChat.supabase;
    if (!api || !api.isConfigured()) {
        showToast(api ? api.setupError() : "Supabase library missing.", "fa-solid fa-triangle-exclamation");
        return;
    }
    try {
        const client = api.getClient();
        supabaseClient = client;
        const params = new URLSearchParams(window.location.search);
        if (params.get("error_description")) {
            showToast(params.get("error_description"), "fa-solid fa-triangle-exclamation");
        }
        const { data: { session } } = await client.auth.getSession();
        if (session) await afterAuthenticated(client, { mode: "login", email: session.user.email, name: session.user.user_metadata?.full_name || "" });
    } catch (err) {
        showToast(err.message || "Could not start authentication.", "fa-solid fa-triangle-exclamation");
    }
})();
