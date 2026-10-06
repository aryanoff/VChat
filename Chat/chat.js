/* ==========================================================================
   VCHAT PRODUCTION MESSAGING ENGINE
   Comprehensive real-time messaging, state management, media & UX flows
   ========================================================================== */

const PAGE_SIZE = 40;
const V = window.VChatValidators;
const Dom = window.VChatDom;
const api = window.VChat && window.VChat.supabase;

// ==========================================================================
// 1. GLOBAL APPLICATION STATE (Single Source of Truth)
// ==========================================================================

const AppState = {
    client: null,
    currentUser: null,
    currentProfile: null,
    conversations: [],
    activeConversationId: null,
    activePeer: null,
    messages: [], // in-memory current thread
    drafts: {}, // { [conversationId]: string }
    pinnedChatIds: new Set(),
    starredMessageIds: new Set(),
    mutedChats: new Map(), // convId -> expiry timestamp | 'always'
    blockedIds: new Set(),
    reactions: new Map(), // messageId -> { counts: { [emoji]: number }, userReacted: string[] }
    optimisticClientIds: new Set(), // clientId set for active optimistic deduplication
    replyingTo: null, // message object
    editingMessage: null, // message object
    offlineQueue: [], // [ { clientId, conversationId, content, messageType, createdAt } ]
    onlinePeers: new Set(),
    typingPeers: new Set(),
    connectionStatus: "CONNECTED", // CONNECTED | CONNECTING | DISCONNECTED | RECONNECTING
    currentFilter: "all",
    searchQuery: "",
    renderedMessageIds: new Set(),
    oldestCursor: null,
    loadingOlder: false,
    hasMore: true,
    peerReadAt: null,
    sending: false,

    // Calling state
    call: {
        active: false,
        mode: "audio", // 'audio' | 'video'
        status: "idle", // 'calling' | 'ringing' | 'connected' | 'ended'
        peer: null,
        timer: 0,
        interval: null,
        muted: false,
        cameraOff: false,
        stream: null,
        audioContext: null,
        ringNodes: null
    },

    // Media Lightbox
    lightbox: {
        active: false,
        items: [],
        currentIndex: 0,
        zoom: 1
    },

    // In-chat search
    inChatSearch: {
        active: false,
        query: "",
        matches: [],
        currentIndex: -1
    }
};

// ==========================================================================
// 2. DOM ELEMENT CACHE
// ==========================================================================

const Els = {
    chatApp: document.querySelector(".chat-app"),
    sidebar: document.getElementById("chatSidebar"),
    conversationList: document.getElementById("conversationList"),
    chatSearch: document.getElementById("chatSearch"),
    noSearchResult: document.getElementById("noSearchResult"),
    emptyConversationState: document.getElementById("emptyConversationState"),
    filterButtons: document.querySelectorAll(".chat-filter"),
    newChatButton: document.getElementById("newChatButton"),
    themeToggleButton: document.getElementById("themeToggleButton"),
    sidebarMenuButton: document.getElementById("sidebarMenuButton"),
    profileButton: document.getElementById("profileButton"),
    currentUserName: document.getElementById("currentUserName"),
    currentUserInitials: document.getElementById("currentUserInitials"),
    logoutButton: document.getElementById("logoutButton"),

    // Chat Header & Top Bar
    mobileBackButton: document.getElementById("mobileBackButton"),
    activeUserButton: document.getElementById("activeUserButton"),
    activeChatAvatar: document.getElementById("activeChatAvatar"),
    activeChatInitials: document.getElementById("activeChatInitials"),
    activeChatOnlineDot: document.getElementById("activeChatOnlineDot"),
    activeChatName: document.getElementById("activeChatName"),
    activeChatStatus: document.getElementById("activeChatStatus"),
    videoCallButton: document.getElementById("videoCallButton"),
    audioCallButton: document.getElementById("audioCallButton"),
    chatSearchButton: document.getElementById("chatSearchButton"),
    detailsButton: document.getElementById("detailsButton"),

    // In-Chat Search
    inChatSearchBar: document.getElementById("inChatSearchBar"),
    inChatSearchInput: document.getElementById("inChatSearchInput"),
    inChatSearchMatchCount: document.getElementById("inChatSearchMatchCount"),
    inChatSearchPrevBtn: document.getElementById("inChatSearchPrevBtn"),
    inChatSearchNextBtn: document.getElementById("inChatSearchNextBtn"),
    inChatSearchCloseBtn: document.getElementById("inChatSearchCloseBtn"),

    // Message History Area
    chatMessages: document.getElementById("chatMessages"),
    chatHeroEmpty: document.getElementById("chatHeroEmpty"),
    heroStartChatBtn: document.getElementById("heroStartChatBtn"),
    startFirstChatBtn: document.getElementById("startFirstChatBtn"),
    loadOlderBtn: document.getElementById("loadOlderBtn"),
    secureNotice: document.getElementById("secureNotice"),
    typingIndicator: document.getElementById("typingIndicator"),
    typingLabel: document.getElementById("typingLabel"),

    // Composer & Top Bars
    replyPreviewBar: document.getElementById("replyPreviewBar"),
    replySenderName: document.getElementById("replySenderName"),
    replyTextSnippet: document.getElementById("replyTextSnippet"),
    cancelReplyBtn: document.getElementById("cancelReplyBtn"),
    editingMessageBar: document.getElementById("editingMessageBar"),
    editingTextSnippet: document.getElementById("editingTextSnippet"),
    cancelEditBtn: document.getElementById("cancelEditBtn"),
    blockedComposerNotice: document.getElementById("blockedComposerNotice"),
    unblockBannerBtn: document.getElementById("unblockBannerBtn"),
    messageComposer: document.getElementById("messageComposer"),
    emojiButton: document.getElementById("emojiButton"),
    attachmentButton: document.getElementById("attachmentButton"),
    fileInput: document.getElementById("fileInput"),
    messageInput: document.getElementById("messageInput"),
    voiceButton: document.getElementById("voiceButton"),
    sendButton: document.getElementById("sendButton"),

    // Popups
    attachmentPopup: document.getElementById("attachmentPopup"),
    attachPhotoBtn: document.getElementById("attachPhotoBtn"),
    attachDocBtn: document.getElementById("attachDocBtn"),
    emojiPickerPopup: document.getElementById("emojiPickerPopup"),
    emojiPickerGrid: document.getElementById("emojiPickerGrid"),
    voiceRecordingBar: document.getElementById("voiceRecordingBar"),
    voiceRecordingTimer: document.getElementById("voiceRecordingTimer"),
    cancelVoiceBtn: document.getElementById("cancelVoiceBtn"),
    sendVoiceBtn: document.getElementById("sendVoiceBtn"),

    // Right Details Panel
    detailsPanel: document.getElementById("detailsPanel"),
    closeDetailsButton: document.getElementById("closeDetailsButton"),
    detailsAvatar: document.getElementById("detailsAvatar"),
    detailsInitials: document.getElementById("detailsInitials"),
    detailsOnlineDot: document.getElementById("detailsOnlineDot"),
    detailsName: document.getElementById("detailsName"),
    detailsStatus: document.getElementById("detailsStatus"),
    detailsCallBtn: document.getElementById("detailsCallBtn"),
    detailsVideoBtn: document.getElementById("detailsVideoBtn"),
    detailsSearchBtn: document.getElementById("detailsSearchBtn"),
    detailsAbout: document.getElementById("detailsAbout"),
    detailsViewAllMediaBtn: document.getElementById("detailsViewAllMediaBtn"),
    detailsMediaGrid: document.getElementById("detailsMediaGrid"),
    detailsStarredBtn: document.getElementById("detailsStarredBtn"),
    detailsMuteBtn: document.getElementById("detailsMuteBtn"),
    detailsMuteLabel: document.getElementById("detailsMuteLabel"),
    detailsBlockBtn: document.getElementById("detailsBlockBtn"),
    detailsBlockLabel: document.getElementById("detailsBlockLabel"),

    // Modals
    newChatModal: document.getElementById("newChatModal"),
    closeNewChat: document.getElementById("closeNewChat"),
    newChatNumber: document.getElementById("newChatNumber"),
    newChatValidation: document.getElementById("newChatValidation"),
    findUserBtn: document.getElementById("findUserBtn"),
    newChatResult: document.getElementById("newChatResult"),
    profileModal: document.getElementById("profileModal"),
    closeProfileModal: document.getElementById("closeProfileModal"),
    profileModalAvatar: document.getElementById("profileModalAvatar"),
    profileModalInitials: document.getElementById("profileModalInitials"),
    avatarFileInput: document.getElementById("avatarFileInput"),
    profileNameInput: document.getElementById("profileNameInput"),
    profileAboutInput: document.getElementById("profileAboutInput"),
    profileEmailRead: document.getElementById("profileEmailRead"),
    profileMobileRead: document.getElementById("profileMobileRead"),
    saveProfileBtn: document.getElementById("saveProfileBtn"),

    // Calling Modal
    callModal: document.getElementById("callModal"),
    callTypeBadge: document.getElementById("callTypeBadge"),
    callContactAvatar: document.getElementById("callContactAvatar"),
    callContactInitials: document.getElementById("callContactInitials"),
    callContactName: document.getElementById("callContactName"),
    callStatusLabel: document.getElementById("callStatusLabel"),
    callTimer: document.getElementById("callTimer"),
    callMuteBtn: document.getElementById("callMuteBtn"),
    callCameraBtn: document.getElementById("callCameraBtn"),
    callEndBtn: document.getElementById("callEndBtn"),
    callVideoPreview: document.getElementById("callVideoPreview"),
    callLocalVideo: document.getElementById("callLocalVideo"),

    // Lightbox Modal
    mediaLightboxModal: document.getElementById("mediaLightboxModal"),
    lightboxImage: document.getElementById("lightboxImage"),
    lightboxTitle: document.getElementById("lightboxTitle"),
    lightboxSubtitle: document.getElementById("lightboxSubtitle"),
    lightboxZoomInBtn: document.getElementById("lightboxZoomInBtn"),
    lightboxZoomOutBtn: document.getElementById("lightboxZoomOutBtn"),
    lightboxZoomResetBtn: document.getElementById("lightboxZoomResetBtn"),
    lightboxDownloadBtn: document.getElementById("lightboxDownloadBtn"),
    lightboxCloseBtn: document.getElementById("lightboxCloseBtn"),
    lightboxPrevBtn: document.getElementById("lightboxPrevBtn"),
    lightboxNextBtn: document.getElementById("lightboxNextBtn"),

    // Feature Modals
    muteModal: document.getElementById("muteModal"),
    closeMuteModal: document.getElementById("closeMuteModal"),
    confirmMuteBtn: document.getElementById("confirmMuteBtn"),
    reportModal: document.getElementById("reportModal"),
    closeReportModal: document.getElementById("closeReportModal"),
    submitReportBtn: document.getElementById("submitReportBtn"),
    reportDetailsInput: document.getElementById("reportDetailsInput"),
    starredMessagesModal: document.getElementById("starredMessagesModal"),
    closeStarredModal: document.getElementById("closeStarredModal"),
    starredMessagesList: document.getElementById("starredMessagesList"),
    sharedMediaModal: document.getElementById("sharedMediaModal"),
    closeSharedMediaModal: document.getElementById("closeSharedMediaModal"),
    sharedMediaBrowserGrid: document.getElementById("sharedMediaBrowserGrid"),
    deleteMessageModal: document.getElementById("deleteMessageModal"),
    closeDeleteModal: document.getElementById("closeDeleteModal"),
    deleteForEveryoneBtn: document.getElementById("deleteForEveryoneBtn"),
    deleteForMeBtn: document.getElementById("deleteForMeBtn"),
    messageInfoModal: document.getElementById("messageInfoModal"),
    closeMsgInfoModal: document.getElementById("closeMsgInfoModal"),
    msgInfoDetails: document.getElementById("msgInfoDetails"),
    commandPaletteModal: document.getElementById("commandPaletteModal"),
    commandPaletteInput: document.getElementById("commandPaletteInput"),
    commandPaletteResults: document.getElementById("commandPaletteResults"),
    convContextMenu: document.getElementById("convContextMenu"),
    ctxMarkReadLabel: document.getElementById("ctxMarkReadLabel"),
    ctxPinLabel: document.getElementById("ctxPinLabel"),
    ctxMuteLabel: document.getElementById("ctxMuteLabel"),
    messageReactionPopup: document.getElementById("messageReactionPopup")
};

// Realtime Channel References
let messageChannel = null;
let inboxChannel = null;
let typingChannel = null;
let presenceChannel = null;
let typingDebounceTimer = null;
let selectedContextConvoId = null;
let targetReactionMsgId = null;
let targetDeleteMsg = null;
let lastRenderedDateString = null;

// ==========================================================================
// 3. PERSISTENCE HELPERS (Drafts, Offline Queue, Stars, Pins, Mutes)
// ==========================================================================

function getStorageKey(prefix) {
    return `vchat_${prefix}_${AppState.currentUser ? AppState.currentUser.id : "guest"}`;
}

function loadLocalPreferences() {
    try {
        const draftsJson = localStorage.getItem(getStorageKey("drafts"));
        if (draftsJson) AppState.drafts = JSON.parse(draftsJson);
    } catch { AppState.drafts = {}; }

    try {
        const queueJson = localStorage.getItem(getStorageKey("offline_queue"));
        if (queueJson) AppState.offlineQueue = JSON.parse(queueJson);
    } catch { AppState.offlineQueue = []; }

    try {
        const starJson = localStorage.getItem(getStorageKey("starred"));
        if (starJson) AppState.starredMessageIds = new Set(JSON.parse(starJson));
    } catch { AppState.starredMessageIds = new Set(); }

    try {
        const pinJson = localStorage.getItem(getStorageKey("pinned_chats"));
        if (pinJson) AppState.pinnedChatIds = new Set(JSON.parse(pinJson));
    } catch { AppState.pinnedChatIds = new Set(); }

    try {
        const muteJson = localStorage.getItem(getStorageKey("muted_chats"));
        if (muteJson) AppState.mutedChats = new Map(Object.entries(JSON.parse(muteJson)));
    } catch { AppState.mutedChats = new Map(); }

    try {
        const reactionsJson = localStorage.getItem(getStorageKey("reactions"));
        if (reactionsJson) AppState.reactions = new Map(Object.entries(JSON.parse(reactionsJson)));
    } catch { AppState.reactions = new Map(); }
}

function isChatMuted(convId) {
    if (!convId || !AppState.mutedChats.has(convId)) return false;
    const val = AppState.mutedChats.get(convId);
    if (val === "always") return true;
    const expiry = Number(val);
    if (!isNaN(expiry) && Date.now() > expiry) {
        AppState.mutedChats.delete(convId);
        saveMuted();
        if (AppState.client) {
            AppState.client.from("conversation_members")
                .update({ muted: false })
                .eq("conversation_id", convId)
                .eq("user_id", AppState.currentUser?.id || "")
                .then(() => {}).catch(() => {});
        }
        return false;
    }
    return true;
}

function saveDraft(convoId, text) {
    if (!convoId) return;
    if (text && text.trim()) {
        AppState.drafts[convoId] = text;
    } else {
        delete AppState.drafts[convoId];
    }
    try {
        localStorage.setItem(getStorageKey("drafts"), JSON.stringify(AppState.drafts));
    } catch { /* storage full / disabled */ }
}

