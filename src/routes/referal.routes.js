import express from 'express';
import { 
  getReferralStats, 
  updateViewTime, 
  recordPublisherPayment 
} from '../controllers/referal.controllers.js';
import { authenticateToken } from '../middleware/auth.middleware.js';

const router = express.Router();

// Get the user's current referral status (how many joined, limits, etc.)
router.get('/stats', authenticateToken, getReferralStats);

// Update viewer's watch time (trigger referral condition if bounds met)
router.post('/view-time', authenticateToken, updateViewTime);


// Simulate Publisher receiving a payment (distributes referral % to referrer)
router.post('/payment', authenticateToken, recordPublisherPayment);

export default router;
