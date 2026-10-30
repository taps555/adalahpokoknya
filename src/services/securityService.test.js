'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcrypt');

const {
  normalizeProfileUpdate,
  validatePasswordChange,
  publicUser,
} = require('./securityService');

test('normalize profile accepts own name and email but never role', () => {
  const result = normalizeProfileUpdate({
    name: '  Nama Baru  ',
    email: ' USER@Example.COM ',
    username: 'username-baru',
    role: 'OWNER',
    isActive: false,
  });
  assert.deepEqual(result, {
    name: 'Nama Baru',
    email: 'user@example.com',
    username: 'username-baru',
  });
});

test('password change requires correct old password and a strong new password', async () => {
  const hash = await bcrypt.hash('PasswordLama123', 4);
  await assert.rejects(
    validatePasswordChange({ currentPassword: 'salah', newPassword: 'PasswordBaru123', passwordHash: hash }),
    /Password lama tidak sesuai/,
  );
  await assert.rejects(
    validatePasswordChange({ currentPassword: 'PasswordLama123', newPassword: 'pendek', passwordHash: hash }),
    /minimal 8 karakter/,
  );
  const valid = await validatePasswordChange({ currentPassword: 'PasswordLama123', newPassword: 'PasswordBaru123', passwordHash: hash });
  assert.equal(valid, true);
});

test('public user never exposes password', () => {
  const user = publicUser({
    id: 'u1', username: 'andi', password: 'hash', name: 'Andi', role: 'PERENCANA',
    email: 'andi@example.com', photoUrl: '/uploads/profiles/u1.jpg', isActive: true,
    lastLoginAt: new Date('2026-10-21T00:00:00.000Z'), createdAt: new Date('2026-10-01T00:00:00.000Z'),
  });
  assert.equal(user.password, undefined);
  assert.equal(user.username, 'andi');
  assert.equal(user.role, 'PERENCANA');
});