function saveStarred() {
    try {
        localStorage.setItem(getStorageKey("starred"), JSON.stringify(Array.from(AppState.starredMessageIds)));
    } catch { /* silent */ }
}

function savePinned() {
    try {
        localStorage.setItem(getStorageKey("pinned_chats"), JSON.stringify(Array.from(AppState.pinnedChatIds)));
    } catch { /* silent */ }
}

function saveMuted() {
    try {
        const obj = Object.fromEntries(AppState.mutedChats);
        localStorage.setItem(getStorageKey("muted_chats"), JSON.stringify(obj));
    } catch { /* silent */ }
}

function saveReactions() {
    try {
        const obj = Object.fromEntries(AppState.reactions);
        localStorage.setItem(getStorageKey("reactions"), JSON.stringify(obj));
    } catch { /* silent */ }
}

function saveOfflineQueue() {
    try {
        localStorage.setItem(getStorageKey("offline_queue"), JSON.stringify(AppState.offlineQueue));
    } catch { /* silent */ }
}

// ==========================================================================
// 4. UI TOASTS & NOTIFICATIONS
// ==========================================================================

function showToast(message, icon = "fa-solid fa-circle-info") {
    Dom.showToast("chat-toast", message, icon);
}

function updateConnectionBanner(state) {
    let bar = document.getElementById("connectionBanner");
    if (!bar) {
        bar = document.createElement("div");
        bar.id = "connectionBanner";
        bar.className = "connection-banner";
        document.body.appendChild(bar);
    }
    if (state === "online") {
        bar.hidden = true;
        AppState.connectionStatus = "CONNECTED";
        return;
    }
    bar.hidden = false;
    if (state === "offline") {
        bar.textContent = "You are offline. Messages will send when you reconnect.";
        AppState.connectionStatus = "DISCONNECTED";
    } else {
        bar.textContent = "Reconnecting to VChat…";
        AppState.connectionStatus = "RECONNECTING";
    }
}

// ==========================================================================
// 5. SESSION & AUTHENTICATION
// ==========================================================================

function redirectLogin() {
    window.location.replace("../Auth/login-signup.html");
}

async function requireSession() {
    if (!api || !api.isConfigured()) {
        showToast(api ? api.setupError() : "Supabase is missing.", "fa-solid fa-triangle-exclamation");
        setTimeout(redirectLogin, 1200);
        throw new Error("not configured");
    }
    AppState.client = api.getClient();
    const { data: { session } } = await AppState.client.auth.getSession();
    if (!session) {
        redirectLogin();
        throw new Error("no session");
    }
    AppState.currentUser = session.user;

    const { data } = await AppState.client
        .from("profiles")
        .select("id, full_name, display_name, name, about, bio, mobile, phone, email, avatar_url, last_seen_at, mobile_verified, mobile_verified_at, email_verified, email_verified_at")
        .eq("id", AppState.currentUser.id)
        .maybeSingle();

    AppState.currentProfile = api.mapProfile(data) || {
        id: AppState.currentUser.id,
        name: AppState.currentUser.user_metadata?.full_name || AppState.currentUser.email,
        about: "Hey there! I am using VChat.",
        mobile: AppState.currentUser.user_metadata?.mobile || "",
        email: AppState.currentUser.email,
        avatarUrl: "",
        mobileVerified: false
    };

    const isGoogle = !!(AppState.currentUser.app_metadata && AppState.currentUser.app_metadata.provider === "google");
    const isEmailVerified = !!(AppState.currentUser.email_confirmed_at || AppState.currentProfile.emailVerified || isGoogle);

    if (!isEmailVerified) {
        showToast("Please verify your email address to access VChat.", "fa-solid fa-envelope");
        redirectLogin();
        throw new Error("unverified email");
    }

    if (Els.currentUserName) Els.currentUserName.textContent = AppState.currentProfile.name;
    if (Els.currentUserInitials) Els.currentUserInitials.textContent = Dom.initials(AppState.currentProfile.name);
    const avatarWrap = Els.profileButton && Els.profileButton.querySelector(".user-avatar");
    if (avatarWrap && AppState.currentProfile.avatarUrl) {
        applyAvatar(avatarWrap, AppState.currentProfile.avatarUrl, AppState.currentProfile.name);
    }
    loadLocalPreferences();
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
    if (online) {
        container.appendChild(online);
    } else {
        const span = document.createElement("span");
        span.className = container.classList.contains("large-avatar") ? "large-online" : "avatar-online";
        container.appendChild(span);
    }
}

// ==========================================================================
// 6. CONVERSATION MANAGEMENT & SIDEBAR
// ==========================================================================

async function loadBlocked() {
    try {
        const { data } = await AppState.client
            .from("blocked_users")
            .select("blocked_id")
            .eq("blocker_id", AppState.currentUser.id);
        AppState.blockedIds = new Set((data || []).map((r) => r.blocked_id));
    } catch { /* silent */ }
}

async function loadConversations() {
    const { data, error } = await AppState.client.rpc("list_my_conversations");
    if (error) {
        showToast(error.message, "fa-solid fa-triangle-exclamation");
        return;
    }
    AppState.conversations = (data || []).sort((a, b) => {
        // Pinned conversations always top
        const aPinned = AppState.pinnedChatIds.has(a.conversation_id);
        const bPinned = AppState.pinnedChatIds.has(b.conversation_id);
        if (aPinned && !bPinned) return -1;
        if (!aPinned && bPinned) return 1;
        return new Date(b.last_message_at || 0) - new Date(a.last_message_at || 0);
    });
    renderConversationList();
}

function renderConversationList() {
    if (!Els.conversationList) return;
    Els.conversationList.querySelectorAll(".conversation-item:not([data-template])").forEach((el) => el.remove());

    const query = (Els.chatSearch && Els.chatSearch.value.trim().toLowerCase()) || "";
    let visible = 0;

    if (AppState.conversations.length === 0) {
        if (Els.emptyConversationState) Els.emptyConversationState.hidden = false;
        if (Els.noSearchResult) Els.noSearchResult.hidden = true;
        return;
    }
    if (Els.emptyConversationState) Els.emptyConversationState.hidden = true;

    AppState.conversations.forEach((row) => {
        const name = row.peer_name || row.title || "Chat";
        const isGroup = !!row.is_group;
        const isMuted = row.muted || isChatMuted(row.conversation_id);
        const isPinned = AppState.pinnedChatIds.has(row.conversation_id);
        const hasDraft = !!(AppState.drafts[row.conversation_id] && row.conversation_id !== AppState.activeConversationId);

        if (AppState.currentFilter === "unread" && !(row.unread_count > 0)) return;
        if (AppState.currentFilter === "groups" && !isGroup) return;
        if (query && !name.toLowerCase().includes(query)) return;
        visible += 1;

        const item = document.createElement("button");
        item.type = "button";
        item.className = "conversation-item" + (row.conversation_id === AppState.activeConversationId ? " active" : "");
        item.dataset.id = row.conversation_id;
        item.dataset.name = name;
        item.dataset.type = isGroup ? "group" : "personal";

        // Context menu listener
        item.addEventListener("contextmenu", (e) => {
            e.preventDefault();
            openContextMenu(e, row.conversation_id);
        });

        // Avatar
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
        if (row.peer_id && AppState.onlinePeers.has(row.peer_id)) {
            const dot = document.createElement("span");
            dot.className = "avatar-online";
            avatar.appendChild(dot);
        }

        // Content
        const content = document.createElement("div");
        content.className = "conversation-content";

        const top = document.createElement("div");
        top.className = "conversation-top";
        const strong = document.createElement("strong");
        strong.textContent = name;
        if (isPinned) {
            const pinIcon = document.createElement("i");
            pinIcon.className = "fa-solid fa-thumbtack";
            pinIcon.style.fontSize = "10px";
            pinIcon.style.color = "var(--green-bright)";
            pinIcon.style.marginLeft = "5px";
            strong.appendChild(pinIcon);
        }

        const time = document.createElement("span");
        time.textContent = Dom.formatTime(row.last_message_at);
        top.appendChild(strong);
        top.appendChild(time);

        const bottom = document.createElement("div");
        bottom.className = "conversation-bottom";
        const p = document.createElement("p");

        if (hasDraft) {
            p.innerHTML = `<span style="color:var(--green-bright);font-weight:700;"><i class="fa-solid fa-pencil" style="font-size:10px;"></i> Draft: </span>` + Dom.escape(AppState.drafts[row.conversation_id]);
        } else {
            p.textContent = row.last_message_preview || "New conversation";
        }
        bottom.appendChild(p);

        if (isMuted) {
            const muteIcon = document.createElement("i");
            muteIcon.className = "fa-solid fa-bell-slash";
            muteIcon.style.fontSize = "11px";
            muteIcon.style.color = "var(--muted)";
            muteIcon.style.marginLeft = "4px";
            bottom.appendChild(muteIcon);
        }

        if (row.unread_count > 0 && row.conversation_id !== AppState.activeConversationId) {
            const badge = document.createElement("span");
            badge.className = "unread-count";
            badge.textContent = row.unread_count > 99 ? "99+" : String(row.unread_count);
            bottom.appendChild(badge);
        }

        content.appendChild(top);
        content.appendChild(bottom);
        item.appendChild(avatar);
        item.appendChild(content);

        Els.conversationList.insertBefore(item, Els.emptyConversationState || Els.noSearchResult || null);
    });

    if (Els.noSearchResult) Els.noSearchResult.hidden = (visible > 0 || !query);
}

// ==========================================================================
// 7. THREAD SELECTION & EMPTY STATES
// ==========================================================================

function showIdleThreadState() {
    AppState.activeConversationId = null;
    AppState.activePeer = null;
    AppState.renderedMessageIds = new Set();
    AppState.messages = [];
    lastRenderedDateString = null;
    clearMessageElements();

    if (Els.chatHeroEmpty) Els.chatHeroEmpty.hidden = false;
    if (Els.loadOlderBtn) Els.loadOlderBtn.hidden = true;
    if (Els.secureNotice) Els.secureNotice.hidden = true;
    if (Els.typingIndicator) Els.typingIndicator.hidden = true;
    if (Els.inChatSearchBar) Els.inChatSearchBar.hidden = true;
    if (Els.replyPreviewBar) Els.replyPreviewBar.hidden = true;
    if (Els.editingMessageBar) Els.editingMessageBar.hidden = true;
    if (Els.blockedComposerNotice) Els.blockedComposerNotice.hidden = true;

    if (Els.activeChatName) Els.activeChatName.textContent = "VChat";
    if (Els.activeChatStatus) {
        Dom.clear(Els.activeChatStatus);
        Els.activeChatStatus.textContent = "Select a conversation";
    }
    if (Els.activeChatOnlineDot) Els.activeChatOnlineDot.hidden = true;

    if (Els.activeUserButton) {
        const av = Els.activeUserButton.querySelector(".user-avatar");
        if (av) {
            Dom.clear(av);
            av.className = "user-avatar avatar-green";
            av.textContent = "VC";
        }
    }

    if (Els.messageInput) {
        Els.messageInput.value = "";
        Els.messageInput.disabled = true;
        Els.messageInput.placeholder = "Select a conversation to start chatting...";
    }
    if (Els.sendButton) Els.sendButton.disabled = true;
    if (Els.voiceButton) Els.voiceButton.disabled = true;
    if (Els.attachmentButton) Els.attachmentButton.disabled = true;
    if (Els.emojiButton) Els.emojiButton.disabled = true;
    if (Els.videoCallButton) Els.videoCallButton.disabled = true;
    if (Els.audioCallButton) Els.audioCallButton.disabled = true;
    if (Els.chatSearchButton) Els.chatSearchButton.disabled = true;

    updateDetails(null);
    cancelVoiceRecording();
}

function clearMessageElements() {
    if (!Els.chatMessages) return;
    Els.chatMessages.querySelectorAll(".message, .thread-starter-banner, .date-separator").forEach((el) => el.remove());
}

async function openConversation(id) {
    cancelVoiceRecording();
    // Preserve draft from previous conversation
    if (AppState.activeConversationId && Els.messageInput && !AppState.editingMessage) {
        saveDraft(AppState.activeConversationId, Els.messageInput.value);
    }

    const row = AppState.conversations.find((c) => c.conversation_id === id);
    if (!row) return;

    AppState.activeConversationId = id;
    AppState.activePeer = {
        id: row.peer_id,
        name: row.peer_name || row.title || "Chat",
        about: row.peer_about,
        avatarUrl: row.peer_avatar,
        lastSeenAt: row.peer_last_seen,
        isGroup: !!row.is_group
    };
    AppState.oldestCursor = null;
    AppState.hasMore = true;
    AppState.replyingTo = null;
    AppState.editingMessage = null;
    lastRenderedDateString = null;

    if (Els.replyPreviewBar) Els.replyPreviewBar.hidden = true;
    if (Els.editingMessageBar) Els.editingMessageBar.hidden = true;

    // Check if blocked
    const isBlocked = AppState.blockedIds.has(AppState.activePeer.id);
    if (Els.blockedComposerNotice) Els.blockedComposerNotice.hidden = !isBlocked;

    if (Els.conversationList) {
        Els.conversationList.querySelectorAll(".conversation-item").forEach((btn) => {
            btn.classList.toggle("active", btn.dataset.id === id);
        });
    }

    // Enable composer & controls
    if (Els.messageInput) {
        Els.messageInput.disabled = isBlocked;
        Els.messageInput.placeholder = isBlocked ? "Contact is blocked." : "Type a message...";
        Els.messageInput.value = AppState.drafts[id] || "";
        autoResizeTextarea();
        if (!isBlocked) setTimeout(() => Els.messageInput.focus(), 80);
    }
    if (Els.sendButton) Els.sendButton.disabled = isBlocked;
    if (Els.voiceButton) Els.voiceButton.disabled = isBlocked;
    if (Els.attachmentButton) Els.attachmentButton.disabled = isBlocked;
    if (Els.emojiButton) Els.emojiButton.disabled = isBlocked;
    if (Els.videoCallButton) Els.videoCallButton.disabled = isBlocked;
    if (Els.audioCallButton) Els.audioCallButton.disabled = isBlocked;
    if (Els.chatSearchButton) Els.chatSearchButton.disabled = false;

    if (Els.chatHeroEmpty) Els.chatHeroEmpty.hidden = true;
    if (Els.secureNotice) Els.secureNotice.hidden = false;

    if (Els.activeChatName) Els.activeChatName.textContent = AppState.activePeer.name;
    if (Els.activeUserButton) {
        const av = Els.activeUserButton.querySelector(".user-avatar");
        if (av) {
            av.className = "user-avatar " + Dom.avatarClass(AppState.activePeer.name);
            applyAvatar(av, AppState.activePeer.avatarUrl, AppState.activePeer.name);
        }
    }

    updateActivePeerStatus();
    updateDetails(AppState.activePeer);
    subscribeConversation(id);

    await loadMessages(false);
    await AppState.client.rpc("mark_conversation_read", { p_conversation_id: id });
    await refreshPeerRead();
    await loadConversations();

    if (Els.chatApp) Els.chatApp.classList.add("chat-open");
}

