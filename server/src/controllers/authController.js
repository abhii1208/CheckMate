const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

const userModel = require('../models/userModel');
const { generateOtp } = require('../utils/otp');
const { sendOtpEmail } = require('../services/emailService');

const JWT_SECRET = process.env.JWT_SECRET || 'change-this-checkmate-secret';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';

function generateToken(user) {
  return jwt.sign(
    {
      sub: user.id,
      email: user.email,
      name: user.name,
    },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN }
  );
}

async function register(req, res, next) {
  try {
    const { name, email, password } = req.body;

    if (!name || String(name).trim().length < 2) {
      return res.status(400).json({ message: 'Please enter a valid name.' });
    }

    if (!email || !/^\S+@\S+\.\S+$/.test(String(email).trim())) {
      return res.status(400).json({ message: 'Please enter a valid email address.' });
    }

    if (!password || String(password).length < 8) {
      return res.status(400).json({ message: 'Password must be at least 8 characters long.' });
    }

    const existingUser = await userModel.findUserByEmail(email);

    if (existingUser) {
      return res.status(409).json({ message: 'An account with this email already exists.' });
    }

    const user = await userModel.createUser({ name, email, password });
    const token = generateToken(user);

    return res.status(201).json({
      message: 'Account created successfully.',
      token,
      user,
    });
  } catch (error) {
    return next(error);
  }
}

async function login(req, res, next) {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: 'Email and password are required.' });
    }

    const user = await userModel.verifyUser({ email, password });

    if (!user) {
      return res.status(401).json({ message: 'Invalid email or password.' });
    }

    const token = generateToken(user);

    return res.json({
      message: 'Signed in successfully.',
      token,
      user,
    });
  } catch (error) {
    return next(error);
  }
}

function me(req, res) {
  return res.json({ user: req.user });
}

async function forgotPassword(req, res, next) {
  const genericMessage = 'If an account with that email exists, an OTP has been sent to the registered email address.';

  try {
    const email = String(req.body?.email || '').trim().toLowerCase();

    if (!email || !/^\S+@\S+\.\S+$/.test(email)) {
      return res.status(400).json({ message: 'Please enter a valid email address.' });
    }

    const user = await userModel.findUserByEmail(email);

    if (!user) {
      return res.json({ message: genericMessage });
    }

    const otp = generateOtp();
    const otpExpiry = new Date(Date.now() + 5 * 60 * 1000);

    await userModel.savePasswordResetOtp({ email, otp, otpExpiry });
    await sendOtpEmail({ email: user.email, name: user.name, otp });

    return res.json({ message: genericMessage });
  } catch (error) {
    return next(error);
  }
}

async function resetPassword(req, res, next) {
  try {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const otp = String(req.body?.otp || '').trim();
    const newPassword = String(req.body?.newPassword || '');

    if (!email || !otp || !newPassword) {
      return res.status(400).json({ message: 'Email, OTP, and new password are required.' });
    }

    if (newPassword.length < 8) {
      return res.status(400).json({ message: 'Password must be at least 8 characters long.' });
    }

    const user = await userModel.findUserByEmail(email);

    if (!user || !user.otp || user.otp !== otp) {
      return res.status(400).json({ message: 'Invalid or expired OTP.' });
    }

    const expiryTime = new Date(user.otp_expiry).getTime();

    if (!expiryTime || expiryTime < Date.now()) {
      return res.status(400).json({ message: 'Invalid or expired OTP.' });
    }

    const passwordHash = await bcrypt.hash(newPassword, 12);
    await userModel.updatePasswordWithReset({ userId: user.id, passwordHash });

    return res.json({ message: 'Password reset successfully.' });
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  register,
  login,
  me,
  forgotPassword,
  resetPassword,
};
