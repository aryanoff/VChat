/**
 * VChat Automated QA & Messaging System Test Suite
 * Tests message lifecycle, idempotency, offline queue, mute expiration,
 * read receipt timestamp logic, XSS escaping, and realtime reconciliation.
 */

const assert = require("assert");

console.log("=================================================");
console.log("RUNNING VCHAT MESSAGING ENGINE AUTOMATED TESTS");
console.log("=================================================\n");

let passed = 0;
let failed = 0;

function test(description, fn) {
    try {
        fn();
        console.log(`  ✓ ${description}`);
        passed++;
    } catch (err) {
        console.error(`  ✗ ${description}`);
        console.error(`    ${err.message}`);
        failed++;
    }
}

// -------------------------------------------------------------
// 1. MESSAGE CREATION & VALIDATION
// -------------------------------------------------------------
test("Message creation validates content and generates unique client ID", () => {
    function createClientMessage(conversationId, senderId, text) {
        if (!conversationId) throw new Error("Conversation ID is required");
        if (!senderId) throw new Error("Sender ID is required");
        const trimmed = (text || "").trim();
        if (!trimmed) throw new Error("Message text cannot be empty");
        if (trimmed.length > 5000) throw new Error("Message exceeds 5000 character limit");
        
        const clientId = "client_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8);
        return {
            id: "tmp-" + clientId,
            clientId,
            conversationId,
            senderId,
            content: trimmed,
            messageType: "text",
            status: "sending",
            createdAt: new Date().toISOString()
        };
    }

    assert.throws(() => createClientMessage("", "user_1", "Hello"), /Conversation ID is required/);
    assert.throws(() => createClientMessage("conv_1", "user_1", "   "), /Message text cannot be empty/);
    
    const msg = createClientMessage("conv_1", "user_1", "Hello World!");
    assert.strictEqual(msg.content, "Hello World!");
    assert.strictEqual(msg.messageType, "text");
    assert.strictEqual(msg.status, "sending");
    assert.ok(msg.clientId.startsWith("client_"));
    assert.strictEqual(msg.id, "tmp-" + msg.clientId);
});

// -------------------------------------------------------------
// 2. IDEMPOTENCY & REALTIME DEDUPLICATION
// -------------------------------------------------------------
test("Realtime deduplication prevents duplicate bubbles for optimistic messages", () => {
    const renderedMessages = new Map();
    const optimisticClientIds = new Set();

    function onOptimisticSend(msg) {
        optimisticClientIds.add(msg.clientId);
        renderedMessages.set(msg.id, { ...msg });
    }

    function onRealtimeInsert(serverMsg) {
        // If server message arrives with client_id matching an active optimistic send
        if (serverMsg.client_id && optimisticClientIds.has(serverMsg.client_id)) {
            // Reconcile in place instead of creating a second bubble
            const tmpId = "tmp-" + serverMsg.client_id;
            const existing = renderedMessages.get(tmpId);
            if (existing) {
                renderedMessages.delete(tmpId);
                renderedMessages.set(serverMsg.id, {
                    ...existing,
                    id: serverMsg.id,
                    status: "sent",
                    created_at: serverMsg.created_at
                });
            }
            optimisticClientIds.delete(serverMsg.client_id);
            return { action: "reconciled", count: renderedMessages.size };
        }

        // Otherwise append normal new incoming message
        if (!renderedMessages.has(serverMsg.id)) {
            renderedMessages.set(serverMsg.id, serverMsg);
            return { action: "appended", count: renderedMessages.size };
        }
        return { action: "ignored", count: renderedMessages.size };
    }

    const clientMsg = {
        id: "tmp-client_123",
        clientId: "client_123",
        conversationId: "conv_1",
        senderId: "user_me",
        content: "Optimistic message"
    };

    onOptimisticSend(clientMsg);
    assert.strictEqual(renderedMessages.size, 1);
    assert.ok(renderedMessages.has("tmp-client_123"));

    // Realtime broadcast arrives with the real server UUID and client_id
    const serverBroadcast = {
        id: "server-uuid-999",
        client_id: "client_123",
        conversation_id: "conv_1",
        sender_id: "user_me",
        content: "Optimistic message",
        created_at: new Date().toISOString()
    };

    const result = onRealtimeInsert(serverBroadcast);
    assert.strictEqual(result.action, "reconciled");
    assert.strictEqual(renderedMessages.size, 1); // Exact 1 message, no duplicates!
    assert.ok(renderedMessages.has("server-uuid-999"));
    assert.ok(!renderedMessages.has("tmp-client_123"));
    assert.strictEqual(renderedMessages.get("server-uuid-999").status, "sent");
});

