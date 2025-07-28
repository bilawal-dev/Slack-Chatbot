import { Router } from 'express';
import { ChatController } from '../controllers/ChatController.js';

const router = Router();

// * Locations
router.get('/locations/:folderId', ChatController.getListsInFolder);

// * Threads
router.post('/threads', ChatController.createThread);
router.get('/threads/:listId', ChatController.getThreads);
router.put('/threads/:threadId', ChatController.updateThread);
router.delete('/threads/:threadId', ChatController.deleteThread);

// * Messages
router.post('/messages', ChatController.sendMessage);
router.get('/messages/:threadId', ChatController.getMessagesForThread);

export default router;