import express from 'express';
import { authenticateToken, authorizeUser } from '../middleware/auth.middleware.js';
import { uploadSingleFile } from '../middleware/upload.middleware.js';
import { uploadFile } from '../controllers/file.controllers.js';
import {
  getDashboardAnalytics,
  getViewsAnalytics,
  getUsersAnalytics
} from '../controllers/publisher/analytics.controllers.js';
import {
  getPublisherContent,
  getPublisherContentById,
  updatePublisherContent,
  deletePublisherContent
} from '../controllers/publisher/content.controllers.js';

const router = express.Router();

router.use(authenticateToken);
router.use(authorizeUser({ roles: ['PUBLISHER'], requireApproved: true }));

// ---------------------------
// Analytics Endpoints
// ---------------------------
router.get('/analytics/dashboard', getDashboardAnalytics);
router.get('/analytics/views', getViewsAnalytics);
router.get('/analytics/users', getUsersAnalytics);

// ---------------------------
// Content Endpoints
// ---------------------------
router.post('/content/upload', uploadSingleFile, uploadFile);
router.get('/content', getPublisherContent);
router.get('/content/:id', getPublisherContentById);
router.put('/content/:id', updatePublisherContent);
router.delete('/content/:id', deletePublisherContent);

export default router;
