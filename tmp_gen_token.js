const { PrismaClient } = require('@prisma/client');
const jwt = require('jsonwebtoken');
const prisma = new PrismaClient();
async function main() {
  const u = await prisma.user.findFirst({ where: { username: 'admin' } });
  if (!u) { console.log('NOT_FOUND'); return; }
  const token = jwt.sign(
    { userId: u.id, username: u.username, role: u.role },
    process.env.JWT_SECRET || 'rahasia_super_aman_123',
    { expiresIn: '4h' }
  );
  console.log(token);
}
main().catch(e => console.error(e)).finally(() => prisma.$disconnect());
