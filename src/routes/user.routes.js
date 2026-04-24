import express from 'express'
import { getUser, getUsers, sendOtp, verifyOtp } from '../controllers/user.controllers.js'
import { authenticateToken } from '../middleware/auth.middleware.js'

const router = express.Router()

router.get('/', authenticateToken, getUsers) // good idea to protect this route
router.get('/profile', authenticateToken, getUser);

router.post('/send-otp', authenticateToken, sendOtp)
router.post('/verify-otp', authenticateToken, verifyOtp)

export default router