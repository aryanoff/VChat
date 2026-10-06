/* =============================================
   VCHAT CHAT — Supabase-backed messaging
============================================= */

const PAGE_SIZE = 40;
const V = window.VChatValidators;
const Dom = window.VChatDom;
const api = window.VChat && window.VChat.supabase;

const chatApp = document.querySelector(".chat-app");
const conversationList = document.getElementById("conversationList");
const chatSearch = document.getElementById("chatSearch");
const noSearchResult = document.getElementById("noSearchResult");
const filterButtons = document.querySelectorAll(".chat-filter");
const messageInput = document.getElementById("messageInput");
const sendButton = document.getElementById("sendButton");
const chatMessages = document.getElementById("chatMessages");
const typingIndicator = document.getElementById("typingIndicator");
const currentUserName = document.getElementById("currentUserName");
const currentUserInitials = document.getElementById("currentUserInitials");
const profileButton = document.getElementById("profileButton");
const activeChatName = document.getElementById("activeChatName");
const activeChatStatus = document.getElementById("activeChatStatus");
const activeUserButton = document.getElementById("activeUserButton");
const detailsPanel = document.getElementById("detailsPanel");
const detailsButton = document.getElementById("detailsButton");
const closeDetailsButton = document.getElementById("closeDetailsButton");
const mobileBackButton = document.getElementById("mobileBackButton");
const newChatButton = document.getElementById("newChatButton");
const newChatModal = document.getElementById("newChatModal");
const closeNewChat = document.getElementById("closeNewChat");
const newChatNumber = document.getElementById("newChatNumber");
const newChatValidation = document.getElementById("newChatValidation");
const findUserBtn = document.getElementById("findUserBtn");
const newChatResult = document.getElementById("newChatResult");
const logoutButton = document.getElementById("logoutButton");
const fileInput = document.getElementById("fileInput");
const attachmentButton = document.getElementById("attachmentButton");
const videoCallButton = document.getElementById("videoCallButton");
const audioCallButton = document.getElementById("audioCallButton");
const emojiButton = document.getElementById("emojiButton");
const voiceButton = document.getElementById("voiceButton");
const chatSearchButton = document.getElementById("chatSearchButton");
const sidebarMenuButton = document.getElementById("sidebarMenuButton");

let client = null;
let currentUser = null;
let currentProfile = null;
let conversations = [];
let activeConversationId = null;
let activePeer = null;
let oldestCursor = null;
let loadingOlder = false;
let hasMore = true;
let renderedIds = new Set();
let messageChannel = null;
let inboxChannel = null;
let typingChannel = null;
let presenceChannel = null;
let typingTimer = null;
let peerReadAt = null;
let onlinePeers = new Set();
let currentFilter = "all";
let blockedIds = new Set();
let sending = false;

function showToast(message, icon) {
    Dom.showToast("chat-toast", message, icon);
}

function redirectLogin() {
    window.location.replace("../Auth/login-signup.html");
}

function setStatus(text, online) {
    if (!activeChatStatus) return;
    Dom.clear(activeChatStatus);
    const i = document.createElement("i");
    if (online) i.className = "status-online-dot";
    activeChatStatus.appendChild(i);
    activeChatStatus.appendChild(document.createTextNode(" " + text));
}

function connectionBanner(state) {
    let bar = document.getElementById("connectionBanner");
    if (!bar) {
        bar = document.createElement("div");
        bar.id = "connectionBanner";
        bar.className = "connection-banner";
        document.body.appendChild(bar);
    }
    if (state === "online") {
        bar.hidden = true;
        return;
    }
    bar.hidden = false;
    bar.textContent = state === "offline"
        ? "You are offline. Messages will send when you reconnect."
        : "Reconnecting to VChat…";
}

async function requireSession() {
    if (!api || !api.isConfigured()) {
        showToast(api ? api.setupError() : "Supabase is missing.", "fa-solid fa-triangle-exclamation");
        setTimeout(redirectLogin, 1200);
        throw new Error("not configured");
    }
    client = api.getClient();
    const { data: { session } } = await client.auth.getSession();
    if (!session) {
        redirectLogin();
        throw new Error("no session");
    }
    currentUser = session.user;
    const { data } = await client
        .from("profiles")
        .select("id, full_name, display_name, name, about, bio, mobile, phone, email, avatar_url, last_seen_at, mobile_verified, mobile_verified_at, email_verified, email_verified_at")
        .eq("id", currentUser.id)
        .maybeSingle();
    currentProfile = api.mapProfile(data) || {
        id: currentUser.id,
        name: currentUser.user_metadata?.full_name || currentUser.email,
        about: "Hey there! I am using VChat.",
        mobile: currentUser.user_metadata?.mobile || "",
        email: currentUser.email,
        avatarUrl: "",
        mobileVerified: false
    };
    if (!currentUser.email_confirmed_at && !currentProfile.emailVerified) {
        showToast("Verify your email before using chat.", "fa-solid fa-envelope");
        redirectLogin();
        throw new Error("unverified email");
    }
    if (!currentProfile.mobileVerified) {
        showToast("Verify your mobile number before using chat.", "fa-solid fa-mobile-screen");
        redirectLogin();
        throw new Error("unverified mobile");
    }
    if (currentUserName) currentUserName.textContent = currentProfile.name;
    if (currentUserInitials) currentUserInitials.textContent = Dom.initials(currentProfile.name);
    const avatarWrap = profileButton && profileButton.querySelector(".user-avatar");
    if (avatarWrap && currentProfile.avatarUrl) {
        applyAvatar(avatarWrap, currentProfile.avatarUrl, currentProfile.name);
    }
}

