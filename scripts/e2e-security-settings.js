'use strict';
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const prisma = require('../src/lib/prisma');

const BASE = 'http://localhost:4000/api';
const name = `SEC-E2E-${Date.now()}`;
let userId;

async function req(path, options = {}) {
  const response = await fetch(BASE + path, options);
  const content = response.headers.get('content-type') || '';
  const data = content.includes('json') ? await response.json() : Buffer.from(await response.arrayBuffer());
  if (!response.ok) throw new Error(`${options.method || 'GET'} ${path} ${response.status}: ${Buffer.isBuffer(data) ? data.toString() : JSON.stringify(data)}`);
  return { response, data };
}

(async () => {
  const password = 'PasswordLama123';
  const user = await prisma.user.create({ data: { username: name.toLowerCase(), name, role: 'PERENCANA', email: `${name.toLowerCase()}@example.com`, password: await bcrypt.hash(password, 4) } });
  userId = user.id;
  const token = jwt.sign({ userId, role: user.role, name: user.name }, process.env.JWT_SECRET || 'rahasia_super_aman_123');
  const headers = { Authorization: `Bearer ${token}` };
  const me = await req('/security/me', { headers });
  console.log('PASS me', me.data.data.username);
  const profile = await req('/security/me', { method: 'PATCH', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ name: `${name}-BARU`, username: user.username, email: user.email }) });
  console.log('PASS profile', profile.data.data.name);
  const directory = await req('/security/users', { headers });
  console.log('PASS directory', directory.data.data.some((x) => x.id === userId));
  const passwordResult = await req('/security/me/password', { method: 'PATCH', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ currentPassword: password, newPassword: 'PasswordBaru123' }) });
  console.log('PASS password', passwordResult.data.message);
  const logs = await req('/security/activity-logs?module=PROFILE', { headers });
  console.log('PASS logs', logs.data.data.map((x) => x.action).join(','));
  const txt = await req('/security/activity-logs/export?format=txt', { headers });
  console.log('PASS txt', txt.data.length, txt.response.headers.get('content-type'));
  const xlsx = await req('/security/activity-logs/export?format=xlsx', { headers });
  console.log('PASS xlsx', xlsx.data.subarray(0, 2).toString(), xlsx.data.length);
  const integration = await req('/security/integration-status', { headers });
  console.log('PASS integration', integration.data.retentionMonths);
})().catch((error) => { console.error('FAIL', error.message); process.exitCode = 1; }).finally(async () => {
  if (userId) {
    await prisma.activityLog.deleteMany({ where: { userId } });
    await prisma.user.delete({ where: { id: userId } });
  }
  await prisma.$disconnect();
});