function updateActivePeerStatus() {
    if (!Els.activeChatStatus || !AppState.activePeer) return;
    if (AppState.blockedIds.has(AppState.activePeer.id)) {
        setStatus("Blocked", false);
        return;
    }
    if (AppState.activePeer.isGroup) {
        setStatus("Group conversation", false);
        return;
    }
    if (AppState.activePeer.id && AppState.onlinePeers.has(AppState.activePeer.id)) {
        setStatus("Online", true);
    } else {
        setStatus(AppState.activePeer.lastSeenAt ? ("Last seen " + Dom.formatTime(AppState.activePeer.lastSeenAt)) : "Offline", false);
    }
}

function setStatus(text, online) {
    if (!Els.activeChatStatus) return;
    Dom.clear(Els.activeChatStatus);
    const i = document.createElement("i");
    if (online) i.className = "status-online-dot";
    Els.activeChatStatus.appendChild(i);
    Els.activeChatStatus.appendChild(document.createTextNode(" " + text));
}

// ==========================================================================
// 8. MESSAGE RENDERING & ACTION BAR
// ==========================================================================

function formatSeparatorDate(dateStr) {
    const d = new Date(dateStr);
    const now = new Date();
    const isToday = d.toDateString() === now.toDateString();
    if (isToday) return "Today";
    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
    return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

function appendDateSeparator(dateStr, prepend) {
    const sepText = formatSeparatorDate(dateStr);
    if (sepText === lastRenderedDateString && !prepend) return;
    lastRenderedDateString = sepText;

    const div = document.createElement("div");
    div.className = "date-separator";
    div.style.textAlign = "center";
    div.style.margin = "12px 0";
    div.innerHTML = `<span style="background:rgba(255,255,255,0.06);padding:3px 10px;border-radius:12px;font-size:11px;color:var(--muted);font-weight:600;">${sepText}</span>`;

    if (prepend) {
        const btn = document.getElementById("loadOlderBtn");
        Els.chatMessages.insertBefore(div, btn ? btn.nextSibling : Els.chatMessages.firstChild);
    } else {
        Els.chatMessages.appendChild(div);
    }
}

function messageStatusTicks(msg) {
    if (msg.sender_id !== AppState.currentUser.id) return "";
    if (msg._failed) return " !";
    if (msg._queued) return " 🕒";
    if (msg._sending) return " …";
    if (AppState.peerReadAt && new Date(msg.created_at) <= new Date(AppState.peerReadAt)) return " ✓✓";
    return " ✓";
}

function appendMessage(msg, prepend = false) {
    if (!msg || AppState.renderedMessageIds.has(msg.id)) return;
    if (msg.id) AppState.renderedMessageIds.add(msg.id);

    appendDateSeparator(msg.created_at, prepend);

    const isMine = msg.sender_id === AppState.currentUser.id;
    const isStarred = AppState.starredMessageIds.has(msg.id);
    const wrap = document.createElement("div");
    wrap.className = "message " + (isMine ? "sent" : "received");
    wrap.dataset.id = msg.id || msg.client_id || "";
    if (msg.client_id) wrap.dataset.clientId = msg.client_id;
    if (msg.created_at) wrap.dataset.createdAt = msg.created_at;

    const bubble = document.createElement("div");
    bubble.className = "message-bubble";

    // Reply quote preview if present
    if (msg.reply_to || (msg.content && msg.content.startsWith("> "))) {
        let quoteName = "Message";
        let quoteText = "";
        if (msg.content && msg.content.startsWith("> ")) {
            const firstLine = msg.content.split("\n")[0];
            quoteText = firstLine.replace(/^>\s*/, "");
        }
        const quoteDiv = document.createElement("div");
        quoteDiv.className = "message-reply-quote";
        quoteDiv.innerHTML = `<strong>${Dom.escape(quoteName)}</strong><span>${Dom.escape(quoteText)}</span>`;
        quoteDiv.addEventListener("click", () => {
            showToast("Referenced earlier message", "fa-solid fa-reply");
        });
        bubble.appendChild(quoteDiv);
    }

    // Message Content by Type
    if (msg.deleted_at || msg.content === "This message was deleted") {
        const p = document.createElement("p");
        p.className = "message-deleted";
        p.innerHTML = `<i class="fa-solid fa-ban"></i> <em>This message was deleted</em>`;
        bubble.appendChild(p);
    } else if (msg.message_type === "image" && msg._url) {
        const img = document.createElement("img");
        img.className = "message-image";
        img.src = msg._url;
        img.alt = msg.content || "Image";
        img.style.cursor = "zoom-in";
        img.style.borderRadius = "8px";
        img.style.maxWidth = "100%";
        img.addEventListener("click", () => openLightbox(msg._url, msg.content, AppState.activePeer?.name));
        bubble.appendChild(img);
        if (msg.content && msg.content !== "file" && !msg.content.endsWith(".png") && !msg.content.endsWith(".jpg")) {
            const cap = document.createElement("p");
            cap.textContent = msg.content;
            bubble.appendChild(cap);
        }
    } else if (msg.message_type === "audio" && msg._url) {
        // Voice Note Player
        const voiceWrap = document.createElement("div");
        voiceWrap.className = "voice-note-player";
        const playBtn = document.createElement("button");
        playBtn.type = "button";
        playBtn.className = "voice-play-btn";
        playBtn.innerHTML = `<i class="fa-solid fa-play"></i>`;

        const audio = new Audio(msg._url);
        const meta = document.createElement("div");
        meta.className = "voice-meta";
        const track = document.createElement("div");
        track.className = "voice-progress-track";
        const fill = document.createElement("div");
        fill.className = "voice-progress-fill";
        track.appendChild(fill);
        const timeSpan = document.createElement("span");
        timeSpan.className = "voice-time";
        timeSpan.textContent = "Voice note";

        audio.addEventListener("timeupdate", () => {
            if (audio.duration) {
                const pct = (audio.currentTime / audio.duration) * 100;
                fill.style.width = pct + "%";
                timeSpan.textContent = formatTimerSeconds(Math.floor(audio.currentTime));
            }
        });
        audio.addEventListener("ended", () => {
            playBtn.innerHTML = `<i class="fa-solid fa-play"></i>`;
            fill.style.width = "0%";
        });

        playBtn.addEventListener("click", () => {
            if (audio.paused) {
                audio.play();
                playBtn.innerHTML = `<i class="fa-solid fa-pause"></i>`;
            } else {
                audio.pause();
                playBtn.innerHTML = `<i class="fa-solid fa-play"></i>`;
            }
        });

        meta.appendChild(track);
        meta.appendChild(timeSpan);
        voiceWrap.appendChild(playBtn);
        voiceWrap.appendChild(meta);
        bubble.appendChild(voiceWrap);
    } else if (msg.message_type === "file") {
        const p = document.createElement("p");
        p.style.display = "flex";
        p.style.alignItems = "center";
        p.style.gap = "8px";
        const icon = document.createElement("i");
        icon.className = "fa-solid fa-file-lines";
        p.appendChild(icon);

        if (msg._url) {
            const a = document.createElement("a");
            a.href = msg._url;
            a.target = "_blank";
            a.download = msg.content || "document";
            a.textContent = msg.content || "Download Attachment";
            a.style.color = "var(--green-bright)";
            p.appendChild(a);
        } else {
            p.appendChild(document.createTextNode(" " + (msg.content || "Attachment")));
        }
        bubble.appendChild(p);
    } else {
        const p = document.createElement("p");
        // Strip quote line if needed
        let text = msg.content || "";
        if (text.startsWith("> ") && text.includes("\n")) {
            text = text.substring(text.indexOf("\n") + 1);
        }
        p.textContent = text;
        bubble.appendChild(p);
    }

    // Meta (Timestamp, edited tag, read receipts, star)
    const meta = document.createElement("div");
    meta.className = "message-meta";
    const time = document.createElement("time");
    time.textContent = Dom.formatTime(msg.created_at);
    meta.appendChild(time);

    if (msg.edited_at) {
        const editedSpan = document.createElement("span");
        editedSpan.className = "message-edited-tag";
        editedSpan.textContent = " (edited)";
        meta.appendChild(editedSpan);
    }

    if (isStarred) {
        const star = document.createElement("i");
        star.className = "fa-solid fa-star message-star-badge";
        meta.appendChild(star);
    }

    if (isMine) {
        const read = document.createElement("span");
        read.className = "message-read";
        read.textContent = messageStatusTicks(msg);
        if (msg._failed) {
            read.style.color = "#EF4444";
            read.style.cursor = "pointer";
            read.title = "Click to retry";
            read.addEventListener("click", () => retryMessage(msg));
        }
        meta.appendChild(read);
    }
    bubble.appendChild(meta);

    // Reactions container on message bubble
    const reactionsWrap = document.createElement("div");
    reactionsWrap.className = "message-reactions-wrap";
    reactionsWrap.dataset.reactionsFor = msg.id || "";
    renderMessageReactions(msg.id, reactionsWrap);
    bubble.appendChild(reactionsWrap);

    // Message Actions Bar (Hover)
    if (!msg.deleted_at) {
        const actionsBar = document.createElement("div");
        actionsBar.className = "message-actions-bar";

        // React
        const reactBtn = document.createElement("button");
        reactBtn.type = "button";
        reactBtn.className = "msg-act-btn";
        reactBtn.title = "React";
        reactBtn.innerHTML = `<i class="fa-regular fa-face-smile"></i>`;
        reactBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            openReactionPopup(e, msg.id);
        });

        // Reply
        const replyBtn = document.createElement("button");
        replyBtn.type = "button";
        replyBtn.className = "msg-act-btn";
        replyBtn.title = "Reply";
        replyBtn.innerHTML = `<i class="fa-solid fa-reply"></i>`;
        replyBtn.addEventListener("click", () => setReplyMessage(msg));

        // Star
        const starBtn = document.createElement("button");
        starBtn.type = "button";
        starBtn.className = "msg-act-btn";
        starBtn.title = isStarred ? "Unstar" : "Star";
        starBtn.innerHTML = `<i class="${isStarred ? "fa-solid fa-star" : "fa-regular fa-star"}"></i>`;
        starBtn.addEventListener("click", () => toggleStarMessage(msg.id));

        // Copy
        const copyBtn = document.createElement("button");
        copyBtn.type = "button";
        copyBtn.className = "msg-act-btn";
        copyBtn.title = "Copy";
        copyBtn.innerHTML = `<i class="fa-regular fa-copy"></i>`;
        copyBtn.addEventListener("click", () => {
            navigator.clipboard.writeText(msg.content || "");
            showToast("Copied to clipboard", "fa-solid fa-copy");
        });

        // Info
        const infoBtn = document.createElement("button");
        infoBtn.type = "button";
        infoBtn.className = "msg-act-btn";
        infoBtn.title = "Message info";
        infoBtn.innerHTML = `<i class="fa-solid fa-circle-info"></i>`;
        infoBtn.addEventListener("click", () => openMessageInfoModal(msg));

        // Forward
        const fwdBtn = document.createElement("button");
        fwdBtn.type = "button";
        fwdBtn.className = "msg-act-btn";
        fwdBtn.title = "Forward";
        fwdBtn.innerHTML = `<i class="fa-solid fa-share"></i>`;
        fwdBtn.addEventListener("click", () => forwardMessage(msg));

        actionsBar.appendChild(reactBtn);
        actionsBar.appendChild(replyBtn);
        actionsBar.appendChild(starBtn);
        actionsBar.appendChild(copyBtn);
        actionsBar.appendChild(infoBtn);
        actionsBar.appendChild(fwdBtn);

        // Edit (own text messages only)
        if (isMine && msg.message_type === "text") {
            const editBtn = document.createElement("button");
            editBtn.type = "button";
            editBtn.className = "msg-act-btn";
            editBtn.title = "Edit";
            editBtn.innerHTML = `<i class="fa-solid fa-pencil"></i>`;
            editBtn.addEventListener("click", () => startEditingMessage(msg));
            actionsBar.appendChild(editBtn);
        }

        // Delete
        const delBtn = document.createElement("button");
        delBtn.type = "button";
        delBtn.className = "msg-act-btn";
        delBtn.title = "Delete";
        delBtn.innerHTML = `<i class="fa-solid fa-trash-can"></i>`;
        delBtn.addEventListener("click", () => promptDeleteMessage(msg));
        actionsBar.appendChild(delBtn);

        wrap.appendChild(actionsBar);
    }

    wrap.appendChild(bubble);

    if (prepend) {
        const btn = document.getElementById("loadOlderBtn");
        Els.chatMessages.insertBefore(wrap, btn ? btn.nextSibling : Els.chatMessages.firstChild);
    } else {
        Els.chatMessages.appendChild(wrap);
        if (Els.typingIndicator) Els.chatMessages.appendChild(Els.typingIndicator);
    }
}

function openMessageInfoModal(msg) {
    if (!Els.messageInfoModal || !Els.msgInfoDetails) return;
    const isMine = msg.sender_id === AppState.currentUser?.id;
    const senderName = isMine ? "You" : (AppState.activePeer?.name || "Contact");
    const sentTime = msg.created_at ? new Date(msg.created_at).toLocaleString() : "Unknown";
    const statusText = !isMine ? "Received" : (msg._failed ? "Failed (click retry)" : (msg._queued ? "Queued offline" : (msg._sending ? "Sending…" : (AppState.peerReadAt && new Date(msg.created_at) <= new Date(AppState.peerReadAt) ? "Read by recipient (✓✓)" : "Delivered to server (✓)"))));

    Els.msgInfoDetails.innerHTML = `
        <div class="msg-info-row">
            <span class="label">Sender</span>
            <span class="value">${Dom.escape(senderName)}</span>
        </div>
        <div class="msg-info-row">
            <span class="label">Sent Time</span>
            <span class="value">${Dom.escape(sentTime)}</span>
        </div>
        <div class="msg-info-row">
            <span class="label">Delivery Status</span>
            <span class="value">${Dom.escape(statusText)}</span>
        </div>
        <div class="msg-info-row">
            <span class="label">Message Type</span>
            <span class="value" style="text-transform: capitalize;">${Dom.escape(msg.message_type || "text")}</span>
        </div>
        <div class="msg-info-row">
            <span class="label">Message ID</span>
            <span class="value" style="font-family: monospace; font-size: 11px;">${Dom.escape(msg.id || msg.client_id || "Pending")}</span>
        </div>
    `;
    Els.messageInfoModal.hidden = false;
}

function forwardMessage(msg) {
    if (!msg || !msg.content) return;
    if (Els.messageInput) {
        Els.messageInput.value = `Forwarded: ${msg.content}`;
        autoResizeTextarea();
        Els.messageInput.focus();
        showToast("Message loaded into composer to forward.", "fa-solid fa-share");
    }
}

function addMessageReaction(msgId, emoji) {
    if (!msgId || !emoji) return;
    let data = AppState.reactions.get(msgId);
    if (!data) {
        data = { counts: {}, userReacted: [] };
    }
    const hadReacted = data.userReacted && data.userReacted.includes(emoji);
    if (hadReacted) {
        data.counts[emoji] = Math.max((data.counts[emoji] || 1) - 1, 0);
        if (data.counts[emoji] === 0) delete data.counts[emoji];
        data.userReacted = data.userReacted.filter(e => e !== emoji);
    } else {
        data.counts[emoji] = (data.counts[emoji] || 0) + 1;
        if (!data.userReacted) data.userReacted = [];
        data.userReacted.push(emoji);
    }
    AppState.reactions.set(msgId, data);
    saveReactions();

    if (typingChannel) {
        typingChannel.send({
            type: "broadcast",
            event: "reaction",
            payload: { message_id: msgId, emoji, user_id: AppState.currentUser?.id, added: !hadReacted }
        });
    }

    const wrap = Els.chatMessages.querySelector(`[data-reactions-for="${msgId}"]`);
    if (wrap) renderMessageReactions(msgId, wrap);
}

