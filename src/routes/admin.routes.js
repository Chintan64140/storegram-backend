import express from 'express';
import { authenticateToken } from '../middleware/auth.middleware.js';
import {
  ensureAdmin,
  getAllUsers,
  getUserById,
  blockUser,
  changeUserRole,
  getAllViews,
  overrideStorage,
  adminDeleteFile,
  getWithdrawRequests,
  getAllTransactions,
  getPublishers,
  getPublisherDetails,
  approvePublisher,
  getAdminDashboard,
  getAllFiles
} from '../controllers/admin.controllers.js';
import { updatePaymentStatus } from '../controllers/payment.controllers.js';

const router = express.Router();

router.use(authenticateToken);
router.use(ensureAdmin);

// 1. User Management
router.get('/users', getAllUsers);
router.get('/users/:userId', getUserById);
router.post('/users/block', blockUser);
router.post('/users/change-role', changeUserRole);

// 2. View/Tracking Management
router.get('/views', getAllViews);

// 3. Storage & Files Management
router.get('/files', getAllFiles);
router.post('/storage/increase', overrideStorage);
router.post('/storage/decrease', overrideStorage);
router.delete('/files/:fileId', adminDeleteFile);

// 4. Withdraw Management
router.get('/withdraw/requests', getWithdrawRequests);
router.get('/transactions', getAllTransactions);
// Using the existing payment status update controller for approve/reject
router.post('/withdraw/approve', updatePaymentStatus);
router.post('/withdraw/reject', updatePaymentStatus);

// 5. Publisher Control
router.get('/publishers', getPublishers);
router.get('/publishers/:publisherId', getPublisherDetails);
router.post('/publishers/approve', approvePublisher);

// 6. Analytics Dashboard
router.get('/analytics/dashboard', getAdminDashboard);

export default router;
