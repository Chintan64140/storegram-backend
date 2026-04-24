import express from 'express';
import { authenticateToken } from '../middleware/auth.middleware.js';
import {
  createFolder,
  getFolders,
  updateFolder,
  deleteFolder
} from '../controllers/folder.controllers.js';

const router = express.Router();

router.use(authenticateToken);

router.post('/', createFolder);
router.get('/', getFolders);
router.put('/:folderId', updateFolder);
router.delete('/:folderId', deleteFolder);

export default router;
