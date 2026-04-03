const nodemailer = require('nodemailer');

let transporter = null;

function isEmailConfigured() {
  return Boolean(process.env.EMAIL_USER && process.env.EMAIL_PASS);
}

function getTransporter() {
  if (transporter) {
    return transporter;
  }

  if (!isEmailConfigured()) {
    const error = new Error('Email OTP is not available right now. Please configure email delivery and try again.');
    error.status = 503;
    throw error;
  }

  transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS,
    },
  });

  return transporter;
}

async function sendOtpEmail({ email, name, otp, purpose = 'password reset' }) {
  const mailer = getTransporter();

  await mailer.sendMail({
    from: process.env.EMAIL_USER,
    to: email,
    subject: `CheckMate ${purpose} OTP`,
    text: `Hello ${name || 'there'}, your CheckMate OTP is ${otp}. It expires in 5 minutes.`,
  });
}

module.exports = {
  isEmailConfigured,
  sendOtpEmail,
};
