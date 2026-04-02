const nodemailer = require('nodemailer');

let transporter = null;

function getTransporter() {
  if (transporter) {
    return transporter;
  }

  const { EMAIL_USER, EMAIL_PASS } = process.env;

  if (!EMAIL_USER || !EMAIL_PASS) {
    throw new Error('EMAIL_USER and EMAIL_PASS must be configured to send password reset OTP emails.');
  }

  transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: EMAIL_USER,
      pass: EMAIL_PASS,
    },
  });

  return transporter;
}

async function sendOtpEmail({ email, name, otp }) {
  const mailer = getTransporter();

  await mailer.sendMail({
    from: process.env.EMAIL_USER,
    to: email,
    subject: 'CheckMate password reset OTP',
    text: `Hello ${name || 'there'}, your CheckMate OTP is ${otp}. It expires in 5 minutes.`,
  });
}

module.exports = {
  sendOtpEmail,
};
