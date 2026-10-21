'use strict';

const bcrypt = require('bcrypt');

const USERNAME_PATTERN = /^[a-zA-Z0-9._-]{3,50}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normalizeProfileUpdate(input = {}) {
  const result = {};
  if (input.name !== undefined) {
    const name = String(input.name || '').trim();
    if (name.length < 2 || name.length > 100) throw new Error('Nama harus 2 sampai 100 karakter.');
    result.name = name;
  }
  if (input.username !== undefined) {
    const username = String(input.username || '').trim();
    if (!USERNAME_PATTERN.test(username)) throw new Error('Username harus 3-50 karakter: huruf, angka, titik, garis bawah, atau strip.');
    result.username = username;
  }
  if (input.email !== undefined) {
    const email = String(input.email || '').trim().toLowerCase();
    if (email && !EMAIL_PATTERN.test(email)) throw new Error('Format email tidak valid.');
    result.email = email || null;
  }
  if (!Object.keys(result).length) throw new Error('Tidak ada perubahan profil yang dikirim.');
  return result;
}

async function validatePasswordChange({ currentPassword, newPassword, passwordHash }) {
  if (!currentPassword) throw new Error('Password lama wajib diisi.');
  if (typeof newPassword !== 'string' || newPassword.length < 8) throw new Error('Password baru minimal 8 karakter.');
  if (newPassword.length > 128) throw new Error('Password baru maksimal 128 karakter.');
  const matched = await bcrypt.compare(currentPassword, passwordHash);
  if (!matched) throw new Error('Password lama tidak sesuai.');
  if (currentPassword === newPassword) throw new Error('Password baru harus berbeda dari password lama.');
  return true;
}

function publicUser(user = {}) {
  return {
    id: user.id,
    username: user.username,
    name: user.name,
    role: user.role,
    email: user.email || null,
    photoUrl: user.photoUrl || null,
    isActive: user.isActive !== false,
    lastLoginAt: user.lastLoginAt || null,
    emailVerifiedAt: user.emailVerifiedAt || null,
    createdAt: user.createdAt || null,
    updatedAt: user.updatedAt || null,
  };
}

function groupUsersByRole(users = []) {
  return users.reduce((groups, user) => {
    const role = user.role || 'UNKNOWN';
    if (!groups[role]) groups[role] = [];
    groups[role].push(publicUser(user));
    return groups;
  }, {});
}

module.exports = {
  normalizeProfileUpdate,
  validatePasswordChange,
  publicUser,
  groupUsersByRole,
};
