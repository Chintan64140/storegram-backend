import jwt from "jsonwebtoken";
import { supabase } from "../config/supabase.js";

// Verify Bearer token from header and set req.user
export const authenticateToken = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ error: "Unauthorized: No token provided" });
    }

    const token = authHeader.split(" ")[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    const { data: user, error } = await supabase
      .from("users")
      .select("*")
      .eq("id", decoded.id)
      .single();

    if (error || !user) {
      return res.status(401).json({ error: "Unauthorized: Invalid user" });
    }
    
    // Optional: check if token matches the stored token (session invalidation)
    if (user.access_token && user.access_token !== token) {
       return res.status(401).json({ error: "Unauthorized: Session expired, please login again" });
    }
    
    req.user = user;
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: "Unauthorized: Token expired" });
    }
    res.status(401).json({ error: "Unauthorized: Invalid token" });
  }
};

export const authorizeUser = ({
  requireVerified = false,
  requireApproved = false,
  roles = [],
} = {}) => {
  return (req, res, next) => {
    try {
      const user = req.user;

      if (!user) {
        return res.status(401).json({ error: "Unauthorized: User context not found" });
      }

      // 🔐 Role check
      if (roles.length && !roles.includes(user.role)) {
        return res.status(403).json({ error: "Access denied: Insufficient permissions for your role" });
      }

      // 📱 OTP verification check
      if (requireVerified && !user.is_verified) {
        return res.status(403).json({ error: "Access denied: Mobile number not verified" });
      }

      // 👑 Publisher approval check
      if (requireApproved && user.role === "PUBLISHER" && !user.is_approved) {
        return res.status(403).json({ error: "Access denied: Waiting for admin approval for publisher role" });
      }

      next();
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  };
};