function renderMessageReactions(msgId, container) {
    if (!container) return;
    Dom.clear(container);
    const data = AppState.reactions.get(msgId);
    if (!data || !data.counts) return;

    Object.entries(data.counts).forEach(([emoji, count]) => {
        if (count <= 0) return;
        const pill = document.createElement("button");
        pill.type = "button";
        const userHas = data.userReacted && data.userReacted.includes(emoji);
        pill.className = "message-reaction-pill" + (userHas ? " user-reacted" : "");
        pill.innerHTML = `<span>${emoji}</span> <span>${count}</span>`;
        pill.title = userHas ? `You reacted with ${emoji}` : `${count} reaction(s)`;
        pill.addEventListener("click", () => addMessageReaction(msgId, emoji));
        container.appendChild(pill);
    });
}

function renderAllReactions() {
    Els.chatMessages.querySelectorAll(".message-reactions-wrap").forEach(wrap => {
        const id = wrap.dataset.reactionsFor;
        if (id) renderMessageReactions(id, wrap);
    });
}

function scrollMessagesToBottom() {
    if (Els.chatMessages) Els.chatMessages.scrollTop = Els.chatMessages.scrollHeight;
}

// ==========================================================================
// 9. MESSAGE LOADING & REALTIME PIPELINE
// ==========================================================================

async function hydrateAttachment(msg) {
    if (msg.message_type !== "image" && msg.message_type !== "file" && msg.message_type !== "audio") return msg;
    try {
        const { data } = await AppState.client
            .from("attachments")
            .select("storage_path, filename, mime_type, size_bytes")
            .eq("message_id", msg.id)
            .maybeSingle();
        if (!data) return msg;
        const { data: signed } = await AppState.client.storage.from("chat-attachments").createSignedUrl(data.storage_path, 3600);
        msg._url = signed && signed.signedUrl;
        msg.content = msg.content || data.filename;
    } catch { /* silent */ }
    return msg;
}

async function loadMessages(older) {
    if (!AppState.activeConversationId || AppState.loadingOlder) return;
    if (older && !AppState.hasMore) return;

    AppState.loadingOlder = true;
    if (Els.loadOlderBtn && older) Els.loadOlderBtn.textContent = "Loading…";

    const prevScrollHeight = Els.chatMessages ? Els.chatMessages.scrollHeight : 0;
    const prevScrollTop = Els.chatMessages ? Els.chatMessages.scrollTop : 0;

    let query = AppState.client
        .from("messages")
        .select("id, conversation_id, sender_id, content, message_type, created_at, client_id, edited_at, deleted_at")
        .eq("conversation_id", AppState.activeConversationId)
        .order("created_at", { ascending: false })
        .limit(PAGE_SIZE);

    if (older && AppState.oldestCursor) query = query.lt("created_at", AppState.oldestCursor);

    const { data, error } = await query;
    AppState.loadingOlder = false;

    if (error) {
        showToast(error.message, "fa-solid fa-triangle-exclamation");
        if (Els.loadOlderBtn) Els.loadOlderBtn.textContent = "Load older messages";
        return;
    }

    const batch = (data || []).slice().reverse();
    AppState.hasMore = (data || []).length === PAGE_SIZE;

    if (!older) {
        clearMessageElements();
        AppState.renderedMessageIds = new Set();
        AppState.messages = batch;
        if (Els.chatHeroEmpty) Els.chatHeroEmpty.hidden = true;
        if (Els.secureNotice) Els.secureNotice.hidden = false;
    }

    if (Els.loadOlderBtn) Els.loadOlderBtn.hidden = !AppState.hasMore;
    if (batch.length) AppState.oldestCursor = batch[0].created_at;

    for (const msg of batch) {
        await hydrateAttachment(msg);
        appendMessage(msg, older);
    }

    if (!older) {
        // Also display any offline queued messages for this conversation at the bottom
        const queuedForThread = AppState.offlineQueue.filter(q => q.conversation_id === AppState.activeConversationId);
        queuedForThread.forEach(q => appendMessage(q, false));

        if (batch.length === 0 && queuedForThread.length === 0) {
            const starter = document.createElement("div");
            starter.className = "thread-starter-banner";
            starter.innerHTML = `
                <i class="fa-solid fa-comments"></i>
                <strong>No messages yet</strong>
                <p>Say hello to ${Dom.escape(AppState.activePeer ? AppState.activePeer.name : "your friend")}! Send a message below. 👋</p>
            `;
            Els.chatMessages.insertBefore(starter, Els.typingIndicator || null);
        }
        scrollMessagesToBottom();
    } else {
        // PRESERVE SCROLL POSITION ON OLDER HISTORY PREPEND
        if (Els.chatMessages) {
            const newScrollHeight = Els.chatMessages.scrollHeight;
            Els.chatMessages.scrollTop = prevScrollTop + (newScrollHeight - prevScrollHeight);
        }
    }

    if (Els.loadOlderBtn && AppState.hasMore) Els.loadOlderBtn.textContent = "Load older messages";
}

async function refreshPeerRead() {
    if (!AppState.activeConversationId) return;
    try {
        const { data } = await AppState.client.rpc("get_peer_read_at", { p_conversation_id: AppState.activeConversationId });
        AppState.peerReadAt = data || null;
        Els.chatMessages.querySelectorAll(".message.sent").forEach((node) => {
            const tick = node.querySelector(".message-read");
            if (tick && !tick.textContent.includes("!")) {
                const msgTime = node.dataset.createdAt ? new Date(node.dataset.createdAt) : null;
                const isRead = AppState.peerReadAt && msgTime && msgTime <= new Date(AppState.peerReadAt);
                tick.textContent = isRead ? " ✓✓" : " ✓";
                if (isRead) {
                    tick.classList.add("read");
                } else {
                    tick.classList.remove("read");
                }
            }
        });
    } catch { /* silent */ }
}

function unsubscribeConversation() {
    if (messageChannel) {
        AppState.client.removeChannel(messageChannel);
        messageChannel = null;
    }
    if (typingChannel) {
        AppState.client.removeChannel(typingChannel);
        typingChannel = null;
    }
}

function subscribeConversation(id) {
    unsubscribeConversation();

    messageChannel = AppState.client
        .channel("messages:" + id)
        .on("postgres_changes", {
            event: "INSERT",
            schema: "public",
            table: "messages",
            filter: "conversation_id=eq." + id
        }, async (payload) => {
            const msg = payload.new;
            if (AppState.renderedMessageIds.has(msg.id)) return;

            // Reconcile optimistic message if matching client_id exists
            if (msg.client_id && AppState.optimisticClientIds.has(msg.client_id)) {
                AppState.optimisticClientIds.delete(msg.client_id);
                const optEl = Els.chatMessages.querySelector(`[data-client-id="${msg.client_id}"]`)
                           || Els.chatMessages.querySelector(`[data-id="tmp-${msg.client_id}"]`);
                if (optEl) {
                    optEl.dataset.id = msg.id;
                    optEl.dataset.createdAt = msg.created_at;
                    optEl.classList.remove("sending");
                    const tick = optEl.querySelector(".message-read");
                    if (tick) tick.textContent = messageStatusTicks(msg);
                    AppState.renderedMessageIds.add(msg.id);
                    AppState.renderedMessageIds.delete("tmp-" + msg.client_id);
                    return;
                }
            }

            const starter = Els.chatMessages.querySelector(".thread-starter-banner");
            if (starter) starter.remove();
            await hydrateAttachment(msg);
            appendMessage(msg, false);
            scrollMessagesToBottom();
            if (msg.sender_id !== AppState.currentUser.id) {
                await AppState.client.rpc("mark_conversation_read", { p_conversation_id: id });
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

    typingChannel = AppState.client.channel("typing:" + id, { config: { broadcast: { self: false } } });
    typingChannel.on("broadcast", { event: "typing" }, (payload) => {
        if (!Els.typingIndicator) return;
        const from = payload.payload && payload.payload.user_id;
        if (from === AppState.currentUser?.id) return;
        Els.typingIndicator.hidden = false;
        if (Els.typingLabel) {
            Els.typingLabel.textContent = (AppState.activePeer?.name || "Someone") + " is typing...";
        }
        clearTimeout(Els.typingIndicator._hide);
        Els.typingIndicator._hide = setTimeout(() => { Els.typingIndicator.hidden = true; }, 2500);
    });
    typingChannel.on("broadcast", { event: "typing_stop" }, (payload) => {
        if (!Els.typingIndicator) return;
        const from = payload.payload && payload.payload.user_id;
        if (from !== AppState.currentUser?.id) {
            Els.typingIndicator.hidden = true;
        }
    });
    typingChannel.on("broadcast", { event: "reaction" }, (payload) => {
        const p = payload.payload;
        if (p && p.message_id && p.emoji) {
            let data = AppState.reactions.get(p.message_id) || { counts: {}, userReacted: [] };
            if (p.added) {
                data.counts[p.emoji] = (data.counts[p.emoji] || 0) + 1;
            } else {
                data.counts[p.emoji] = Math.max((data.counts[p.emoji] || 1) - 1, 0);
            }
            AppState.reactions.set(p.message_id, data);
            saveReactions();
            const wrap = Els.chatMessages.querySelector(`[data-reactions-for="${p.message_id}"]`);
            if (wrap) renderMessageReactions(p.message_id, wrap);
        }
    });
    typingChannel.subscribe();
}

function subscribeInbox() {
    if (inboxChannel) AppState.client.removeChannel(inboxChannel);
    inboxChannel = AppState.client
        .channel("inbox:" + AppState.currentUser.id)
        .on("postgres_changes", { event: "*", schema: "public", table: "conversations" }, () => loadConversations())
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "notifications", filter: "user_id=eq." + AppState.currentUser.id }, (payload) => {
            const row = payload.new;
            if (row && row.body) showToast(row.body, "fa-solid fa-bell");
            loadConversations();
        })
        .subscribe();
}

function subscribePresence() {
    if (presenceChannel) AppState.client.removeChannel(presenceChannel);
    presenceChannel = AppState.client.channel("vchat-presence", {
        config: { presence: { key: AppState.currentUser.id } }
    });
    presenceChannel.on("presence", { event: "sync" }, () => {
        const state = presenceChannel.presenceState();
        AppState.onlinePeers = new Set(Object.keys(state));
        renderConversationList();
        updateActivePeerStatus();
    });
    presenceChannel.subscribe(async (status) => {
        if (status === "SUBSCRIBED") {
            await presenceChannel.track({ online_at: new Date().toISOString() });
            await AppState.client.rpc("touch_last_seen");
        }
    });
}

// ==========================================================================
// 10. COMPOSER, SENDING & EDITING FLOW
// ==========================================================================

function autoResizeTextarea() {
    if (!Els.messageInput) return;
    Els.messageInput.style.height = "auto";
    Els.messageInput.style.height = Math.min(Els.messageInput.scrollHeight, 120) + "px";
}

let lastTypingEmit = 0;
let typingStopTimer = null;

function emitTyping() {
    if (!typingChannel || !AppState.currentUser || !AppState.activeConversationId) return;
    const now = Date.now();
    if (now - lastTypingEmit > 2500) {
        lastTypingEmit = now;
        typingChannel.send({
            type: "broadcast",
            event: "typing",
            payload: { user_id: AppState.currentUser.id, name: AppState.currentProfile?.name }
        });
    }

    clearTimeout(typingStopTimer);
    typingStopTimer = setTimeout(() => {
        stopTyping();
    }, 2000);
}

function stopTyping() {
    if (!typingChannel || !AppState.currentUser || !AppState.activeConversationId) return;
    typingChannel.send({
        type: "broadcast",
        event: "typing_stop",
        payload: { user_id: AppState.currentUser.id }
    });
}

function setReplyMessage(msg) {
    AppState.replyingTo = msg;
    if (Els.replyPreviewBar) {
        Els.replyPreviewBar.hidden = false;
        if (Els.replySenderName) {
            Els.replySenderName.textContent = msg.sender_id === AppState.currentUser.id ? "Replying to yourself" : `Replying to ${AppState.activePeer?.name || "Contact"}`;
        }
        if (Els.replyTextSnippet) {
            Els.replyTextSnippet.textContent = msg.content || (msg.message_type === "image" ? "Photo" : "Attachment");
        }
    }
    if (Els.messageInput) Els.messageInput.focus();
}

function cancelReply() {
    AppState.replyingTo = null;
    if (Els.replyPreviewBar) Els.replyPreviewBar.hidden = true;
}

function startEditingMessage(msg) {
    AppState.editingMessage = msg;
    if (Els.editingMessageBar) {
        Els.editingMessageBar.hidden = false;
        if (Els.editingTextSnippet) Els.editingTextSnippet.textContent = msg.content;
    }
    if (Els.messageInput) {
        Els.messageInput.value = msg.content;
        autoResizeTextarea();
        Els.messageInput.focus();
    }
    cancelReply();
}

function cancelEditing() {
    AppState.editingMessage = null;
    if (Els.editingMessageBar) Els.editingMessageBar.hidden = true;
    if (Els.messageInput) Els.messageInput.value = "";
    autoResizeTextarea();
}

async function sendMessage() {
    if (!Els.messageInput || AppState.sending) return;
    const text = Els.messageInput.value.trim();
    if (!text) return;

    if (!AppState.activeConversationId) {
        showToast("Start a chat from New Chat first.", "fa-solid fa-comment");
        return;
    }

    // Editing Flow
    if (AppState.editingMessage) {
        const msgId = AppState.editingMessage.id;
        try {
            const { error } = await AppState.client
                .from("messages")
                .update({ content: text, edited_at: new Date().toISOString() })
                .eq("id", msgId);
            if (error) throw error;
            showToast("Message edited", "fa-solid fa-pencil");
            cancelEditing();
            await loadMessages(false);
        } catch (err) {
            showToast(err.message || "Failed to edit message", "fa-solid fa-triangle-exclamation");
        }
        return;
    }

    // Prepend reply quote if active
    let outgoingContent = text;
    if (AppState.replyingTo) {
        const sender = AppState.replyingTo.sender_id === AppState.currentUser.id ? "You" : (AppState.activePeer?.name || "Contact");
        const snippet = (AppState.replyingTo.content || "Media").slice(0, 60);
        outgoingContent = `> ${sender}: ${snippet}\n${text}`;
        cancelReply();
    }

    const clientId = (crypto.randomUUID && crypto.randomUUID()) || String(Date.now());

    // Offline Queue Flow
    if (!navigator.onLine) {
        const queuedMsg = {
            id: "queue-" + clientId,
            client_id: clientId,
            conversation_id: AppState.activeConversationId,
            sender_id: AppState.currentUser.id,
            content: outgoingContent,
            message_type: "text",
            created_at: new Date().toISOString(),
            _queued: true
        };
        AppState.offlineQueue.push(queuedMsg);
        saveOfflineQueue();
        appendMessage(queuedMsg, false);
        scrollMessagesToBottom();
        Els.messageInput.value = "";
        autoResizeTextarea();
        delete AppState.drafts[AppState.activeConversationId];
        saveDraft(AppState.activeConversationId, "");
        showToast("Message queued offline. Will send when reconnected.", "fa-solid fa-clock");
        return;
    }

    AppState.sending = true;
    AppState.optimisticClientIds.add(clientId);
    const optimistic = {
        id: "tmp-" + clientId,
        client_id: clientId,
        conversation_id: AppState.activeConversationId,
        sender_id: AppState.currentUser.id,
        content: outgoingContent,
        message_type: "text",
        created_at: new Date().toISOString(),
        _sending: true
    };

    appendMessage(optimistic, false);
    scrollMessagesToBottom();

    Els.messageInput.value = "";
    autoResizeTextarea();
    delete AppState.drafts[AppState.activeConversationId];
    saveDraft(AppState.activeConversationId, "");
    stopTyping();

    try {
        const { data, error } = await AppState.client.rpc("send_chat_message", {
            p_conversation_id: AppState.activeConversationId,
            p_content: outgoingContent,
            p_message_type: "text",
            p_client_id: clientId
        });
        if (error) throw error;

        AppState.optimisticClientIds.delete(clientId);
        // Reconcile optimistic element in place
        const tmp = Els.chatMessages.querySelector(`[data-client-id="${clientId}"]`)
                 || Els.chatMessages.querySelector(`[data-id="tmp-${clientId}"]`);
        if (tmp && data) {
            tmp.dataset.id = data.id;
            tmp.dataset.createdAt = data.created_at;
            tmp.classList.remove("sending");
            const tick = tmp.querySelector(".message-read");
            if (tick) tick.textContent = messageStatusTicks(data);
            AppState.renderedMessageIds.add(data.id);
            AppState.renderedMessageIds.delete("tmp-" + clientId);
        } else if (data && !AppState.renderedMessageIds.has(data.id)) {
            appendMessage(data, false);
        }
        await loadConversations();
    } catch (err) {
        AppState.optimisticClientIds.delete(clientId);
        const tmp = Els.chatMessages.querySelector(`[data-client-id="${clientId}"]`)
                 || Els.chatMessages.querySelector(`[data-id="tmp-${clientId}"]`);
        if (tmp) {
            const tick = tmp.querySelector(".message-read");
            if (tick) {
                tick.textContent = " failed (retry)";
                tick.style.color = "#EF4444";
                tick.style.cursor = "pointer";
                tick.addEventListener("click", () => retryMessage(optimistic));
            }
        }
        showToast(err.message || "Message failed to send.", "fa-solid fa-triangle-exclamation");
    } finally {
        AppState.sending = false;
        if (Els.messageInput) Els.messageInput.focus();
    }
}

async function retryMessage(msg) {
    if (!navigator.onLine) return showToast("You are currently offline.", "fa-solid fa-wifi");
    showToast("Retrying message send…", "fa-solid fa-arrow-rotate-right");
    const tmp = Els.chatMessages.querySelector(`[data-id="${msg.id}"]`);
    if (tmp) tmp.remove();
    AppState.renderedMessageIds.delete(msg.id);
    if (Els.messageInput) {
        Els.messageInput.value = msg.content;
        sendMessage();
    }
}

async function drainOfflineQueue() {
    if (!navigator.onLine || AppState.offlineQueue.length === 0) return;
    const queue = [...AppState.offlineQueue];
    AppState.offlineQueue = [];
    saveOfflineQueue();

    for (const item of queue) {
        try {
            await AppState.client.rpc("send_chat_message", {
                p_conversation_id: item.conversation_id,
                p_content: item.content,
                p_message_type: item.message_type || "text",
                p_client_id: item.client_id
            });
            const queuedEl = Els.chatMessages.querySelector(`[data-id="${item.id}"]`);
            if (queuedEl) {
                const tick = queuedEl.querySelector(".message-read");
                if (tick) tick.textContent = " ✓";
            }
        } catch {
            AppState.offlineQueue.push(item);
            saveOfflineQueue();
        }
    }
    await loadConversations();
    showToast("Queued messages delivered.", "fa-solid fa-circle-check");
}

// ==========================================================================
// 11. VOICE NOTES ENGINE (Web Audio API & MediaRecorder)
// ==========================================================================

let mediaRecorder = null;
let audioChunks = [];
let voiceTimerInterval = null;
let voiceStartTime = 0;

async function startVoiceRecording() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        showToast("Audio recording is not supported in this browser.", "fa-solid fa-microphone-slash");
        return;
    }
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        mediaRecorder = new MediaRecorder(stream);
        audioChunks = [];

        mediaRecorder.ondataavailable = (e) => {
            if (e.data.size > 0) audioChunks.push(e.data);
        };

        mediaRecorder.start();
        voiceStartTime = Date.now();
        if (Els.voiceRecordingBar) Els.voiceRecordingBar.hidden = false;

        voiceTimerInterval = setInterval(() => {
            const elapsed = Math.floor((Date.now() - voiceStartTime) / 1000);
            if (Els.voiceRecordingTimer) Els.voiceRecordingTimer.textContent = formatTimerSeconds(elapsed);
        }, 500);

    } catch (err) {
        showToast("Microphone access denied: " + (err.message || "permission error"), "fa-solid fa-triangle-exclamation");
    }
}

