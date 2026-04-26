import { supabase } from "../config/supabase.js";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { s3Client } from "../config/s3.js";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { DeleteObjectCommand } from "@aws-sdk/client-s3";

// Constants for earnings
const EARNING_PER_VALID_VIEW = 0.01; // Example: 0.01 amount per valid view
const MAX_SECONDS_FOR_VALID_VIEW = 20;

const getClientIp = (req) => {
  const forwardedFor = req.headers["x-forwarded-for"];
  const ip = Array.isArray(forwardedFor)
    ? forwardedFor[0]
    : forwardedFor?.split(",")[0]?.trim();

  return (
    req.headers["cf-connecting-ip"] ||
    ip ||
    req.ip ||
    req.connection?.remoteAddress ||
    "Unknown"
  ).replace(/^::ffff:/, "");
};

const getViewerLocation = (req) => {
  const body = req.body || {};

  if (typeof body.location === "string" && body.location.trim()) {
    return body.location.trim();
  }

  if (body.location && typeof body.location === "object") {
    const parts = [
      body.location.city,
      body.location.region,
      body.location.country,
    ].filter(Boolean);

    if (parts.length) return parts.join(", ");
  }

  const parts = [body.city, body.region, body.country].filter(Boolean);
  if (parts.length) return parts.join(", ");

  if (req.headers["cf-ipcountry"]) {
    return String(req.headers["cf-ipcountry"]);
  }

  return "Unknown";
};

const getValidViewThreshold = (duration) => {
  const durationSeconds = Number(duration) || 0;
  if (durationSeconds <= 0) return MAX_SECONDS_FOR_VALID_VIEW;

  return Math.min(MAX_SECONDS_FOR_VALID_VIEW, Math.ceil(durationSeconds * 0.1));
};

const creditPublisherForView = async ({ view, file }) => {
  const { data: publisher } = await supabase
    .from("users")
    .select("id, wallet_balance")
    .eq("id", file.publisher_id)
    .single();

  if (!publisher) {
    return { credited: false, reason: "publisher_not_found" };
  }

  const newWalletBalance =
    (publisher.wallet_balance || 0) + EARNING_PER_VALID_VIEW;

  await supabase
    .from("users")
    .update({ wallet_balance: newWalletBalance })
    .eq("id", publisher.id);

  await supabase.from("transactions").insert([
    {
      user_id: publisher.id,
      amount: EARNING_PER_VALID_VIEW,
      reference_id: `EARNING_VIEW_${view.id}`,
      status: "APPROVED",
    },
  ]);

  await supabase
    .from("files")
    .update({
      total_views: (file.total_views || 0) + 1,
      total_earnings: (file.total_earnings || 0) + EARNING_PER_VALID_VIEW,
    })
    .eq("id", file.id);

  return {
    credited: true,
    earningAmount: EARNING_PER_VALID_VIEW,
    walletBalance: newWalletBalance,
  };
};

/**
 * 1. Upload File & Generate Short Link
 */
// export const uploadFile = async (req, res) => {
//   try {
//     const userId = req.user.id;
//     const user = req.user;
//     const { title, duration } = req.body;
//     const file = req.file;

//     if (user.role !== 'PUBLISHER') {
//       return res.status(403).json({ error: 'Only Publishers can upload earning files' });
//     }

//     if (!user.is_approved) {
//       return res.status(403).json({ error: 'Publisher account is waiting for admin approval' });
//     }

//     if (!file) {
//       return res.status(400).json({ error: 'No file uploaded' });
//     }

//     const fileExtension = path.extname(file.originalname);
//     const fileName = `${crypto.randomBytes(8).toString('hex')}${fileExtension}`;
//     const fileStream = fs.createReadStream(file.path);

//     const uploadParams = {
//       Bucket: process.env.R2_BUCKET_NAME,
//       Key: fileName,
//       Body: fileStream,
//       ContentType: file.mimetype,
//     };

//     // Upload to Cloudflare R2
//     await s3Client.send(new PutObjectCommand(uploadParams));

//     // Delete local temp file
//     fs.unlinkSync(file.path);

//     // Construct the public URL
//     const fileUrl = `${process.env.R2_PUBLIC_URL}/${fileName}`;

//     // Generate a unique 6-character short link
//     const shortId = crypto.randomBytes(3).toString('hex');

//     const { data: dbFile, error } = await supabase
//       .from('files')
//       .insert([{
//         publisher_id: userId,
//         title: title || file.originalname,
//         file_url: fileUrl,
//         duration: duration ? parseInt(duration) : 0,
//         size: file.size,
//         short_id: shortId,
//         total_views: 0,
//         total_earnings: 0
//       }])
//       .select()
//       .single();

