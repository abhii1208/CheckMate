const jwt = require('jsonwebtoken');

const userModel = require('../models/userModel');

const JWT_SECRET = process.env.JWT_SECRET || 'change-this-checkmate-secret';

async function requireAuth(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const [scheme, token] = header.split(' ');

    if (scheme !== 'Bearer' || !token) {
      return res.status(401).json({ message: 'Please sign in to continue.' });
    }

    const payload = jwt.verify(token, JWT_SECRET);
    const user = await userModel.getUserById(payload.sub);

    if (!user) {
      return res.status(401).json({ message: 'Your session is no longer valid. Please sign in again.' });
    }

    req.user = user;
    return next();
  } catch (error) {
    return res.status(401).json({ message: 'Your session expired. Please sign in again.' });
  }
}

module.exports = {
  requireAuth,
};