function cancelVoiceRecording() {
    if (mediaRecorder) {
        try {
            if (mediaRecorder.state !== "inactive") mediaRecorder.stop();
            if (mediaRecorder.stream) {
                mediaRecorder.stream.getTracks().forEach((t) => t.stop());
            }
        } catch { /* silent */ }
        mediaRecorder = null;
    }
    clearInterval(voiceTimerInterval);
    audioChunks = [];
    if (Els.voiceRecordingBar) Els.voiceRecordingBar.hidden = true;
}

async function sendVoiceRecording() {
    if (!mediaRecorder || mediaRecorder.state === "inactive") return;
    clearInterval(voiceTimerInterval);
    if (Els.voiceRecordingBar) Els.voiceRecordingBar.hidden = true;

    mediaRecorder.onstop = async () => {
        mediaRecorder.stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(audioChunks, { type: "audio/webm" });
        const file = new File([blob], `voice-${Date.now()}.webm`, { type: "audio/webm" });

        showToast("Uploading voice note…", "fa-solid fa-cloud-arrow-up");
        const path = `${AppState.activeConversationId}/${AppState.currentUser.id}/${Date.now()}-voice.webm`;
        const { error: upErr } = await AppState.client.storage.from("chat-attachments").upload(path, file, {
            contentType: "audio/webm",
            upsert: false
        });
        if (upErr) return showToast(upErr.message || "Voice upload failed", "fa-solid fa-triangle-exclamation");

        const { data: msg, error: msgErr } = await AppState.client.rpc("send_chat_message", {
            p_conversation_id: AppState.activeConversationId,
            p_content: "Voice note",
            p_message_type: "audio",
            p_client_id: null
        });
        if (msgErr) return showToast(msgErr.message, "fa-solid fa-triangle-exclamation");

        await AppState.client.from("attachments").insert({
            message_id: msg.id,
            conversation_id: AppState.activeConversationId,
            storage_path: path,
            filename: file.name,
            mime_type: "audio/webm",
            size_bytes: file.size
        });
        await loadMessages(false);
    };
    mediaRecorder.stop();
}

function formatTimerSeconds(secs) {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m}:${s < 10 ? "0" : ""}${s}`;
}

// ==========================================================================
// 12. CALLING ENGINE & CALLSERVICE ARCHITECTURE (Phase 20)
// ==========================================================================

const CallService = {
    state: {
        active: false,
        mode: "audio",
        status: "idle",
        peer: null,
        timer: 0,
        interval: null,
        timeout: null,
        muted: false,
        cameraOff: false,
        stream: null,
        audioContext: null,
        ringNodes: null
    },

    start(peer, mode = "audio") {
        if (!peer) return showToast("Select a contact to call.", "fa-solid fa-phone");
        this.end();

        this.state.active = true;
        this.state.mode = mode;
        this.state.status = "calling";
        this.state.peer = peer;
        this.state.timer = 0;
        this.state.muted = false;
        this.state.cameraOff = false;

        if (Els.callModal) Els.callModal.hidden = false;
        if (Els.callContactName) Els.callContactName.textContent = peer.name;
        if (Els.callContactInitials) Els.callContactInitials.textContent = Dom.initials(peer.name);
        if (Els.callTypeBadge) {
            Els.callTypeBadge.innerHTML = mode === "video" 
                ? `<i class="fa-solid fa-video"></i> Video Call` 
                : `<i class="fa-solid fa-phone"></i> Voice Call`;
        }
        if (Els.callStatusLabel) Els.callStatusLabel.textContent = "Calling peer…";
        if (Els.callTimer) Els.callTimer.hidden = true;
        if (Els.callCameraBtn) Els.callCameraBtn.hidden = (mode !== "video");
        if (Els.callVideoPreview) Els.callVideoPreview.hidden = (mode !== "video");

        playRingTone();

        if (navigator.mediaDevices?.getUserMedia) {
            navigator.mediaDevices.getUserMedia({ video: mode === "video", audio: true })
                .then((stream) => {
                    this.state.stream = stream;
                    if (mode === "video" && Els.callLocalVideo) {
                        Els.callLocalVideo.srcObject = stream;
                    }
                })
                .catch(() => showToast("Microphone or camera permission unavailable.", "fa-solid fa-triangle-exclamation"));
        }

        setTimeout(() => {
            if (!this.state.active) return;
            if (Els.callStatusLabel) Els.callStatusLabel.textContent = "Signaling standby — Peer not connected";
        }, 2200);

        this.state.timeout = setTimeout(() => {
            if (!this.state.active) return;
            stopRingTone();
            if (Els.callStatusLabel) Els.callStatusLabel.textContent = "Peer unavailable (Signaling server offline)";
            showToast("Voice & Video calling requires a WebRTC signaling server (STUN/TURN) to exchange session offers.", "fa-solid fa-circle-info");
            setTimeout(() => this.end(), 2200);
        }, 6500);
    },

    toggleMicrophone() {
        this.state.muted = !this.state.muted;
        if (Els.callMuteBtn) Els.callMuteBtn.classList.toggle("active-off", this.state.muted);
        if (this.state.stream) {
            this.state.stream.getAudioTracks().forEach((t) => (t.enabled = !this.state.muted));
        }
        showToast(this.state.muted ? "Microphone muted" : "Microphone active", "fa-solid fa-microphone");
    },

    toggleCamera() {
        this.state.cameraOff = !this.state.cameraOff;
        if (Els.callCameraBtn) Els.callCameraBtn.classList.toggle("active-off", this.state.cameraOff);
        if (this.state.stream) {
            this.state.stream.getVideoTracks().forEach((t) => (t.enabled = !this.state.cameraOff));
        }
    },

    end() {
        stopRingTone();
        clearTimeout(this.state.timeout);
        clearInterval(this.state.interval);
        if (this.state.stream) {
            this.state.stream.getTracks().forEach((t) => t.stop());
            this.state.stream = null;
        }
        if (Els.callLocalVideo) Els.callLocalVideo.srcObject = null;
        if (Els.callStatusLabel) Els.callStatusLabel.textContent = "Call ended";
        this.state.active = false;
        setTimeout(() => {
            if (Els.callModal) Els.callModal.hidden = true;
        }, 500);
    }
};

function playRingTone() {
    try {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (!AudioCtx) return;
        const ctx = new AudioCtx();
        const osc1 = ctx.createOscillator();
        const osc2 = ctx.createOscillator();
        const gain = ctx.createGain();

        osc1.frequency.value = 440;
        osc2.frequency.value = 480;
        gain.gain.value = 0.08;

        osc1.connect(gain);
        osc2.connect(gain);
        gain.connect(ctx.destination);

        osc1.start();
        osc2.start();
        CallService.state.audioContext = ctx;
        CallService.state.ringNodes = { osc1, osc2, gain };
    } catch { /* audio not allowed yet */ }
}

function stopRingTone() {
    if (CallService.state.ringNodes) {
        try {
            CallService.state.ringNodes.osc1.stop();
            CallService.state.ringNodes.osc2.stop();
        } catch { /* silent */ }
        CallService.state.ringNodes = null;
    }
    if (CallService.state.audioContext) {
        try { CallService.state.audioContext.close(); } catch { /* silent */ }
        CallService.state.audioContext = null;
    }
}

function startCall(mode = "audio") {
    CallService.start(AppState.activePeer, mode);
}

function endCall() {
    CallService.end();
}

// ==========================================================================
// 13. MEDIA LIGHTBOX
// ==========================================================================

function openLightbox(url, title = "Photo", sender = "") {
    AppState.lightbox.active = true;
    AppState.lightbox.zoom = 1;

    // Collect all image messages in current conversation
    AppState.lightbox.items = AppState.messages
        .filter((m) => m.message_type === "image" && m._url)
        .map((m) => ({ url: m._url, title: m.content || "Photo" }));

    const foundIdx = AppState.lightbox.items.findIndex((i) => i.url === url);
    AppState.lightbox.currentIndex = foundIdx >= 0 ? foundIdx : 0;

    if (Els.mediaLightboxModal) Els.mediaLightboxModal.hidden = false;
    if (Els.lightboxImage) {
        Els.lightboxImage.src = url;
        Els.lightboxImage.style.transform = "scale(1)";
    }
    if (Els.lightboxTitle) Els.lightboxTitle.textContent = title;
    if (Els.lightboxSubtitle) Els.lightboxSubtitle.textContent = sender ? `Shared by ${sender}` : "Shared in conversation";
    if (Els.lightboxDownloadBtn) Els.lightboxDownloadBtn.href = url;
}

function closeLightbox() {
    AppState.lightbox.active = false;
    if (Els.mediaLightboxModal) Els.mediaLightboxModal.hidden = true;
}

function lightboxNavigate(dir) {
    if (AppState.lightbox.items.length <= 1) return;
    const newIdx = (AppState.lightbox.currentIndex + dir + AppState.lightbox.items.length) % AppState.lightbox.items.length;
    AppState.lightbox.currentIndex = newIdx;
    const item = AppState.lightbox.items[newIdx];
    if (Els.lightboxImage) {
        Els.lightboxImage.src = item.url;
        Els.lightboxImage.style.transform = "scale(1)";
    }
    AppState.lightbox.zoom = 1;
    if (Els.lightboxTitle) Els.lightboxTitle.textContent = item.title;
    if (Els.lightboxDownloadBtn) Els.lightboxDownloadBtn.href = item.url;
}

// ==========================================================================
// 14. IN-CHAT MESSAGE SEARCH
// ==========================================================================

function toggleInChatSearch() {
    if (!AppState.activeConversationId) return showToast("Select a conversation to search.", "fa-solid fa-magnifying-glass");
    AppState.inChatSearch.active = !AppState.inChatSearch.active;
    if (Els.inChatSearchBar) {
        Els.inChatSearchBar.hidden = !AppState.inChatSearch.active;
        if (AppState.inChatSearch.active && Els.inChatSearchInput) {
            Els.inChatSearchInput.value = "";
            Els.inChatSearchInput.focus();
        }
    }
    if (!AppState.inChatSearch.active) clearSearchHighlights();
}

function performInChatSearch() {
    clearSearchHighlights();
    const query = (Els.inChatSearchInput?.value || "").trim().toLowerCase();
    AppState.inChatSearch.query = query;
    if (!query) {
        if (Els.inChatSearchMatchCount) Els.inChatSearchMatchCount.textContent = "0 of 0";
        AppState.inChatSearch.matches = [];
        return;
    }

    const matches = [];
    Els.chatMessages.querySelectorAll(".message p").forEach((p) => {
        const text = p.textContent;
        if (text.toLowerCase().includes(query)) {
            const escaped = Dom && typeof Dom.escape === "function" ? Dom.escape(text) : text;
            const escapedQuery = Dom && typeof Dom.escape === "function" ? Dom.escape(query) : query;
            const regex = new RegExp(`(${escapedQuery.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi");
            p.innerHTML = escaped.replace(regex, `<mark class="chat-search-highlight">$1</mark>`);
            matches.push(p);
        }
    });

    AppState.inChatSearch.matches = matches;
    AppState.inChatSearch.currentIndex = matches.length > 0 ? 0 : -1;
    updateSearchMatchDisplay();
}

