/**
 * GET /api/finance/suppliers
 * List semua supplier
 */
router.get("/suppliers", async (req, res) => {
  try {
    const suppliers = await prisma.supplier.findMany({
      orderBy: { name: "asc" },
    });
    res.json(suppliers);
  } catch (error) {
    console.error("Get Suppliers Error:", error);
    res.status(500).json({ error: "Gagal mengambil data toko/supplier" });
  }
});

/**
 * GET /api/finance/suppliers/:id
 * Detail satu supplier
 */
router.get("/suppliers/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const supplier = await prisma.supplier.findUnique({ where: { id } });

    if (!supplier) {
      return res.status(404).json({ error: "Supplier tidak ditemukan" });
    }
    res.json(supplier);
  } catch (error) {
    console.error("Get Supplier Detail Error:", error);
    res.status(500).json({ error: "Gagal mengambil detail supplier" });
  }
});

/**
 * POST /api/finance/suppliers
 * Tambah supplier (Toko) baru
 */
router.post("/suppliers", async (req, res) => {
  try {
    const {
      code,
      name,
      type,
      address,
      address2,
      phone,
      fax,
      taxGroup,
      npwp,
      email,
      contactName,
      creditLimit,
      bankAccount,
      status,
    } = req.body;

    if (!name) {
      return res.status(400).json({ error: "Nama supplier wajib diisi" });
    }

    const newSupplier = await prisma.supplier.create({
      data: {
        code,
        name,
        type,
        address,
        address2,
        phone,
        fax,
        taxGroup,
        npwp,
        email,
        contactName,
        creditLimit,
        bankAccount,
        status,
      },
    });
    res.json(newSupplier);
  } catch (error) {
    console.error("Create Supplier Error:", error);
    if (error.code === "P2002") {
      return res.status(409).json({ error: "Kode supplier sudah dipakai" });
    }
    res.status(500).json({ error: "Gagal menambah supplier baru" });
  }
});

/**
 * PUT /api/finance/suppliers/:id
 * Update supplier
 */
router.put("/suppliers/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const {
      code,
      name,
      type,
      address,
      address2,
      phone,
      fax,
      taxGroup,
      npwp,
      email,
      contactName,
      creditLimit,
      bankAccount,
      status,
    } = req.body;

    const updated = await prisma.supplier.update({
      where: { id },
      data: {
        code,
        name,
        type,
        address,
        address2,
        phone,
        fax,
        taxGroup,
        npwp,
        email,
        contactName,
        creditLimit,
        bankAccount,
        status,
      },
    });
    res.json(updated);
  } catch (error) {
    console.error("Update Supplier Error:", error);
    if (error.code === "P2002") {
      return res.status(409).json({ error: "Kode supplier sudah dipakai" });
    }
    if (error.code === "P2025") {
      return res.status(404).json({ error: "Supplier tidak ditemukan" });
    }
    res.status(500).json({ error: "Gagal update supplier" });
  }
});

/**
 * DELETE /api/finance/suppliers/:id
 * Hapus supplier
 */
router.delete("/suppliers/:id", async (req, res) => {
  try {
    const { id } = req.params;
    await prisma.supplier.delete({ where: { id } });
    res.json({ message: "Supplier berhasil dihapus" });
  } catch (error) {
    console.error("Delete Supplier Error:", error);
    if (error.code === "P2025") {
      return res.status(404).json({ error: "Supplier tidak ditemukan" });
    }
    if (error.code === "P2003") {
      return res
        .status(409)
        .json({ error: "Supplier tidak bisa dihapus, masih dipakai di PO" });
    }
    res.status(500).json({ error: "Gagal menghapus supplier" });
  }
});