function applyAvatar(container, url, name) {
    if (!container) return;
    const online = container.querySelector(".avatar-online, .large-online");
    Dom.clear(container);
    if (url) {
        const img = document.createElement("img");
        img.src = url;
        img.alt = name || "Avatar";
        container.appendChild(img);
    } else {
        container.appendChild(document.createTextNode(Dom.initials(name)));
    }
    if (online) container.appendChild(online);
    else {
        const span = document.createElement("span");
        span.className = container.classList.contains("large-avatar") ? "large-online" : "avatar-online";
        container.appendChild(span);
    }
}

function emptyConversationList() {
    if (!conversationList) return;
    conversationList.querySelectorAll(".conversation-item").forEach((el) => el.remove());
}

async function loadBlocked() {
    const { data } = await client
        .from("blocked_users")
        .select("blocked_id")
        .eq("blocker_id", currentUser.id);
    blockedIds = new Set((data || []).map((row) => row.blocked_id));
}

async function loadConversations() {
    const { data, error } = await client.rpc("list_my_conversations");
    if (error) {
        showToast(error.message, "fa-solid fa-triangle-exclamation");
        return;
    }
    conversations = (data || []).sort((a, b) => {
        return new Date(b.last_message_at || 0) - new Date(a.last_message_at || 0);
    });
    renderConversationList();
}

function renderConversationList() {
    emptyConversationList();
    const query = (chatSearch && chatSearch.value.trim().toLowerCase()) || "";
    let visible = 0;
    conversations.forEach((row) => {
        const name = row.peer_name || row.title || "Chat";
        const isGroup = !!row.is_group;
        if (currentFilter === "unread" && !(row.unread_count > 0)) return;
        if (currentFilter === "groups" && !isGroup) return;
        if (query && !name.toLowerCase().includes(query)) return;
        visible += 1;
        const item = document.createElement("button");
        item.type = "button";
        item.className = "conversation-item" + (row.conversation_id === activeConversationId ? " active" : "");
        item.dataset.id = row.conversation_id;
        item.dataset.name = name;
        item.dataset.type = isGroup ? "group" : "personal";

        const avatar = document.createElement("div");
        avatar.className = "user-avatar " + Dom.avatarClass(name);
        if (row.peer_avatar) {
            const img = document.createElement("img");
            img.src = row.peer_avatar;
            img.alt = name;
            avatar.appendChild(img);
        } else {
            avatar.textContent = Dom.initials(name);
        }
        if (row.peer_id && onlinePeers.has(row.peer_id)) {
            const dot = document.createElement("span");
            dot.className = "avatar-online";
            avatar.appendChild(dot);
        }

        const content = document.createElement("div");
        content.className = "conversation-content";
        const top = document.createElement("div");
        top.className = "conversation-top";
        const strong = document.createElement("strong");
        strong.textContent = name;
        const time = document.createElement("span");
        time.textContent = Dom.formatTime(row.last_message_at);
        top.appendChild(strong);
        top.appendChild(time);
        const bottom = document.createElement("div");
        bottom.className = "conversation-bottom";
        const p = document.createElement("p");
        p.textContent = row.last_message_preview || "New conversation";
        bottom.appendChild(p);
        if (row.unread_count > 0 && row.conversation_id !== activeConversationId) {
            const badge = document.createElement("span");
            badge.className = "unread-count";
            badge.textContent = String(row.unread_count);
            bottom.appendChild(badge);
        }
        content.appendChild(top);
        content.appendChild(bottom);
        item.appendChild(avatar);
        item.appendChild(content);
        conversationList.insertBefore(item, noSearchResult || null);
    });
    if (noSearchResult) noSearchResult.hidden = visible !== 0;
}

function resetThreadShell() {
    if (!chatMessages) return;
    Dom.clear(chatMessages);
    const pattern = document.createElement("div");
    pattern.className = "chat-pattern";
    pattern.setAttribute("aria-hidden", "true");
    chatMessages.appendChild(pattern);
    const loadOlder = document.createElement("button");
    loadOlder.type = "button";
    loadOlder.id = "loadOlderBtn";
    loadOlder.className = "load-older-btn";
    loadOlder.textContent = "Load older messages";
    loadOlder.addEventListener("click", () => loadMessages(true));
    chatMessages.appendChild(loadOlder);
    const notice = document.createElement("div");
    notice.className = "secure-notice";
    const lock = document.createElement("i");
    lock.className = "fa-solid fa-lock";
    notice.appendChild(lock);
    notice.appendChild(document.createTextNode(" Messages are stored in your Supabase project with RLS. This is not end-to-end encryption."));
    chatMessages.appendChild(notice);
}

