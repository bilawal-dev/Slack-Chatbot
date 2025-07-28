import { Router } from 'express';
import { SlackController } from '../controllers/SlackController.js';

const router = Router();

router.post('/events', SlackController.handleEvent);

export default router; 