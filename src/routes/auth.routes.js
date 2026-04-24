import express from 'express';
import { 
  signup, 
  login, 
  changePassword, 
  forgotPassword, 
  resetPassword,
  sendOtp,
  verifyOtp,
  googleAuth,
  refreshToken,
  logout
} from '../controllers/auth.controllers.js';
import { authenticateToken } from '../middleware/auth.middleware.js';

const router = express.Router();

router.post('/signup', signup);
router.post('/login', login);
router.post('/forgot-password', forgotPassword);
router.post('/reset-password', resetPassword);

// New Auth Routes
router.post('/send-otp', sendOtp);
router.post('/verify-otp', verifyOtp);
router.post('/resend-otp', sendOtp); // resend-otp maps to sendOtp
router.post('/google', googleAuth);
router.post('/refresh-token', refreshToken);

// Protected routes inside Auth flow
router.post('/logout', authenticateToken, logout);
router.post('/change-password', authenticateToken, changePassword);

export default router;
