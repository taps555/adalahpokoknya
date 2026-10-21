'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');
const ExcelJS = require('exceljs');
const express = require('express');
const multer = require('multer');
const bcrypt = require('bcrypt');
const prisma = require('../../lib/prisma');
const { verifyToken } = require('../../middleware/auth');
const { normalizeProfileUpdate, validatePasswordChange, publicUser, groupUsersByRole } = require('../../services/securityService');
const { sanitizeActivityData } = require('../../services/activityLogService');

const router = express.Router();
const SETTINGS_OPEN_ACCESS = process.env.SETTINGS_OPEN_ACCESS !== 'false';
const PROFILE_DIR = path.join(__dirname, '../../../public/uploads/profiles');
const ARCHIVE_DIR = path.join(__dirname, '../../../storage/activity-logs');
fs.mkdirSync(PROFILE_DIR, { recursive: true });
fs.mkdirSync(ARCHIVE_DIR, { recursive: true });

const imageExt = Object.freeze({ 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' });
const imageMagic = {
  ffD8FF: '.jpg',
  '89504E47': '.png',
  52494646: '.webp',
};
function detectImage(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return null;
  const head = buffer.subarray(0, 4).toString('HEX').toUpperCase();
  if (head.startsWith('FFD8FF')) return imageMagic.ffD8FF;
  if (head.startsWith('89504E47')) return imageMagic['89504E47'];
  if (head.startsWith('52494646') && buffer.subarray(8, 12).toString('ASCII') === 'WEBP') return imageMagic['52494646'];
  return null;
}
const uploadPhoto = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => imageExt[file.mimetype] ? cb(null, true) : cb(new Error('Foto profil harus JPG, PNG, atau WEBP.')),
});
function assertRealImage(buffer) {
  const detected = detectImage(buffer);
  if (!detected) throw new Error('Isi file bukan gambar JPG, PNG, atau WEBP yang valid.');
  return detected;
}

function settingAccess(req, res, next) {
  if (SETTINGS_OPEN_ACCESS || req.user?.role === 'SUPER_ADMIN') return next();
  return res.status(403).json({ error: 'Akses Setting hanya untuk SUPER_ADMIN.' });
}

function actor(req) {
  return { userId: req.user?.userId || null, userName: req.user?.name || null, role: req.user?.role || null };
}

async function logSecurity(req, data, { statusCode = 200 } = {}) {
  const succeeded = Number(statusCode) < 400;
  try {
    await prisma.activityLog.create({ data: { ...actor(req), status: succeeded ? 'SUCCESS' : 'FAILED', requestMethod: req.method, requestPath: req.originalUrl.split('?')[0], statusCode, ipAddress: req.ip || null, userAgent: req.headers['user-agent'] || null, changes: {}, ...data } });
  } catch (error) {
    console.error('Security audit error:', error.message);
  }
}

function removeProfileFile(photoUrl) {
  if (!photoUrl || !photoUrl.startsWith('/uploads/profiles/')) return;
  const full = path.resolve(path.join(__dirname, '../../../public', photoUrl.replace(/^\//, '')));
  if (!full.startsWith(path.resolve(PROFILE_DIR) + path.sep)) return;
  try { fs.rmSync(full, { force: true }); } catch { /* ignore */ }
}

router.use(verifyToken, settingAccess);

router.get('/me', async (req, res) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.user.userId } });
    if (!user) return res.status(404).json({ error: 'User tidak ditemukan.' });
    res.json({ data: publicUser(user), gmailEnabled: false });
  } catch (error) { res.status(500).json({ error: 'Gagal memuat profil.' }); }
});

router.patch('/me', async (req, res) => {
  try {
    const before = await prisma.user.findUnique({ where: { id: req.user.userId } });
    if (!before) { await logSecurity(req, { module: 'PROFILE', action: 'UPDATE_PROFILE', entityType: 'USER', entityId: req.user.userId, summary: 'Percobaan mengubah profil sendiri gagal', changes: {} }, { statusCode: 404 }); return res.status(404).json({ error: 'User tidak ditemukan.' }); }
    const data = normalizeProfileUpdate(req.body);
    if (data.username && data.username !== before.username) {
      if (!req.body.currentPassword || !await bcrypt.compare(req.body.currentPassword, before.password)) {
        await logSecurity(req, { module: 'PROFILE', action: 'UPDATE_PROFILE', entityType: 'USER', entityId: before.id, summary: 'Percobaan mengubah username ditolak: password lama tidak sesuai', changes: {} }, { statusCode: 400 });
        return res.status(400).json({ error: 'Password lama tidak sesuai.' });
      }
      if (process.env.GMAIL_OTP_ENABLED === 'true') return res.status(501).json({ error: 'OTP Gmail belum diimplementasikan pada server ini.' });
    }
    const updated = await prisma.user.update({ where: { id: before.id }, data });
    await logSecurity(req, { module: 'PROFILE', action: 'UPDATE_PROFILE', entityType: 'USER', entityId: before.id, entityName: updated.name, summary: 'Mengubah profil sendiri', changes: sanitizeActivityData({ before: publicUser(before), after: publicUser(updated) }) });
    res.json({ message: 'Profil berhasil diperbarui.', data: publicUser(updated) });
  } catch (error) {
    const unique = error?.code === 'P2002';
    const code = unique ? 409 : 400;
    await logSecurity(req, { module: 'PROFILE', action: 'UPDATE_PROFILE', entityType: 'USER', entityId: req.user.userId, summary: 'Percobaan mengubah profil sendiri gagal', changes: { reason: unique ? 'duplikat username/email' : error.message } }, { statusCode: code });
    res.status(code).json({ error: unique ? 'Username atau email sudah digunakan.' : error.message });
  }
});

