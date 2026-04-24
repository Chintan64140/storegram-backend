import { supabase } from '../config/supabase.js';

export const createFolder = async (req, res) => {
  try {
    const { name, parentId } = req.body;
    const userId = req.user.id;

    if (!name) return res.status(400).json({ error: 'Folder name is required' });

    const { data: folder, error } = await supabase
      .from('folders')
      .insert([{
        user_id: userId,
        name,
        parent_id: parentId || null
      }])
      .select()
      .single();

    if (error) throw error;
    res.status(201).json(folder);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

export const getFolders = async (req, res) => {
  try {
    const userId = req.user.id;
    const { parentId } = req.query;

    let query = supabase.from('folders').select('*').eq('user_id', userId);
    
    if (parentId) {
      query = query.eq('parent_id', parentId);
    } else {
      query = query.is('parent_id', null); // Top level folders
    }

    const { data: folders, error } = await query;

    if (error) throw error;
    res.json(folders);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

export const updateFolder = async (req, res) => {
  try {
    const userId = req.user.id;
    const { folderId } = req.params;
    const { name, parentId } = req.body;

    const { data: folder, error } = await supabase
      .from('folders')
      .update({ name, parent_id: parentId })
      .eq('id', folderId)
      .eq('user_id', userId)
      .select()
      .single();

    if (error || !folder) return res.status(404).json({ error: 'Folder not found or update failed' });
    res.json(folder);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

export const deleteFolder = async (req, res) => {
  try {
    const userId = req.user.id;
    const { folderId } = req.params;

    // Supabase should ideally cascade delete files inside, or we can just delete the folder
    const { error } = await supabase
      .from('folders')
      .delete()
      .eq('id', folderId)
      .eq('user_id', userId);

    if (error) throw error;
    res.json({ message: 'Folder deleted successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
