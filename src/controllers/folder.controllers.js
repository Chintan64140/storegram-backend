import { supabase } from '../config/supabase.js';

const normalizeFolderId = (value) => {
  const normalized = String(value || '').trim();
  return normalized || null;
};

const getFolderById = async (folderId, userId) => {
  if (!folderId) {
    return null;
  }

  const { data: folder, error } = await supabase
    .from('folders')
    .select('id, user_id, parent_id')
    .eq('id', folderId)
    .eq('user_id', userId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return folder;
};

const assertValidParentFolder = async ({ parentId, userId, currentFolderId = null }) => {
  const normalizedParentId = normalizeFolderId(parentId);

  if (!normalizedParentId) {
    return null;
  }

  if (currentFolderId && normalizedParentId === currentFolderId) {
    throw new Error('A folder cannot be its own parent');
  }

  const parentFolder = await getFolderById(normalizedParentId, userId);
  if (!parentFolder) {
    throw new Error('Parent folder not found');
  }

  if (currentFolderId) {
    let cursor = parentFolder;

    while (cursor?.parent_id) {
      if (cursor.parent_id === currentFolderId) {
        throw new Error('You cannot move a folder into one of its own children');
      }

      cursor = await getFolderById(cursor.parent_id, userId);
    }
  }

  return normalizedParentId;
};

export const createFolder = async (req, res) => {
  try {
    const { name, parentId } = req.body;
    const userId = req.user.id;
    const trimmedName = String(name || '').trim();

    if (!trimmedName) return res.status(400).json({ error: 'Folder name is required' });

    const normalizedParentId = await assertValidParentFolder({ parentId, userId });

    const { data: folder, error } = await supabase
      .from('folders')
      .insert([{
        user_id: userId,
        name: trimmedName,
        parent_id: normalizedParentId
      }])
      .select()
      .single();

    if (error) throw error;
    res.status(201).json(folder);
  } catch (err) {
    const status = ['Folder name is required', 'Parent folder not found'].includes(err.message)
      || err.message.includes('cannot')
      ? 400
      : 500;
    res.status(status).json({ error: err.message });
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
    const trimmedName = String(name || '').trim();

    if (!trimmedName) {
      return res.status(400).json({ error: 'Folder name is required' });
    }

    const existingFolder = await getFolderById(folderId, userId);
    if (!existingFolder) {
      return res.status(404).json({ error: 'Folder not found or update failed' });
    }

    const normalizedParentId = await assertValidParentFolder({
      parentId,
      userId,
      currentFolderId: folderId,
    });

    const { data: folder, error } = await supabase
      .from('folders')
      .update({ name: trimmedName, parent_id: normalizedParentId })
      .eq('id', folderId)
      .eq('user_id', userId)
      .select()
      .single();

    if (error || !folder) return res.status(404).json({ error: 'Folder not found or update failed' });
    res.json(folder);
  } catch (err) {
    const status = ['Folder name is required', 'Parent folder not found'].includes(err.message)
      || err.message.includes('cannot')
      ? 400
      : 500;
    res.status(status).json({ error: err.message });
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
