import { supabase } from "../config/supabase.js";

// Viewer qualification stats
const VIEWER_QUALIFY_MINUTES = 5;
const VIEWER_QUALIFY_SECONDS = VIEWER_QUALIFY_MINUTES * 60;
const REFERRALS_NEEDED_FOR_STORAGE = 20;
const STORAGE_BONUS_MB = 1024; // 1GB

// Publisher bonus stats
const PUBLISHER_BONUS_PERCENTAGE = 0.05; // 5% bonus. If a user receives payment of 100, referrer gets 5.

/**
 * Get Referral Stats for current user
 */
export const getReferralStats = async (req, res) => {
  try {
    const userId = req.user.id;
    const userRole = req.user.role;

    // Get all users referred by this user
    const { data: referredUsers, error } = await supabase
      .from('users')
      .select('id, name, role, view_time_seconds, is_qualified_referral')
      .eq('referred_by', userId);

    if (error) throw error;
    console.log(userRole);

    if (userRole === 'VIEWER') {
      const viewerReferrals = referredUsers.filter(u => u.role === 'VIEWER');
      const qualified = viewerReferrals.filter(u => u.is_qualified_referral).length;

      const storageBonusesEarned = Math.floor(qualified / REFERRALS_NEEDED_FOR_STORAGE);
      console.log(REFERRALS_NEEDED_FOR_STORAGE);

      return res.json({
        totalReferredViewers: viewerReferrals.length,
        qualifiedViewers: qualified,
        pendingViewers: viewerReferrals.length - qualified,
        storageBonusEarnedMB: storageBonusesEarned * STORAGE_BONUS_MB,
        nextBonusProgress: `${qualified % REFERRALS_NEEDED_FOR_STORAGE}/${REFERRALS_NEEDED_FOR_STORAGE}`
      });
    }

    if (userRole === 'PUBLISHER') {
      const publisherReferrals = referredUsers.filter(u => u.role === 'PUBLISHER');

      const { data: me, error: meError } = await supabase
        .from('users')
        .select('wallet_balance')
        .eq('id', userId)
        .single();

      return res.json({
        totalReferredPublishers: publisherReferrals.length,
        totalReferralEarnings: me?.wallet_balance || 0,
        bonusPercentage: `${PUBLISHER_BONUS_PERCENTAGE * 100}%`
      });
    }

    return res.json({
      message: "Admin referral stats",
      referredUsersCount: referredUsers.length
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};

/**
 * Update View Time for Viewer logic.
 * Frontend calls this periodically (e.g. every minute) to add to view_time_seconds
 */
export const updateViewTime = async (req, res) => {
  try {
    const userId = req.user.id;
    const { secondsWatched } = req.body;

    if (!secondsWatched || secondsWatched <= 0) {
      return res.status(400).json({ error: "Invalid view time" });
    }

    const { data: user, error: userError } = await supabase
      .from('users')
      .select('id, referred_by, view_time_seconds, is_qualified_referral, role')
      .eq('id', userId)
      .single();

    if (userError || !user) throw userError || new Error("User not found");

    if (user.role !== 'VIEWER') {
      return res.status(400).json({
        message: "Only Viewers accumulate view time for referral qualification",
        ignored: true
      });
    }

    const newViewTime = (user.view_time_seconds || 0) + secondsWatched;
    let newlyQualified = false;

    // Check if they cross the threshold
    console.log(!user.is_qualified_referral , newViewTime >= VIEWER_QUALIFY_SECONDS);
    
    if (!user.is_qualified_referral && newViewTime >= VIEWER_QUALIFY_SECONDS) {
      newlyQualified = true;
    }

    // Update user's view time and qualification status
    await supabase
      .from('users')
      .update({
        view_time_seconds: newViewTime,
        is_qualified_referral: user.is_qualified_referral || newlyQualified
      })
      .eq('id', userId);

    // If newly qualified, check the referrer to give bonus
    if (newlyQualified && user.referred_by) {
      console.log(newlyQualified , user.referred_by);
      

      await processViewerReferralBonus(user.referred_by);
    }

    return res.json({
      message: "View time updated",
      totalViewTime: newViewTime,
      newlyQualified
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};

/**
 * Evaluates the referrer's storage limits if a new viewer qualifies
 */
async function processViewerReferralBonus(referrerId) {
  const { data: referrer } = await supabase
    .from('users')
    .select('id, role, storage_total')
    .eq('id', referrerId)
    .single();

  if (!referrer || referrer.role !== 'VIEWER') return;

  // Count qualified viewers referred by this referrer
  const { count, error } = await supabase
    .from('users')
    .select('*', { count: 'exact', head: true })
    .eq('referred_by', referrerId)
    .eq('role', 'VIEWER')
    .eq('is_qualified_referral', true);

  if (error) return;

  // For every 20 viewers, +1GB.
  // We assume default base storage for Viewer is 5120MB.
  const BASE_STORAGE = 5120;
  const bonusesEarned = Math.floor(count / REFERRALS_NEEDED_FOR_STORAGE);

  const expectedStorage = BASE_STORAGE + (bonusesEarned * STORAGE_BONUS_MB);

  console.log(expectedStorage ,'ahdj');
  

  // If their storage is less than expected, update it
  if (referrer.storage_total < expectedStorage) {
    await supabase
      .from('users')
      .update({ storage_total: expectedStorage })
      .eq('id', referrerId);
  }
}

/**
 * Record a payment and distribute publisher referral bonus (10% or 5%)
 */
export const recordPublisherPayment = async (req, res) => {
  try {
    const userId = req.user.id;
    const { amount, referenceId } = req.body;

    if (!amount || amount <= 0) {
      return res.status(400).json({ error: "Invalid payment amount" });
    }

    const { data: user, error: userError } = await supabase
      .from('users')
      .select('id, role, referred_by, wallet_balance')
      .eq('id', userId)
      .single();

    if (userError || !user) throw userError || new Error("User not found");

    if (user.role !== 'PUBLISHER') {
      return res.status(400).json({ error: "Only Publisher payments generate publisher referral bonuses" });
    }

    // Instead of crediting immediately, create a PENDING transaction.
    // The actual wallet balance and referral bonus will be processed
    // when the Admin approves this transaction via the payment routes.
    const { data: transaction, error: insertError } = await supabase
      .from('transactions')
      .insert([{
        user_id: userId,
        amount: amount,
        reference_id: referenceId || 'N/A', // Reference for the earning/payment
        status: 'PENDING'
      }])
      .select()
      .single();

    if (insertError) {
      return res.status(500).json({ error: 'Failed to record payment request: ' + insertError.message });
    }

    return res.json({
      message: "Payment request submitted successfully. Waiting for admin approval to credit wallet and distribute referral bonus.",
      transactionAmount: amount,
      transactionStatus: transaction.status
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
