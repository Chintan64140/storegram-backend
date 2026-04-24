import multer from 'multer';
import path from 'path';
import fs from 'fs';

const uploadDir = 'uploads/';
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

export const upload = multer({ storage: storage });

export const uploadSingleFile = (req, res, next) => {
  upload.single('file')(req, res, (error) => {
    if (!error) return next();

    if (error instanceof multer.MulterError) {
      return res.status(400).json({
        error: error.message,
        code: error.code,
        expectedField: 'file',
        hint: 'Send multipart/form-data with the uploaded file in a field named "file".'
      });
    }

    return res.status(400).json({ error: error.message });
  });
};
