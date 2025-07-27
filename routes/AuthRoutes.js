import { Router } from 'express'
import AuthController from '../controllers/AuthController.js'
import { AuthenticateToken } from '../middleware/AuthMiddleware.js'

const router = Router()

router.post('/signup', AuthController.Signup)
router.post('/login', AuthController.Login)
router.get('/authenticate', AuthenticateToken, AuthController.Authenticate)

export default router