//     if (error) throw error;

//     return res.status(201).json({
//       message: 'File uploaded successfully',
//       shortLink: `${req.protocol}://${req.get('host')}/api/files/${shortId}`,
//       tracking: {
//         start: `${req.protocol}://${req.get('host')}/api/files/${shortId}/view/start`,
//         heartbeat: `${req.protocol}://${req.get('host')}/api/files/${shortId}/view/:viewId/heartbeat`,
//         end: `${req.protocol}://${req.get('host')}/api/files/${shortId}/view/:viewId/end`
//       },
//       file: dbFile
//     });
//   } catch (error) {
//     console.error('Upload File Error:', error);
//     // Cleanup local file on error if it still exists
//     if (req.file && fs.existsSync(req.file.path)) {
//       fs.unlinkSync(req.file.path);
//     }
//     return res.status(500).json({ error: error.message || 'Internal Server Error' });
//   }
// };

export const uploadFile = async (req, res) => {
  let fileName = null;

  try {
    const user = req.user;
    const userId = user.id;
    const { title, duration } = req.body;
    const normalizedFolderId = String(req.body?.folderId || "").trim() || null;
    const file = req.file;

    // 🔒 Role check
    if (user.role !== "PUBLISHER") {
      return res
        .status(403)
        .json({ error: "Only Publishers can upload earning files" });
    }

    if (!user.is_approved) {
      return res
        .status(403)
        .json({ error: "Publisher account is waiting for admin approval" });
    }

    if (!file) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    if (normalizedFolderId) {
      const { data: folder, error: folderError } = await supabase
        .from("folders")
        .select("id")
        .eq("id", normalizedFolderId)
        .eq("user_id", userId)
        .maybeSingle();

      if (folderError) {
        throw folderError;
      }

      if (!folder) {
        if (fs.existsSync(file.path)) {
          fs.unlinkSync(file.path);
        }

        return res.status(404).json({ error: "Folder not found" });
      }
    }

    // 📦 File validation
    const allowedMimeTypes = [
      // VIDEO
      "video/mp4",
      "video/x-matroska", // mkv
      "video/webm",
      "video/quicktime", // mov
      "video/x-m4v", // m4v

      // IMAGE
      "image/png",
      "image/jpeg", // jpg, jpeg
      "image/gif",
      "image/webp",
      "image/svg+xml",

      // DOCUMENT
      "application/pdf",
      "text/plain",
    ];

    if (!allowedMimeTypes.includes(file.mimetype)) {
      return res.status(400).json({ error: "Invalid file type" });
    }

    const MAX_SIZE = 100 * 1024 * 1024; // 100MB
    if (file.size > MAX_SIZE) {
      return res.status(400).json({ error: "File too large (max 100MB)" });
    }

    // 📁 Safe extension handling
    const ext = path.extname(file.originalname).toLowerCase();
    const allowedExt = [".mp4", ".mkv", ".png", ".jpg", ".jpeg"];

    if (!allowedExt.includes(ext)) {
      return res.status(400).json({ error: "Invalid file extension" });
    }

    // 🔑 Generate file name
    fileName = `${crypto.randomBytes(16).toString("hex")}${ext}`;

    // ☁️ Upload to R2
    try {
      await s3Client.send(
        new PutObjectCommand({
          Bucket: process.env.R2_BUCKET_NAME,
          Key: fileName,
          Body: fs.createReadStream(file.path),
          ContentType: file.mimetype,
        }),
      );
    } catch (err) {
      console.log(err);

      throw new Error("Upload to storage failed");
    }

    // 🧹 Delete temp file
    if (fs.existsSync(file.path)) {
      fs.unlinkSync(file.path);
    }

    // 🔗 Public URL
    const fileUrl = `${process.env.R2_PUBLIC_URL}/${fileName}`;

    // 🔗 Generate unique short ID (collision-safe)
    let shortId;
    let exists = true;

    while (exists) {
      shortId = crypto.randomBytes(5).toString("hex"); // 10 chars

      const { data } = await supabase
        .from("files")
        .select("id")
        .eq("short_id", shortId)
        .maybeSingle();

      exists = !!data;
    }

    // ⏱️ Safe duration parsing
    const parsedDuration = Number(duration);
    const finalDuration = Number.isFinite(parsedDuration) ? parsedDuration : 0;

    // 💾 Insert DB
    const { data: dbFile, error } = await supabase
      .from("files")
      .insert([
        {
          publisher_id: userId,
          title: title || file.originalname,
          file_url: fileUrl,
          duration: finalDuration,
          size: file.size,
          folder_id: normalizedFolderId,
          short_id: shortId,
          total_views: 0,
          total_earnings: 0,
        },
      ])
      .select()
      .single();

    if (error) {
      // ❌ rollback R2 upload
      await s3Client.send(
        new DeleteObjectCommand({
          Bucket: process.env.R2_BUCKET_NAME,
          Key: fileName,
        }),
      );

      throw error;
    }

    // 📊 Update user storage
    await supabase
      .from("users")
      .update({
        storage_used: (user.storage_used || 0) + file.size,
      })
      .eq("id", userId);

    // ✅ Success
    return res.status(201).json({
      message: "File uploaded successfully",
      shortLink: `${req.protocol}://${req.get("host")}/api/files/${shortId}`,
      tracking: {
        start: `${req.protocol}://${req.get("host")}/api/files/${shortId}/view/start`,
        heartbeat: `${req.protocol}://${req.get("host")}/api/files/${shortId}/view/:viewId/heartbeat`,
        end: `${req.protocol}://${req.get("host")}/api/files/${shortId}/view/:viewId/end`,
      },
      file: dbFile,
    });
  } catch (error) {
    console.error("Upload File Error:", error);

    // 🧹 Cleanup local file
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }

    // 🧹 Cleanup R2 file if partially uploaded
    if (fileName) {
      try {
        await s3Client.send(
          new DeleteObjectCommand({
            Bucket: process.env.R2_BUCKET_NAME,
            Key: fileName,
          }),
        );
      } catch (err) {
        console.error("Failed to cleanup R2:", err);
      }
    }

    return res.status(500).json({
      error: error.message || "Internal Server Error",
    });
  }
};

