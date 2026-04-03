const bcrypt = require('bcryptjs');

const db = require('../config/db');

const memoryUsers = [];
let nextUserId = 1;

function sanitizeUser(user) {
  if (!user) {
    return null;
  }

  return {
    id: user.id,
    name: user.name,
    email: user.email,
    profile_image_url: user.profile_image_url || '',
    created_at: user.created_at,
  };
}

async function findUserByEmail(email) {
  const normalizedEmail = String(email || '').trim().toLowerCase();

  if (!normalizedEmail) {
    return null;
  }

  if (db.isDatabaseReady()) {
    const query = `
      SELECT id, name, email, password_hash, otp, otp_expiry, profile_image_url, created_at
      FROM users
      WHERE email = $1
      LIMIT 1;
    `;

    const { rows } = await db.query(query, [normalizedEmail]);
    return rows[0] || null;
  }

  return memoryUsers.find((user) => user.email === normalizedEmail) || null;
}

async function getUserById(id) {
  if (!id) {
    return null;
  }

  if (db.isDatabaseReady()) {
    const query = `
      SELECT id, name, email, profile_image_url, created_at
      FROM users
      WHERE id = $1
      LIMIT 1;
    `;

    const { rows } = await db.query(query, [id]);
    return sanitizeUser(rows[0]);
  }

  return sanitizeUser(memoryUsers.find((user) => user.id === Number(id)));
}

async function getUserCredentialsById(id) {
  if (!id) {
    return null;
  }

  if (db.isDatabaseReady()) {
    const query = `
      SELECT id, name, email, password_hash, otp, otp_expiry, profile_image_url, created_at
      FROM users
      WHERE id = $1
      LIMIT 1;
    `;

    const { rows } = await db.query(query, [id]);
    return rows[0] || null;
  }

  return memoryUsers.find((user) => user.id === Number(id)) || null;
}

async function createUser({ name, email, password }) {
  const normalizedName = String(name || '').trim();
  const normalizedEmail = String(email || '').trim().toLowerCase();
  const passwordHash = await bcrypt.hash(password, 12);

  if (db.isDatabaseReady()) {
    const query = `
      INSERT INTO users (name, email, password_hash)
      VALUES ($1, $2, $3)
      RETURNING id, name, email, profile_image_url, created_at;
    `;

    const { rows } = await db.query(query, [normalizedName, normalizedEmail, passwordHash]);
    return sanitizeUser(rows[0]);
  }

  const newUser = {
    id: nextUserId++,
    name: normalizedName,
    email: normalizedEmail,
    password_hash: passwordHash,
    profile_image_url: '',
    created_at: new Date().toISOString(),
  };

  memoryUsers.push(newUser);
  return sanitizeUser(newUser);
}

async function verifyUser({ email, password }) {
  const user = await findUserByEmail(email);

  if (!user) {
    return null;
  }

  const isMatch = await bcrypt.compare(password, user.password_hash);
  return isMatch ? sanitizeUser(user) : null;
}

async function verifyPasswordByUserId({ userId, password }) {
  const user = await getUserCredentialsById(userId);

  if (!user) {
    return null;
  }

  const isMatch = await bcrypt.compare(password, user.password_hash);
  return isMatch ? user : null;
}

async function savePasswordResetOtp({ email, otp, otpExpiry }) {
  const normalizedEmail = String(email || '').trim().toLowerCase();

  if (!normalizedEmail) {
    return null;
  }

  if (db.isDatabaseReady()) {
    const query = `
      UPDATE users
      SET otp = $2, otp_expiry = $3, updated_at = CURRENT_TIMESTAMP
      WHERE email = $1
      RETURNING id, name, email, otp, otp_expiry, profile_image_url, created_at;
    `;

    const { rows } = await db.query(query, [normalizedEmail, otp, otpExpiry]);
    return rows[0] || null;
  }

  const user = memoryUsers.find((item) => item.email === normalizedEmail);

  if (!user) {
    return null;
  }

  user.otp = otp;
  user.otp_expiry = otpExpiry.toISOString();
  return user;
}

