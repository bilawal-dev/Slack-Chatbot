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
            let customAttributes = event.conversation.custom_attributes || {};
            let channel = customAttributes.slack_channel;
            
            console.log("🔍 Initial custom attributes from webhook:", customAttributes);

            // Fallback: If slack_channel is missing, fetch it directly from the Chatwoot API.
            // This handles the race condition where the first message webhook is sent before attributes are processed.
            if (!channel) {
               console.warn("⚠️ slack_channel missing from webhook. Attempting to fetch from Chatwoot API as a fallback...");
               try {
                   const convResponse = await fetch(`https://app.chatwoot.com/api/v1/conversations/${convId}`, {
                       headers: { api_access_token: process.env.CHATWOOT_API_TOKEN },
                   });
                   if (convResponse.ok) {
                       const convDetails = await convResponse.json();
                       customAttributes = convDetails.custom_attributes || {};
                       channel = customAttributes.slack_channel;
                       console.log("✅ Successfully fetched conversation details. Found channel:", channel);
                   } else {
                       console.error(`❌ Failed to fetch conversation details. Status: ${convResponse.status}`);
                   }
               } catch (apiError) {
                   console.error("💥 Error fetching conversation details from Chatwoot API:", apiError);
               }
            }
            
            const text = event.content;
            const senderName = event.sender.name;
 
             console.log("📊 Final extracted data:");
             console.log("   - Conversation ID:", convId);
             console.log("   - Channel:", channel);
             console.log("   - Text:", text);
             console.log("   - Sender:", senderName);
 
             if (!channel) {
                 console.log("❌ No slack_channel custom attribute found, even after API fallback. Message will be ignored.");
                 return res.sendStatus(200);
             }

            if (!text) {
                console.log("❌ No content in Chatwoot webhook payload.");
                return res.sendStatus(200);
            }

            // Check if this conversation already has a thread in Slack
            const existingThreadKey = `conv:${convId}:thread`;
            const existingThreadTs = await redis.get(existingThreadKey);
            
            console.log("🔍 Checking for existing thread:", existingThreadKey);
            console.log("💾 Existing thread timestamp:", existingThreadTs);

            const slackMessage = `*${senderName}*: ${text}`;
            console.log("📤 Slack message content:", slackMessage);

            let slackPayload = {
                channel: channel,
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
                // If this was a new message (not a thread reply), store the thread mapping
                if (!existingThreadTs) {
                    // Store conversation -> thread mapping
                    await redis.set(existingThreadKey, data.message.ts);
                    console.log("💾 Stored conversation->thread mapping:", existingThreadKey, "->", data.message.ts);
                }
                
                // Always store thread -> conversation mapping for replies
                const threadToConvKey = `${channel}:${data.message.thread_ts || data.message.ts}`;
                await redis.set(threadToConvKey, convId.toString());
                console.log("💾 Stored thread->conversation mapping:", threadToConvKey, "->", convId.toString());
                
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
            
            // Check if this is a threaded message or a reply to a thread
            const threadTs = ev.thread_ts || ev.ts; // Use thread_ts if available, otherwise the message itself
            const key = `${ev.channel}:${threadTs}`;
            
            console.log("🔑 Looking up Redis key:", key);
            console.log("🧵 Thread timestamp:", threadTs);
            console.log("📝 Is threaded reply:", !!ev.thread_ts);
            
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
                        message_type: "outgoing", // This represents agent/team member responses
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