/**
 * 2. Get File by Short Link (Viewer comes from link)
 */
export const getFileByShortLink = async (req, res) => {
  try {
    const { shortId } = req.params;

    const { data: file, error } = await supabase
      .from("files")
      .select(
        "id, title, description, file_url, duration, size, short_id, publisher_id, created_at",
      )
      .eq("short_id", shortId)
      .single();

    if (error || !file) {
      return res.status(404).json({ error: "File not found" });
    }

    return res.status(200).json({
      message: "File retrieved successfully",
      tracking: {
        thresholdSeconds: getValidViewThreshold(file.duration),
        startUrl: `${req.protocol}://${req.get("host")}/api/files/${shortId}/view/start`,
      },
      file,
    });
  } catch (error) {
    console.error("Get File Error:", error);
    return res
      .status(500)
      .json({ error: error.message || "Internal Server Error" });
  }
};

/**
 * 3. Start public viewer tracking session from short link
 */
export const startFileView = async (req, res) => {
  try {
    const { shortId } = req.params;

    const { data: file, error: fileError } = await supabase
      .from("files")
      .select("id, title, duration, publisher_id")
      .eq("short_id", shortId)
      .single();

    if (fileError || !file)
      return res.status(404).json({ error: "File not found" });

    const { data: view, error: viewError } = await supabase
      .from("views")
      .insert([
        {
          file_id: file.id,
          publisher_id: file.publisher_id,
          watch_time: 0,
          is_valid: false,
          location: getViewerLocation(req),
          ip_address: getClientIp(req),
        },
      ])
      .select()
      .single();

    if (viewError) throw viewError;

    return res.status(201).json({
      message: "View tracking started",
      viewId: view.id,
      thresholdSeconds: getValidViewThreshold(file.duration),
      file: {
        id: file.id,
        title: file.title,
        duration: file.duration,
      },
    });
  } catch (error) {
    console.error("Start View Error:", error);
    return res
      .status(500)
      .json({ error: error.message || "Internal Server Error" });
  }
};

/**
 * 4. Update public viewer watch time while video is playing
 */
export const heartbeatFileView = async (req, res) => {
  try {
    const { shortId, viewId } = req.params;
    const { watchTimeSeconds } = req.body;

    if (watchTimeSeconds === undefined || Number(watchTimeSeconds) < 0) {
      return res.status(400).json({ error: "watchTimeSeconds is required" });
    }

    const { data: file, error: fileError } = await supabase
      .from("files")
      .select("id, duration")
      .eq("short_id", shortId)
      .single();

    if (fileError || !file)
      return res.status(404).json({ error: "File not found" });

    const { data: view, error } = await supabase
      .from("views")
      .update({
        watch_time: Number(watchTimeSeconds),
        location: getViewerLocation(req),
        ip_address: getClientIp(req),
      })
      .eq("id", viewId)
      .eq("file_id", file.id)
      .select()
      .single();

    if (error || !view)
      return res.status(404).json({ error: "View session not found" });

    const thresholdSeconds = getValidViewThreshold(file.duration);

    return res.json({
      message: "View heartbeat saved",
      viewId: view.id,
      watchTimeSeconds: view.watch_time,
      thresholdSeconds,
      canCountView: Number(view.watch_time) >= thresholdSeconds,
    });
  } catch (error) {
    console.error("Heartbeat View Error:", error);
    return res
      .status(500)
      .json({ error: error.message || "Internal Server Error" });
  }
};

