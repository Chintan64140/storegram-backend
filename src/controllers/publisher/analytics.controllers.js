import { supabase } from '../../config/supabase.js';
import { createPaginationMeta, getPaginationParams } from '../../utils/pagination.js';

const EARNING_PER_VALID_VIEW = 0.01;
const MAX_SECONDS_FOR_VALID_VIEW = 20;

const toNumber = (value) => {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : 0;
};

const formatDateKey = (value) => {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date.toISOString().slice(0, 10);
};

const formatMonthKey = (value) => {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
};

const getMonthRange = (monthKey) => {
  const normalizedMonth = /^\d{4}-\d{2}$/.test(monthKey) ? monthKey : formatMonthKey(new Date());
  const [year, month] = normalizedMonth.split('-').map(Number);
  const start = new Date(Date.UTC(year, month - 1, 1));
  const end = new Date(Date.UTC(year, month, 0));

  return {
    monthKey: normalizedMonth,
    start,
    end,
  };
};

export const getDashboardAnalytics = async (req, res) => {
  try {
    const userId = req.user.id;
    const selectedDate = formatDateKey(req.query.date) || formatDateKey(new Date());
    const { monthKey: selectedMonth, start: monthStart, end: monthEnd } = getMonthRange(req.query.month || selectedDate?.slice(0, 7));

    const [
      { data: files, error: filesError },
      { count: totalReferredUsers, error: referralsError },
      { data: publisher, error: publisherError },
      { data: transactions, error: transactionsError },
      { data: views, error: viewsError },
    ] = await Promise.all([
      supabase
        .from('files')
        .select('id, total_views, total_earnings, created_at')
        .eq('publisher_id', userId),
      supabase
        .from('users')
        .select('id', { count: 'exact', head: true })
        .eq('referred_by', userId),
      supabase
        .from('users')
        .select('wallet_balance')
        .eq('id', userId)
        .single(),
      supabase
        .from('transactions')
        .select('id, amount, status, reference_id, created_at')
        .eq('user_id', userId)
        .order('created_at', { ascending: false }),
      supabase
        .from('views')
        .select('id, is_valid, created_at')
        .eq('publisher_id', userId)
        .order('created_at', { ascending: false }),
    ]);

    if (filesError) throw filesError;
    if (referralsError) throw referralsError;
    if (publisherError) throw publisherError;
    if (transactionsError) throw transactionsError;
    if (viewsError) throw viewsError;

    const allFiles = files || [];
    const allTransactions = transactions || [];
    const allViews = views || [];

    const totalViews = allFiles.reduce((sum, file) => sum + toNumber(file.total_views), 0);
    const totalFiles = allFiles.length;
    const totalRevenue = allFiles.reduce((sum, file) => sum + toNumber(file.total_earnings), 0);

    const totalPaid = allTransactions
      .filter((transaction) => transaction.status === 'APPROVED' && toNumber(transaction.amount) < 0)
      .reduce((sum, transaction) => sum + Math.abs(toNumber(transaction.amount)), 0);

    const approvedWithdrawals = allTransactions.filter((transaction) => transaction.status === 'APPROVED' && toNumber(transaction.amount) < 0).length;
    const pendingWithdrawals = allTransactions.filter((transaction) => transaction.status === 'PENDING' && toNumber(transaction.amount) < 0).length;
    const canceledWithdrawals = allTransactions.filter((transaction) => transaction.status === 'REJECTED' && toNumber(transaction.amount) < 0).length;

    const dailyUploadedFiles = allFiles.filter((file) => formatDateKey(file.created_at) === selectedDate).length;
    const dailyViews = allViews.filter((view) => formatDateKey(view.created_at) === selectedDate);
    const dailyValidViews = dailyViews.filter((view) => view.is_valid).length;
    const dailyViewEarnings = allTransactions
      .filter((transaction) => (
        transaction.status === 'APPROVED' &&
        toNumber(transaction.amount) > 0 &&
        String(transaction.reference_id || '').startsWith('EARNING_VIEW_') &&
        formatDateKey(transaction.created_at) === selectedDate
      ))
      .reduce((sum, transaction) => sum + toNumber(transaction.amount), 0);
    const dailyTotalEarnings = allTransactions
      .filter((transaction) => (
        transaction.status === 'APPROVED' &&
        toNumber(transaction.amount) > 0 &&
        formatDateKey(transaction.created_at) === selectedDate
      ))
      .reduce((sum, transaction) => sum + toNumber(transaction.amount), 0);

    const monthlyUploadedFiles = allFiles.filter((file) => formatMonthKey(file.created_at) === selectedMonth).length;
    const monthlyViews = allViews.filter((view) => formatMonthKey(view.created_at) === selectedMonth);
    const monthlyValidViews = monthlyViews.filter((view) => view.is_valid).length;
    const monthlyViewEarnings = allTransactions
      .filter((transaction) => (
        transaction.status === 'APPROVED' &&
        toNumber(transaction.amount) > 0 &&
        String(transaction.reference_id || '').startsWith('EARNING_VIEW_') &&
        formatMonthKey(transaction.created_at) === selectedMonth
      ))
      .reduce((sum, transaction) => sum + toNumber(transaction.amount), 0);
    const monthlyTotalEarnings = allTransactions
      .filter((transaction) => (
        transaction.status === 'APPROVED' &&
        toNumber(transaction.amount) > 0 &&
        formatMonthKey(transaction.created_at) === selectedMonth
      ))
      .reduce((sum, transaction) => sum + toNumber(transaction.amount), 0);

    const chartData = [];
    for (let date = new Date(monthStart); date <= monthEnd; date.setUTCDate(date.getUTCDate() + 1)) {
      const dayKey = formatDateKey(date);

      chartData.push({
        date: dayKey,
        label: String(date.getUTCDate()).padStart(2, '0'),
        views: allViews.filter((view) => formatDateKey(view.created_at) === dayKey).length,
        uploadedFiles: allFiles.filter((file) => formatDateKey(file.created_at) === dayKey).length,
        earnings: allTransactions
          .filter((transaction) => (
            transaction.status === 'APPROVED' &&
            toNumber(transaction.amount) > 0 &&
            formatDateKey(transaction.created_at) === dayKey
          ))
          .reduce((sum, transaction) => sum + toNumber(transaction.amount), 0),
      });
    }

    res.json({
      totalViews,
      totalFiles,
      totalReferredUsers: totalReferredUsers || 0,
      walletBalance: publisher?.wallet_balance || 0,
      revenueOverview: {
        totalRevenue,
        totalPaid,
        availableRevenue: publisher?.wallet_balance || 0,
        approvedWithdrawals,
        pendingWithdrawals,
        canceledWithdrawals,
      },
      earningsModel: {
        amountPerValidView: EARNING_PER_VALID_VIEW,
        thresholdRule: 'A view counts after 10% watch time, capped at 20 seconds.',
        maxThresholdSeconds: MAX_SECONDS_FOR_VALID_VIEW,
      },
      dailyAnalytics: {
        date: selectedDate,
        uploadedFiles: dailyUploadedFiles,
        views: dailyViews.length,
        validViews: dailyValidViews,
        viewEarnings: dailyViewEarnings,
        totalEarnings: dailyTotalEarnings,
      },
      monthlyAnalytics: {
        month: selectedMonth,
        uploadedFiles: monthlyUploadedFiles,
        views: monthlyViews.length,
        validViews: monthlyValidViews,
        viewEarnings: monthlyViewEarnings,
        totalEarnings: monthlyTotalEarnings,
        chart: chartData,
      },
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

export const getViewsAnalytics = async (req, res) => {
  try {
    const userId = req.user.id;
    const { page, limit, from, to } = getPaginationParams(req.query, { defaultLimit: 10, maxLimit: 100 });

    const { data: views, error, count } = await supabase
      .from('views')
      .select(`
        id, watch_time, is_valid, location, ip_address, created_at,
        files(title, short_id)
      `, { count: 'exact' })
      .eq('publisher_id', userId)
      .order('created_at', { ascending: false })
      .range(from, to);

    if (error) throw error;
    res.json({
      data: views || [],
      pagination: createPaginationMeta({ page, limit, totalItems: count }),
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

export const getUsersAnalytics = async (req, res) => {
  try {
    const userId = req.user.id;
    const { page, limit, from, to } = getPaginationParams(req.query, { defaultLimit: 10, maxLimit: 100 });

    const { data: referredUsers, error, count } = await supabase
      .from('users')
      .select('id, name, email, role, created_at', { count: 'exact' })
      .eq('referred_by', userId)
      .order('created_at', { ascending: false })
      .range(from, to);

    if (error) throw error;
    res.json({
      data: referredUsers || [],
      pagination: createPaginationMeta({ page, limit, totalItems: count }),
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
