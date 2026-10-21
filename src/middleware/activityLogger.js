'use strict';

const { shouldTrackRequest, writeActivityLog } = require('../services/activityLogService');

function activityLogger(prisma) {
  return (req, res, next) => {
    if (!shouldTrackRequest(req.method, req.originalUrl || req.url)) return next();
    // Route security menulis log profil yang lebih kaya sendiri, supaya tidak dobel.
    if (String(req.originalUrl || '').startsWith('/api/security/')) return next();

    let responseBody = null;
    const originalJson = res.json.bind(res);
    const originalSend = res.send.bind(res);
    let captured = false;
    res.json = (body) => { captured = true; responseBody = body; return originalJson(body); };
    res.send = (body) => { if (!captured && body && typeof body === 'object' && !Buffer.isBuffer(body)) responseBody = body; return originalSend(body); };

    res.on('finish', () => {
      // Non-blocking untuk aksi umum. Endpoint approval penting dapat menulis log
      // transaksional khusus; middleware tetap menjadi jaring pengaman global.
      writeActivityLog(prisma, req, { statusCode: res.statusCode, responseBody }).catch((error) => {
        console.error('Activity log middleware error:', error.message);
      });
    });
    next();
  };
}

module.exports = activityLogger;
