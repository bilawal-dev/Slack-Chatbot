import dotenv from 'dotenv';
import prisma from '../config/database.js';

dotenv.config();

const API_TOKEN = process.env.CLICKUP_PERSONAL_API_TOKEN;
const BASE_URL = 'https://api.clickup.com/api/v2';

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
        const url = `${BASE_URL}${endpoint}`;

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
}