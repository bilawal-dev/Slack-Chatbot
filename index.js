import express from "express";
import dotenv from "dotenv";
import { createClient } from 'redis';

dotenv.config();

const redis = await createClient({
    url: process.env.REDIS_URL
}).connect();

console.log("✅ Redis connected successfully");

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 5000;

// Helper endpoint to clear Redis (for debugging)
app.get('/', async (req, res) => {
    try {
        const keys = await redis.keys('*');
        res.json({
            message: '✅ Redis keys fetched successfully',
            keys,
            total: keys.length
        });
    } catch (err) {
        console.error("❌ Error fetching Redis keys:", err);
        res.status(500).json({ error: 'Error fetching Redis keys' });
    }
});

// Clear Redis endpoint (for debugging)
app.delete('/redis/clear', async (req, res) => {
    try {
        await redis.flushall();
        res.json({ message: '✅ Redis cleared successfully' });
    } catch (err) {
        console.error("❌ Error clearing Redis:", err);
        res.status(500).json({ error: 'Error clearing Redis' });
    }
});

app.post("/chatwoot-webhook", async (req, res) => {
    console.log("🔔 Chatwoot webhook received:");
    console.log("📋 Full payload:", JSON.stringify(req.body, null, 2));
    
    try {
        const event = req.body;
        console.log("🔍 Event type:", event.event);
        console.log("📝 Message type:", event.message_type);
        
        if (
            event.event === "message_created" &&
            event.message_type === "incoming"
        ) {
            console.log("✅ Valid message event detected");
            
            const convId = event.conversation.id;
            const accountId = event.account.id;
            const customAttributes = event.sender.custom_attributes || {};
            console.log("🔍 Custom attributes:", customAttributes);

            // Extract dynamic channel and folder info
            const slackChannel = customAttributes.slack_channel;
            const folderId = customAttributes.folder_id; // New: for tracking different folders
            
            console.log("🔍 Channel:", slackChannel);
            console.log("🔍 Folder ID:", folderId);
            
            const text = event.content;
            const senderName = event.sender.name;

            console.log("📊 Extracted data:");
            console.log("   - Conversation ID:", convId);
            console.log("   - Account ID:", accountId);
            console.log("   - Slack Channel:", slackChannel);
            console.log("   - Folder ID:", folderId);
            console.log("   - Text:", text);
            console.log("   - Sender:", senderName);

            if (!slackChannel) {
                console.log("❌ No slack_channel found in custom attributes.");
                return res.sendStatus(200);
            }

            if (!text) {
                console.log("❌ No content in Chatwoot webhook payload.");
                return res.sendStatus(200);
            }

            // Create unique thread key including folder for better organization
            const threadKey = folderId ? 
                `folder:${folderId}:conv:${convId}:thread` : 
                `conv:${convId}:thread`;
            
            const existingThreadTs = await redis.get(threadKey);
            
            console.log("🔍 Checking for existing thread:", threadKey);
            console.log("💾 Existing thread timestamp:", existingThreadTs);

            const slackMessage = `*${senderName}*: ${text}`;
            console.log("📤 Slack message content:", slackMessage);

            let slackPayload = {
                channel: slackChannel,
                text: slackMessage
            };

            // If there's an existing thread, post as a reply
            if (existingThreadTs) {
                slackPayload.thread_ts = existingThreadTs;
                console.log("🧵 Posting as thread reply to:", existingThreadTs);
            } else {
                console.log("🆕 Creating new message (will become thread parent)");
            }

            console.log("🚀 Sending message to Slack...");
            const response = await fetch("https://slack.com/api/chat.postMessage", {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}`,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify(slackPayload),
            });
            
            const data = await response.json();
            console.log("📥 Slack API response:", JSON.stringify(data, null, 2));
            
            if (data.ok) {
                const conversationData = JSON.stringify({
                    accountId,
                    conversationId: convId,
                    folderId: folderId || null,
                    slackChannel
                });

                // Store conversation -> thread mapping (only for new threads)
                if (!existingThreadTs) {
                    await redis.set(threadKey, data.message.ts);
                    console.log("💾 Stored conversation->thread mapping:", threadKey, "->", data.message.ts);
                }
                
                // Store thread -> conversation mapping for bidirectional lookup
                const threadToConvKey = `${slackChannel}:${data.message.ts}`;
                await redis.set(threadToConvKey, conversationData);
                console.log("💾 Stored thread->conversation mapping:", threadToConvKey, "->", conversationData);
                
                console.log("✅ Message sent to Slack successfully");
            } else {
                console.error("❌ Slack API Error:", data.error);
                if (data.response_metadata) {
                    console.error("📋 Response metadata:", data.response_metadata);
                }
            }
        } else {
            console.log("⏭️ Skipping event - not a valid incoming message");
        }
    } catch (error) {
        console.error("💥 Error processing Chatwoot webhook:", error);
        console.error("📋 Error stack:", error.stack);
    }
    res.sendStatus(200);
});

app.post("/slack-events", async (req, res) => {
    console.log("🔔 Slack event received:");
    console.log("📋 Full payload:", JSON.stringify(req.body, null, 2));
    
    const body = req.body;
    // Slack URL verification
    if (body.type === "url_verification") {
        console.log("🔐 Slack URL verification challenge received");
        console.log("🎯 Challenge:", body.challenge);
        return res.send(body.challenge);
    }

    try {
        const ev = body.event;
        console.log("🔍 Event data:", JSON.stringify(ev, null, 2));
        
        // Handle both threaded messages and replies to thread parents
        if (ev && ev.type === "message" && !ev.bot_id && ev.text) {
            console.log("✅ Valid message from user detected");
            
            // For replies, use thread_ts. For new messages, use ts.
            const threadTs = ev.thread_ts || ev.ts;
            const key = `${ev.channel}:${threadTs}`;
            
            console.log("🔑 Looking up Redis key:", key);
            console.log("🧵 Thread timestamp:", threadTs);
            console.log("📝 Is threaded reply:", !!ev.thread_ts);
            
            const rawData = await redis.get(key);
            console.log("💾 Redis lookup result (raw):", rawData);
            
            if (rawData) {
                let accountId, convId, folderId, slackChannel;
                try {
                    const parsedData = JSON.parse(rawData);
                    accountId = parsedData.accountId;
                    convId = parsedData.conversationId;
                    folderId = parsedData.folderId;
                    slackChannel = parsedData.slackChannel;
                } catch (e) {
                    // Fallback for old format
                    console.warn("⚠️ Could not parse Redis data as JSON. Falling back to old format.");
                    convId = rawData;
                    accountId = '129102';
                }

                console.log("📊 Parsed Redis data:", { accountId, convId, folderId, slackChannel });

                if (!accountId || !convId) {
                    console.error("❌ Invalid data in Redis, even after fallback:", rawData);
                    return res.sendStatus(200);
                }

                console.log("🚀 Sending message to Chatwoot...");
                console.log("📤 Message content:", ev.text);
                console.log("🎯 Account ID:", accountId);
                console.log("🎯 Conversation ID:", convId);
                console.log("🎯 Folder ID:", folderId);

                const chatwootUrl = `https://app.chatwoot.com/api/v1/accounts/${accountId}/conversations/${convId}/messages`;
                console.log("🔗 Posting to Chatwoot URL:", chatwootUrl);
                
                const response = await fetch(chatwootUrl, {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        api_access_token: process.env.CHATWOOT_API_TOKEN,
                    },
                    body: JSON.stringify({
                        content: ev.text,
                        message_type: "outgoing",
                    }),
                });

                console.log("📥 Chatwoot API response status:", response.status);
                
                if (!response.ok) {
                    const errorData = await response.text();
                    console.error("❌ Chatwoot API Error:", response.status, errorData);
                } else {
                    const responseData = await response.json();
                    console.log("✅ Message sent to Chatwoot successfully");
                    console.log("📋 Chatwoot response:", JSON.stringify(responseData, null, 2));
                }
            } else {
                console.log("⚠️ No conversation mapping found for this message/thread");
                console.log("🔍 Tried key:", key);
            }
        } else {
            console.log("⏭️ Skipping event - not a valid user message");
            if (ev) {
                console.log("   - Event type:", ev.type);
                console.log("   - Has text:", !!ev.text);
                console.log("   - Is bot:", !!ev.bot_id);
                console.log("   - Has thread_ts:", !!ev.thread_ts);
            }
        }
    } catch (error) {
        console.error("💥 Error processing Slack event:", error);
        console.error("📋 Error stack:", error.stack);
    }
    res.sendStatus(200);
});

app.listen(PORT, () => {
    console.log(`🚀 Server is running on port ${PORT}`);
}); 