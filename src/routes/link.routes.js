import express from 'express';
import { authenticateToken } from '../middleware/auth.middleware.js';
import {
  createLink,
  getLinkData,
  verifyLinkPassword,
  revokeLink
} from '../controllers/link.controllers.js';

const router = express.Router();

// Public routes for accessing links
router.get('/:linkId', getLinkData);
router.post('/:linkId/password', verifyLinkPassword);

// Protected routes for managing links
router.post('/create', authenticateToken, createLink);
router.post('/:linkId/revoke', authenticateToken, revokeLink);

export default router;