function messageStatusTicks(msg) {
    if (msg.sender_id !== currentUser.id) return "";
    if (msg._failed) return " !";
    if (msg._sending) return " …";
    if (peerReadAt && new Date(msg.created_at) <= new Date(peerReadAt)) return " ✓✓";
    return " ✓";
}

function appendMessage(msg, prepend) {
    if (!msg || renderedIds.has(msg.id)) return;
    if (msg.id) renderedIds.add(msg.id);
    const wrap = document.createElement("div");
    wrap.className = "message " + (msg.sender_id === currentUser.id ? "sent" : "received");
    wrap.dataset.id = msg.id || msg.client_id || "";
    const bubble = document.createElement("div");
    bubble.className = "message-bubble";
    if (msg.message_type === "image" && msg._url) {
        const img = document.createElement("img");
        img.className = "message-image";
        img.src = msg._url;
        img.alt = msg.content || "Image";
        bubble.appendChild(img);
    }
    if (msg.message_type === "file" || (msg.message_type === "image" && msg.content)) {
        const p = document.createElement("p");
        const icon = document.createElement("i");
        icon.className = "fa-solid fa-paperclip";
        p.appendChild(icon);
        p.appendChild(document.createTextNode(" " + (msg.content || "Attachment")));
        bubble.appendChild(p);
    } else if (msg.message_type !== "image") {
        const p = document.createElement("p");
        p.textContent = msg.content || "";
        bubble.appendChild(p);
    }
    const meta = document.createElement("div");
    meta.className = "message-meta";
    const time = document.createElement("time");
    time.textContent = Dom.formatTime(msg.created_at);
    meta.appendChild(time);
    if (msg.sender_id === currentUser.id) {
        const read = document.createElement("span");
        read.className = "message-read";
        read.textContent = messageStatusTicks(msg);
        meta.appendChild(read);
    }
    bubble.appendChild(meta);
    wrap.appendChild(bubble);
    if (prepend) {
        const btn = document.getElementById("loadOlderBtn");
        chatMessages.insertBefore(wrap, btn ? btn.nextSibling : chatMessages.firstChild);
    } else {
        chatMessages.appendChild(wrap);
        if (typingIndicator && typingIndicator.parentNode !== chatMessages) {
            chatMessages.appendChild(typingIndicator);
        } else if (typingIndicator) {
            chatMessages.appendChild(typingIndicator);
        }
    }
}

function scrollMessagesToBottom() {
    if (chatMessages) chatMessages.scrollTop = chatMessages.scrollHeight;
}

async function hydrateAttachment(msg) {
    if (msg.message_type !== "image" && msg.message_type !== "file") return msg;
    const { data } = await client
        .from("attachments")
        .select("storage_path, filename, mime_type, size_bytes")
        .eq("message_id", msg.id)
        .maybeSingle();
    if (!data) return msg;
    const { data: signed } = await client.storage.from("chat-attachments").createSignedUrl(data.storage_path, 3600);
    msg._url = signed && signed.signedUrl;
    msg.content = msg.content || data.filename;
    return msg;
}

async function loadMessages(older) {
    if (!activeConversationId || loadingOlder) return;
    loadingOlder = true;
    const loadBtn = document.getElementById("loadOlderBtn");
    if (loadBtn && older) loadBtn.textContent = "Loading…";
    let query = client
        .from("messages")
        .select("id, conversation_id, sender_id, content, message_type, created_at, client_id")
        .eq("conversation_id", activeConversationId)
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .limit(PAGE_SIZE);
    if (older && oldestCursor) query = query.lt("created_at", oldestCursor);
    const { data, error } = await query;
    loadingOlder = false;
    if (error) {
        showToast(error.message, "fa-solid fa-triangle-exclamation");
        if (loadBtn) loadBtn.textContent = "Load older messages";
        return;
    }
    const batch = (data || []).slice().reverse();
    hasMore = (data || []).length === PAGE_SIZE;
    if (loadBtn) loadBtn.hidden = !hasMore;
    if (!older) {
        resetThreadShell();
        renderedIds = new Set();
        if (typingIndicator) chatMessages.appendChild(typingIndicator);
    }
    if (batch.length) oldestCursor = batch[0].created_at;
    for (const msg of batch) {
        await hydrateAttachment(msg);
        appendMessage(msg, older);
    }
    if (!older) scrollMessagesToBottom();
    if (loadBtn && hasMore) loadBtn.textContent = "Load older messages";
}

async function refreshPeerRead() {
    if (!activeConversationId) return;
    const { data } = await client.rpc("get_peer_read_at", { p_conversation_id: activeConversationId });
    peerReadAt = data || null;
    chatMessages.querySelectorAll(".message.sent").forEach((node) => {
        const id = node.dataset.id;
        const tick = node.querySelector(".message-read");
        if (!tick) return;
        tick.textContent = peerReadAt ? " ✓✓" : " ✓";
    });
}

function unsubscribeConversation() {
    if (messageChannel) {
        client.removeChannel(messageChannel);
        messageChannel = null;
    }
    if (typingChannel) {
        client.removeChannel(typingChannel);
        typingChannel = null;
    }
}

