import nodemailer from 'nodemailer';
import dotenv from 'dotenv';

dotenv.config();

/**
 * Configure standard Nodemailer transporter.
 * Ensure you set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS in your .env file
 */
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.gmail.com', // default to gmail
  port: process.env.SMTP_PORT || 587,
  secure: process.env.SMTP_SECURE === 'true' ? true : false, 
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

export const sendEmailOTP = async (to, otp) => {
  try {
    const mailOptions = {
      from: `"StoreGram" <${process.env.SMTP_USER}>`,
      to,
      subject: 'StoreGram - Password Reset OTP',
      html: `
        <div style="font-family: Arial, sans-serif; padding: 20px;">
          <h2>Password Reset Request</h2>
          <p>We received a request to reset your password. Use the OTP below to proceed.</p>
          <div style="background-color: #f4f4f4; padding: 15px; border-radius: 5px; text-align: center; font-size: 24px; font-weight: bold; letter-spacing: 2px;">
            ${otp}
          </div>
          <p>This OTP will expire in 10 minutes.</p>
          <p>If you didn't request this, please ignore this email.</p>
        </div>
      `,
    };

    const info = await transporter.sendMail(mailOptions);
    console.log(`Email sent: ${info.messageId}`);
    return true;
  } catch (error) {
    console.error('Error sending email:', error);
    return false;
  }
};
