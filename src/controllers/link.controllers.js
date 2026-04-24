import { supabase } from '../config/supabase.js';
import crypto from 'crypto';
import bcrypt from 'bcrypt';

export const createLink = async (req, res) => {
  try {
    const userId = req.user.id;
    const {
      fileId,
      folderId,
      password,
      expiresInDays
    } = req.body;

    const normalizedFileId = fileId?.trim() || null;
    const normalizedFolderId = folderId?.trim() || null;
    const normalizedPassword = password?.trim() || null;
    const normalizedExpiresInDays = expiresInDays === '' || expiresInDays === undefined
      ? null
      : Number(expiresInDays);

    if (!normalizedFileId && !normalizedFolderId) {
      return res.status(400).json({ error: 'Either fileId or folderId is required' });
    }

    if (normalizedExpiresInDays !== null && (!Number.isInteger(normalizedExpiresInDays) || normalizedExpiresInDays <= 0)) {
      return res.status(400).json({ error: 'expiresInDays must be a positive number' });
    }

    let hashedPassword = null;
    if (normalizedPassword) {
      hashedPassword = await bcrypt.hash(normalizedPassword, 10);
    }

    const expiresAt = normalizedExpiresInDays
      ? new Date(Date.now() + normalizedExpiresInDays * 24 * 60 * 60 * 1000)
      : null;
    const shortId = crypto.randomBytes(4).toString('hex');

    const { data: link, error } = await supabase
      .from('shared_links')
      .insert([{
        user_id: userId,
        file_id: normalizedFileId,
        folder_id: normalizedFolderId,
        password: hashedPassword,
        expires_at: expiresAt,
        short_id: shortId,
        is_revoked: false
      }])
      .select()
      .single();

    if (error) throw error;
    
    // Don't send the hashed password back
    delete link.password;

    res.status(201).json({
      message: 'Link created successfully',
      linkUrl: `${req.protocol}://${req.get('host')}/api/links/${shortId}`,
      link
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

export const getLinkData = async (req, res) => {
  try {
    const { linkId } = req.params;
    
    const { data: link, error } = await supabase
      .from('shared_links')
      .select('*, files(*), folders(*)')
      .eq('short_id', linkId)
      .single();

    if (error || !link) return res.status(404).json({ error: 'Link not found' });

    if (link.is_revoked) return res.status(403).json({ error: 'This link has been revoked' });
    if (link.expires_at && new Date() > new Date(link.expires_at)) {
      return res.status(403).json({ error: 'This link has expired' });
    }

    if (link.password) {
      // If there is a password, we don't return the file/folder data yet. 
      // The client must call the /password endpoint.
      return res.status(401).json({ 
        message: 'Password required', 
        isPasswordProtected: true,
        shortId: link.short_id
      });
    }

    delete link.password;
    res.json(link);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

export const verifyLinkPassword = async (req, res) => {
  try {
    const { linkId } = req.params;
    const { password } = req.body;

    if (!password) return res.status(400).json({ error: 'Password is required' });

    const { data: link, error } = await supabase
      .from('shared_links')
      .select('*, files(*), folders(*)')
      .eq('short_id', linkId)
      .single();

    if (error || !link) return res.status(404).json({ error: 'Link not found' });
    if (link.is_revoked) return res.status(403).json({ error: 'This link has been revoked' });
    if (link.expires_at && new Date() > new Date(link.expires_at)) {
      return res.status(403).json({ error: 'This link has expired' });
    }

    const isMatch = await bcrypt.compare(password, link.password);
    if (!isMatch) return res.status(401).json({ error: 'Incorrect password' });

    delete link.password;
    res.json(link);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

export const revokeLink = async (req, res) => {
  try {
    const userId = req.user.id;
    const { linkId } = req.params;

    const { error } = await supabase
      .from('shared_links')
      .update({ is_revoked: true })
      .eq('short_id', linkId)
      .eq('user_id', userId);

    if (error) throw error;
    res.json({ message: 'Link revoked successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
