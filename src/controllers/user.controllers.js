import { supabase } from "../config/supabase.js";

// Rest of user routes (create/login are moved to auth.controllers.js)
export const getUsers = async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("users")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) throw error;

    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

export const getUser = async (req, res) => {
  try {
    const userId = req.user.id;

    const { data, error } = await supabase
      .from("users")
      .select("*")
      .eq("id", userId);

    const { data: referredUsers, error_ } = await supabase
      .from("users")
      .select("*")
      .eq("referred_by", userId);

    const referArray = referredUsers.map((item) => ({
      id: item.id,
      name: item.name,
      email: item.email,
      role: item.role,
      wallet_balance: item.wallet_balance,
      is_qualified_referral: false,
      view_time_seconds: item.view_time_seconds,
    }));

    const resFull = {
      userData: data,
      referedUsers: referArray,
    };

    if (error) throw error;

    res.json(resFull);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

export const sendOtp = async (req, res) => {
  try {
    const { mobile } = req.body;
    if (!mobile)
      return res.status(400).json({ error: "Mobile number is required" });

    const otp = Math.floor(100000 + Math.random() * 900000);

    // store OTP
    await supabase.from("otp").insert([
      {
        mobile,
        otp: otp.toString(),
        expires_at: new Date(Date.now() + 5 * 60 * 1000),
      },
    ]);

    // integrate SMS provider here for production

    res.json({ message: "OTP sent" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

export const verifyOtp = async (req, res) => {
  try {
    const { mobile, otp } = req.body;
    if (!mobile || !otp)
      return res.status(400).json({ error: "Mobile and OTP are required" });

    const { data, error } = await supabase
      .from("otp")
      .select("*")
      .eq("mobile", mobile)
      .eq("otp", otp.toString())
      .single();

    if (error || !data) {
      return res.status(400).json({ error: "Invalid OTP" });
    }

    // check expiry
    if (new Date() > new Date(data.expires_at)) {
      return res.status(400).json({ error: "OTP expired" });
    }

    // ✅ mark user verified
    await supabase
      .from("users")
      .update({ is_verified: true })
      .eq("mobile", mobile);

    // Clean up OTP
    if (data.id) {
      await supabase.from("otp").delete().eq("id", data.id);
    }

    res.json({ message: "Verified successfully" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

export const updateProfile = async (req, res) => {
  try {
    const userId = req.user.id;
    const { name, mobile } = req.body;

    const { data, error } = await supabase
      .from("users")
      .update({ name, mobile })
      .eq("id", userId)
      .select()
      .single();

    if (error) throw error;

    res.json({ message: "Profile updated successfully", user: data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

export const updateBankDetails = async (req, res) => {
  try {
    const userId = req.user.id;
    const { bankName, accountName, accountNumber, ifscCode, paypalEmail } = req.body;

    const { data, error } = await supabase
      .from("users")
      .update({
        bank_name: bankName,
        account_name: accountName,
        account_number: accountNumber,
        ifsc_code: ifscCode,
        paypal_email: paypalEmail
      })
      .eq("id", userId)
      .select()
      .single();

    if (error) throw error;

    res.json({ message: "Bank details updated successfully", user: data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
