import { DeleteObjectCommand } from '@aws-sdk/client-s3';
import { supabase } from '../../config/supabase.js';
import { s3Client } from '../../config/s3.js';
import { createPaginationMeta, getPaginationParams } from '../../utils/pagination.js';

export const getPublisherContent = async (req, res) => {
  try {
    const userId = req.user.id;
    const { page, limit, from, to } = getPaginationParams(req.query, { defaultLimit: 10, maxLimit: 100 });

    const { data: files, error, count } = await supabase
      .from('files')
      .select('*', { count: 'exact' })
      .eq('publisher_id', userId)
      .order('created_at', { ascending: false })
      .range(from, to);

    if (error) throw error;
    res.json({
      data: files || [],
      pagination: createPaginationMeta({ page, limit, totalItems: count }),
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

export const getPublisherContentById = async (req, res) => {
  try {
    const userId = req.user.id;
    const { id } = req.params;

    const { data: file, error } = await supabase
      .from('files')
      .select('*')
      .eq('id', id)
      .eq('publisher_id', userId)
      .single();

    if (error || !file) return res.status(404).json({ error: 'Content not found' });
    res.json(file);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

export const updatePublisherContent = async (req, res) => {
  try {
    const userId = req.user.id;
    const { id } = req.params;
    const { title, description } = req.body;

    const { data: file, error } = await supabase
      .from('files')
      .update({ title, description })
      .eq('id', id)
      .eq('publisher_id', userId)
      .select()
      .single();

    if (error || !file) return res.status(404).json({ error: 'Content not found or update failed' });
    res.json({ message: 'Content updated successfully', file });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

export const deletePublisherContent = async (req, res) => {
  try {
    const userId = req.user.id;
    const { id } = req.params;

    const { data: file, error: fetchError } = await supabase
      .from('files')
      .select('file_url')
      .eq('id', id)
      .eq('publisher_id', userId)
      .single();

    if (fetchError || !file) return res.status(404).json({ error: 'Content not found' });

    const urlParts = file.file_url.split('/');
    const fileKey = urlParts[urlParts.length - 1];

    if (fileKey && process.env.R2_BUCKET_NAME) {
      try {
        await s3Client.send(new DeleteObjectCommand({
          Bucket: process.env.R2_BUCKET_NAME,
          Key: fileKey,
        }));
      } catch (s3Error) {
        console.error('Failed to delete file from S3:', s3Error);
      }
    }

    const { error: deleteError } = await supabase
      .from('files')
      .delete()
      .eq('id', id);

    if (deleteError) throw deleteError;

    res.json({ message: 'Content deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