function updateSearchMatchDisplay() {
    const total = AppState.inChatSearch.matches.length;
    const current = AppState.inChatSearch.currentIndex;
    if (Els.inChatSearchMatchCount) {
        Els.inChatSearchMatchCount.textContent = total > 0 ? `${current + 1} of ${total}` : "0 of 0";
    }
    Els.chatMessages.querySelectorAll("mark.chat-search-highlight-active").forEach((m) => m.classList.remove("chat-search-highlight-active"));
    if (current >= 0 && AppState.inChatSearch.matches[current]) {
        const target = AppState.inChatSearch.matches[current];
        const mark = target.querySelector("mark");
        if (mark) mark.classList.add("chat-search-highlight-active");
        target.scrollIntoView({ behavior: "smooth", block: "center" });
    }
}

function clearSearchHighlights() {
    Els.chatMessages.querySelectorAll(".message p").forEach((p) => {
        if (p.querySelector("mark")) p.textContent = p.textContent;
    });
}

// ==========================================================================
// 15. STARRED, PINNED, MUTED & CONTEXT MENUS
// ==========================================================================

function toggleStarMessage(msgId) {
    if (AppState.starredMessageIds.has(msgId)) {
        AppState.starredMessageIds.delete(msgId);
        showToast("Message unstarred", "fa-regular fa-star");
    } else {
        AppState.starredMessageIds.add(msgId);
        showToast("Message starred", "fa-solid fa-star");
    }
    saveStarred();
    loadMessages(false);
}

function openStarredModal() {
    if (Els.starredMessagesModal) Els.starredMessagesModal.hidden = false;
    if (!Els.starredMessagesList) return;
    Dom.clear(Els.starredMessagesList);

    const starredList = AppState.messages.filter((m) => AppState.starredMessageIds.has(m.id));
    if (starredList.length === 0) {
        Els.starredMessagesList.innerHTML = `
            <div class="empty-starred-placeholder">
                <i class="fa-regular fa-star"></i>
                <strong>No starred messages</strong>
                <p>Star messages in this conversation to quickly reference them here.</p>
            </div>
        `;
        return;
    }

    starredList.forEach((msg) => {
        const card = document.createElement("div");
        card.className = "starred-item-card";
        card.innerHTML = `
            <div class="starred-item-header">
                <strong>${msg.sender_id === AppState.currentUser.id ? "You" : (AppState.activePeer?.name || "Contact")}</strong>
                <span>${Dom.formatTime(msg.created_at)}</span>
            </div>
            <div class="starred-item-text">${Dom.escape(msg.content || "Attachment")}</div>
        `;
        card.addEventListener("click", () => {
            if (Els.starredMessagesModal) Els.starredMessagesModal.hidden = true;
            const el = Els.chatMessages.querySelector(`[data-id="${msg.id}"]`);
            if (el) {
                el.scrollIntoView({ behavior: "smooth", block: "center" });
                el.classList.add("message-highlighted");
                setTimeout(() => el.classList.remove("message-highlighted"), 1600);
            }
        });
        Els.starredMessagesList.appendChild(card);
    });
}

function openSharedMediaModal() {
    if (Els.sharedMediaModal) Els.sharedMediaModal.hidden = false;
    if (!Els.sharedMediaBrowserGrid) return;
    Dom.clear(Els.sharedMediaBrowserGrid);

    const mediaList = AppState.messages.filter((m) => m.message_type === "image" || m.message_type === "file");
    if (mediaList.length === 0) {
        Els.sharedMediaBrowserGrid.innerHTML = `<div style="grid-column:1/-1;text-align:center;color:var(--muted);padding:30px;">No shared media in this chat.</div>`;
        return;
    }

    mediaList.forEach((m) => {
        const item = document.createElement("div");
        item.className = "shared-browser-item";
        if (m.message_type === "image" && m._url) {
            item.innerHTML = `<img src="${m._url}" alt="Media">`;
            item.addEventListener("click", () => {
                if (Els.sharedMediaModal) Els.sharedMediaModal.hidden = true;
                openLightbox(m._url, m.content, AppState.activePeer?.name);
            });
        } else {
            item.innerHTML = `<i class="fa-solid fa-file-lines" style="font-size:24px;color:var(--green-bright);"></i>`;
        }
        Els.sharedMediaBrowserGrid.appendChild(item);
    });
}

function openContextMenu(event, convId) {
    selectedContextConvoId = convId;
    if (!Els.convContextMenu) return;
    Els.convContextMenu.hidden = false;
    Els.convContextMenu.style.left = `${Math.min(event.clientX, window.innerWidth - 200)}px`;
    Els.convContextMenu.style.top = `${Math.min(event.clientY, window.innerHeight - 200)}px`;

    const isPinned = AppState.pinnedChatIds.has(convId);
    const isMuted = AppState.mutedChats.has(convId);
    if (Els.ctxPinLabel) Els.ctxPinLabel.textContent = isPinned ? "Unpin chat" : "Pin chat";
    if (Els.ctxMuteLabel) Els.ctxMuteLabel.textContent = isMuted ? "Unmute notifications" : "Mute notifications";
}

function closeContextMenu() {
    if (Els.convContextMenu) Els.convContextMenu.hidden = true;
}

function openReactionPopup(event, msgId) {
    targetReactionMsgId = msgId;
    if (!Els.messageReactionPopup) return;
    Els.messageReactionPopup.hidden = false;
    Els.messageReactionPopup.style.left = `${Math.min(event.clientX - 40, window.innerWidth - 240)}px`;
    Els.messageReactionPopup.style.top = `${Math.max(event.clientY - 46, 10)}px`;
}

function closeReactionPopup() {
    if (Els.messageReactionPopup) Els.messageReactionPopup.hidden = true;
}

// ==========================================================================
// 16. DELETE & REPORT DIALOGS
// ==========================================================================

function promptDeleteMessage(msg) {
    targetDeleteMsg = msg;
    if (!Els.deleteMessageModal) return;
    Els.deleteMessageModal.hidden = false;
    const isMine = msg.sender_id === AppState.currentUser.id;
    if (Els.deleteForEveryoneBtn) Els.deleteForEveryoneBtn.hidden = !isMine;
}

async function executeDelete(everyone = false) {
    if (!targetDeleteMsg) return;
    const msgId = targetDeleteMsg.id;
    if (Els.deleteMessageModal) Els.deleteMessageModal.hidden = true;

    if (everyone) {
        try {
            const { error } = await AppState.client
                .from("messages")
                .update({ deleted_at: new Date().toISOString(), content: "This message was deleted" })
                .eq("id", msgId);
            if (error) throw error;
            showToast("Message deleted for everyone", "fa-solid fa-trash");
            loadMessages(false);
        } catch (err) {
            showToast(err.message || "Delete failed", "fa-solid fa-triangle-exclamation");
        }
    } else {
        const el = Els.chatMessages.querySelector(`[data-id="${msgId}"]`);
        if (el) el.remove();
        showToast("Message deleted for you", "fa-solid fa-trash");
    }
}

// ==========================================================================
// 17. COMMAND PALETTE (Ctrl / Cmd + K)
// ==========================================================================

const COMMANDS = [
    { label: "Start New Chat", icon: "fa-solid fa-pen-to-square", kbd: "N", action: () => openNewChatModal() },
    { label: "Search in Conversation", icon: "fa-solid fa-magnifying-glass", kbd: "F", action: () => toggleInChatSearch() },
    { label: "Toggle Dark / Light Theme", icon: "fa-solid fa-circle-half-stroke", kbd: "T", action: () => window.toggleTheme && window.toggleTheme() },
    { label: "My Profile & Settings", icon: "fa-solid fa-user-gear", kbd: "P", action: () => openProfileEditor() },
    { label: "Starred Messages", icon: "fa-solid fa-star", kbd: "*", action: () => openStarredModal() },
    { label: "Shared Media Browser", icon: "fa-solid fa-images", kbd: "M", action: () => openSharedMediaModal() },
    { label: "Mute Notifications", icon: "fa-solid fa-bell-slash", kbd: "U", action: () => openMuteModal() }
];

function toggleCommandPalette() {
    if (!Els.commandPaletteModal) return;
    const isOpen = !Els.commandPaletteModal.hidden;
    Els.commandPaletteModal.hidden = isOpen;
    if (!isOpen && Els.commandPaletteInput) {
        Els.commandPaletteInput.value = "";
        renderCommandRows("");
        setTimeout(() => Els.commandPaletteInput.focus(), 60);
    }
}

function renderCommandRows(query) {
    if (!Els.commandPaletteResults) return;
    Dom.clear(Els.commandPaletteResults);
    const filtered = COMMANDS.filter((c) => c.label.toLowerCase().includes(query.toLowerCase()));
    filtered.forEach((cmd) => {
        const row = document.createElement("button");
        row.type = "button";
        row.className = "command-row";
        row.innerHTML = `
            <div class="command-row-left">
                <i class="${cmd.icon}"></i>
                <span>${cmd.label}</span>
            </div>
            <kbd>${cmd.kbd}</kbd>
        `;
        row.addEventListener("click", () => {
            if (Els.commandPaletteModal) Els.commandPaletteModal.hidden = true;
            cmd.action();
        });
        Els.commandPaletteResults.appendChild(row);
    });
}

// ==========================================================================
// 18. RIGHT DETAILS PANEL SYNC
// ==========================================================================

async function loadDetailsMedia() {
    if (!Els.detailsPanel || !AppState.activeConversationId) return;
    if (!Els.detailsMediaGrid) return;
    try {
        const { data } = await AppState.client
            .from("attachments")
            .select("filename, mime_type, size_bytes")
            .eq("conversation_id", AppState.activeConversationId)
            .limit(6);

        Dom.clear(Els.detailsMediaGrid);
        if (data && data.length) {
            data.forEach((file) => {
                const cell = document.createElement("div");
                cell.className = "media-placeholder";
                const isImg = (file.mime_type || "").startsWith("image/");
                cell.innerHTML = `<i class="${isImg ? "fa-regular fa-image" : "fa-regular fa-file"}"></i>`;
                cell.title = file.filename + " (" + Dom.formatBytes(file.size_bytes) + ")";
                cell.addEventListener("click", openSharedMediaModal);
                Els.detailsMediaGrid.appendChild(cell);
            });
        } else {
            Els.detailsMediaGrid.innerHTML = `
                <div class="media-placeholder empty">
                    <i class="fa-regular fa-image"></i>
                    <span>No media</span>
                </div>
            `;
        }
    } catch { /* silent */ }
}

function updateDetails(peer) {
    if (!Els.detailsPanel) return;
    if (!peer) {
        if (Els.detailsName) Els.detailsName.textContent = "Select a chat";
        if (Els.detailsStatus) Els.detailsStatus.textContent = "Offline";
        if (Els.detailsAbout) Els.detailsAbout.textContent = "Select a conversation to view contact info.";
        if (Els.detailsAvatar) {
            Dom.clear(Els.detailsAvatar);
            Els.detailsAvatar.textContent = "VC";
        }
        if (Els.detailsOnlineDot) Els.detailsOnlineDot.hidden = true;
        if (Els.detailsMediaGrid) {
            Els.detailsMediaGrid.innerHTML = `
                <div class="media-placeholder empty">
                    <i class="fa-regular fa-image"></i>
                    <span>No media</span>
                </div>
            `;
        }
        return;
    }

    if (Els.detailsName) Els.detailsName.textContent = peer.name;
    const isOnline = peer.id && AppState.onlinePeers.has(peer.id);
    if (Els.detailsStatus) {
        Els.detailsStatus.textContent = isOnline ? "Online" : (peer.lastSeenAt ? "Last seen " + Dom.formatTime(peer.lastSeenAt) : "Offline");
    }
    if (Els.detailsOnlineDot) Els.detailsOnlineDot.hidden = !isOnline;
    if (Els.detailsAbout) Els.detailsAbout.textContent = peer.about || "Available for conversation on VChat.";
    if (Els.detailsAvatar) applyAvatar(Els.detailsAvatar, peer.avatarUrl, peer.name);

    const isBlocked = AppState.blockedIds.has(peer.id);
    if (Els.detailsBlockLabel) Els.detailsBlockLabel.textContent = isBlocked ? "Unblock contact" : "Block contact";

    const isMuted = isChatMuted(AppState.activeConversationId);
    if (Els.detailsMuteLabel) Els.detailsMuteLabel.textContent = isMuted ? "Unmute notifications" : "Mute notifications";

    loadDetailsMedia();
}

function openMuteModal() {
    if (!AppState.activeConversationId) return showToast("Select a conversation first.", "fa-solid fa-bell");
    if (Els.muteModal) Els.muteModal.hidden = false;
}

function openReportModal() {
    if (!AppState.activePeer) return showToast("Select a contact first.", "fa-solid fa-shield");
    if (Els.reportModal) Els.reportModal.hidden = false;
}

// ==========================================================================
// 19. PROFILE & NEW CHAT MODALS
// ==========================================================================

function openProfileEditor() {
    if (!Els.profileModal) return;
    if (Els.profileNameInput) Els.profileNameInput.value = AppState.currentProfile.name || "";
    if (Els.profileAboutInput) Els.profileAboutInput.value = AppState.currentProfile.about || "";
    if (Els.profileEmailRead) Els.profileEmailRead.textContent = AppState.currentProfile.email || AppState.currentUser.email;
    if (Els.profileMobileRead) Els.profileMobileRead.textContent = AppState.currentProfile.mobile ? "+91 " + AppState.currentProfile.mobile : "Not set";
    if (Els.profileModalAvatar) applyAvatar(Els.profileModalAvatar, AppState.currentProfile.avatarUrl, AppState.currentProfile.name);
    Els.profileModal.hidden = false;
}

function openNewChatModal() {
    if (!Els.newChatModal) return;
    Els.newChatModal.hidden = false;
    clearNewChatFeedback();
    if (Els.newChatNumber) {
        Els.newChatNumber.value = "";
        setTimeout(() => Els.newChatNumber.focus(), 60);
    }
}

