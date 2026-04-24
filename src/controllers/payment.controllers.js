import { supabase } from '../config/supabase.js';
import { createPaginationMeta, getPaginationParams } from '../utils/pagination.js';

const PUBLISHER_BONUS_PERCENTAGE = 0.05; // 5% bonus

/**
 * 0. Add Earning (Simulate publisher earning money, e.g., from views/ads)
 */
export const addEarning = async (req, res) => {
  try {
    const userId = req.user.id;
    const { amount } = req.body;

    if (!amount || amount <= 0) {
      return res.status(400).json({ error: 'Invalid earning amount' });
    }

    const { data: user, error: userError } = await supabase
      .from('users')
      .select('id, role, wallet_balance')
      .eq('id', userId)
      .single();

    if (userError || !user) throw userError || new Error('User not found');

    if (user.role !== 'PUBLISHER') {
      return res.status(400).json({ error: 'Only Publishers can earn money' });
    }

    // Add earning to wallet
    const newWalletBalance = (user.wallet_balance || 0) + Number(amount);
    await supabase
      .from('users')
      .update({ wallet_balance: newWalletBalance })
      .eq('id', user.id);

    // Record earning transaction
    await supabase
      .from('transactions')
      .insert([{
        user_id: userId,
        amount: amount,
        reference_id: 'SYSTEM_EARNING',
        status: 'APPROVED' // Earnings are instantly approved
      }]);

    return res.status(200).json({
      message: 'Earning added successfully',
      walletBalance: newWalletBalance
    });
  } catch (error) {
    console.error('Add Earning Error:', error);
    return res.status(500).json({ error: error.message || 'Internal Server Error' });
  }
};

/**
 * 1. Request Manual Payment / Withdrawal (User requests payout)
 * Stores the request in 'transactions' table with PENDING status and deducts from wallet.
 */
export const requestManualPayment = async (req, res) => {
  try {
    const userId = req.user.id;
    const { amount, referenceId } = req.body;

    if (!amount || amount <= 0) {
      return res.status(400).json({ error: 'Invalid withdrawal amount' });
    }

    const { data: user, error: userError } = await supabase
      .from('users')
      .select('id, role, wallet_balance')
      .eq('id', userId)
      .single();

    if (userError || !user) throw userError || new Error('User not found');

    if (user.role !== 'PUBLISHER') {
      return res.status(400).json({ error: 'Only Publishers can request withdrawals' });
    }

    if ((user.wallet_balance || 0) < amount) {
      return res.status(400).json({ error: 'Insufficient wallet balance' });
    }

    // Deduct amount from wallet immediately so they can't double-spend
    const newWalletBalance = user.wallet_balance - amount;
    await supabase
      .from('users')
      .update({ wallet_balance: newWalletBalance })
      .eq('id', user.id);

    // Insert pending withdrawal transaction into the database
    // Amount is stored as negative to represent a withdrawal
    const { data: transaction, error: insertError } = await supabase
      .from('transactions')
      .insert([{
        user_id: userId,
        amount: -amount,
        reference_id: referenceId || 'WITHDRAWAL_REQUEST',
        status: 'PENDING'
      }])
      .select()
      .single();

    if (insertError) {
      // Revert wallet balance if insert fails
      await supabase.from('users').update({ wallet_balance: user.wallet_balance }).eq('id', user.id);
      return res.status(500).json({ error: 'Failed to record withdrawal request: ' + insertError.message });
    }

    return res.status(200).json({
      message: 'Withdrawal request submitted successfully. Awaiting approval.',
      walletBalance: newWalletBalance,
      transaction
    });
  } catch (error) {
    console.error('Request Withdrawal Error:', error);
    return res.status(500).json({ error: error.message || 'Internal Server Error' });
  }
};

/**
 * 2. Update Payment Status (Admin securely approves/rejects the payment)
 * If APPROVED, distributes referral bonuses. If REJECTED, refunds the user's wallet.
 */
