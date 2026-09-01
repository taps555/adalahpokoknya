const express = require("express");
const router = express.Router();
const prisma = require("../../lib/prisma"); // Sesuaikan path menuju file prisma Anda
const { verifyToken, authorizeRoles } = require("../../middleware/auth"); // Sesuaikan path middleware auth Anda

/**
 * GET /api/finance/material-requests
 * Mengambil semua daftar permintaan barang untuk Dasbor Finance
 */

/**
 * PUT /api/finance/material-requests/items/:id
 * Auto-Save: Mengupdate status PO, volume, dan catatan dari Dasbor Finance
 */
router.put(
  "/material-requests/items/:id",

  async (req, res) => {
    try {
      const { id } = req.params;
      const { isCompleted, orderedVolume, catatanFinance } = req.body;

      const updatedItem = await prisma.materialRequestItem.update({
        where: { id: id },
        data: {
          isCompleted: isCompleted !== undefined ? isCompleted : undefined,
          orderedVolume:
            orderedVolume !== undefined ? Number(orderedVolume) : undefined,
          catatanFinance:
            catatanFinance !== undefined ? catatanFinance : undefined,
        },
      });

      res.json({ message: "Data berhasil disimpan!", data: updatedItem });
    } catch (error) {
      console.error("Update Item Error:", error);
      res.status(500).json({ error: "Gagal memperbarui data barang." });
    }
  },
);

module.exports = router;