function subscribeConversation(id) {
    unsubscribeConversation();
    messageChannel = client
        .channel("messages:" + id)
        .on("postgres_changes", {
            event: "INSERT",
            schema: "public",
            table: "messages",
            filter: "conversation_id=eq." + id
        }, async (payload) => {
            const msg = payload.new;
            if (renderedIds.has(msg.id)) return;
            await hydrateAttachment(msg);
            appendMessage(msg, false);
            scrollMessagesToBottom();
            if (msg.sender_id !== currentUser.id) {
                await client.rpc("mark_conversation_read", { p_conversation_id: id });
            }
            await loadConversations();
            await refreshPeerRead();
        })
        .on("postgres_changes", {
            event: "UPDATE",
            schema: "public",
            table: "messages",
            filter: "conversation_id=eq." + id
        }, () => {
            loadMessages(false);
        })
        .subscribe();

    typingChannel = client.channel("typing:" + id, { config: { broadcast: { self: false } } });
    typingChannel.on("broadcast", { event: "typing" }, (payload) => {
        if (!typingIndicator) return;
        const from = payload.payload && payload.payload.user_id;
        if (from === currentUser.id) return;
        typingIndicator.hidden = false;
        const label = document.getElementById("typingLabel");
        if (label) label.textContent = (activePeer && activePeer.name ? activePeer.name : "Someone") + " is typing...";
        clearTimeout(typingIndicator._hide);
        typingIndicator._hide = setTimeout(() => { typingIndicator.hidden = true; }, 1800);
    });
    typingChannel.subscribe();
}

function subscribeInbox() {
    if (inboxChannel) client.removeChannel(inboxChannel);
    inboxChannel = client
        .channel("inbox:" + currentUser.id)
        .on("postgres_changes", { event: "*", schema: "public", table: "conversations" }, () => loadConversations())
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "notifications", filter: "user_id=eq." + currentUser.id }, (payload) => {
            const row = payload.new;
            if (row && row.body) showToast(row.body, "fa-solid fa-bell");
            loadConversations();
        })
        .subscribe();
}

function subscribePresence() {
    if (presenceChannel) client.removeChannel(presenceChannel);
    presenceChannel = client.channel("vchat-presence", {
        config: { presence: { key: currentUser.id } }
    });
    presenceChannel.on("presence", { event: "sync" }, () => {
        const state = presenceChannel.presenceState();
        onlinePeers = new Set(Object.keys(state));
        renderConversationList();
        if (activePeer && activePeer.id) {
            if (onlinePeers.has(activePeer.id)) setStatus("Online", true);
            else setStatus(activePeer.lastSeenAt ? ("Last seen " + Dom.formatTime(activePeer.lastSeenAt)) : "Offline", false);
        }
    });
    presenceChannel.subscribe(async (status) => {
        if (status === "SUBSCRIBED") {
            await presenceChannel.track({ online_at: new Date().toISOString() });
            await client.rpc("touch_last_seen");
        }
    });
}

function updateDetails(peer) {
    if (!detailsPanel || !peer) return;
    const nameEl = detailsPanel.querySelector(".details-profile h2");
    const statusEl = detailsPanel.querySelector(".details-profile > p");
    const aboutEl = detailsPanel.querySelector(".details-section > p");
    const avatarEl = detailsPanel.querySelector(".large-avatar");
    if (nameEl) nameEl.textContent = peer.name;
    if (statusEl) statusEl.textContent = onlinePeers.has(peer.id) ? "Online" : (peer.lastSeenAt ? "Last seen " + Dom.formatTime(peer.lastSeenAt) : "Offline");
    if (aboutEl) aboutEl.textContent = peer.about || "Available for conversation on VChat.";
    if (avatarEl) applyAvatar(avatarEl, peer.avatarUrl, peer.name);
}

async function openConversation(id) {
    const row = conversations.find((c) => c.conversation_id === id);
    if (!row) return;
    activeConversationId = id;
    activePeer = {
        id: row.peer_id,
        name: row.peer_name || row.title || "Chat",
        about: row.peer_about,
        avatarUrl: row.peer_avatar,
        lastSeenAt: row.peer_last_seen
    };
    oldestCursor = null;
    hasMore = true;
    if (activeChatName) activeChatName.textContent = activePeer.name;
    if (activeUserButton) {
        const av = activeUserButton.querySelector(".user-avatar");
        if (av) {
            av.className = "user-avatar " + Dom.avatarClass(activePeer.name);
            applyAvatar(av, activePeer.avatarUrl, activePeer.name);
        }
    }
    if (activePeer.id && onlinePeers.has(activePeer.id)) setStatus("Online", true);
    else setStatus(activePeer.lastSeenAt ? ("Last seen " + Dom.formatTime(activePeer.lastSeenAt)) : "Offline", false);
    updateDetails(activePeer);
    subscribeConversation(id);
    await loadMessages(false);
    await client.rpc("mark_conversation_read", { p_conversation_id: id });
    await refreshPeerRead();
    await loadConversations();
    if (chatApp) chatApp.classList.add("chat-open");
}

if (conversationList) {
    conversationList.addEventListener("click", (event) => {
        const item = event.target.closest(".conversation-item");
        if (!item || !item.dataset.id) return;
        openConversation(item.dataset.id);
    });
}

if (chatSearch) {
    chatSearch.addEventListener("input", renderConversationList);
}