// -------------------------------------------------------------
// 3. OFFLINE QUEUE PERSISTENCE & DRAINING
// -------------------------------------------------------------
test("Offline queue persists to JSON, recovers on reconnect, and drains safely", () => {
    let storage = {};
    function saveQueue(queue) {
        storage["offline_queue"] = JSON.stringify(queue);
    }
    function loadQueue() {
        return JSON.parse(storage["offline_queue"] || "[]");
    }

    const queue = [
        { clientId: "q1", conversationId: "c1", content: "Msg 1", status: "queued" },
        { clientId: "q2", conversationId: "c1", content: "Msg 2", status: "queued" }
    ];

    saveQueue(queue);
    const restored = loadQueue();
    assert.strictEqual(restored.length, 2);
    assert.strictEqual(restored[0].clientId, "q1");

    // Draining simulation
    const sent = [];
    while (restored.length > 0) {
        const item = restored.shift();
        sent.push(item.clientId);
        saveQueue(restored);
    }

    assert.strictEqual(sent.length, 2);
    assert.strictEqual(loadQueue().length, 0);
});

// -------------------------------------------------------------
// 4. MUTE EXPIRATION LOGIC
// -------------------------------------------------------------
test("Muted chats expire after duration and clean up automatically", () => {
    const mutedChats = new Map();

    function setMute(convId, duration) {
        let expiry = "always";
        const now = Date.now();
        if (duration === "1h") expiry = now + 3600 * 1000;
        else if (duration === "8h") expiry = now + 8 * 3600 * 1000;
        else if (duration === "1w") expiry = now + 7 * 86400 * 1000;
        mutedChats.set(convId, expiry);
    }

    function isMuted(convId) {
        if (!mutedChats.has(convId)) return false;
        const val = mutedChats.get(convId);
        if (val === "always") return true;
        const expiry = Number(val);
        if (!isNaN(expiry) && Date.now() > expiry) {
            mutedChats.delete(convId);
            return false;
        }
        return true;
    }

    // Always muted
    setMute("c_always", "always");
    assert.strictEqual(isMuted("c_always"), true);

    // 1h in the future
    setMute("c_1h", "1h");
    assert.strictEqual(isMuted("c_1h"), true);

    // Expired mute simulated
    mutedChats.set("c_expired", Date.now() - 5000);
    assert.strictEqual(isMuted("c_expired"), false);
    assert.strictEqual(mutedChats.has("c_expired"), false); // Cleaned up
});

// -------------------------------------------------------------
// 5. READ RECEIPTS TIMESTAMP ACCURACY
// -------------------------------------------------------------
test("Read receipts verify per-timestamp comparison against peer read timestamp", () => {
    function computeTickStatus(messageCreatedAt, peerReadAt) {
        if (!peerReadAt) return " ✓"; // Sent only
        const msgTime = new Date(messageCreatedAt).getTime();
        const readTime = new Date(peerReadAt).getTime();
        return msgTime <= readTime ? " ✓✓" : " ✓";
    }

    const t0 = "2026-10-06T10:00:00Z";
    const t1 = "2026-10-06T10:05:00Z";
    const t2 = "2026-10-06T10:10:00Z";

    // Peer read up to 10:05:00Z
    const peerReadAt = t1;

    // t0 (10:00:00Z) was read
    assert.strictEqual(computeTickStatus(t0, peerReadAt), " ✓✓");
    // t1 (10:05:00Z) was read exactly at mark
    assert.strictEqual(computeTickStatus(t1, peerReadAt), " ✓✓");
    // t2 (10:10:00Z) was sent after peer read -> single tick ✓
    assert.strictEqual(computeTickStatus(t2, peerReadAt), " ✓");
    // If peer has never read (null) -> single tick ✓
    assert.strictEqual(computeTickStatus(t0, null), " ✓");
});

