const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

const userModel = require('../models/userModel');
const { generateOtp } = require('../utils/otp');
const { isEmailConfigured, sendOtpEmail } = require('../services/emailService');

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

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function isValidEmail(email) {
  return /^\S+@\S+\.\S+$/.test(normalizeEmail(email));
}

async function sendVerificationOtp(user, purpose = 'verification') {
  if (!isEmailConfigured()) {
    const error = new Error('Email OTP is not available right now. Please configure email delivery and try again.');
    error.status = 503;
    throw error;
  }

  const otp = generateOtp();
  const otpExpiry = new Date(Date.now() + 5 * 60 * 1000);

  await userModel.saveOtpForUser({ userId: user.id, otp, otpExpiry });
  await sendOtpEmail({
    email: user.email,
    name: user.name,
    otp,
    purpose,
  });
}

function assertValidOtp(user, otp) {
  if (!user || !user.otp || user.otp !== String(otp || '').trim()) {
    return false;
  }

  const expiryTime = new Date(user.otp_expiry).getTime();
  return Boolean(expiryTime && expiryTime >= Date.now());
}

async function register(req, res, next) {
  try {
    const { name, password } = req.body;
    const email = normalizeEmail(req.body?.email);

    if (!name || String(name).trim().length < 2) {
      return res.status(400).json({ message: 'Please enter a valid name.' });
    }

    if (!isValidEmail(email)) {
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
    const password = String(req.body?.password || '');
    const email = normalizeEmail(req.body?.email);

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
    const email = normalizeEmail(req.body?.email);

    if (!isValidEmail(email)) {
      return res.status(400).json({ message: 'Please enter a valid email address.' });
    }

    if (!isEmailConfigured()) {
      return res.status(503).json({ message: 'Email OTP is not available right now. Please try again later.' });
    }

    const user = await userModel.findUserByEmail(email);

    if (!user) {
      return res.json({ message: genericMessage });
    }

    await sendVerificationOtp(user, 'password reset');

    return res.json({ message: genericMessage });
  } catch (error) {
    return next(error);
  }
}

async function resetPassword(req, res, next) {
  try {
    const email = normalizeEmail(req.body?.email);
    const otp = String(req.body?.otp || '').trim();
    const newPassword = String(req.body?.newPassword || '');

    if (!email || !otp || !newPassword) {
      return res.status(400).json({ message: 'Email, OTP, and new password are required.' });
    }

    if (!isValidEmail(email)) {
      return res.status(400).json({ message: 'Please enter a valid email address.' });
    }

    if (newPassword.length < 8) {
      return res.status(400).json({ message: 'Password must be at least 8 characters long.' });
    }

    const user = await userModel.findUserByEmail(email);

    if (!assertValidOtp(user, otp)) {
      return res.status(400).json({ message: 'Invalid or expired OTP.' });
    }

    const passwordHash = await bcrypt.hash(newPassword, 12);
    await userModel.updatePasswordWithReset({ userId: user.id, passwordHash });

    return res.json({ message: 'Password reset successfully.' });
  } catch (error) {
    return next(error);
  }
}

async function requestProfileOtp(req, res, next) {
  try {
    const password = String(req.body?.password || '');
    const user = await userModel.verifyPasswordByUserId({ userId: req.user.id, password });

    if (!user) {
      return res.status(401).json({ message: 'Current password is incorrect.' });
    }

    await sendVerificationOtp(user, 'account verification');
    return res.json({ message: 'Verification OTP sent to your email address.' });
  } catch (error) {
    return next(error);
  }
}

async function updateProfile(req, res, next) {
  try {
    const name = String(req.body?.name || '').trim();
    const email = normalizeEmail(req.body?.email);
    const profileImageUrl = String(req.body?.profileImageUrl || '').trim();
    const password = String(req.body?.password || '');

    if (name.length < 2) {
      return res.status(400).json({ message: 'Please enter a valid name.' });
    }

    if (!isValidEmail(email)) {
      return res.status(400).json({ message: 'Please enter a valid email address.' });
    }

    if (profileImageUrl && profileImageUrl.length > 1500000) {
      return res.status(400).json({ message: 'Profile image is too large. Choose a smaller image.' });
    }

    const user = await userModel.verifyPasswordByUserId({ userId: req.user.id, password });

    if (!user) {
      return res.status(401).json({ message: 'Current password is incorrect.' });
    }

    const existingUser = await userModel.findUserByEmail(email);
    if (existingUser && existingUser.id !== req.user.id) {
      return res.status(409).json({ message: 'Another account already uses that email address.' });
    }

    const updatedUser = await userModel.updateUserProfile({
      userId: req.user.id,
      name,
      email,
      profileImageUrl,
    });
    const token = generateToken(updatedUser);

    return res.json({
      message: 'Profile updated successfully.',
      token,
      user: updatedUser,
    });
  } catch (error) {
    return next(error);
  }
}

async function changePassword(req, res, next) {
  try {
    const currentPassword = String(req.body?.currentPassword || '');
    const newPassword = String(req.body?.newPassword || '');
    const otp = String(req.body?.otp || '').trim();
    const user = await userModel.verifyPasswordByUserId({ userId: req.user.id, password: currentPassword });

    if (!user) {
      return res.status(401).json({ message: 'Current password is incorrect.' });
    }

    if (newPassword.length < 8) {
      return res.status(400).json({ message: 'Password must be at least 8 characters long.' });
    }

    if (!assertValidOtp(user, otp)) {
      return res.status(400).json({ message: 'Invalid or expired OTP.' });
    }

    const passwordHash = await bcrypt.hash(newPassword, 12);
    await userModel.changeUserPassword({ userId: req.user.id, passwordHash });

    return res.json({ message: 'Password changed successfully.' });
  } catch (error) {
    return next(error);
  }
}

async function deleteAccount(req, res, next) {
  try {
    const password = String(req.body?.password || '');
    const otp = String(req.body?.otp || '').trim();
    const user = await userModel.verifyPasswordByUserId({ userId: req.user.id, password });

    if (!user) {
      return res.status(401).json({ message: 'Current password is incorrect.' });
    }

    if (!assertValidOtp(user, otp)) {
      return res.status(400).json({ message: 'Invalid or expired OTP.' });
    }

    await userModel.deleteUser(req.user.id);
    return res.json({ message: 'Account deleted successfully.' });
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
  requestProfileOtp,
  updateProfile,
  changePassword,
  deleteAccount,
};
