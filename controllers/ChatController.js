import dotenv from 'dotenv';
import prisma from '../config/database.js';
import { listToSlackChannelMapping } from '../utils/List_To_SlackChannel_Mapping.js';

dotenv.config();

const API_TOKEN = process.env.CLICKUP_PERSONAL_API_TOKEN;
const CLICKUP_API_BASE_URL = 'https://api.clickup.com/api/v2';

// Known IDs from franchise_template_analysis.md and ExtraInfo.md
export const KNOWN_IDS = {
    teamId: '9013410499',
    templatesSpaceId: '90131823880',
    // projectsSpaceId: '90137209740',
    projectsSpaceId: '90137498382', // Brandon's test space "Brandon's copy"
    // projectIntakeListId: '901314460682',
    projectIntakeListId: '901316852775', // Brandon's test space "Brandon's copy" project intake list
    franchiseTemplateListId: '901314428250',
    customFields: {
        percentComplete: 'e50bab98-75cd-40c2-a193-ce2811e1713b',
        phase: 'e024c849-5312-44c7-8c28-d3642fc4163a'
    }
};

export class ChatController {

    // * Helper Function For API Calls
    static async apiCall(endpoint, options = {}) {
        const url = `${CLICKUP_API_BASE_URL}${endpoint}`;

        try {
            const response = await fetch(url, {
                headers: {
                    'Authorization': API_TOKEN,
                    'Content-Type': 'application/json',
                    ...options.headers
                },
                ...options
            });

            if (!response.ok) {
                const errorText = await response.text();
                console.error(`❌ API Error (${response.status}):`, errorText);
                throw new Error(`ClickUp API Error: ${response.status} - ${errorText}`);
            }

            const data = await response.json();
            return data;

        } catch (error) {
            console.error(`❌ API Call Failed for ${endpoint}:`, error);
            throw error;
        }
    };

    // * GET Lists (locations) In Folder
    static async getListsInFolder(req, res) {
        const { folderId } = req.params;
        const { userId } = req.user;

        if (!folderId) {
            return res.status(400).json({ success: false, message: 'Folder ID is required' });
        }

        try {
            const data = await ChatController.apiCall(`/folder/${folderId}/list`);

            const locationsData = await Promise.all(data.lists.map(async (list) => {
                const threadCount = await prisma.thread.count({
                    where: {
                        userId,
                        folderId: folderId,
                        listId: list.id,
                    },
                });

                return {
                    listId: list.id,
                    name: list.name,
                    threadCount: threadCount,
                }
            }));

            return res.status(200).json({
                success: true,
                message: `Lists for folder ${folderId} fetched successfully`,
                data: locationsData,
            });

        } catch (error) {
            console.error(`❌ Error fetching lists for folder ${folderId}:`, error);
            return res.status(500).json({
                success: false,
                message: error.message || 'An error occurred while fetching lists',
                data: []
            });
        }
    }

    // * POST a new thread
    static async createThread(req, res) {
        const { listId, folderId } = req.body;
        let { name } = req.body;
        const { userId } = req.user;

        if (!listId || !folderId) {
            return res.status(400).json({ success: false, message: 'List ID and Folder ID are required' });
        }

        // If no name is provided, use the default name
        if (!name) {
            name = `New Thread - ${new Date().toLocaleDateString()}`
        }

        try {
            const thread = await prisma.thread.create({
                data: {
                    userId,
                    listId,
                    folderId,
                    name,
                },
            });

            return res.status(201).json({
                success: true,
                message: 'Thread created successfully',
                data: thread,
            });

        } catch (error) {
            console.error(`❌ Error creating thread:`, error);
            return res.status(500).json({
                success: false,
                message: error.message || 'An error occurred while creating the thread',
            });
        }
    }

    // * GET all threads for a location
    static async getThreads(req, res) {
        const { listId } = req.params;
        const { userId } = req.user;

        try {
            const threads = await prisma.thread.findMany({
                where: {
                    userId,
                    listId,
                },
            });

            return res.status(200).json({
                success: true,
                message: `Threads for list ${listId} fetched successfully`,
                data: threads,
            });

        } catch (error) {
            console.error(`❌ Error fetching threads:`, error);
            return res.status(500).json({
                success: false,
                message: error.message || 'An error occurred while fetching threads',
            });
        }
    }

