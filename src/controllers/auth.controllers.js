import { supabase } from "../config/supabase.js";
import jwt from "jsonwebtoken";
import bcrypt from "bcrypt";
import crypto from "crypto";
import { sendEmailOTP } from "../utils/sendEmail.js";

const generateToken = (userId) => {
  return jwt.sign({ id: userId }, process.env.JWT_SECRET, {
    expiresIn: "7d",
  });
};

export const signup = async (req, res) => {
  try {
    const { name, email, mobile, role, password, referralCode } = req.body;

    if (!name || !email || !mobile || !role || !password) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    // Check if user already exists
    const { data: existingUser } = await supabase
      .from("users")
      .select("id")
      .or(`email.eq.${email},mobile.eq.${mobile}`)
      .single();

    if (existingUser) {
      return res.status(400).json({ error: "User with this email or mobile already exists" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const myReferralCode = crypto.randomBytes(4).toString("hex").toUpperCase();

    let referredBy = null;
    if (referralCode) {
      const { data } = await supabase
        .from("users")
        .select("id")
        .eq("referral_code", referralCode)
        .single();
      if (data) referredBy = data.id;
    }

    let storage_total = 0;
    let is_verified = false;
    let is_approved = false;

    if (role === "VIEWER") {
      storage_total = 5120; // 5 GB
      is_verified = false;
      is_approved = true;
    } else if (role === "PUBLISHER") {
      storage_total = 15360; // 15 GB
      is_verified = false;
      is_approved = false; // Requires admin approval
    } else if (role === "ADMIN") {
      storage_total = 999999;
      is_verified = true;
      is_approved = true;
    } else {
      return res.status(400).json({ error: "Invalid role" });
    }

    const { data, error } = await supabase
      .from("users")
      .insert([
        {
          name,
          email,
          mobile,
          password: hashedPassword,
          role,
          storage_total,
          is_verified,
          is_approved,
          referral_code: myReferralCode,
          referred_by: referredBy,
        },
      ])
      .select();

    if (error) throw error;

    const user = data[0];
    const token = generateToken(user.id);

    // Save token to user
    await supabase.from("users").update({ access_token: token }).eq("id", user.id);

    delete user.password;
    user.access_token = token;

    res.status(201).json({ user, token });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

export const login = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: "Email and password are required" });
    }

    const { data: user, error } = await supabase
      .from("users")
      .select("*")
      .eq("email", email)
      .single();

    if (error || !user) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const token = generateToken(user.id);

    await supabase
      .from("users")
      .update({ access_token: token })
      .eq("id", user.id);

    delete user.password;
    user.access_token = token;

    res.json({ user, token });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

export const changePassword = async (req, res) => {
  try {
    const { oldPassword, newPassword } = req.body;
    const userId = req.user.id;

    if (!oldPassword || !newPassword) {
      return res.status(400).json({ error: "Old and new passwords are required" });
    }

    if (oldPassword === newPassword) {
      return res.status(400).json({ error: "New password must be different from old password" });
    }

    const { data: user, error } = await supabase
      .from("users")
      .select("password")
      .eq("id", userId)
      .single();

    if (error || !user) {
      return res.status(404).json({ error: "User not found" });
    }

    const isMatch = await bcrypt.compare(oldPassword, user.password);
    if (!isMatch) {
      return res.status(400).json({ error: "Incorrect old password" });
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);
    const { error: updateError } = await supabase
      .from("users")
      .update({ password: hashedPassword })
      .eq("id", userId);

    if (updateError) throw updateError;

    res.json({ message: "Password updated successfully" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

export const forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ error: "Email is required" });
    }

    const { data: user, error } = await supabase
      .from("users")
      .select("id, email, mobile")
      .eq("email", email)
      .single();

    if (error || !user) {
      // Don't leak whether user exists or not
      return res.json({ message: "If the email is registered, an OTP will be sent softly." });
    }

    const otp = Math.floor(100000 + Math.random() * 900000);

    // Storing OTP associated with email inside otp table
    // Ensure that your `otp` table schema can hold an email or you use mobile
    // Changing standard convention: storing the email as identifier so it matches easier
    await supabase.from("otp").insert([
      {
        mobile: user.email, // using the 'mobile' column to store email since we use it as identifier here
        otp: otp.toString(),
        expires_at: new Date(Date.now() + 10 * 60 * 1000), // 10 minutes expiry
      },
    ]);

    // SEND THE EMAIL
    const emailSent = await sendEmailOTP(user.email, otp);

    if (!emailSent) {
      console.error("Failed to send OTP email.");
      // Optional: Still return success softly or an error. Usually we drop down but return success.
      // return res.status(500).json({ error: "Failed to send email" });
    }

    res.json({
      message: "OTP sent successfully to your email address",
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

export const resetPassword = async (req, res) => {
  try {
    const { email, otp, newPassword } = req.body;

    // Adjusted to check 'email' instead of 'mobile' since we use email flow
    if (!email || !otp || !newPassword) {
      return res.status(400).json({ error: "Email, OTP, and new password are required" });
    }

    const { data, error } = await supabase
      .from("otp")
      .select("*")
      .eq("mobile", email) // "mobile" column is mapped to storing the email above
      .eq("otp", otp.toString())
      .single();
    console.log(data, error);

    if (error || !data) {
      return res.status(400).json({ error: "Invalid OTP" });
    }

    if (new Date() > new Date(data.expires_at)) {
      return res.status(400).json({ error: "OTP has expired" });
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);
    const { error: updateError } = await supabase
      .from("users")
      .update({ password: hashedPassword })
      .eq("email", email);

    if (updateError) throw updateError;

    // Clean up OTP so it can't be reused
    if (data.id) {
      await supabase.from("otp").delete().eq("id", data.id);
    } else {
      await supabase.from("otp").delete().eq("mobile", email).eq("otp", otp);
    }

    res.json({ message: "Password has been reset successfully. You can now login." });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

export const sendOtp = async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: "Email is required" });

    const { data: user, error } = await supabase
      .from("users")
      .select("id, email, is_verified")
      .eq("email", email)
      .single();

    if (error || !user) {
      return res.status(404).json({ error: "User not found" });
    }

    if (user.is_verified) {
      return res.status(400).json({ error: "User is already verified" });
    }

    const otp = Math.floor(100000 + Math.random() * 900000);

    await supabase.from("otp").insert([{
      mobile: email, // using 'mobile' column to store email for OTP tracking
      otp: otp.toString(),
      expires_at: new Date(Date.now() + 10 * 60 * 1000), // 10 minutes expiry
    }]);

    const emailSent = await sendEmailOTP(email, otp);
    if (!emailSent) {
      console.error("Failed to send OTP email.");
    }

    res.json({ message: "OTP sent successfully for verification" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

export const verifyOtp = async (req, res) => {
  try {
    const { email, otp } = req.body;
    if (!email || !otp) return res.status(400).json({ error: "Email and OTP are required" });

    const { data, error } = await supabase
      .from("otp")
      .select("*")
      .eq("mobile", email)
      .eq("otp", otp.toString())
      .single();

    if (error || !data) {
      return res.status(400).json({ error: "Invalid OTP" });
    }

    if (new Date() > new Date(data.expires_at)) {
      return res.status(400).json({ error: "OTP has expired" });
    }

    // Mark user as verified
    await supabase
      .from("users")
      .update({ is_verified: true })
      .eq("email", email);

    // Clean up OTP
    if (data.id) {
      await supabase.from("otp").delete().eq("id", data.id);
    } else {
      await supabase.from("otp").delete().eq("mobile", email).eq("otp", otp);
    }

    res.json({ message: "Email verified successfully" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

export const googleAuth = async (req, res) => {
  try {
    const { email, name, role, referralCode } = req.body;
    
    if (!email || !name) {
      return res.status(400).json({ error: "Email and name are required from Google" });
    }

    let { data: user, error } = await supabase
      .from("users")
      .select("*")
      .eq("email", email)
      .single();

    if (!user) {
      // User doesn't exist, create a new one via Google
      const myReferralCode = crypto.randomBytes(4).toString("hex").toUpperCase();
      let referredBy = null;
      if (referralCode) {
        const { data } = await supabase.from("users").select("id").eq("referral_code", referralCode).single();
        if (data) referredBy = data.id;
      }

      const defaultRole = role || "VIEWER";
      let storage_total = defaultRole === "PUBLISHER" ? 15360 : 5120;
      let is_approved = defaultRole === "PUBLISHER" ? false : true;

      const { data: newUser, error: insertError } = await supabase
        .from("users")
        .insert([{
          name,
          email,
          mobile: "GOOGLE_" + crypto.randomBytes(4).toString("hex"), // Dummy mobile to satisfy any unique constraints
          role: defaultRole,
          storage_total,
          is_verified: true, // Google emails are verified
          is_approved,
          referral_code: myReferralCode,
          referred_by: referredBy,
          password: "GOOGLE_LOGIN_" + crypto.randomBytes(8).toString("hex")
        }])
        .select()
        .single();
        
      if (insertError) throw insertError;
      user = newUser;
    }

    const token = generateToken(user.id);
    await supabase.from("users").update({ access_token: token }).eq("id", user.id);
    
    delete user.password;
    user.access_token = token;

    res.json({ user, token, message: "Google login successful" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

export const refreshToken = async (req, res) => {
  try {
    const { token } = req.body;
    if (!token) return res.status(400).json({ error: "Token is required" });

    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET, { ignoreExpiration: true });
    } catch (e) {
      return res.status(401).json({ error: "Invalid token format" });
    }

    if (!decoded || !decoded.id) return res.status(401).json({ error: "Invalid token payload" });

    const newToken = generateToken(decoded.id);
    await supabase.from("users").update({ access_token: newToken }).eq("id", decoded.id);

    res.json({ token: newToken, message: "Token refreshed successfully" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

export const logout = async (req, res) => {
  try {
    const userId = req.user.id; 
    await supabase.from("users").update({ access_token: null }).eq("id", userId);
    res.json({ message: "Logged out successfully" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
