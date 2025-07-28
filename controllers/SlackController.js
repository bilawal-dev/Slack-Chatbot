import prisma from "../config/database.js";

export class SlackController {
    static async handleEvent(req, res) {
        const { body } = req;

        // 1. Handle Slack's URL Verification Challenge
        if (body.type === 'url_verification') {
            return res.status(200).send(body.challenge);
        }

        // 2. Verify the Event Type and process it
        if (body.event && body.event.type === 'message' && !body.event.bot_id) {
            const { event } = body;

            // We only care about threaded messages (replies)
            if (event.thread_ts) {
                try {
                    // 3. Identify the Thread
                    const thread = await prisma.thread.findUnique({
                        where: {
                            slackThreadTs: event.thread_ts
                        }
                    });

                    if (thread) {
                        // 4. Create the Message
                        await prisma.message.create({
                            data: {
                                text: event.text,
                                sender: 'AGENT',
                                threadId: thread.id,
                            },
                        });
                        console.log(`Message from Slack stored for thread: ${thread.id}`);
                    } else {
                        console.warn(`No matching thread found for slackThreadTs: ${event.thread_ts}`);
                    }
                } catch (error) {
                    console.error("Error processing Slack event:", error);
                }
            } else {
                console.log("Skipping event: Not a threaded message.");
            }
        }

        // Acknowledge the event at the end of execution to prevent timeouts
        // and ensure logic completes in serverless environments.
        return res.status(200).send();
    }
} 