filterButtons.forEach((button) => {
    button.addEventListener("click", function () {
        filterButtons.forEach((btn) => btn.classList.remove("active"));
        this.classList.add("active");
        currentFilter = this.dataset.filter;
        renderConversationList();
    });
});

if (mobileBackButton) {
    mobileBackButton.addEventListener("click", () => {
        if (chatApp) chatApp.classList.remove("chat-open");
        if (detailsPanel) detailsPanel.classList.remove("open");
    });
}
if (detailsButton) detailsButton.addEventListener("click", () => detailsPanel && detailsPanel.classList.toggle("open"));
if (activeUserButton) activeUserButton.addEventListener("click", () => detailsPanel && detailsPanel.classList.toggle("open"));
if (closeDetailsButton) closeDetailsButton.addEventListener("click", () => detailsPanel && detailsPanel.classList.remove("open"));

function autoResizeTextarea() {
    if (!messageInput) return;
    messageInput.style.height = "auto";
    messageInput.style.height = Math.min(messageInput.scrollHeight, 120) + "px";
}

function emitTyping() {
    if (!typingChannel || !activeConversationId) return;
    typingChannel.send({
        type: "broadcast",
        event: "typing",
        payload: { user_id: currentUser.id }
    });
}

if (messageInput) {
    messageInput.addEventListener("input", () => {
        autoResizeTextarea();
        clearTimeout(typingTimer);
        emitTyping();
        typingTimer = setTimeout(() => {}, 1200);
    });
    messageInput.addEventListener("keydown", (event) => {
        if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            sendMessage();
        }
    });
}
if (sendButton) sendButton.addEventListener("click", sendMessage);

async function sendMessage() {
    if (!messageInput || sending) return;
    const text = messageInput.value.trim();
    if (!text) return;
    if (!activeConversationId) {
        showToast("Start a chat from New Chat first.", "fa-solid fa-comment");
        return;
    }
    if (!navigator.onLine) {
        showToast("You are offline. Message was not sent.", "fa-solid fa-wifi");
        return;
    }
    sending = true;
    const clientId = (crypto.randomUUID && crypto.randomUUID()) || String(Date.now());
    const optimistic = {
        id: "tmp-" + clientId,
        client_id: clientId,
        sender_id: currentUser.id,
        content: text,
        message_type: "text",
        created_at: new Date().toISOString(),
        _sending: true
    };
    appendMessage(optimistic, false);
    scrollMessagesToBottom();
    messageInput.value = "";
    messageInput.style.height = "auto";
    try {
        const { data, error } = await client.rpc("send_chat_message", {
            p_conversation_id: activeConversationId,
            p_content: text,
            p_message_type: "text",
            p_client_id: clientId
        });
        if (error) throw error;
        const tmp = chatMessages.querySelector('[data-id="tmp-' + clientId + '"]');
        if (tmp) tmp.remove();
        renderedIds.delete(optimistic.id);
        if (data) appendMessage(data, false);
        await loadConversations();
    } catch (err) {
        const tmp = chatMessages.querySelector('[data-id="tmp-' + clientId + '"]');
        if (tmp) {
            const tick = tmp.querySelector(".message-read");
            if (tick) tick.textContent = " failed";
        }
        showToast(err.message || "Message failed to send.", "fa-solid fa-triangle-exclamation");
    } finally {
        sending = false;
        messageInput.focus();
    }
}

if (attachmentButton && fileInput) {
    attachmentButton.addEventListener("click", () => fileInput.click());
    fileInput.addEventListener("change", async function () {
        const files = Array.from(this.files || []);
        this.value = "";
        if (!activeConversationId) {
            showToast("Open a conversation before attaching files.", "fa-solid fa-paperclip");
            return;
        }
        for (const file of files) {
            const check = V.isAllowedAttachment(file);
            if (!check.ok) {
                showToast(check.error, "fa-solid fa-triangle-exclamation");
                continue;
            }
            const safeName = String(file.name || "file").replace(/[^\w.\-]+/g, "_").slice(0, 80);
            const path = activeConversationId + "/" + currentUser.id + "/" + Date.now() + "-" + safeName;
            showToast("Uploading " + file.name + "…", "fa-solid fa-cloud-arrow-up");
            const { error: upErr } = await client.storage.from("chat-attachments").upload(path, file, {
                contentType: file.type || "application/octet-stream",
                upsert: false
            });
            if (upErr) {
                showToast(upErr.message || "Upload failed.", "fa-solid fa-triangle-exclamation");
                continue;
            }
            const type = check.isImage ? "image" : "file";
            const { data: msg, error: msgErr } = await client.rpc("send_chat_message", {
                p_conversation_id: activeConversationId,
                p_content: file.name,
                p_message_type: type,
                p_client_id: null
            });
            if (msgErr) {
                showToast(msgErr.message, "fa-solid fa-triangle-exclamation");
                continue;
            }
            await client.from("attachments").insert({
                message_id: msg.id,
                conversation_id: activeConversationId,
                storage_path: path,
                filename: file.name,
                mime_type: file.type,
                size_bytes: file.size
            });
            await loadMessages(false);
        }
    });
}

