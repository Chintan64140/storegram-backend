import express from 'express';
import { requestManualPayment, updatePaymentStatus, getPublisherEarnings } from '../controllers/payment.controllers.js';
import { authenticateToken } from '../middleware/auth.middleware.js';

const router = express.Router();

router.use(authenticateToken);

// Publisher initiates a manual payment request (eg. UTR or Screenshot based)
router.post('/request', requestManualPayment);

// Admin explicitly approves/rejects the pending payment request
router.post('/update-status', updatePaymentStatus);

// Publisher checks their current earnings and transaction history
router.get('/earnings', getPublisherEarnings);

export default router;