/**
 * 5. End public viewer tracking session and credit publisher once if valid
 */
export const endFileView = async (req, res) => {
  try {
    const { shortId, viewId } = req.params;
    const { watchTimeSeconds } = req.body;

    const { data: file, error: fileError } = await supabase
      .from("files")
      .select("id, duration, publisher_id, total_views, total_earnings")
      .eq("short_id", shortId)
      .single();

    if (fileError || !file)
      return res.status(404).json({ error: "File not found" });

    const { data: existingView, error: viewError } = await supabase
      .from("views")
      .select("*")
      .eq("id", viewId)
      .eq("file_id", file.id)
      .single();

    if (viewError || !existingView) {
      return res.status(404).json({ error: "View session not found" });
    }

    const finalWatchTime = Math.max(
      Number(existingView.watch_time) || 0,
      Number(watchTimeSeconds) || 0,
    );
    const thresholdSeconds = getValidViewThreshold(file.duration);
    const isValidView = finalWatchTime >= thresholdSeconds;

    if (!isValidView) {
      await supabase
        .from("views")
        .update({
          watch_time: finalWatchTime,
          is_valid: false,
          location: getViewerLocation(req),
          ip_address: getClientIp(req),
        })
        .eq("id", viewId);

      return res.json({
        message: "View tracking ended but watch time was not enough to count",
        viewId,
        finalWatchTime,
        thresholdSeconds,
        isValidView: false,
        credited: false,
      });
    }

    const { data: creditedView, error: creditViewError } = await supabase
      .from("views")
      .update({
        watch_time: finalWatchTime,
        is_valid: true,
        location: getViewerLocation(req),
        ip_address: getClientIp(req),
      })
      .eq("id", viewId)
      .eq("is_valid", false)
      .select()
      .single();

    if (creditViewError || !creditedView) {
      return res.json({
        message: "View tracking ended, view was already credited",
        viewId,
        finalWatchTime,
        thresholdSeconds,
        isValidView: true,
        credited: false,
      });
    }

    const creditResult = await creditPublisherForView({
      view: creditedView,
      file,
    });

    return res.json({
      message: "Valid view counted and publisher earning credited",
      viewId,
      finalWatchTime,
      thresholdSeconds,
      isValidView: true,
      ...creditResult,
    });
  } catch (error) {
    console.error("End View Error:", error);
    return res
      .status(500)
      .json({ error: error.message || "Internal Server Error" });
  }
};

/**
 * 6. Legacy one-call tracking API.
 */
export const trackFileView = async (req, res) => {
  try {
    const { shortId } = req.params;
    const { watchTimeSeconds, location } = req.body;

    if (watchTimeSeconds === undefined) {
      return res.status(400).json({ error: "watchTimeSeconds is required" });
    }

    // 1. Get file details
    const { data: file, error: fileError } = await supabase
      .from("files")
      .select("id, duration, publisher_id, total_views, total_earnings")
      .eq("short_id", shortId)
      .single();

    if (fileError || !file)
      return res.status(404).json({ error: "File not found" });

    // Valid if viewer watches 10% of the file, capped at 20 seconds for long videos.
    const thresholdSeconds = getValidViewThreshold(file.duration);
    const isValidView = Number(watchTimeSeconds) >= thresholdSeconds;

    // 3. Save the view event (valid or not, for analytics)
    const { data: view, error: viewError } = await supabase
      .from("views")
      .insert([
        {
          file_id: file.id,
          publisher_id: file.publisher_id,
          watch_time: Number(watchTimeSeconds),
          is_valid: isValidView,
          location: location || getViewerLocation(req),
          ip_address: getClientIp(req),
        },
      ])
      .select()
      .single();

    if (viewError) {
      throw viewError;
    }

    // 4. If valid, process publisher earnings!
    if (isValidView) {
      await creditPublisherForView({ view, file });
    }

    return res.status(200).json({
      message: "View tracked successfully",
      viewId: view?.id,
      thresholdSeconds,
      isValidView,
    });
  } catch (error) {
    console.error("Track View Error:", error);
    return res
      .status(500)
      .json({ error: error.message || "Internal Server Error" });
  }
};