    // * UPDATE a thread
    static async updateThread(req, res) {
        const { threadId } = req.params;
        const { name } = req.body;
        const { userId } = req.user;

        try {
            const thread = await prisma.thread.findUnique({
                where: { id: threadId },
            });

            if (!thread) {
                return res.status(404).json({ success: false, message: 'Thread not found' });
            }

            if (thread.userId !== userId) {
                return res.status(403).json({ success: false, message: 'You are not authorized to update this thread' });
            }

            const updatedThread = await prisma.thread.update({
                where: { id: threadId },
                data: { name },
            });

            return res.status(200).json({
                success: true,
                message: 'Thread updated successfully',
                data: updatedThread,
            });

        } catch (error) {
            console.error(`❌ Error updating thread:`, error);
            return res.status(500).json({
                success: false,
                message: error.message || 'An error occurred while updating the thread',
            });
        }
    }

    // * DELETE a thread
    static async deleteThread(req, res) {
        const { threadId } = req.params;
        const { userId } = req.user;

        try {
            const thread = await prisma.thread.findUnique({
                where: { id: threadId },
            });

            if (!thread) {
                return res.status(404).json({ success: false, message: 'Thread not found' });
            }

            if (thread.userId !== userId) {
                return res.status(403).json({ success: false, message: 'You are not authorized to delete this thread' });
            }

            await prisma.thread.delete({
                where: { id: threadId },
            });

            return res.status(200).json({
                success: true,
                message: 'Thread deleted successfully',
            });

        } catch (error) {
            console.error(`❌ Error deleting thread:`, error);
            return res.status(500).json({
                success: false,
                message: error.message || 'An error occurred while deleting the thread',
            });
        }
    }

    // * POST a new message to a thread in Slack
    static async sendMessage(req, res) {
        const { threadId, text } = req.body;
        const { userId } = req.user;

        if (!threadId || !text) {
            return res.status(400).json({ success: false, message: "threadId and text are required" });
        }

        try {
            const thread = await prisma.thread.findFirst({
                where: {
                    id: threadId,
                    userId: userId,
                },
            });

            if (!thread) {
                return res.status(404).json({ success: false, message: "Thread not found or you do not have permission to access it" });
            }

            const channelId = listToSlackChannelMapping[thread.listId];
            if (!channelId) {
                return res.status(400).json({ success: false, message: "No Slack channel configured for this location" });
            }

            let slackThreadTs = thread.slackThreadTs;
            const slackMessage = {
                channel: channelId,
                text: text,
            };

            if (slackThreadTs) {
                slackMessage.thread_ts = slackThreadTs;
            } else {
                // To make the initial message more descriptive in the channel
                slackMessage.text = `New thread started by user: ${text}`;
            }

            const response = await fetch("https://slack.com/api/chat.postMessage", {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}`,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify(slackMessage),
            });

            const data = await response.json();

            if (!data.ok) {
                console.error("❌ Slack API Error:", data.error);
                return res.status(500).json({ success: false, message: `Failed to send message to Slack: ${data.error}` });
            }

            if (!slackThreadTs) {
                // If this was a new thread, save the timestamp
                slackThreadTs = data.ts;
                await prisma.thread.update({
                    where: { id: threadId },
                    data: { slackThreadTs: slackThreadTs },
                });
            }

            const message = await prisma.message.create({
                data: {
                    text: text,
                    sender: "USER",
                    threadId: threadId,
                },
            });

            return res.status(201).json({ success: true, message: "Message sent successfully", data: message });

        } catch (error) {
            console.error("Error sending message:", error);
            return res.status(500).json({ success: false, message: "Internal server error" });
        }
    }

    // * GET all messages for a thread
    static async getMessagesForThread(req, res) {
        const { threadId } = req.params;
        const { userId } = req.user;

        try {
            // First, verify the user owns the thread
            const thread = await prisma.thread.findFirst({
                where: {
                    id: threadId,
                    userId: userId
                }
            });

            if (!thread) {
                return res.status(404).json({ success: false, message: "Thread not found or you do not have permission to access it" });
            }

            // If ownership is confirmed, fetch the messages
            const messages = await prisma.message.findMany({
                where: {
                    threadId: threadId,
                },
                orderBy: {
                    createdAt: 'asc' // Fetch messages in chronological order
                }
            });

            return res.status(200).json({ success: true, data: messages });
        } catch (error) {
            console.error(`Error fetching messages for thread ${threadId}:`, error);
            return res.status(500).json({ success: false, message: "Internal server error" });
        }
    }
}