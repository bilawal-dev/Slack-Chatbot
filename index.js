import express from "express";
import dotenv from "dotenv";
import { createClient } from 'redis';

dotenv.config();

const redis = await createClient({
    url: process.env.REDIS_URL
}).connect();

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 5000;

app.get('/', (req, res) => {
    res.send('Hello World!');
});

app.post("/chatwoot-webhook", async (req, res) => {
    try {
        const event = req.body;
        if (
            event.webhook_event === "message_created" &&
            event.message.sender_type === "contact"
        ) {
            const convId = event.conversation.id;
            const meta = event.conversation.meta_attributes || {};
            const channel = meta.slack_channel;
            const text = event.message.content;

            if (!channel || !text) {
                console.log("Missing slack_channel or content in Chatwoot webhook payload.");
                return res.sendStatus(200);
            }

            const response = await fetch("https://slack.com/api/chat.postMessage", {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}`,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({ channel, text }),
            });
            const data = await response.json();
            if (data.ok) {
                await redis.set(`${channel}:${data.message.ts}`, convId);
            } else {
                console.error("Slack API Error:", data.error);
            }
        }
    } catch (error) {
        console.error("Error processing Chatwoot webhook:", error);
    }
    res.sendStatus(200);
});

app.post("/slack-events", async (req, res) => {
    const body = req.body;
    // Slack URL verification
    if (body.type === "url_verification") {
        return res.send(body.challenge);
    }

    try {
        const ev = body.event;
        if (ev && ev.type === "message" && ev.thread_ts && !ev.bot_id) {
            const key = `${ev.channel}:${ev.thread_ts}`;
            const convId = await redis.get(key);
            if (convId) {
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

                if (!response.ok) {
                    const errorData = await response.text();
                    console.error("Chatwoot API Error:", response.status, errorData);
                }
            }
        }
    } catch (error) {
        console.error("Error processing Slack event:", error);
    }
    res.sendStatus(200);
});

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
}); 