import express from 'express';
import { authenticateToken } from '../middleware/auth.middleware.js';
import { upload } from '../middleware/upload.middleware.js';
import {
  initStorage,
  uploadToStorage,
  getStorageFiles,
  getStorageFileById,
  deleteStorageFile,
  getStorageUsage
} from '../controllers/storage.controllers.js';

const router = express.Router();

router.use(authenticateToken);

router.post('/init', initStorage);
router.post('/upload', upload.single('file'), uploadToStorage);
router.get('/files', getStorageFiles);
router.get('/files/:fileId', getStorageFileById);
router.delete('/files/:fileId', deleteStorageFile);
router.get('/usage', getStorageUsage);

export default router;