router.post('/me/photo', uploadPhoto.single('photo'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Pilih foto profil.' });
    const before = await prisma.user.findUnique({ where: { id: req.user.userId } });
    if (!before) return res.status(404).json({ error: 'User tidak ditemukan.' });
    // Validasi isi file, bukan hanya header Content-Type dari client.
    const detectedExt = assertRealImage(req.file.buffer);
    const fileName = `${before.id}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}${detectedExt}`;
    fs.writeFileSync(path.join(PROFILE_DIR, fileName), req.file.buffer, { flag: 'wx' });
    const photoUrl = `/uploads/profiles/${fileName}`;
    const updated = await prisma.user.update({ where: { id: before.id }, data: { photoUrl } });
    removeProfileFile(before.photoUrl);
    await logSecurity(req, { module: 'PROFILE', action: 'UPDATE_PHOTO', entityType: 'USER', entityId: before.id, entityName: before.name, summary: 'Mengganti foto profil sendiri', changes: { photo: { before: before.photoUrl, after: photoUrl } } });
    res.json({ message: 'Foto profil berhasil diperbarui.', data: publicUser(updated) });
  } catch (error) { res.status(400).json({ error: error.message || 'Gagal mengunggah foto profil.' }); }
});

router.delete('/me/photo', async (req, res) => {
  try {
    const before = await prisma.user.findUnique({ where: { id: req.user.userId } });
    if (!before) return res.status(404).json({ error: 'User tidak ditemukan.' });
    const updated = await prisma.user.update({ where: { id: before.id }, data: { photoUrl: null } });
    removeProfileFile(before.photoUrl);
    await logSecurity(req, { module: 'PROFILE', action: 'DELETE_PHOTO', entityType: 'USER', entityId: before.id, entityName: before.name, summary: 'Menghapus foto profil sendiri', changes: { photo: { before: before.photoUrl, after: null } } });
    res.json({ message: 'Foto profil dihapus.', data: publicUser(updated) });
  } catch (error) { res.status(400).json({ error: 'Gagal menghapus foto profil.' }); }
});

router.patch('/me/password', async (req, res) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.user.userId } });
    if (!user) return res.status(404).json({ error: 'User tidak ditemukan.' });
    await validatePasswordChange({ currentPassword: req.body.currentPassword, newPassword: req.body.newPassword, passwordHash: user.password });
    const password = await bcrypt.hash(req.body.newPassword, 10);
    await prisma.user.update({ where: { id: user.id }, data: { password } });
    await logSecurity(req, { module: 'PROFILE', action: 'CHANGE_PASSWORD', entityType: 'USER', entityId: user.id, entityName: user.name, summary: 'Mengganti password sendiri', changes: {} });
    res.json({ message: 'Password berhasil diganti.', gmailNotificationSent: false });
  } catch (error) { res.status(400).json({ error: error.message }); }
});

router.get('/users', async (_req, res) => {
  try {
    const users = await prisma.user.findMany({ orderBy: [{ role: 'asc' }, { name: 'asc' }] });
    res.json({ data: users.map(publicUser), grouped: groupUsersByRole(users) });
  } catch { res.status(500).json({ error: 'Gagal memuat direktori user.' }); }
});

router.get('/activity-logs', async (req, res) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50));
    const where = {};
    if (req.query.module) where.module = req.query.module;
    if (req.query.action) where.action = req.query.action;
    if (req.query.status) where.status = req.query.status;
    if (req.query.role) where.role = req.query.role;
    if (req.query.userId) where.userId = req.query.userId;
    if (req.query.projectId) where.projectId = req.query.projectId;
    if (req.query.from || req.query.to) {
      where.createdAt = {};
      if (req.query.from) where.createdAt.gte = new Date(`${req.query.from}T00:00:00.000Z`);
      if (req.query.to) where.createdAt.lte = new Date(`${req.query.to}T23:59:59.999Z`);
    }
    const [data, total] = await Promise.all([
      prisma.activityLog.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * limit, take: limit }),
      prisma.activityLog.count({ where }),
    ]);
    res.json({ data, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
  } catch { res.status(500).json({ error: 'Gagal memuat log aktivitas.' }); }
});