async function saveOtpForUser({ userId, otp, otpExpiry }) {
  if (!userId) {
    return null;
  }

  if (db.isDatabaseReady()) {
    const query = `
      UPDATE users
      SET otp = $2, otp_expiry = $3, updated_at = CURRENT_TIMESTAMP
      WHERE id = $1
      RETURNING id, name, email, otp, otp_expiry, profile_image_url, created_at;
    `;

    const { rows } = await db.query(query, [userId, otp, otpExpiry]);
    return rows[0] || null;
  }

  const user = memoryUsers.find((item) => item.id === Number(userId));

  if (!user) {
    return null;
  }

  user.otp = otp;
  user.otp_expiry = otpExpiry.toISOString();
  return user;
}

async function clearOtpForUser(userId) {
  if (!userId) {
    return null;
  }

  if (db.isDatabaseReady()) {
    const query = `
      UPDATE users
      SET otp = NULL, otp_expiry = NULL, updated_at = CURRENT_TIMESTAMP
      WHERE id = $1
      RETURNING id, name, email, profile_image_url, created_at;
    `;

    const { rows } = await db.query(query, [userId]);
    return sanitizeUser(rows[0]);
  }

  const user = memoryUsers.find((item) => item.id === Number(userId));

  if (!user) {
    return null;
  }

  user.otp = null;
  user.otp_expiry = null;
  return sanitizeUser(user);
}

async function updatePasswordWithReset({ userId, passwordHash }) {
  if (!userId || !passwordHash) {
    return null;
  }

  if (db.isDatabaseReady()) {
    const query = `
      UPDATE users
      SET password_hash = $2, otp = NULL, otp_expiry = NULL, updated_at = CURRENT_TIMESTAMP
      WHERE id = $1
      RETURNING id, name, email, profile_image_url, created_at;
    `;

    const { rows } = await db.query(query, [userId, passwordHash]);
    return sanitizeUser(rows[0]);
  }

  const user = memoryUsers.find((item) => item.id === Number(userId));

  if (!user) {
    return null;
  }

  user.password_hash = passwordHash;
  user.otp = null;
  user.otp_expiry = null;
  return sanitizeUser(user);
}

async function updateUserProfile({ userId, name, email, profileImageUrl }) {
  const normalizedName = String(name || '').trim();
  const normalizedEmail = String(email || '').trim().toLowerCase();
  const normalizedProfileImageUrl = String(profileImageUrl || '').trim();

  if (db.isDatabaseReady()) {
    const query = `
      UPDATE users
      SET
        name = $2,
        email = $3,
        profile_image_url = $4,
        otp = NULL,
        otp_expiry = NULL,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $1
      RETURNING id, name, email, profile_image_url, created_at;
    `;

    const { rows } = await db.query(query, [userId, normalizedName, normalizedEmail, normalizedProfileImageUrl]);
    return sanitizeUser(rows[0]);
  }

  const user = memoryUsers.find((item) => item.id === Number(userId));

  if (!user) {
    return null;
  }

  user.name = normalizedName;
  user.email = normalizedEmail;
  user.profile_image_url = normalizedProfileImageUrl;
  user.otp = null;
  user.otp_expiry = null;
  return sanitizeUser(user);
}

async function changeUserPassword({ userId, passwordHash }) {
  if (!userId || !passwordHash) {
    return null;
  }

  if (db.isDatabaseReady()) {
    const query = `
      UPDATE users
      SET password_hash = $2, otp = NULL, otp_expiry = NULL, updated_at = CURRENT_TIMESTAMP
      WHERE id = $1
      RETURNING id, name, email, profile_image_url, created_at;
    `;

    const { rows } = await db.query(query, [userId, passwordHash]);
    return sanitizeUser(rows[0]);
  }

  const user = memoryUsers.find((item) => item.id === Number(userId));

  if (!user) {
    return null;
  }

  user.password_hash = passwordHash;
  user.otp = null;
  user.otp_expiry = null;
  return sanitizeUser(user);
}

async function deleteUser(userId) {
  if (!userId) {
    return false;
  }

  if (db.isDatabaseReady()) {
    const { rowCount } = await db.query('DELETE FROM users WHERE id = $1;', [userId]);
    return rowCount > 0;
  }

  const index = memoryUsers.findIndex((item) => item.id === Number(userId));

  if (index === -1) {
    return false;
  }

  memoryUsers.splice(index, 1);
  return true;
}

module.exports = {
  findUserByEmail,
  getUserById,
  getUserCredentialsById,
  createUser,
  verifyUser,
  verifyPasswordByUserId,
  savePasswordResetOtp,
  saveOtpForUser,
  clearOtpForUser,
  updatePasswordWithReset,
  updateUserProfile,
  changeUserPassword,
  deleteUser,
};
