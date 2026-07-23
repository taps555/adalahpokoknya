'use strict';
const express = require('express');
const prisma = require('../../lib/prisma');
const router = express.Router();

/**
 * POST /projects/:projectId/rab-groups
 * Body: { "name": "PEKERJAAN PERSIAPAN", "parentId": null, "reference": "1.1" }
 */
router.post('/projects/:projectId/rab-groups', async (req, res) => {
  try {
    const { projectId } = req.params;
    const { name, parentId, reference } = req.body;

    if (!name) {
      return res.status(400).json({ error: 'Field "name" wajib diisi.' });
    }

    const project = await prisma.project.findUnique({ where: { id: projectId } });
    if (!project) return res.status(404).json({ error: 'Project tidak ditemukan.' });

    if (parentId) {
      const parent = await prisma.rabGroup.findUnique({ where: { id: parentId } });
      if (!parent) return res.status(404).json({ error: 'Parent group tidak ditemukan.' });
      if (parent.projectId !== projectId) {
        return res.status(400).json({ error: 'Parent group bukan milik project ini.' });
      }
    }

    const siblingCount = await prisma.rabGroup.count({
      where: { projectId, parentId: parentId || null },
    });

    const group = await prisma.rabGroup.create({
      data: {
        projectId,
        name,
        reference: reference || null,
        parentId: parentId || null,
        order: siblingCount,
      },
    });

    res.status(201).json({ message: 'Group berhasil ditambahkan', data: group });
  } catch (error) {
    console.error('Error Create RabGroup:', error);
    res.status(500).json({ error: error.message || 'Terjadi kesalahan pada server.' });
  }
});

/**
 * GET /projects/:projectId/rab-groups
 * Return nested tree: Group -> Sub-Group -> ... -> items (baris pekerjaan)
 */
router.get('/projects/:projectId/rab-groups', async (req, res) => {
  try {
    const { projectId } = req.params;
    const { discipline } = req.query;
    const groups = await prisma.rabGroup.findMany({
      where: { projectId },
      include: {
        items: discipline ? { where: { discipline } } : true,
      },
      orderBy: [{ order: 'asc' }],
    });
    const byId = new Map(groups.map((g) => [g.id, { ...g, children: [] }]));
    const roots = [];
    for (const g of byId.values()) {
      if (g.parentId && byId.has(g.parentId)) {
        byId.get(g.parentId).children.push(g);
      } else {
        roots.push(g);
      }
    }
    res.json(roots);
  } catch (error) {
    console.error('Error List RabGroup:', error);
    res.status(500).json({ error: 'Terjadi kesalahan pada server.' });
  }
});

/** PUT /rab-groups/:id — rename / pindah urutan / pindah parent */
router.put('/rab-groups/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name, reference, order, parentId } = req.body;
    const existing = await prisma.rabGroup.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: 'Group tidak ditemukan.' });
    if (parentId === id) {
      return res.status(400).json({ error: 'Group tidak boleh jadi parent dirinya sendiri.' });
    }
    const updated = await prisma.rabGroup.update({
      where: { id },
      data: {
        ...(name !== undefined ? { name } : {}),
        ...(reference !== undefined ? { reference } : {}),
        ...(order !== undefined ? { order } : {}),
        ...(parentId !== undefined ? { parentId: parentId || null } : {}),
      },
    });
    res.json({ message: 'Group berhasil diperbarui', data: updated });
  } catch (error) {
    console.error('Error Update RabGroup:', error);
    res.status(500).json({ error: 'Terjadi kesalahan pada server.' });
  }
});

/** DELETE /rab-groups/:id */
router.delete('/rab-groups/:id', async (req, res) => {
  try {
    await prisma.rabGroup.delete({ where: { id: req.params.id } });
    res.json({ message: 'Group beserta seluruh isinya berhasil dihapus.' });
  } catch (error) {
    if (error.code === 'P2025') {
      return res.status(404).json({ error: 'Group tidak ditemukan.' });
    }
    console.error('Error Delete RabGroup:', error);
    res.status(500).json({ error: 'Terjadi kesalahan pada server.' });
  }
});

module.exports = router;