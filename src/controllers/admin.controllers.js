import { supabase } from '../config/supabase.js';
import { s3Client } from '../config/s3.js';
import { DeleteObjectCommand } from '@aws-sdk/client-s3';
import { createPaginationMeta, getPaginationParams } from '../utils/pagination.js';

const BYTES_PER_MB = 1024 * 1024;

const toNumber = (value) => Number(value || 0);

const normalizeStorageUsedToMB = (storageUsed, storageTotal) => {
  const used = toNumber(storageUsed);
  const total = toNumber(storageTotal);

  if (used <= 0) {
    return 0;
  }

  if ((total > 0 && used > total * 4) || used > BYTES_PER_MB * 2) {
    return used / BYTES_PER_MB;
  }

  return used;
};

const normalizeUserStorage = (user) => ({
  ...user,
  storage_used_mb: normalizeStorageUsedToMB(user.storage_used, user.storage_total),
  storage_total_mb: toNumber(user.storage_total),
});

const getRecentMonthLabels = (count = 6) => {
  const labels = [];
  const now = new Date();

  for (let index = count - 1; index >= 0; index -= 1) {
    const date = new Date(now.getFullYear(), now.getMonth() - index, 1);
    labels.push({
      key: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`,
      label: date.toLocaleString('en-US', { month: 'short', year: 'numeric' }),
    });
  }

  return labels;
};

// Helper middleware to ensure admin access
export const ensureAdmin = (req, res, next) => {
  if (req.user.role !== 'ADMIN') {
    return res.status(403).json({ error: 'Access denied. Admins only.' });
  }
  next();
};

// --------------------------------
// User Management
// --------------------------------
export const getAllUsers = async (req, res) => {
  try {
    const { page, limit, from, to } = getPaginationParams(req.query, { defaultLimit: 15 });
    const { data: users, error, count } = await supabase
      .from('users')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(from, to);
    if (error) throw error;
    res.json({
      data: (users || []).map(normalizeUserStorage),
      pagination: createPaginationMeta({ page, limit, totalItems: count }),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

export const getUserById = async (req, res) => {
  try {
    const { data: user, error } = await supabase.from('users').select('*').eq('id', req.params.userId).single();
    if (error) throw error;
    res.json(normalizeUserStorage(user));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

export const blockUser = async (req, res) => {
  try {
    const { userId, isBlocked } = req.body; // isBlocked = true or false
    const { data, error } = await supabase.from('users').update({ is_approved: !isBlocked }).eq('id', userId).select().single();
    if (error) throw error;
    res.json({ message: `User ${isBlocked ? 'blocked' : 'unblocked'} successfully`, user: data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

export const changeUserRole = async (req, res) => {
  try {
    const { userId, role } = req.body;
    const { data, error } = await supabase.from('users').update({ role }).eq('id', userId).select().single();
    if (error) throw error;
    res.json({ message: 'Role updated', user: data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// --------------------------------
// View / Tracking Management
// --------------------------------
export const getAllViews = async (req, res) => {
  try {
    const { page, limit, from, to } = getPaginationParams(req.query, { defaultLimit: 20, maxLimit: 200 });
    const { data, error, count } = await supabase
      .from('views')
      .select('*, files(title), users(name)', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(from, to);
    if (error) throw error;
    res.json({
      data: data || [],
      pagination: createPaginationMeta({ page, limit, totalItems: count }),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// --------------------------------
// Storage Management
// --------------------------------
export const getAllFiles = async (req, res) => {
  try {
    const { page, limit, from, to } = getPaginationParams(req.query, { defaultLimit: 15, maxLimit: 200 });
    const { data, error, count } = await supabase
      .from('files')
      .select('*, users(name, email)', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(from, to);
    if (error) throw error;
    res.json({
      data: data || [],
      pagination: createPaginationMeta({ page, limit, totalItems: count }),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

export const overrideStorage = async (req, res) => {
  try {
    const { userId, additionalMB } = req.body; // use negative for decrease
    const { data: user } = await supabase.from('users').select('storage_total').eq('id', userId).single();
    if (!user) return res.status(404).json({ error: 'User not found' });

    const newTotal = Math.max(0, user.storage_total + additionalMB);
    const { data, error } = await supabase.from('users').update({ storage_total: newTotal }).eq('id', userId).select().single();
    if (error) throw error;
    res.json({ message: 'Storage capacity updated', storage_total: data.storage_total });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

export const adminDeleteFile = async (req, res) => {
  try {
    const { fileId } = req.params;
    const { data: file, error: fetchError } = await supabase.from('files').select('file_url, publisher_id, size').eq('id', fileId).single();
    if (fetchError || !file) return res.status(404).json({ error: 'File not found' });

    const urlParts = file.file_url.split('/');
    const fileKey = urlParts[urlParts.length - 1];

    if (fileKey && process.env.R2_BUCKET_NAME) {
      try { await s3Client.send(new DeleteObjectCommand({ Bucket: process.env.R2_BUCKET_NAME, Key: fileKey })); } catch (e) {}
    }

    await supabase.from('files').delete().eq('id', fileId);

    // Give storage back
    const { data: user } = await supabase.from('users').select('storage_used, storage_total').eq('id', file.publisher_id).single();
    if (user) {
      const fileSizeMB = file.size / (1024 * 1024);
      const currentStorageUsedMB = normalizeStorageUsedToMB(user.storage_used, user.storage_total);
      await supabase
        .from('users')
        .update({ storage_used: Math.max(0, currentStorageUsedMB - fileSizeMB) })
        .eq('id', file.publisher_id);
    }

    res.json({ message: 'File overridden and deleted by Admin' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// --------------------------------
// Withdraw Management (Pending)
// --------------------------------
export const getWithdrawRequests = async (req, res) => {
  try {
    const { page, limit, from, to } = getPaginationParams(req.query, { defaultLimit: 15, maxLimit: 100 });
    const { data, error, count } = await supabase
      .from('transactions')
      .select('*, users(id, name, email, role, wallet_balance, mobile, referral_code, is_approved, storage_used, storage_total, created_at)', { count: 'exact' })
      .eq('status', 'PENDING')
      .order('created_at', { ascending: false })
      .range(from, to);
    if (error) throw error;
    res.json({
      data: (data || []).map((transaction) => ({
        ...transaction,
        users: transaction.users ? normalizeUserStorage(transaction.users) : null,
      })),
      pagination: createPaginationMeta({ page, limit, totalItems: count }),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

export const getAllTransactions = async (req, res) => {
  try {
    const { page, limit, from, to } = getPaginationParams(req.query, { defaultLimit: 20, maxLimit: 200 });
    const { data, error, count } = await supabase
      .from('transactions')
      .select('*, users(id, name, email, role, wallet_balance, mobile, referral_code, is_approved, storage_used, storage_total, created_at)', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(from, to);

    if (error) throw error;

    const normalizedTransactions = (data || []).map((transaction) => ({
      ...transaction,
      users: transaction.users ? normalizeUserStorage(transaction.users) : null,
    }));

    res.json({
      data: normalizedTransactions,
      pagination: createPaginationMeta({ page, limit, totalItems: count }),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// --------------------------------
// Publishers Control
// --------------------------------
export const getPublishers = async (req, res) => {
  try {
    const { page, limit, from, to } = getPaginationParams(req.query, { defaultLimit: 15 });
    const { data: publishers, error } = await supabase
      .from('users')
      .select('*', { count: 'exact' })
      .eq('role', 'PUBLISHER')
      .order('created_at', { ascending: false })
      .range(from, to);

    if (error) throw error;
    const totalItems = publishers?.length === 0 ? 0 : undefined;

    const { count: publisherCount, error: countError } = await supabase
      .from('users')
      .select('*', { count: 'exact', head: true })
      .eq('role', 'PUBLISHER');

    if (countError) throw countError;

    const publisherIds = (publishers || []).map((publisher) => publisher.id);

    if (publisherIds.length === 0) {
      return res.json({
        data: [],
        pagination: createPaginationMeta({ page, limit, totalItems: publisherCount ?? totalItems }),
      });
    }

    const [{ data: files, error: filesError }, { data: transactions, error: transactionsError }] = await Promise.all([
      supabase.from('files').select('publisher_id, size, total_views, total_earnings').in('publisher_id', publisherIds),
      supabase.from('transactions').select('user_id, amount, status').in('user_id', publisherIds),
    ]);

    if (filesError) throw filesError;
    if (transactionsError) throw transactionsError;

    const fileStats = new Map();
    for (const file of files || []) {
      const current = fileStats.get(file.publisher_id) || {
        totalFiles: 0,
        totalViews: 0,
        totalEarnings: 0,
        totalFileStorageMB: 0,
      };

      current.totalFiles += 1;
      current.totalViews += toNumber(file.total_views);
      current.totalEarnings += toNumber(file.total_earnings);
      current.totalFileStorageMB += toNumber(file.size) / BYTES_PER_MB;

      fileStats.set(file.publisher_id, current);
    }

    const transactionStats = new Map();
    for (const transaction of transactions || []) {
      const current = transactionStats.get(transaction.user_id) || {
        totalTransactions: 0,
        pendingWithdrawals: 0,
        approvedWithdrawals: 0,
        rejectedWithdrawals: 0,
        approvedPayoutAmount: 0,
      };

      current.totalTransactions += 1;

      const amount = toNumber(transaction.amount);
      const isWithdrawal = amount < 0;

      if (isWithdrawal && transaction.status === 'PENDING') {
        current.pendingWithdrawals += 1;
      }

      if (isWithdrawal && transaction.status === 'APPROVED') {
        current.approvedWithdrawals += 1;
        current.approvedPayoutAmount += Math.abs(amount);
      }

      if (isWithdrawal && transaction.status === 'REJECTED') {
        current.rejectedWithdrawals += 1;
      }

      transactionStats.set(transaction.user_id, current);
    }

    const enrichedPublishers = publishers.map((publisher) => {
      const stats = fileStats.get(publisher.id) || {
        totalFiles: 0,
        totalViews: 0,
        totalEarnings: 0,
        totalFileStorageMB: 0,
      };

      const payoutStats = transactionStats.get(publisher.id) || {
        totalTransactions: 0,
        pendingWithdrawals: 0,
        approvedWithdrawals: 0,
        rejectedWithdrawals: 0,
        approvedPayoutAmount: 0,
      };

      return {
        ...normalizeUserStorage(publisher),
        stats: {
          ...stats,
          ...payoutStats,
        },
      };
    });

    res.json({
      data: enrichedPublishers,
      pagination: createPaginationMeta({ page, limit, totalItems: publisherCount }),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

export const getPublisherDetails = async (req, res) => {
  try {
    const { publisherId } = req.params;
    const filesPagination = getPaginationParams(req.query, { prefix: 'files', defaultLimit: 10, maxLimit: 100 });
    const viewsPagination = getPaginationParams(req.query, { prefix: 'views', defaultLimit: 10, maxLimit: 100 });
    const transactionsPagination = getPaginationParams(req.query, { prefix: 'transactions', defaultLimit: 10, maxLimit: 100 });
    const referredUsersPagination = getPaginationParams(req.query, { prefix: 'referredUsers', defaultLimit: 10, maxLimit: 100 });

    const { data: publisher, error: publisherError } = await supabase
      .from('users')
      .select('*')
      .eq('id', publisherId)
      .eq('role', 'PUBLISHER')
      .single();

    if (publisherError || !publisher) {
      return res.status(404).json({ error: 'Publisher not found' });
    }

    const [
      { data: files, error: filesError, count: filesCount },
      { data: views, error: viewsError, count: viewsCount },
      { data: transactions, error: transactionsError, count: transactionsCount },
      { data: referredUsers, error: referredUsersError, count: referredUsersCount },
      { data: summaryFiles, error: summaryFilesError },
      { data: summaryViews, error: summaryViewsError },
      { data: summaryTransactions, error: summaryTransactionsError },
      { count: summaryReferredUsersCount, error: summaryReferredUsersCountError },
    ] = await Promise.all([
      supabase
        .from('files')
        .select('*', { count: 'exact' })
        .eq('publisher_id', publisherId)
        .order('created_at', { ascending: false })
        .range(filesPagination.from, filesPagination.to),
      supabase
        .from('views')
        .select('*, files(title, short_id)', { count: 'exact' })
        .eq('publisher_id', publisherId)
        .order('created_at', { ascending: false })
        .range(viewsPagination.from, viewsPagination.to),
      supabase
        .from('transactions')
        .select('*', { count: 'exact' })
        .eq('user_id', publisherId)
        .order('created_at', { ascending: false })
        .range(transactionsPagination.from, transactionsPagination.to),
      supabase
        .from('users')
        .select('id, name, email, role, created_at, is_approved', { count: 'exact' })
        .eq('referred_by', publisherId)
        .order('created_at', { ascending: false })
        .range(referredUsersPagination.from, referredUsersPagination.to),
      supabase
        .from('files')
        .select('size, total_views, total_earnings')
        .eq('publisher_id', publisherId),
      supabase
        .from('views')
        .select('is_valid')
        .eq('publisher_id', publisherId),
      supabase
        .from('transactions')
        .select('amount, status')
        .eq('user_id', publisherId),
      supabase
        .from('users')
        .select('*', { count: 'exact', head: true })
        .eq('referred_by', publisherId),
    ]);

    if (filesError) throw filesError;
    if (viewsError) throw viewsError;
    if (transactionsError) throw transactionsError;
    if (referredUsersError) throw referredUsersError;
    if (summaryFilesError) throw summaryFilesError;
    if (summaryViewsError) throw summaryViewsError;
    if (summaryTransactionsError) throw summaryTransactionsError;
    if (summaryReferredUsersCountError) throw summaryReferredUsersCountError;

    const allFiles = summaryFiles || [];
    const allViews = summaryViews || [];
    const allTransactions = summaryTransactions || [];

    const approvedWithdrawals = allTransactions.filter((transaction) => transaction.status === 'APPROVED' && toNumber(transaction.amount) < 0);
    const pendingWithdrawals = allTransactions.filter((transaction) => transaction.status === 'PENDING' && toNumber(transaction.amount) < 0);
    const validViews = allViews.filter((view) => view.is_valid);

    const totalFileStorageMB = allFiles.reduce((sum, file) => sum + toNumber(file.size) / BYTES_PER_MB, 0);
    const totalFileViews = allFiles.reduce((sum, file) => sum + toNumber(file.total_views), 0);
    const totalFileEarnings = allFiles.reduce((sum, file) => sum + toNumber(file.total_earnings), 0);
    const approvedPayoutAmount = approvedWithdrawals.reduce((sum, transaction) => sum + Math.abs(toNumber(transaction.amount)), 0);

    res.json({
      publisher: normalizeUserStorage(publisher),
      summary: {
        totalFiles: allFiles.length,
        totalViews: allViews.length,
        validViews: validViews.length,
        totalFileViews,
        totalFileEarnings,
        totalFileStorageMB,
        totalTransactions: allTransactions.length,
        pendingWithdrawals: pendingWithdrawals.length,
        approvedWithdrawals: approvedWithdrawals.length,
        approvedPayoutAmount,
        referredUsers: summaryReferredUsersCount || 0,
      },
      files: {
        data: files || [],
        pagination: createPaginationMeta({ page: filesPagination.page, limit: filesPagination.limit, totalItems: filesCount }),
      },
      views: {
        data: views || [],
        pagination: createPaginationMeta({ page: viewsPagination.page, limit: viewsPagination.limit, totalItems: viewsCount }),
      },
      transactions: {
        data: transactions || [],
        pagination: createPaginationMeta({ page: transactionsPagination.page, limit: transactionsPagination.limit, totalItems: transactionsCount }),
      },
      referredUsers: {
        data: referredUsers || [],
        pagination: createPaginationMeta({ page: referredUsersPagination.page, limit: referredUsersPagination.limit, totalItems: referredUsersCount }),
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

export const approvePublisher = async (req, res) => {
  try {
    const { publisherId } = req.body;
    const { data, error } = await supabase.from('users').update({ is_approved: true }).eq('id', publisherId).select().single();
    if (error) throw error;
    res.json({ message: 'Publisher approved', user: data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// --------------------------------
// Dashboard Analytics
// --------------------------------
export const getAdminDashboard = async (req, res) => {
  try {
    const [
      { count: totalUsers, error: totalUsersError },
      { count: totalFiles, error: totalFilesError },
      { count: totalViews, error: totalViewsError },
      { data: users, error: usersError },
      { data: transactions, error: transactionsError },
    ] = await Promise.all([
      supabase.from('users').select('*', { count: 'exact', head: true }),
      supabase.from('files').select('*', { count: 'exact', head: true }),
      supabase.from('views').select('*', { count: 'exact', head: true }),
      supabase.from('users').select('id, role, is_approved, storage_used, storage_total'),
      supabase.from('transactions').select('id, amount, status, created_at'),
    ]);

    if (totalUsersError) throw totalUsersError;
    if (totalFilesError) throw totalFilesError;
    if (totalViewsError) throw totalViewsError;
    if (usersError) throw usersError;
    if (transactionsError) throw transactionsError;

    const allUsers = users || [];
    const allTransactions = transactions || [];

    const pendingWithdrawals = allTransactions.filter((transaction) => transaction.status === 'PENDING' && toNumber(transaction.amount) < 0);
    const completedWithdrawals = allTransactions.filter((transaction) => transaction.status === 'APPROVED' && toNumber(transaction.amount) < 0);
    const rejectedWithdrawals = allTransactions.filter((transaction) => transaction.status === 'REJECTED' && toNumber(transaction.amount) < 0);

    const approvedPublishers = allUsers.filter((user) => user.role === 'PUBLISHER' && user.is_approved).length;
    const pendingPublishers = allUsers.filter((user) => user.role === 'PUBLISHER' && !user.is_approved).length;

    const platformStorageUsedMB = allUsers.reduce(
      (sum, user) => sum + normalizeStorageUsedToMB(user.storage_used, user.storage_total),
      0
    );

    const totalPayoutAmount = completedWithdrawals.reduce(
      (sum, transaction) => sum + Math.abs(toNumber(transaction.amount)),
      0
    );

    const chartBuckets = getRecentMonthLabels(6).reduce((result, item) => {
      result[item.key] = {
        month: item.label,
        completed: 0,
        pending: 0,
        rejected: 0,
        payoutAmount: 0,
      };
      return result;
    }, {});

    for (const transaction of allTransactions) {
      const amount = toNumber(transaction.amount);
      if (amount >= 0 || !transaction.created_at) {
        continue;
      }

      const date = new Date(transaction.created_at);
      const bucketKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      const bucket = chartBuckets[bucketKey];

      if (!bucket) {
        continue;
      }

      if (transaction.status === 'APPROVED') {
        bucket.completed += 1;
        bucket.payoutAmount += Math.abs(amount);
      } else if (transaction.status === 'PENDING') {
        bucket.pending += 1;
      } else if (transaction.status === 'REJECTED') {
        bucket.rejected += 1;
      }
    }

    res.json({
      totalUsers: totalUsers || 0,
      totalFiles: totalFiles || 0,
      totalViews: totalViews || 0,
      totalTransactions: allTransactions.length,
      pendingWithdrawals: pendingWithdrawals.length,
      completedWithdrawals: completedWithdrawals.length,
      rejectedWithdrawals: rejectedWithdrawals.length,
      approvedPublishers,
      pendingPublishers,
      platformStorageUsedMB,
      totalPayoutAmount,
      withdrawalChart: Object.values(chartBuckets),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
