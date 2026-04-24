import { supabase } from '../config/supabase.js';

const EARNING_PER_VALID_VIEW = 0.01;

export const startTracking = async (req, res) => {
  try {
    const { shortId } = req.body;
    if (!shortId) return res.status(400).json({ error: 'shortId is required' });

    // Find the file
    const { data: file, error: fileError } = await supabase
      .from('files')
      .select('id, publisher_id')
      .eq('short_id', shortId)
      .single();

    if (fileError || !file) return res.status(404).json({ error: 'File not found' });

    // Create an initial view record with 0 watch time
    const { data: view, error: viewError } = await supabase
      .from('views')
      .insert([{
        file_id: file.id,
        publisher_id: file.publisher_id,
        watch_time: 0,
        is_valid: false,
        ip_address: req.ip || req.connection.remoteAddress
      }])
      .select()
      .single();

    if (viewError) throw viewError;

    res.status(201).json({
      message: 'Tracking started',
      viewId: view.id
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

export const heartbeatTracking = async (req, res) => {
  try {
    const { viewId, watchTimeSeconds } = req.body;
    if (!viewId || watchTimeSeconds === undefined) {
      return res.status(400).json({ error: 'viewId and watchTimeSeconds are required' });
    }

    // Update the view record with the latest watch time
    const { error } = await supabase
      .from('views')
      .update({ watch_time: watchTimeSeconds })
      .eq('id', viewId);

    if (error) throw error;

    res.json({ message: 'Heartbeat registered' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

export const endTracking = async (req, res) => {
  try {
    const { viewId } = req.body;
    if (!viewId) return res.status(400).json({ error: 'viewId is required' });

    // Get the view and the associated file
    const { data: view, error: viewError } = await supabase
      .from('views')
      .select('*, files(duration, total_views, total_earnings)')
      .eq('id', viewId)
      .single();

    if (viewError || !view) return res.status(404).json({ error: 'View record not found' });
    
    // If it was already validated previously, don't double credit
    if (view.is_valid) {
      return res.json({ message: 'Tracking ended, view was already credited' });
    }

    const fileDuration = view.files?.duration || 0;
    const tenPercentDuration = fileDuration * 0.1;
    let isValidView = false;

    // Validation rule: >= 20 seconds OR >= 10% of total duration
    if (view.watch_time >= 20 || (fileDuration > 0 && view.watch_time >= tenPercentDuration)) {
      isValidView = true;
    }

    // Update view as valid (or kept invalid)
    await supabase.from('views').update({ is_valid: isValidView }).eq('id', viewId);

    if (isValidView) {
      // 1. Get publisher
      const { data: publisher } = await supabase
        .from('users')
        .select('id, wallet_balance')
        .eq('id', view.publisher_id)
        .single();

      if (publisher) {
        // 2. Add Earning to Wallet
        const newWalletBalance = (publisher.wallet_balance || 0) + EARNING_PER_VALID_VIEW;
        await supabase.from('users').update({ wallet_balance: newWalletBalance }).eq('id', publisher.id);

        // 3. Record Transaction
        await supabase.from('transactions').insert([{
          user_id: publisher.id,
          amount: EARNING_PER_VALID_VIEW,
          reference_id: `EARNING_VIEW_${view.id}`,
          status: 'APPROVED'
        }]);

        // 4. Update File Stats
        await supabase.from('files').update({
          total_views: (view.files.total_views || 0) + 1,
          total_earnings: (view.files.total_earnings || 0) + EARNING_PER_VALID_VIEW
        }).eq('id', view.file_id);
      }
    }

    res.json({
      message: 'Tracking ended successfully',
      finalWatchTime: view.watch_time,
      isValidView
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