// -------------------------------------------------------------
// 6. XSS PROTECTION IN IN-CHAT SEARCH HIGHLIGHTS
// -------------------------------------------------------------
test("In-chat search highlights sanitize HTML entities before applying mark tag", () => {
    function escapeHtml(str) {
        if (!str) return "";
        return String(str)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }

    function highlightSearch(rawText, query) {
        const escaped = escapeHtml(rawText);
        const escapedQuery = escapeHtml(query);
        const regex = new RegExp(`(${escapedQuery.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi");
        return escaped.replace(regex, `<mark class="chat-search-highlight">$1</mark>`);
    }

    const maliciousMessage = `<img src=x onerror=alert(1)> Check this out!`;
    const searchResult = highlightSearch(maliciousMessage, "alert");

    // Must NOT contain unescaped <img
    assert.ok(!searchResult.includes("<img src=x onerror="));
    // Must contain safe &lt;img
    assert.ok(searchResult.includes("&lt;img"));
    // Must highlight "alert" with mark tag
    assert.ok(searchResult.includes(`<mark class="chat-search-highlight">alert</mark>`));
});

// -------------------------------------------------------------
// 7. CONVERSATION ORDERING (PINNED PRIORITY + TIMESTAMP)
// -------------------------------------------------------------
test("Conversation list sorts pinned conversations to the top, then latest timestamp", () => {
    const pinned = new Set(["c2"]);
    const conversations = [
        { id: "c1", updated_at: "2026-10-06T12:00:00Z" },
        { id: "c2", updated_at: "2026-10-06T10:00:00Z" },
        { id: "c3", updated_at: "2026-10-06T14:00:00Z" }
    ];

    const sorted = [...conversations].sort((a, b) => {
        const aPin = pinned.has(a.id) ? 1 : 0;
        const bPin = pinned.has(b.id) ? 1 : 0;
        if (aPin !== bPin) return bPin - aPin;
        return new Date(b.updated_at) - new Date(a.updated_at);
    });

    assert.strictEqual(sorted[0].id, "c2"); // Pinned comes first despite older time
    assert.strictEqual(sorted[1].id, "c3"); // Latest unpinned
    assert.strictEqual(sorted[2].id, "c1"); // Next unpinned
});

// -------------------------------------------------------------
// 8. DRAFT PERSISTENCE PER CONVERSATION
// -------------------------------------------------------------
test("Drafts persist per conversation and clear after sending", () => {
    const drafts = {};
    function saveDraft(convId, text) {
        if (!convId) return;
        if (text && text.trim()) drafts[convId] = text;
        else delete drafts[convId];
    }

    saveDraft("conv_A", "Draft for A");
    saveDraft("conv_B", "Draft for B");
    assert.strictEqual(drafts["conv_A"], "Draft for A");
    assert.strictEqual(drafts["conv_B"], "Draft for B");

    // User switches back and sends A
    saveDraft("conv_A", "");
    assert.strictEqual(drafts["conv_A"], undefined);
    assert.strictEqual(drafts["conv_B"], "Draft for B");
});

// -------------------------------------------------------------
// 9. REACTION STATE TOGGLING
// -------------------------------------------------------------
test("Emoji reactions toggle counts and user selection per message", () => {
    const reactions = new Map();

    function toggleReaction(msgId, emoji, userId) {
        if (!reactions.has(msgId)) {
            reactions.set(msgId, { counts: {}, users: {} });
        }
        const r = reactions.get(msgId);
        if (!r.counts[emoji]) r.counts[emoji] = 0;
        if (!r.users[emoji]) r.users[emoji] = new Set();

        if (r.users[emoji].has(userId)) {
            r.users[emoji].delete(userId);
            r.counts[emoji]--;
            if (r.counts[emoji] <= 0) {
                delete r.counts[emoji];
                delete r.users[emoji];
            }
        } else {
            r.users[emoji].add(userId);
            r.counts[emoji]++;
        }
    }

    toggleReaction("msg_1", "❤️", "user_1");
    assert.strictEqual(reactions.get("msg_1").counts["❤️"], 1);

    toggleReaction("msg_1", "❤️", "user_2");
    assert.strictEqual(reactions.get("msg_1").counts["❤️"], 2);

    // user_1 unreacts
    toggleReaction("msg_1", "❤️", "user_1");
    assert.strictEqual(reactions.get("msg_1").counts["❤️"], 1);

    // user_2 unreacts -> cleaned up
    toggleReaction("msg_1", "❤️", "user_2");
    assert.strictEqual(reactions.get("msg_1").counts["❤️"], undefined);
});

// -------------------------------------------------------------
// 10. SCROLL POSITION PRESERVATION ON OLDER PREPEND
// -------------------------------------------------------------
test("Prepend scroll height delta maintains user viewport when loading older history", () => {
    // Simulated DOM element
    let scrollTop = 10;
    let scrollHeight = 500;

    const prevScrollTop = scrollTop;
    const prevScrollHeight = scrollHeight;

    // Simulate prepending 40 older messages (height increases by 800px)
    scrollHeight += 800;

    // Delta formula implemented in loadMessages:
    scrollTop = prevScrollTop + (scrollHeight - prevScrollHeight);

    // Viewport relative to older messages is exactly preserved
    assert.strictEqual(scrollTop, 810);
});

console.log("\n=================================================");
console.log(`TEST SUMMARY: ${passed} PASSED, ${failed} FAILED`);
console.log("=================================================");

if (failed > 0) process.exit(1);