const quickEmojis = ["😊", "🔥", "👍", "❤️", "🎉", "🙌"];
let emojiIndex = 0;
if (emojiButton && messageInput) {
    emojiButton.addEventListener("click", () => {
        messageInput.value += (messageInput.value ? " " : "") + quickEmojis[emojiIndex++ % quickEmojis.length];
        messageInput.focus();
        autoResizeTextarea();
    });
}

function notBuilt(feature) {
    showToast(feature + " is not implemented. It would need a separate realtime media stack.", "fa-solid fa-circle-info");
}
if (audioCallButton) audioCallButton.addEventListener("click", () => notBuilt("Voice calling"));
if (videoCallButton) videoCallButton.addEventListener("click", () => notBuilt("Video calling"));
if (voiceButton) voiceButton.addEventListener("click", () => notBuilt("Voice messages"));
if (chatSearchButton && chatSearch) {
    chatSearchButton.addEventListener("click", () => {
        chatSearch.focus();
        showToast("Search chats in the sidebar.", "fa-solid fa-magnifying-glass");
    });
}

if (detailsPanel) {
    const detailActionBtns = detailsPanel.querySelectorAll(".details-actions button");
    if (detailActionBtns[0]) detailActionBtns[0].addEventListener("click", () => notBuilt("Voice calling"));
    if (detailActionBtns[1]) detailActionBtns[1].addEventListener("click", () => notBuilt("Video calling"));
    if (detailActionBtns[2]) {
        detailActionBtns[2].addEventListener("click", () => {
            const q = window.prompt("Search in this conversation (client-side):", "");
            if (!q) return;
            const hits = [];
            chatMessages.querySelectorAll(".message p").forEach((p) => {
                if (p.textContent.toLowerCase().includes(q.toLowerCase())) hits.push(p.textContent);
            });
            showToast(hits.length ? hits.length + " match(es) in the loaded messages." : "No matches in the loaded page of messages.", "fa-solid fa-magnifying-glass");
        });
    }
    const viewAllBtn = detailsPanel.querySelector(".details-title-row button");
    if (viewAllBtn) {
        viewAllBtn.addEventListener("click", async () => {
            if (!activeConversationId) return;
            const { data } = await client
                .from("attachments")
                .select("filename, mime_type, size_bytes")
                .eq("conversation_id", activeConversationId)
                .limit(20);
            const grid = detailsPanel.querySelector(".media-grid");
            if (grid) {
                Dom.clear(grid);
                (data || []).forEach((file) => {
                    const cell = document.createElement("div");
                    cell.className = "media-placeholder";
                    const icon = document.createElement("i");
                    icon.className = (file.mime_type || "").startsWith("image/") ? "fa-regular fa-image" : "fa-regular fa-file";
                    cell.appendChild(icon);
                    cell.title = file.filename + " (" + Dom.formatBytes(file.size_bytes) + ")";
                    grid.appendChild(cell);
                });
                if (!(data || []).length) {
                    const empty = document.createElement("div");
                    empty.className = "media-placeholder";
                    empty.textContent = "None";
                    grid.appendChild(empty);
                }
            }
        });
    }
    const optionBtns = detailsPanel.querySelectorAll(".details-options button");
    if (optionBtns[0]) {
        optionBtns[0].addEventListener("click", () => {
            showToast("Starred messages are not stored yet.", "fa-regular fa-star");
        });
    }
    if (optionBtns[1]) {
        optionBtns[1].addEventListener("click", async () => {
            const row = conversations.find((c) => c.conversation_id === activeConversationId);
            const next = !(row && row.muted);
            await client.from("conversation_members").update({ muted: next })
                .eq("conversation_id", activeConversationId)
                .eq("user_id", currentUser.id);
            showToast(next ? "Notifications muted for this chat." : "Notifications enabled for this chat.", "fa-solid fa-bell");
            await loadConversations();
        });
    }
    if (optionBtns[2]) {
        optionBtns[2].addEventListener("click", async () => {
            if (!activePeer || !activePeer.id) return;
            const confirmed = window.confirm("Block " + activePeer.name + "? You will not be able to message each other.");
            if (!confirmed) return;
            const { error } = await client.from("blocked_users").insert({
                blocker_id: currentUser.id,
                blocked_id: activePeer.id
            });
            if (error) {
                showToast(error.message, "fa-solid fa-triangle-exclamation");
                return;
            }
            blockedIds.add(activePeer.id);
            showToast(activePeer.name + " was blocked.", "fa-solid fa-ban");
            setStatus("Blocked", false);
        });
    }
}

if (logoutButton) {
    logoutButton.addEventListener("click", async () => {
        const confirmed = window.confirm("Log out of VChat?");
        if (!confirmed) return;
        unsubscribeConversation();
        if (inboxChannel) client.removeChannel(inboxChannel);
        if (presenceChannel) client.removeChannel(presenceChannel);
        await client.auth.signOut();
        window.location.replace("../index.html");
    });
}

