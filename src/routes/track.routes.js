import express from 'express';
import { authenticateToken } from '../middleware/auth.middleware.js';
import {
  startTracking,
  heartbeatTracking,
  endTracking
} from '../controllers/track.controllers.js';

const router = express.Router();

router.use(authenticateToken);
  
// Protected routes for viewer tracking
router.post('/start', startTracking);
router.post('/heartbeat', heartbeatTracking);
router.post('/end', endTracking);

export default router;