export const updatePaymentStatus = async (req, res) => {
  try {
    const userRole = req.user.role;
    if (userRole !== 'ADMIN') return res.status(403).json({ error: 'Only Admins can update payment status' });

    const { transactionId, status } = req.body;

    if (!['APPROVED', 'REJECTED', 'PENDING'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status. Must be APPROVED, REJECTED, or PENDING' });
    }

    const { data: transaction, error: txError } = await supabase
      .from('transactions')
      .select('*')
      .eq('id', transactionId)
      .single();

    if (txError || !transaction) return res.status(404).json({ error: 'Transaction not found' });
    if (transaction.status === 'APPROVED' || transaction.status === 'REJECTED') {
      return res.status(400).json({ error: 'This transaction has already been processed' });
    }

    // Amount was stored as negative for withdrawal, get absolute value
    const absAmount = Math.abs(transaction.amount);

    // Update status in DB
    const { error: updateTxError } = await supabase
      .from('transactions')
      .update({ status: status })
      .eq('id', transactionId);



    if (updateTxError) return res.status(500).json({ error: 'Failed to update transaction status' });

    const { data: user } = await supabase
      .from('users')
      .select('id, role, wallet_balance, referred_by')
      .eq('id', transaction.user_id)
      .single();

    if (status === 'REJECTED') {
      // Refund the wallet
      if (user) {
        const refundedBalance = (user.wallet_balance || 0) + absAmount;
        await supabase.from('users').update({ wallet_balance: refundedBalance }).eq('id', user.id);
      }
      return res.status(200).json({ message: 'Withdrawal rejected. Funds refunded to user wallet.', transactionStatus: status });
    }

    // If APPROVED, process referral bonus!
    let bonusProcessed = false;
    let bonusAmount = 0;

    if (status === 'APPROVED' && user && user.referred_by && user.role === 'PUBLISHER') {
      bonusAmount = absAmount * PUBLISHER_BONUS_PERCENTAGE;

      // Give 5% to referrer
      const { data: referrer } = await supabase
        .from('users')
        .select('id, role, wallet_balance')
        .eq('id', user.referred_by)
        .single();

      if (referrer && referrer.role === 'PUBLISHER') {
        const referrerNewBalance = (referrer.wallet_balance || 0) + bonusAmount;
        await supabase.from('users').update({ wallet_balance: referrerNewBalance }).eq('id', referrer.id);

        // Also create an earning transaction for the referrer so they see it in their dashboard!
        await supabase.from('transactions').insert([{
          user_id: referrer.id,
          amount: bonusAmount,
          reference_id: `REFERRAL_BONUS_FROM_${user.id}`,
          status: 'APPROVED'
        }]);

        bonusProcessed = true;
      }
    }

    return res.status(200).json({
      message: 'Withdrawal approved. Publisher paid & referral bonus distributed.',
      transactionStatus: status,
      referralBonusProcessed: bonusProcessed,
      bonusAmount: bonusAmount
    });
  } catch (error) {
    console.error('Update Payment Status Error:', error);
    return res.status(500).json({ error: error.message || 'Internal Server Error' });
  }
};

/**
 * 3. Get Publisher Earnings
 * Allows a publisher to check their current wallet balance and transaction history.
 */
export const getPublisherEarnings = async (req, res) => {
  try {
    const userId = req.user.id;
    const { page, limit, from, to } = getPaginationParams(req.query, { defaultLimit: 10, maxLimit: 100 });

    // Fetch the user's current wallet balance
    const { data: user, error: userError } = await supabase
      .from('users')
      .select('id, role, wallet_balance')
      .eq('id', userId)
      .single();

    if (userError || !user) throw userError || new Error('User not found');

    if (user.role !== 'PUBLISHER') {
      return res.status(400).json({ error: 'Only Publishers can view earnings' });
    }

    // Fetch the user's transaction history (earnings/payments)
    const { data: transactions, error: txError, count } = await supabase
      .from('transactions')
      .select('*', { count: 'exact' })
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .range(from, to);

    if (txError) {
      return res.status(500).json({ error: 'Failed to fetch transaction history' });
    }

    const { data: allApprovedTransactions, error: approvedError } = await supabase
      .from('transactions')
      .select('amount')
      .eq('user_id', userId)
      .eq('status', 'APPROVED');

    if (approvedError) {
      return res.status(500).json({ error: 'Failed to fetch approved earnings history' });
    }

    // Calculate total earnings from approved transactions (only positive amounts are earnings)
    const totalEarned = (allApprovedTransactions || [])
      .filter(tx => Number(tx.amount) > 0)
      .reduce((sum, tx) => sum + Number(tx.amount), 0);

    return res.status(200).json({
      message: 'Earnings fetched successfully',
      walletBalance: user.wallet_balance || 0,
      totalEarned: totalEarned,
      transactions: transactions || [],
      pagination: createPaginationMeta({ page, limit, totalItems: count }),
    });
  } catch (error) {
    console.error('Get Earnings Error:', error);
    return res.status(500).json({ error: error.message || 'Internal Server Error' });
  }
};