function closeNewChatModal() {
    if (Els.newChatModal) Els.newChatModal.hidden = true;
    clearNewChatFeedback();
}

function clearNewChatFeedback() {
    if (Els.newChatValidation) {
        Els.newChatValidation.hidden = true;
        Els.newChatValidation.textContent = "";
    }
    if (Els.newChatResult) {
        Els.newChatResult.hidden = true;
        Dom.clear(Els.newChatResult);
        Els.newChatResult.style.display = "none";
    }
    if (Els.findUserBtn) {
        Els.findUserBtn.disabled = false;
        Els.findUserBtn.innerHTML = `<i class="fa-solid fa-user-plus"></i><span>Find VChat user</span>`;
    }
}

async function findVChatUser() {
    const entered = V.normalizeMobile(Els.newChatNumber?.value || "");
    if (!entered) return setModalError("Please enter a mobile number.");
    if (!V.isValidMobile(entered)) return setModalError("Please enter a valid 10-digit Indian mobile number.");
    if (entered === V.normalizeMobile(AppState.currentProfile.mobile)) return setModalError("That is your own number.");

    Els.findUserBtn.disabled = true;
    Els.findUserBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i><span>Searching...</span>`;

    try {
        const { data, error } = await AppState.client.rpc("lookup_user_by_mobile", { p_mobile: entered });
        if (error) throw error;
        const user = Array.isArray(data) ? data[0] : data;
        Els.newChatResult.hidden = false;
        Els.newChatResult.style.display = "block";
        Dom.clear(Els.newChatResult);

        if (!user) {
            Els.newChatResult.innerHTML = `<div class="user-not-found">No verified VChat account found with +91 ${entered}.</div>`;
            return;
        }

        const card = document.createElement("div");
        card.className = "user-found-card";
        card.innerHTML = `
            <div class="user-found-avatar ${Dom.avatarClass(user.display_name)}">${Dom.initials(user.display_name)}</div>
            <div class="user-found-info">
                <div class="user-found-name">${Dom.escape(user.display_name)}</div>
                <div class="user-found-number">+91 ${Dom.escape(user.mobile)} • ${Dom.escape(user.about || "VChat User")}</div>
            </div>
            <button type="button" class="start-chat-btn">Start Chat</button>
        `;
        card.querySelector(".start-chat-btn").addEventListener("click", () => startNewChat(user));
        Els.newChatResult.appendChild(card);
    } catch (err) {
        setModalError(err.message || "Search failed.");
    } finally {
        Els.findUserBtn.disabled = false;
        Els.findUserBtn.innerHTML = `<i class="fa-solid fa-user-plus"></i><span>Find VChat user</span>`;
    }
}

function setModalError(msg) {
    if (!Els.newChatValidation) return;
    Els.newChatValidation.hidden = false;
    Els.newChatValidation.textContent = msg;
    if (Els.newChatResult) Els.newChatResult.hidden = true;
}

async function startNewChat(user) {
    closeNewChatModal();
    const { data, error } = await AppState.client.rpc("get_or_create_direct_conversation", { p_other_id: user.id });
    if (error) return showToast(error.message, "fa-solid fa-triangle-exclamation");
    await loadConversations();
    await openConversation(data);
    showToast("Chat created with " + user.display_name, "fa-solid fa-circle-check");
}

// ==========================================================================
// 20. POPUP PICKERS (EMOJIS & ATTACHMENTS)
// ==========================================================================

const QUICK_EMOJIS = ["😊", "🔥", "👍", "❤️", "🎉", "🙌", "😂", "✨", "💯", "🙏", "😍", "👏", "😎", "🥳", "🤔", "💡", "🚀", "💪"];

function initEmojiPicker() {
    if (!Els.emojiPickerGrid) return;
    Dom.clear(Els.emojiPickerGrid);
    QUICK_EMOJIS.forEach((char) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "emoji-item-btn";
        btn.textContent = char;
        btn.addEventListener("click", () => {
            if (Els.messageInput) {
                Els.messageInput.value += char;
                autoResizeTextarea();
                Els.messageInput.focus();
            }
            if (Els.emojiPickerPopup) Els.emojiPickerPopup.hidden = true;
        });
        Els.emojiPickerGrid.appendChild(btn);
    });
}

// ==========================================================================
// 21. ATTACHMENT PIPELINE
// ==========================================================================

async function handleFilesUpload(files) {
    if (!AppState.activeConversationId) return showToast("Open a conversation first.", "fa-solid fa-paperclip");
    for (const file of files) {
        const check = V.isAllowedAttachment(file);
        if (!check.ok) {
            showToast(check.error, "fa-solid fa-triangle-exclamation");
            continue;
        }
        const safeName = String(file.name || "file").replace(/[^\w.\-]+/g, "_").slice(0, 80);
        const path = `${AppState.activeConversationId}/${AppState.currentUser.id}/${Date.now()}-${safeName}`;
        showToast("Uploading " + file.name + "…", "fa-solid fa-cloud-arrow-up");

        const { error: upErr } = await AppState.client.storage.from("chat-attachments").upload(path, file, {
            contentType: file.type || "application/octet-stream",
            upsert: false
        });
        if (upErr) {
            showToast(upErr.message || "Upload failed.", "fa-solid fa-triangle-exclamation");
            continue;
        }

        const type = check.isImage ? "image" : "file";
        const { data: msg, error: msgErr } = await AppState.client.rpc("send_chat_message", {
            p_conversation_id: AppState.activeConversationId,
            p_content: file.name,
            p_message_type: type,
            p_client_id: null
        });
        if (msgErr) {
            showToast(msgErr.message, "fa-solid fa-triangle-exclamation");
            continue;
        }

        await AppState.client.from("attachments").insert({
            message_id: msg.id,
            conversation_id: AppState.activeConversationId,
            storage_path: path,
            filename: file.name,
            mime_type: file.type,
            size_bytes: file.size
        });
        await loadMessages(false);
    }
}

// ==========================================================================
// 22. EVENT BINDINGS & WIRING
// ==========================================================================

function bindEventListeners() {
    // Sidebar conversation selection
    if (Els.conversationList) {
        Els.conversationList.addEventListener("click", (e) => {
            const item = e.target.closest(".conversation-item");
            if (!item || !item.dataset.id) return;
            openConversation(item.dataset.id);
        });
    }

    // Filter Buttons
    Els.filterButtons.forEach((btn) => {
        btn.addEventListener("click", function () {
            Els.filterButtons.forEach((b) => b.classList.remove("active"));
            this.classList.add("active");
            AppState.currentFilter = this.dataset.filter;
            renderConversationList();
        });
    });

    // Sidebar search
    if (Els.chatSearch) Els.chatSearch.addEventListener("input", renderConversationList);

    // Composer inputs
    if (Els.messageInput) {
        Els.messageInput.addEventListener("input", () => {
            autoResizeTextarea();
            if (AppState.activeConversationId && !AppState.editingMessage) {
                saveDraft(AppState.activeConversationId, Els.messageInput.value);
            }
            clearTimeout(typingDebounceTimer);
            emitTyping();
            typingDebounceTimer = setTimeout(() => {}, 1200);
        });

        Els.messageInput.addEventListener("keydown", (e) => {
            if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                sendMessage();
            }
        });
    }

    if (Els.sendButton) Els.sendButton.addEventListener("click", sendMessage);
    if (Els.cancelReplyBtn) Els.cancelReplyBtn.addEventListener("click", cancelReply);
    if (Els.cancelEditBtn) Els.cancelEditBtn.addEventListener("click", cancelEditing);

    // Voice recording buttons
    if (Els.voiceButton) Els.voiceButton.addEventListener("click", startVoiceRecording);
    if (Els.cancelVoiceBtn) Els.cancelVoiceBtn.addEventListener("click", cancelVoiceRecording);
    if (Els.sendVoiceBtn) Els.sendVoiceBtn.addEventListener("click", sendVoiceRecording);

    // Popups
    if (Els.emojiButton) {
        Els.emojiButton.addEventListener("click", () => {
            if (Els.emojiPickerPopup) Els.emojiPickerPopup.hidden = !Els.emojiPickerPopup.hidden;
            if (Els.attachmentPopup) Els.attachmentPopup.hidden = true;
        });
    }

    if (Els.attachmentButton) {
        Els.attachmentButton.addEventListener("click", () => {
            if (Els.attachmentPopup) Els.attachmentPopup.hidden = !Els.attachmentPopup.hidden;
            if (Els.emojiPickerPopup) Els.emojiPickerPopup.hidden = true;
        });
    }

    if (Els.attachPhotoBtn) {
        Els.attachPhotoBtn.addEventListener("click", () => {
            if (Els.attachmentPopup) Els.attachmentPopup.hidden = true;
            if (Els.fileInput) {
                Els.fileInput.accept = "image/*,video/*";
                Els.fileInput.click();
            }
        });
    }

    if (Els.attachDocBtn) {
        Els.attachDocBtn.addEventListener("click", () => {
            if (Els.attachmentPopup) Els.attachmentPopup.hidden = true;
            if (Els.fileInput) {
                Els.fileInput.accept = "*/*";
                Els.fileInput.click();
            }
        });
    }

    if (Els.fileInput) {
        Els.fileInput.addEventListener("change", function () {
            handleFilesUpload(Array.from(this.files || []));
            this.value = "";
        });
    }

    // Header actions
    if (Els.chatSearchButton) Els.chatSearchButton.addEventListener("click", toggleInChatSearch);
    if (Els.inChatSearchInput) Els.inChatSearchInput.addEventListener("input", performInChatSearch);
    if (Els.inChatSearchCloseBtn) Els.inChatSearchCloseBtn.addEventListener("click", toggleInChatSearch);
    if (Els.inChatSearchPrevBtn) {
        Els.inChatSearchPrevBtn.addEventListener("click", () => {
            if (AppState.inChatSearch.matches.length === 0) return;
            AppState.inChatSearch.currentIndex = (AppState.inChatSearch.currentIndex - 1 + AppState.inChatSearch.matches.length) % AppState.inChatSearch.matches.length;
            updateSearchMatchDisplay();
        });
    }
    if (Els.inChatSearchNextBtn) {
        Els.inChatSearchNextBtn.addEventListener("click", () => {
            if (AppState.inChatSearch.matches.length === 0) return;
            AppState.inChatSearch.currentIndex = (AppState.inChatSearch.currentIndex + 1) % AppState.inChatSearch.matches.length;
            updateSearchMatchDisplay();
        });
    }

    // Call buttons
    if (Els.audioCallButton) Els.audioCallButton.addEventListener("click", () => startCall("audio"));
    if (Els.videoCallButton) Els.videoCallButton.addEventListener("click", () => startCall("video"));
    if (Els.detailsCallBtn) Els.detailsCallBtn.addEventListener("click", () => startCall("audio"));
    if (Els.detailsVideoBtn) Els.detailsVideoBtn.addEventListener("click", () => startCall("video"));
    if (Els.callEndBtn) Els.callEndBtn.addEventListener("click", endCall);
    if (Els.callMuteBtn) {
        Els.callMuteBtn.addEventListener("click", () => {
            AppState.call.muted = !AppState.call.muted;
            Els.callMuteBtn.classList.toggle("active-off", AppState.call.muted);
            showToast(AppState.call.muted ? "Microphone muted" : "Microphone active", "fa-solid fa-microphone");
        });
    }
    if (Els.callCameraBtn) {
        Els.callCameraBtn.addEventListener("click", () => {
            AppState.call.cameraOff = !AppState.call.cameraOff;
            Els.callCameraBtn.classList.toggle("active-off", AppState.call.cameraOff);
            if (AppState.call.stream) {
                AppState.call.stream.getVideoTracks().forEach((t) => (t.enabled = !AppState.call.cameraOff));
            }
        });
    }

    // Lightbox Controls
    if (Els.lightboxCloseBtn) Els.lightboxCloseBtn.addEventListener("click", closeLightbox);
    if (Els.lightboxPrevBtn) Els.lightboxPrevBtn.addEventListener("click", () => lightboxNavigate(-1));
    if (Els.lightboxNextBtn) Els.lightboxNextBtn.addEventListener("click", () => lightboxNavigate(1));
    if (Els.lightboxZoomInBtn) {
        Els.lightboxZoomInBtn.addEventListener("click", () => {
            AppState.lightbox.zoom = Math.min(AppState.lightbox.zoom + 0.3, 3);
            if (Els.lightboxImage) Els.lightboxImage.style.transform = `scale(${AppState.lightbox.zoom})`;
        });
    }
    if (Els.lightboxZoomOutBtn) {
        Els.lightboxZoomOutBtn.addEventListener("click", () => {
            AppState.lightbox.zoom = Math.max(AppState.lightbox.zoom - 0.3, 0.5);
            if (Els.lightboxImage) Els.lightboxImage.style.transform = `scale(${AppState.lightbox.zoom})`;
        });
    }
    if (Els.lightboxZoomResetBtn) {
        Els.lightboxZoomResetBtn.addEventListener("click", () => {
            AppState.lightbox.zoom = 1;
            if (Els.lightboxImage) Els.lightboxImage.style.transform = "scale(1)";
        });
    }

    // Context Menu Action Dispatcher
    if (Els.convContextMenu) {
        Els.convContextMenu.addEventListener("click", async (e) => {
            const btn = e.target.closest("button");
            if (!btn || !selectedContextConvoId) return;
            const action = btn.dataset.action;
            closeContextMenu();

            if (action === "toggle-read") {
                await AppState.client.rpc("mark_conversation_read", { p_conversation_id: selectedContextConvoId });
                showToast("Conversation marked as read", "fa-solid fa-envelope-open");
                await loadConversations();
            } else if (action === "toggle-pin") {
                if (AppState.pinnedChatIds.has(selectedContextConvoId)) {
                    AppState.pinnedChatIds.delete(selectedContextConvoId);
                    showToast("Conversation unpinned", "fa-solid fa-thumbtack");
                } else {
                    AppState.pinnedChatIds.add(selectedContextConvoId);
                    showToast("Conversation pinned to top", "fa-solid fa-thumbtack");
                }
                savePinned();
                await loadConversations();
            } else if (action === "toggle-mute") {
                openMuteModal();
            } else if (action === "delete-chat") {
                const conf = window.confirm("Delete this conversation? Messages will be cleared from your view.");
                if (conf) {
                    AppState.conversations = AppState.conversations.filter((c) => c.conversation_id !== selectedContextConvoId);
                    showIdleThreadState();
                    renderConversationList();
                    showToast("Conversation removed", "fa-solid fa-trash");
                }
            }
        });
    }

    // Reaction Picker Emoji Clicks
    if (Els.messageReactionPopup) {
        Els.messageReactionPopup.addEventListener("click", (e) => {
            const btn = e.target.closest(".reaction-emoji-btn");
            if (!btn || !targetReactionMsgId) return;
            const emoji = btn.dataset.emoji;
            closeReactionPopup();
            showToast(`Reacted with ${emoji}`, "fa-solid fa-heart");
        });
    }

    // Delete Modal Actions
    if (Els.deleteForEveryoneBtn) Els.deleteForEveryoneBtn.addEventListener("click", () => executeDelete(true));
    if (Els.deleteForMeBtn) Els.deleteForMeBtn.addEventListener("click", () => executeDelete(false));
    if (Els.closeDeleteModal) Els.closeDeleteModal.addEventListener("click", () => (Els.deleteMessageModal.hidden = true));

    // Starred & Media Panel Buttons
    if (Els.detailsStarredBtn) Els.detailsStarredBtn.addEventListener("click", openStarredModal);
    if (Els.closeStarredModal) Els.closeStarredModal.addEventListener("click", () => (Els.starredMessagesModal.hidden = true));
    if (Els.detailsViewAllMediaBtn) Els.detailsViewAllMediaBtn.addEventListener("click", openSharedMediaModal);
    if (Els.closeSharedMediaModal) Els.closeSharedMediaModal.addEventListener("click", () => (Els.sharedMediaModal.hidden = true));

    // Mute Modal & Toggle
    if (Els.detailsMuteBtn) {
        Els.detailsMuteBtn.addEventListener("click", async () => {
            if (!AppState.activeConversationId) return showToast("Select a conversation first.", "fa-solid fa-bell");
            if (isChatMuted(AppState.activeConversationId)) {
                AppState.mutedChats.delete(AppState.activeConversationId);
                saveMuted();
                if (AppState.client) {
                    await AppState.client.from("conversation_members").update({ muted: false })
                        .eq("conversation_id", AppState.activeConversationId)
                        .eq("user_id", AppState.currentUser.id);
                }
                if (Els.detailsMuteLabel) Els.detailsMuteLabel.textContent = "Mute notifications";
                showToast("Notifications unmuted", "fa-solid fa-bell");
                await loadConversations();
            } else {
                openMuteModal();
            }
        });
    }
    if (Els.closeMuteModal) Els.closeMuteModal.addEventListener("click", () => (Els.muteModal.hidden = true));
    if (Els.confirmMuteBtn) {
        Els.confirmMuteBtn.addEventListener("click", async () => {
            if (!AppState.activeConversationId) return;
            const dur = document.querySelector('input[name="muteDuration"]:checked')?.value || "1h";
            let expiry = "always";
            if (dur === "1h") expiry = Date.now() + 60 * 60 * 1000;
            else if (dur === "8h") expiry = Date.now() + 8 * 60 * 60 * 1000;
            else if (dur === "1w") expiry = Date.now() + 7 * 24 * 60 * 60 * 1000;
            AppState.mutedChats.set(AppState.activeConversationId, expiry);
            saveMuted();
            await AppState.client.from("conversation_members").update({ muted: true })
                .eq("conversation_id", AppState.activeConversationId)
                .eq("user_id", AppState.currentUser.id);
            if (Els.muteModal) Els.muteModal.hidden = true;
            if (Els.detailsMuteLabel) Els.detailsMuteLabel.textContent = "Unmute notifications";
            showToast("Notifications muted (" + dur + ")", "fa-solid fa-bell-slash");
            await loadConversations();
        });
    }

    // Block & Unblock Contact
    const handleBlockToggle = async () => {
        if (!AppState.activePeer || !AppState.activePeer.id) return showToast("Select a contact to block.", "fa-solid fa-ban");
        const isBlocked = AppState.blockedIds.has(AppState.activePeer.id);
        if (!isBlocked) {
            const confirmed = window.confirm(`Block ${AppState.activePeer.name}? You will not be able to message each other.`);
            if (!confirmed) return;
            const { error } = await AppState.client.from("blocked_users").insert({
                blocker_id: AppState.currentUser.id,
                blocked_id: AppState.activePeer.id
            });
            if (error) return showToast(error.message, "fa-solid fa-triangle-exclamation");
            AppState.blockedIds.add(AppState.activePeer.id);
            showToast(AppState.activePeer.name + " was blocked.", "fa-solid fa-ban");
        } else {
            const confirmed = window.confirm(`Unblock ${AppState.activePeer.name}?`);
            if (!confirmed) return;
            const { error } = await AppState.client.from("blocked_users").delete()
                .eq("blocker_id", AppState.currentUser.id)
                .eq("blocked_id", AppState.activePeer.id);
            if (error) return showToast(error.message, "fa-solid fa-triangle-exclamation");
            AppState.blockedIds.delete(AppState.activePeer.id);
            showToast(AppState.activePeer.name + " was unblocked.", "fa-solid fa-circle-check");
        }
        await openConversation(AppState.activeConversationId);
    };

    if (Els.detailsBlockBtn) Els.detailsBlockBtn.addEventListener("click", handleBlockToggle);
    if (Els.unblockBannerBtn) Els.unblockBannerBtn.addEventListener("click", handleBlockToggle);

    // Report Contact Modal
    if (Els.closeReportModal) Els.closeReportModal.addEventListener("click", () => (Els.reportModal.hidden = true));
    if (Els.submitReportBtn) {
        Els.submitReportBtn.addEventListener("click", () => {
            const reason = document.querySelector('input[name="reportReason"]:checked')?.value || "Spam";
            if (Els.reportModal) Els.reportModal.hidden = true;
            showToast(`Report submitted (${reason}). Thank you.`, "fa-solid fa-shield");
        });
    }

    // Command Palette
    if (Els.commandPaletteInput) {
        Els.commandPaletteInput.addEventListener("input", (e) => renderCommandRows(e.target.value));
    }

    // Responsive Panel Toggles
    if (Els.mobileBackButton) {
        Els.mobileBackButton.addEventListener("click", () => {
            if (Els.chatApp) Els.chatApp.classList.remove("chat-open");
            if (Els.detailsPanel) Els.detailsPanel.classList.remove("open");
        });
    }
    if (Els.detailsButton) Els.detailsButton.addEventListener("click", () => Els.detailsPanel?.classList.toggle("open"));
    if (Els.activeUserButton) Els.activeUserButton.addEventListener("click", () => Els.detailsPanel?.classList.toggle("open"));
    if (Els.closeDetailsButton) Els.closeDetailsButton.addEventListener("click", () => Els.detailsPanel?.classList.remove("open"));

    // Profile & New Chat Modals
    if (Els.profileButton) Els.profileButton.addEventListener("click", openProfileEditor);
    if (Els.closeProfileModal) Els.closeProfileModal.addEventListener("click", () => (Els.profileModal.hidden = true));
    if (Els.newChatButton) Els.newChatButton.addEventListener("click", openNewChatModal);
    if (Els.closeNewChat) Els.closeNewChat.addEventListener("click", closeNewChatModal);
    if (Els.startFirstChatBtn) Els.startFirstChatBtn.addEventListener("click", openNewChatModal);
    if (Els.heroStartChatBtn) Els.heroStartChatBtn.addEventListener("click", openNewChatModal);
    if (Els.findUserBtn) Els.findUserBtn.addEventListener("click", findVChatUser);

    if (Els.newChatNumber) {
        Els.newChatNumber.addEventListener("keydown", (e) => {
            if (e.key === "Enter") {
                e.preventDefault();
                findVChatUser();
            }
        });
    }

    // Profile Save
    if (Els.saveProfileBtn) {
        Els.saveProfileBtn.addEventListener("click", async () => {
            const name = Els.profileNameInput?.value || "";
            const about = Els.profileAboutInput?.value || "";
            if (!V.isValidName(name)) return showToast("Name must be 2–80 characters.", "fa-solid fa-triangle-exclamation");

            const { data, error } = await AppState.client.rpc("update_my_profile", {
                p_full_name: name.trim(),
                p_about: about,
                p_avatar_url: AppState.currentProfile.avatarUrl || null
            });
            if (error) return showToast(error.message, "fa-solid fa-triangle-exclamation");

            AppState.currentProfile = api.mapProfile(data) || AppState.currentProfile;
            if (Els.currentUserName) Els.currentUserName.textContent = AppState.currentProfile.name;
            if (Els.currentUserInitials) Els.currentUserInitials.textContent = Dom.initials(AppState.currentProfile.name);
            const avatarWrap = Els.profileButton?.querySelector(".user-avatar");
            if (avatarWrap) applyAvatar(avatarWrap, AppState.currentProfile.avatarUrl, AppState.currentProfile.name);
            Els.profileModal.hidden = true;
            showToast("Profile updated successfully.", "fa-solid fa-circle-check");
        });
    }

    // Avatar Upload
    if (Els.avatarFileInput) {
        Els.avatarFileInput.addEventListener("change", async function () {
            const file = this.files && this.files[0];
            this.value = "";
            const check = V.isAllowedAvatar(file);
            if (!check.ok) return showToast(check.error, "fa-solid fa-triangle-exclamation");

            const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
            const path = `${AppState.currentUser.id}/avatar.${ext}`;
            const { error: upErr } = await AppState.client.storage.from("avatars").upload(path, file, { upsert: true, contentType: file.type });
            if (upErr) return showToast(upErr.message, "fa-solid fa-triangle-exclamation");

            const { data } = AppState.client.storage.from("avatars").getPublicUrl(path);
            const publicUrl = data && data.publicUrl;
            await AppState.client.rpc("update_my_profile", {
                p_full_name: AppState.currentProfile.name,
                p_about: AppState.currentProfile.about,
                p_avatar_url: publicUrl
            });
            AppState.currentProfile.avatarUrl = publicUrl;
            applyAvatar(Els.profileButton?.querySelector(".user-avatar"), publicUrl, AppState.currentProfile.name);
            applyAvatar(Els.profileModalAvatar, publicUrl, AppState.currentProfile.name);
            showToast("Avatar updated successfully.", "fa-solid fa-circle-check");
        });
    }

    // Logout
    if (Els.logoutButton) {
        Els.logoutButton.addEventListener("click", async () => {
            const confirmed = window.confirm("Log out of VChat?");
            if (!confirmed) return;
            unsubscribeConversation();
            if (inboxChannel) AppState.client.removeChannel(inboxChannel);
            if (presenceChannel) AppState.client.removeChannel(presenceChannel);
            await AppState.client.auth.signOut();
            window.location.replace("../index.html");
        });
    }

    // Older messages button & infinite upward scroll
    if (Els.loadOlderBtn) Els.loadOlderBtn.addEventListener("click", () => loadMessages(true));
    if (Els.chatMessages) {
        let scrollDebounceTimer = null;
        Els.chatMessages.addEventListener("scroll", () => {
            if (Els.chatMessages.scrollTop < 80 && AppState.hasMore && !AppState.loadingOlder) {
                clearTimeout(scrollDebounceTimer);
                scrollDebounceTimer = setTimeout(() => {
                    if (Els.chatMessages.scrollTop < 80 && AppState.hasMore && !AppState.loadingOlder) {
                        loadMessages(true);
                    }
                }, 150);
            }
        });
    }

    // Global Dismiss on Click Outside
    document.addEventListener("click", (e) => {
        if (!e.target.closest("#emojiButton") && !e.target.closest("#emojiPickerPopup")) {
            if (Els.emojiPickerPopup) Els.emojiPickerPopup.hidden = true;
        }
        if (!e.target.closest("#attachmentButton") && !e.target.closest("#attachmentPopup")) {
            if (Els.attachmentPopup) Els.attachmentPopup.hidden = true;
        }
        if (!e.target.closest("#convContextMenu")) closeContextMenu();
        if (!e.target.closest("#messageReactionPopup") && !e.target.closest(".msg-act-btn")) closeReactionPopup();
    });

    // Keyboard Shortcuts (Esc, Ctrl+K, Ctrl+F, Arrow Keys)
    document.addEventListener("keydown", (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
            e.preventDefault();
            toggleCommandPalette();
            return;
        }
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f") {
            e.preventDefault();
            toggleInChatSearch();
            return;
        }
        if (e.key === "Escape") {
            if (AppState.lightbox.active) return closeLightbox();
            if (AppState.call.active) return endCall();
            if (Els.commandPaletteModal && !Els.commandPaletteModal.hidden) return (Els.commandPaletteModal.hidden = true);
            if (Els.profileModal && !Els.profileModal.hidden) return (Els.profileModal.hidden = true);
            if (Els.newChatModal && !Els.newChatModal.hidden) return closeNewChatModal();
            if (Els.starredMessagesModal && !Els.starredMessagesModal.hidden) return (Els.starredMessagesModal.hidden = true);
            if (Els.sharedMediaModal && !Els.sharedMediaModal.hidden) return (Els.sharedMediaModal.hidden = true);
            if (Els.muteModal && !Els.muteModal.hidden) return (Els.muteModal.hidden = true);
            if (Els.reportModal && !Els.reportModal.hidden) return (Els.reportModal.hidden = true);
            if (Els.deleteMessageModal && !Els.deleteMessageModal.hidden) return (Els.deleteMessageModal.hidden = true);
            if (AppState.inChatSearch.active) return toggleInChatSearch();
            if (AppState.replyingTo) return cancelReply();
            if (AppState.editingMessage) return cancelEditing();
            if (Els.detailsPanel?.classList.contains("open")) return Els.detailsPanel.classList.remove("open");
            if (Els.chatApp?.classList.contains("chat-open")) Els.chatApp.classList.remove("chat-open");
        }
        if (AppState.lightbox.active) {
            if (e.key === "ArrowLeft") lightboxNavigate(-1);
            if (e.key === "ArrowRight") lightboxNavigate(1);
        }
    });

    // Online / Offline Detection & Reconnection Reconciliation
    window.addEventListener("online", async () => {
        updateConnectionBanner("online");
        drainOfflineQueue();
        try {
            await loadConversations();
            if (AppState.activeConversationId) {
                await loadMessages(false);
            }
        } catch { /* ignore transient errors during reconnect */ }
    });
    window.addEventListener("offline", () => {
        updateConnectionBanner("offline");
    });

    // Multi-Tab Synchronization
    window.addEventListener("storage", (e) => {
        if (!e.key) return;
        if (e.key === getStorageKey("drafts")) {
            loadLocalPreferences();
            if (AppState.activeConversationId) {
                const currentDraft = AppState.drafts[AppState.activeConversationId] || "";
                if (Els.messageInput && Els.messageInput.value !== currentDraft && document.activeElement !== Els.messageInput) {
                    Els.messageInput.value = currentDraft;
                }
            }
            renderConversationList();
        } else if (e.key === getStorageKey("pinned_chats")) {
            loadLocalPreferences();
            renderConversationList();
        } else if (e.key === getStorageKey("muted_chats")) {
            loadLocalPreferences();
            renderConversationList();
            if (AppState.activeConversationId && Els.detailsMuteLabel) {
                const isMuted = isChatMuted(AppState.activeConversationId);
                Els.detailsMuteLabel.textContent = isMuted ? "Unmute notifications" : "Mute notifications";
            }
        } else if (e.key === getStorageKey("reactions")) {
            loadLocalPreferences();
            renderAllReactions();
        } else if (e.key === getStorageKey("starred")) {
            loadLocalPreferences();
        }
    });
}

// ==========================================================================
// 23. BOOT SEQUENCE
// ==========================================================================

(async function bootChatApp() {
    try {
        await requireSession();
        initEmojiPicker();
        bindEventListeners();
        showIdleThreadState();
        await loadBlocked();
        await loadConversations();
        subscribeInbox();
        subscribePresence();
        drainOfflineQueue();

        if (AppState.conversations.length > 0) {
            await openConversation(AppState.conversations[0].conversation_id);
        }
        updateConnectionBanner(navigator.onLine ? "online" : "offline");
    } catch (err) {
        if (err && err.message === "no session") return;
        console.warn("VChat boot warning:", err);
    }
})();
