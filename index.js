import express from "express";
import dotenv from "dotenv";
import { createClient } from 'redis';

dotenv.config();

const redis = await createClient({
    url: process.env.REDIS_URL
}).connect();

console.log("✅ Redis connected successfully");

// Maps a Chatwoot Inbox ID to a specific Slack Channel name.
// You can find your Inbox ID in your Chatwoot settings or from the Vercel logs.
const INBOX_TO_CHANNEL_MAP = {
    // From your log, the Inbox ID for 'Subway Support' is 71647.
    // Replace '#your-channel' with the actual Slack channel you want to use.
    '71647': '#your-channel'
};

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 5000;

app.get('/', (req, res) => {
    res.send('Hello World!');
});

app.post("/chatwoot-webhook", async (req, res) => {
    console.log("🔔 Chatwoot webhook received:");
    console.log("📋 Full payload:", JSON.stringify(req.body, null, 2));
    
    try {
        const event = req.body;
        console.log("🔍 Event type:", event.event);
        console.log("📝 Message type:", event.message_type);
        
        // Updated logic based on your Vercel log
        if (
            event.event === "message_created" &&
            event.message_type === "incoming"
        ) {
            console.log("✅ Valid message event detected");
            
            const convId = event.conversation.id;
            const inboxId = event.inbox.id.toString();
            // Static channel for testing
            const channel = "C097BE9AFCK"; // Fixed: added quotes
            const text = event.content;
            const senderName = event.sender.name;

            console.log("📊 Extracted data:");
            console.log("   - Conversation ID:", convId);
            console.log("   - Inbox ID:", inboxId);
            console.log("   - Channel:", channel);
            console.log("   - Text:", text);
            console.log("   - Sender:", senderName);

            if (!text) {
                console.log("❌ No content in Chatwoot webhook payload.");
                return res.sendStatus(200);
            }

            console.log("🚀 Sending message to Slack...");
            const slackMessage = `*${senderName}*: ${text}`;
            console.log("📤 Slack message content:", slackMessage);

            const response = await fetch("https://slack.com/api/chat.postMessage", {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}`,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({ channel, text: slackMessage }),
            });
            
            const data = await response.json();
            console.log("📥 Slack API response:", JSON.stringify(data, null, 2));
            
            if (data.ok) {
                const redisKey = `${channel}:${data.message.ts}`;
                await redis.set(redisKey, convId.toString());
                console.log("✅ Message sent to Slack successfully");
                console.log("💾 Stored in Redis:", redisKey, "->", convId.toString());
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
        
        if (ev && ev.type === "message" && ev.thread_ts && !ev.bot_id) {
            console.log("✅ Valid threaded message from user detected");
            
            const key = `${ev.channel}:${ev.thread_ts}`;
            console.log("🔑 Looking up Redis key:", key);
            
            const convId = await redis.get(key);
            console.log("💾 Redis lookup result:", convId);
            
            if (convId) {
                console.log("🚀 Sending message to Chatwoot...");
                console.log("📤 Message content:", ev.text);
                console.log("🎯 Conversation ID:", convId);
                
                const response = await fetch(`https://app.chatwoot.com/api/v1/conversations/${convId}/messages`, {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        api_access_token: process.env.CHATWOOT_API_TOKEN,
                    },
                    body: JSON.stringify({
                        content: ev.text,
                        message_type: "incoming",
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
                console.log("⚠️ No conversation mapping found for thread");
            }
        } else {
            console.log("⏭️ Skipping event - not a threaded user message");
            if (ev) {
                console.log("   - Event type:", ev.type);
                console.log("   - Has thread_ts:", !!ev.thread_ts);
                console.log("   - Is bot:", !!ev.bot_id);
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