function openNewChatModal() {
    if (!newChatModal) return;
    newChatModal.hidden = false;
    clearNewChatFeedback();
    if (newChatNumber) {
        newChatNumber.value = "";
        setTimeout(() => newChatNumber.focus(), 50);
    }
}
function closeNewChatModal() {
    if (!newChatModal) return;
    newChatModal.hidden = true;
    clearNewChatFeedback();
}
function clearNewChatFeedback() {
    if (newChatValidation) {
        newChatValidation.hidden = true;
        newChatValidation.textContent = "";
    }
    if (newChatResult) {
        newChatResult.hidden = true;
        Dom.clear(newChatResult);
        newChatResult.style.display = "none";
    }
    if (findUserBtn) {
        findUserBtn.disabled = false;
        Dom.clear(findUserBtn);
        const icon = document.createElement("i");
        icon.className = "fa-solid fa-user-plus";
        const span = document.createElement("span");
        span.textContent = "Find VChat user";
        findUserBtn.appendChild(icon);
        findUserBtn.appendChild(span);
    }
}
function setModalError(message) {
    if (!newChatValidation) return;
    newChatValidation.hidden = false;
    newChatValidation.textContent = message;
    if (newChatResult) newChatResult.hidden = true;
}

if (newChatButton) newChatButton.addEventListener("click", openNewChatModal);
if (closeNewChat) closeNewChat.addEventListener("click", closeNewChatModal);
if (newChatModal) {
    newChatModal.addEventListener("click", (event) => {
        if (event.target === newChatModal) closeNewChatModal();
    });
}
if (newChatNumber) {
    newChatNumber.addEventListener("input", () => {
        if (newChatValidation) newChatValidation.hidden = true;
    });
    newChatNumber.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
            event.preventDefault();
            findVChatUser();
        }
    });
}
if (findUserBtn) findUserBtn.addEventListener("click", findVChatUser);

async function findVChatUser() {
    const enteredNumber = V.normalizeMobile(newChatNumber ? newChatNumber.value : "");
    if (!enteredNumber) {
        setModalError("Please enter a mobile number.");
        return;
    }
    if (!V.isValidMobile(enteredNumber)) {
        setModalError("Please enter a valid 10-digit Indian mobile number.");
        return;
    }
    if (enteredNumber === V.normalizeMobile(currentProfile.mobile)) {
        setModalError("That is your own number.");
        return;
    }
    findUserBtn.disabled = true;
    Dom.clear(findUserBtn);
    const spinner = document.createElement("i");
    spinner.className = "fa-solid fa-spinner fa-spin";
    const searchingSpan = document.createElement("span");
    searchingSpan.textContent = "Searching...";
    findUserBtn.appendChild(spinner);
    findUserBtn.appendChild(searchingSpan);
    try {
        const { data, error } = await client.rpc("lookup_user_by_mobile", { p_mobile: enteredNumber });
        if (error) throw error;
        const user = Array.isArray(data) ? data[0] : data;
        newChatResult.hidden = false;
        newChatResult.style.display = "block";
        Dom.clear(newChatResult);
        if (!user) {
            const notFound = document.createElement("div");
            notFound.className = "user-not-found";
            notFound.textContent = "No verified VChat account found with +91 " + enteredNumber + ".";
            newChatResult.appendChild(notFound);
            return;
        }
        const card = document.createElement("div");
        card.className = "user-found-card";
        const avatar = document.createElement("div");
        avatar.className = "user-found-avatar " + Dom.avatarClass(user.display_name);
        avatar.textContent = Dom.initials(user.display_name);
        const info = document.createElement("div");
        info.className = "user-found-info";
        const nameEl = document.createElement("div");
        nameEl.className = "user-found-name";
        nameEl.textContent = user.display_name;
        const numberEl = document.createElement("div");
        numberEl.className = "user-found-number";
        numberEl.textContent = "+91 " + user.mobile + " • " + (user.about || "VChat User");
        info.appendChild(nameEl);
        info.appendChild(numberEl);
        const chatBtn = document.createElement("button");
        chatBtn.type = "button";
        chatBtn.className = "start-chat-btn";
        chatBtn.textContent = "Start Chat";
        chatBtn.addEventListener("click", () => startNewChat(user));
        card.appendChild(avatar);
        card.appendChild(info);
        card.appendChild(chatBtn);
        newChatResult.appendChild(card);
    } catch (err) {
        setModalError(err.message || "Search failed.");
    } finally {
        findUserBtn.disabled = false;
        Dom.clear(findUserBtn);
        const icon = document.createElement("i");
        icon.className = "fa-solid fa-user-plus";
        const span = document.createElement("span");
        span.textContent = "Find VChat user";
        findUserBtn.appendChild(icon);
        findUserBtn.appendChild(span);
    }
}

async function startNewChat(user) {
    closeNewChatModal();
    const { data, error } = await client.rpc("get_or_create_direct_conversation", { p_other_id: user.id });
    if (error) {
        showToast(error.message, "fa-solid fa-triangle-exclamation");
        return;
    }
    await loadConversations();
    await openConversation(data);
    if (messageInput) messageInput.focus();
    showToast("Conversation ready with " + user.display_name, "fa-solid fa-circle-check");
}

