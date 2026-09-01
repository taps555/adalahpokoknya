"use strict";

const express = require("express");
const prisma = require("../../lib/prisma"); // sesuaikan path relatif sama struktur folder lo
const { verifyToken } = require("../../middleware/auth");

const router = express.Router();

/** PUT /material-request-items/:id/lapangan-update
 * Update progress lapangan 1 item (tanggalOnsite, updateLapangan)
 * DEPENDENT: hanya bisa diupdate kalau status Finance minimal PARTIAL
 * (barang harus sudah mulai dibeli sebelum lapangan bisa lapor progres)
 */
router.put(
  "/material-request-items/:id/lapangan-update",

  async (req, res) => {
    try {
      const { id } = req.params;
      const { tanggalOnsite, updateLapangan } = req.body;

      const existing = await prisma.materialRequestItem.findUnique({
        where: { id },
      });
      if (!existing)
        return res.status(404).json({ error: "Item tidak ditemukan." });

      if (existing.status === "PENDING") {
        return res.status(400).json({
          error:
            "Barang belum diproses Finance (status masih PENDING). Update lapangan belum bisa dilakukan.",
        });
      }

      const updated = await prisma.materialRequestItem.update({
        where: { id },
        data: {
          ...(tanggalOnsite !== undefined
            ? { tanggalOnsite: tanggalOnsite ? new Date(tanggalOnsite) : null }
            : {}),
          ...(updateLapangan !== undefined ? { updateLapangan } : {}),
        },
      });

      res.json({ message: "Update lapangan berhasil.", data: updated });
    } catch (error) {
      console.error("Error Lapangan Update:", error);
      res
        .status(500)
        .json({ error: error.message || "Terjadi kesalahan pada server." });
    }
  },
);

/** PUT /material-request-items/lapangan-update-bulk
 * Update progress lapangan banyak item sekaligus
 * body: { items: [{ id, tanggalOnsite, updateLapangan }, ...] }
 * DEPENDENT: item dengan status PENDING otomatis dilewati (masuk skipped)
 */
router.put(
  "/material-request-items/lapangan-update-bulk",

  async (req, res) => {
    try {
      const { items } = req.body;

      if (!Array.isArray(items) || items.length === 0)
        return res
          .status(400)
          .json({ error: 'Field "items" wajib diisi (array).' });

      const ids = items.map((i) => i.id);
      const existingItems = await prisma.materialRequestItem.findMany({
        where: { id: { in: ids } },
      });
      const existingMap = new Map(existingItems.map((e) => [e.id, e]));

      const results = [];
      const skipped = [];

      for (const item of items) {
        const existing = existingMap.get(item.id);

        if (!existing) {
          skipped.push({ id: item.id, reason: "Item tidak ditemukan." });
          continue;
        }

        if (existing.status === "PENDING") {
          skipped.push({
            id: item.id,
            reason: "Status Finance masih PENDING, belum bisa update lapangan.",
          });
          continue;
        }

        const updated = await prisma.materialRequestItem.update({
          where: { id: item.id },
          data: {
            ...(item.tanggalOnsite !== undefined
              ? {
                  tanggalOnsite: item.tanggalOnsite
                    ? new Date(item.tanggalOnsite)
                    : null,
                }
              : {}),
            ...(item.updateLapangan !== undefined
              ? { updateLapangan: item.updateLapangan }
              : {}),
          },
        });

        results.push(updated);
      }

      res.json({
        message: `Berhasil update lapangan ${results.length} item. Dilewati ${skipped.length} item.`,
        data: results,
        skipped,
      });
    } catch (error) {
      console.error("Error Lapangan Update Bulk:", error);
      res
        .status(500)
        .json({ error: error.message || "Terjadi kesalahan pada server." });
    }
  },
);

module.exports = router;