router.get('/activity-logs/export', async (req, res) => {
  try {
    const format = String(req.query.format || 'txt').toLowerCase();
    const since = new Date(); since.setMonth(since.getMonth() - 3);
    const logs = await prisma.activityLog.findMany({ where: { createdAt: { gte: since } }, orderBy: { createdAt: 'asc' } });
    if (format === 'xlsx') {
      const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('Activity Log');
      ws.columns = [
        { header: 'Waktu', key: 'createdAt', width: 22 }, { header: 'User', key: 'userName', width: 24 }, { header: 'Role', key: 'role', width: 20 },
        { header: 'Modul', key: 'module', width: 18 }, { header: 'Aksi', key: 'action', width: 20 }, { header: 'Status', key: 'status', width: 12 },
        { header: 'Project', key: 'projectName', width: 26 }, { header: 'Ringkasan', key: 'summary', width: 60 },
      ];
      logs.forEach((log) => ws.addRow({ ...log, createdAt: log.createdAt.toISOString() }));
      const buffer = await wb.xlsx.writeBuffer();
      res.set({ 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': 'attachment; filename="activity-log.xlsx"' });
      return res.send(Buffer.from(buffer));
    }
    const text = logs.map((log) => `${log.createdAt.toISOString()} | ${log.userName || '-'} | ${log.role || '-'} | ${log.module} | ${log.action} | ${log.status} | ${log.projectName || '-'} | ${log.summary}`).join('\n');
    res.set({ 'Content-Type': 'text/plain; charset=utf-8', 'Content-Disposition': 'attachment; filename="activity-log.txt"' });
    res.send(text);
  } catch { res.status(500).json({ error: 'Gagal mengekspor log aktivitas.' }); }
});

router.get('/archives', async (_req, res) => {
  try { res.json({ data: await prisma.activityArchive.findMany({ orderBy: { month: 'desc' } }), retentionMonths: 3 }); }
  catch { res.status(500).json({ error: 'Gagal memuat arsip log.' }); }
});

router.get('/archives/:month/download', async (req, res) => {
  try {
    const month = String(req.params.month || '');
    if (!/^\d{4}-\d{2}$/.test(month)) return res.status(400).json({ error: 'Format bulan arsip tidak valid.' });
    const meta = await prisma.activityArchive.findUnique({ where: { month } });
    if (!meta || meta.status !== 'VERIFIED') return res.status(404).json({ error: 'Arsip tidak ditemukan.' });
    const target = path.join(ARCHIVE_DIR, `${String(month).replace(/[^0-9-]/g, '')}.jsonl.gz`);
    if (path.dirname(target) !== path.resolve(ARCHIVE_DIR)) return res.status(400).json({ error: 'Format bulan arsip tidak valid.' });
    if (!meta || meta.status !== 'VERIFIED' || path.basename(meta.fileName) !== path.basename(target)) return res.status(404).json({ error: 'Arsip tidak ditemukan.' });
    const raw = zlib.gunzipSync(fs.readFileSync(target)).toString('utf8');
    const rows = raw.split('\n').filter(Boolean).map((line) => JSON.parse(line));
    const format = String(req.query.format || 'txt').toLowerCase();
    if (format === 'xlsx') {
      const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet(`Activity ${month}`);
      ws.columns = [
        { header: 'Waktu', key: 'createdAt', width: 22 }, { header: 'User', key: 'userName', width: 24 }, { header: 'Role', key: 'role', width: 20 },
        { header: 'Modul', key: 'module', width: 18 }, { header: 'Aksi', key: 'action', width: 20 }, { header: 'Status', key: 'status', width: 12 },
        { header: 'Project', key: 'projectName', width: 26 }, { header: 'Ringkasan', key: 'summary', width: 60 },
      ];
      rows.forEach((row) => ws.addRow(row));
      const buffer = await wb.xlsx.writeBuffer();
      res.set({ 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': `attachment; filename="activity-${month}.xlsx"` });
      return res.send(Buffer.from(buffer));
    }
    const text = rows.map((log) => `${log.createdAt} | ${log.userName || '-'} | ${log.role || '-'} | ${log.module} | ${log.action} | ${log.status} | ${log.projectName || '-'} | ${log.summary}`).join('\n');
    res.set({ 'Content-Type': 'text/plain; charset=utf-8', 'Content-Disposition': `attachment; filename="activity-${month}.txt"` });
    res.send(text);
  } catch (error) { res.status(500).json({ error: `Gagal mengunduh arsip: ${error.message}` }); }
});

router.get('/integration-status', (_req, res) => {
  res.json({ gmailEnabled: process.env.GMAIL_OTP_ENABLED === 'true', otpTtlMinutes: 10, maxOtpAttempts: 5, suspiciousLogin: { failedAttempts: 5, windowMinutes: 15 }, retentionMonths: 3 });
});

module.exports = router;
