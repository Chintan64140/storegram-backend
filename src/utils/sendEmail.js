import sgMail from '@sendgrid/mail';
import dotenv from 'dotenv';

dotenv.config();

// Set SendGrid API Key
sgMail.setApiKey(process.env.SENDGRID_API_KEY);

export const sendEmailOTP = async (to, otp) => {
  try {
    const msg = {
      to,
      from: process.env.SENDGRID_FROM_EMAIL,
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

    await sgMail.send(msg);
    console.log(`Email sent to ${to}`);
    return true;
  } catch (error) {
    console.error('Error sending email:', error);
    if (error.response) {
      console.error(error.response.body);
    }
    return false;
  }
};
