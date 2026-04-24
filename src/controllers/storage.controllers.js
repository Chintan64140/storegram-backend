import { supabase } from '../config/supabase.js';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { s3Client } from '../config/s3.js';
import { PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';

export const initStorage = async (req, res) => {
  try {
    const userId = req.user.id;
    
    // We update the user's storage total if they don't have it initialized
    const { data: user } = await supabase.from('users').select('storage_total').eq('id', userId).single();
    
    if (!user || user.storage_total === 0) {
      await supabase.from('users').update({ storage_total: 5120 }).eq('id', userId); // 5GB in MB
    }

    res.json({ message: 'Storage initialized with 5GB quota' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

export const uploadToStorage = async (req, res) => {
  try {
    const userId = req.user.id;
    const { folderId } = req.body;
    const file = req.file;

    if (!file) return res.status(400).json({ error: 'No file uploaded' });

    // 1. Check user storage usage
    const { data: user } = await supabase.from('users').select('storage_total, storage_used').eq('id', userId).single();
    const fileSizeMB = file.size / (1024 * 1024);
    
    if (user && (user.storage_used || 0) + fileSizeMB > (user.storage_total || 5120)) {
      if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
      return res.status(403).json({ error: 'Storage quota exceeded' });
    }

    const fileExtension = path.extname(file.originalname);
    const fileName = `${crypto.randomBytes(8).toString('hex')}${fileExtension}`;
    const fileStream = fs.createReadStream(file.path);

    const uploadParams = {
      Bucket: process.env.R2_BUCKET_NAME,
      Key: fileName,
      Body: fileStream,
      ContentType: file.mimetype,
    };

    // Upload to Cloudflare R2
    await s3Client.send(new PutObjectCommand(uploadParams));

    // Delete local temp file
    fs.unlinkSync(file.path);

    const fileUrl = `${process.env.R2_PUBLIC_URL}/${fileName}`;

    // Update storage_used
    const newStorageUsed = (user.storage_used || 0) + fileSizeMB;
    await supabase.from('users').update({ storage_used: newStorageUsed }).eq('id', userId);

    // Save to files table (using publisher_id field as user_id for viewer uploads to reuse the same table, or add user_id)
    const { data: dbFile, error } = await supabase
      .from('files')
      .insert([{
        publisher_id: userId, // Re-using publisher_id for viewers as well in the single files table
        title: file.originalname,
        file_url: fileUrl,
        size: file.size,
        folder_id: folderId || null,
        short_id: crypto.randomBytes(3).toString('hex')
      }])
      .select()
      .single();

    if (error) throw error;
    res.status(201).json(dbFile);
  } catch (err) {
    if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    res.status(500).json({ error: err.message });
  }
};

export const getStorageFiles = async (req, res) => {
  try {
    const userId = req.user.id;
    const { folderId } = req.query;

    let query = supabase.from('files').select('*').eq('publisher_id', userId);
    
    if (folderId) {
      query = query.eq('folder_id', folderId);
    } else {
      query = query.is('folder_id', null);
    }

    const { data: files, error } = await query;
    if (error) throw error;
    res.json(files);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

export const getStorageFileById = async (req, res) => {
  try {
    const userId = req.user.id;
    const { fileId } = req.params;

    const { data: file, error } = await supabase
      .from('files')
      .select('*')
      .eq('id', fileId)
      .eq('publisher_id', userId)
      .single();

    if (error || !file) return res.status(404).json({ error: 'File not found' });
    res.json(file);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

export const deleteStorageFile = async (req, res) => {
  try {
    const userId = req.user.id;
    const { fileId } = req.params;

    const { data: file, error: fetchError } = await supabase
      .from('files')
      .select('file_url, size')
      .eq('id', fileId)
      .eq('publisher_id', userId)
      .single();

    if (fetchError || !file) return res.status(404).json({ error: 'File not found' });

    const urlParts = file.file_url.split('/');
    const fileKey = urlParts[urlParts.length - 1];

    if (fileKey && process.env.R2_BUCKET_NAME) {
      try {
        await s3Client.send(new DeleteObjectCommand({ Bucket: process.env.R2_BUCKET_NAME, Key: fileKey }));
      } catch (s3Error) {
        console.error('Failed to delete file from S3:', s3Error);
      }
    }

    const { error: deleteError } = await supabase.from('files').delete().eq('id', fileId);
    if (deleteError) throw deleteError;

    // Deduct from storage_used
    const { data: user } = await supabase.from('users').select('storage_used').eq('id', userId).single();
    if (user) {
      const fileSizeMB = file.size / (1024 * 1024);
      const newStorageUsed = Math.max(0, (user.storage_used || 0) - fileSizeMB);
      await supabase.from('users').update({ storage_used: newStorageUsed }).eq('id', userId);
    }

    res.json({ message: 'File deleted successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

export const getStorageUsage = async (req, res) => {
  try {
    const userId = req.user.id;
    const { data: user, error } = await supabase
      .from('users')
      .select('storage_used, storage_total')
      .eq('id', userId)
      .single();

    if (error || !user) return res.status(404).json({ error: 'User not found' });
    res.json({
      storageUsedMB: user.storage_used || 0,
      storageTotalMB: user.storage_total || 5120,
      percentage: ((user.storage_used || 0) / (user.storage_total || 5120)) * 100
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
