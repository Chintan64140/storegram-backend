import express from 'express';
import {
  uploadFile,
  getFileByShortLink,
  startFileView,
  heartbeatFileView,
  endFileView,
  trackFileView
} from '../controllers/file.controllers.js';
import { authenticateToken } from '../middleware/auth.middleware.js';
import { uploadSingleFile } from '../middleware/upload.middleware.js';

const router = express.Router();

// 1. Publisher uploads a file and generates short link
router.post('/upload', authenticateToken, uploadSingleFile, uploadFile);

// 2. Viewer fetches file details using the short link (Public API, no auth required)
router.get('/:shortId', getFileByShortLink);

// 3. Viewer tracking session from public short link
router.post('/:shortId/view/start', startFileView);
router.post('/:shortId/view/:viewId/heartbeat', heartbeatFileView);
router.post('/:shortId/view/:viewId/end', endFileView);

// 4. Legacy one-call view tracking API
router.post('/:shortId/view', trackFileView);

export default router;
