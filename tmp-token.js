require('dotenv').config();
const jwt = require('jsonwebtoken');
const SECRET = process.env.JWT_SECRET || 'rahasia_super_aman_123';
const token = jwt.sign({ userId: 'cmvcoexkq0001xbocalzqqyvz', role: 'SUPER_ADMIN', name: 'superadmin' }, SECRET, { expiresIn: '2h' });
console.log(token);
