'use strict';

const express = require('express');
const router = express.Router();
const prisma = require('../lib/prisma');

// GET /api/clients?search=abc
// Dipakai untuk isi dropdown/autocomplete client di form input proyek.
router.get('/', async (req, res, next) => {
  try {
    const { search } = req.query;
    const clients = await prisma.client.findMany({
      where: search ? { name: { contains: search, mode: 'insensitive' } } : undefined,
      orderBy: { name: 'asc' },
      take: 50,
    });
    res.json(clients);
  } catch (err) {
    next(err);
  }
});

// POST /api/clients  { name }
// Dipakai kalau user pilih "Client Baru" dari dropdown.
router.post('/', async (req, res, next) => {
  try {
    const { name } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Nama client wajib diisi' });
    }

    const existing = await prisma.client.findFirst({
      where: { name: { equals: name.trim(), mode: 'insensitive' } },
    });
    if (existing) {
      return res.status(409).json({ error: 'Client dengan nama tersebut sudah ada', client: existing });
    }

    const client = await prisma.client.create({ data: { name: name.trim() } });
    res.status(201).json(client);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