function openProfileEditor() {
    let modal = document.getElementById("profileModal");
    if (!modal) return;
    document.getElementById("profileNameInput").value = currentProfile.name || "";
    document.getElementById("profileAboutInput").value = currentProfile.about || "";
    const emailEl = document.getElementById("profileEmailRead");
    const mobileEl = document.getElementById("profileMobileRead");
    if (emailEl) emailEl.textContent = currentProfile.email || currentUser.email;
    if (mobileEl) mobileEl.textContent = currentProfile.mobile ? "+91 " + currentProfile.mobile : "Not set";
    modal.hidden = false;
}

if (profileButton) profileButton.addEventListener("click", openProfileEditor);

document.addEventListener("click", async (event) => {
    const modal = document.getElementById("profileModal");
    if (!modal) return;
    if (event.target.id === "closeProfileModal" || event.target === modal) {
        modal.hidden = true;
        return;
    }
    if (event.target.id === "saveProfileBtn" || event.target.closest("#saveProfileBtn")) {
        const name = (document.getElementById("profileNameInput") || {}).value;
        const about = (document.getElementById("profileAboutInput") || {}).value;
        if (!V.isValidName(name)) {
            showToast("Name must be 2–80 characters.", "fa-solid fa-triangle-exclamation");
            return;
        }
        const { data, error } = await client.rpc("update_my_profile", {
            p_full_name: name.trim(),
            p_about: about,
            p_avatar_url: currentProfile.avatarUrl || null
        });
        if (error) {
            showToast(error.message, "fa-solid fa-triangle-exclamation");
            return;
        }
        currentProfile = api.mapProfile(data) || currentProfile;
        if (currentUserName) currentUserName.textContent = currentProfile.name;
        if (currentUserInitials) currentUserInitials.textContent = Dom.initials(currentProfile.name);
        modal.hidden = true;
        showToast("Profile updated.", "fa-solid fa-circle-check");
    }
});

const avatarInput = document.getElementById("avatarFileInput");
if (avatarInput) {
    avatarInput.addEventListener("change", async function () {
        const file = this.files && this.files[0];
        this.value = "";
        const check = V.isAllowedAvatar(file);
        if (!check.ok) {
            showToast(check.error, "fa-solid fa-triangle-exclamation");
            return;
        }
        const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
        const path = currentUser.id + "/avatar." + ext;
        const { error: upErr } = await client.storage.from("avatars").upload(path, file, { upsert: true, contentType: file.type });
        if (upErr) {
            showToast(upErr.message, "fa-solid fa-triangle-exclamation");
            return;
        }
        const { data } = client.storage.from("avatars").getPublicUrl(path);
        const publicUrl = data && data.publicUrl;
        const { error } = await client.rpc("update_my_profile", {
            p_full_name: currentProfile.name,
            p_about: currentProfile.about,
            p_avatar_url: publicUrl
        });
        if (error) {
            showToast(error.message, "fa-solid fa-triangle-exclamation");
            return;
        }
        currentProfile.avatarUrl = publicUrl;
        const avatarWrap = profileButton && profileButton.querySelector(".user-avatar");
        applyAvatar(avatarWrap, publicUrl, currentProfile.name);
        showToast("Avatar updated.", "fa-solid fa-circle-check");
    });
}

if (sidebarMenuButton) {
    sidebarMenuButton.addEventListener("click", async () => {
        const { data } = await client
            .from("notifications")
            .select("id, title, body, read_at, created_at")
            .eq("user_id", currentUser.id)
            .order("created_at", { ascending: false })
            .limit(8);
        const unread = (data || []).filter((n) => !n.read_at).length;
        showToast(unread ? unread + " unread notification(s). Latest: " + ((data[0] && data[0].body) || "none") : "No unread notifications.", "fa-solid fa-bell");
        if ((data || []).length) {
            await client.from("notifications").update({ read_at: new Date().toISOString() }).eq("user_id", currentUser.id).is("read_at", null);
        }
    });
}

document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
        const profileModal = document.getElementById("profileModal");
        if (profileModal && !profileModal.hidden) {
            profileModal.hidden = true;
            return;
        }
        if (newChatModal && !newChatModal.hidden) {
            closeNewChatModal();
            return;
        }
        if (detailsPanel && detailsPanel.classList.contains("open")) {
            detailsPanel.classList.remove("open");
            return;
        }
        if (chatApp && chatApp.classList.contains("chat-open")) chatApp.classList.remove("chat-open");
    }
});

window.addEventListener("online", () => connectionBanner("online"));
window.addEventListener("offline", () => connectionBanner("offline"));

(async function bootChat() {
    try {
        await requireSession();
        emptyConversationList();
        resetThreadShell();
        const empty = document.createElement("div");
        empty.className = "empty-chat-state";
        const icon = document.createElement("i");
        icon.className = "fa-regular fa-comments";
        const title = document.createElement("strong");
        title.textContent = "Your conversations";
        const p = document.createElement("p");
        p.textContent = "Select a chat or start a new one from the + button.";
        empty.appendChild(icon);
        empty.appendChild(title);
        empty.appendChild(p);
        chatMessages.appendChild(empty);
        await loadBlocked();
        await loadConversations();
        subscribeInbox();
        subscribePresence();
        if (conversations[0]) await openConversation(conversations[0].conversation_id);
        connectionBanner(navigator.onLine ? "online" : "offline");
    } catch (err) {
        if (err && err.message === "no session") return;
        console.warn(err);
    }
})();
