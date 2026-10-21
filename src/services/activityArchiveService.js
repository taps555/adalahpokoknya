'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');

const ARCHIVE_DIR = path.join(__dirname, '../../storage/activity-logs');
const RETENTION_MONTHS = 3;

function monthKey(date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

function archiveCutoff(now = new Date()) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - RETENTION_MONTHS, 1));
}

async function archiveActivityLogs(prisma, now = new Date()) {
  if (!prisma?.activityLog || !prisma?.activityArchive) return [];
  fs.mkdirSync(ARCHIVE_DIR, { recursive: true });
  const cutoff = archiveCutoff(now);
  const logs = await prisma.activityLog.findMany({ where: { createdAt: { lt: cutoff } }, orderBy: { createdAt: 'asc' } });
  const groups = new Map();
  for (const log of logs) {
    const key = monthKey(log.createdAt);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(log);
  }
  const archived = [];
  for (const [month, rows] of groups.entries()) {
    const existing = await prisma.activityArchive.findUnique({ where: { month } });
    if (existing?.status === 'VERIFIED') continue;
    const jsonl = `${rows.map((row) => JSON.stringify(row, (_key, value) => value instanceof Date ? value.toISOString() : value)).join('\n')}\n`;
    const compressed = zlib.gzipSync(Buffer.from(jsonl), { level: 9 });
    const sha256 = crypto.createHash('sha256').update(compressed).digest('hex');
    const fileName = `activity-${month}.jsonl.gz`;
    const temp = path.join(ARCHIVE_DIR, `${fileName}.tmp-${process.pid}`);
    const target = path.join(ARCHIVE_DIR, fileName);
    fs.writeFileSync(temp, compressed, { flag: 'w' });
    const readBack = fs.readFileSync(temp);
    const verifiedHash = crypto.createHash('sha256').update(readBack).digest('hex');
    if (verifiedHash !== sha256 || zlib.gunzipSync(readBack).toString().trim().split('\n').length !== rows.length) {
      fs.rmSync(temp, { force: true });
      throw new Error(`Verifikasi arsip ${month} gagal.`);
    }
    fs.renameSync(temp, target);
    // Metadata terarsip dicatat sebagai PENDING lebih dulu; DB hanya boleh punya SATU
    // kebenaran status dengan data fisik: tanpa VERIFIED, data tetap di DB dan
    // job berikutnya akan mencoba ulang bulan ini, tidak melewatinya.
    await prisma.activityArchive.upsert({
      where: { month },
      create: { month, fileName, recordCount: rows.length, byteSize: compressed.length, sha256, status: 'PENDING', firstLogAt: rows[0].createdAt, lastLogAt: rows[rows.length - 1].createdAt },
      update: { fileName, recordCount: rows.length, byteSize: compressed.length, sha256, status: 'PENDING', firstLogAt: rows[0].createdAt, lastLogAt: rows[rows.length - 1].createdAt },
    });
    await prisma.activityLog.deleteMany({ where: { id: { in: rows.map((row) => row.id) } } });
    // Hapus sukses -> tandai VERIFIED. Jika delete gagal, metadata tetap PENDING.
    const metadata = await prisma.activityArchive.update({ where: { month }, data: { status: 'VERIFIED' } });
    archived.push(metadata);
  }
  return archived;
}

function startActivityArchiveScheduler(prisma) {
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try { await archiveActivityLogs(prisma); }
    catch (error) { console.error('Activity archive error:', error.message); }
    finally { running = false; }
  };
  setTimeout(run, 15_000).unref();
  const timer = setInterval(run, 24 * 60 * 60 * 1000);
  timer.unref();
  return timer;
}

module.exports = { archiveActivityLogs, startActivityArchiveScheduler, monthKey, archiveCutoff, RETENTION_MONTHS, ARCHIVE_DIR };
