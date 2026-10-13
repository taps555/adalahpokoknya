const express = require("express");
const prisma = require("../../lib/prisma");
const { verifyToken } = require("../../middleware/auth");

const router = express.Router();

const VALID_ROLES = [
  "SUPER_ADMIN",
  "PERENCANA",
  "PELAKSANA",
  "FINANCE",
  "PURCHASING",
  "PROJECT_MANAGER",
];

/**
 * Cek apakah user berhak mengubah status tugas (To Do -> In Progress -> Done)
 * Syarat:
 * 1. Super Admin
 * 2. Pembuat tugas (Creator)
 * 3. Ditugaskan ke akun spesifik (AssigneeId === userId)
 * 4. Ditugaskan ke divisi/role spesifik (TargetRole === user.role)
 * 5. Ditugaskan ke seluruh tim (assigneeId null & targetRole null)
 */
const canUserChangeStatus = (user, task) => {
  if (!user || !task) return false;
  if (user.role === "SUPER_ADMIN") return true;
  if (task.creatorId === user.userId) return true;
  if (task.assigneeId) return task.assigneeId === user.userId;
  if (task.targetRole) return task.targetRole === user.role;
  // Ditujukan untuk seluruh tim
  return true;
};

/**
 * GET /api/tasks
 * Mengambil semua task dengan filter fleksibel (scope=my, projectId, priority, status, search)
 */
router.get("/tasks", verifyToken, async (req, res) => {
  try {
    const { scope, projectId, priority, status, search } = req.query;
    const currentUserId = req.user.userId;
    const currentUserRole = req.user.role;

    const where = {};

    // Filter scope: 'my' hanya menampilkan tugas untuk akun yang sedang login:
    // - Ditugaskan ke user langsung
    // - Dibuat oleh user
    // - Ditugaskan ke divisi user (targetRole)
    // - Ditugaskan untuk semua orang (seluruh tim)
    if (scope === "my") {
      where.OR = [
        { assigneeId: currentUserId },
        { creatorId: currentUserId },
        { targetRole: currentUserRole },
        { AND: [{ assigneeId: null }, { targetRole: null }] },
      ];
    }

    // Filter Project: 'none' untuk internal tanpa proyek, atau ID spesifik proyek
    if (projectId) {
      if (projectId === "none") {
        where.projectId = null;
      } else {
        where.projectId = projectId;
      }
    }

    // Filter Prioritas
    if (priority && ["LOW", "MEDIUM", "HIGH", "URGENT"].includes(priority)) {
      where.priority = priority;
    }

    // Filter Status Kolom
    if (status && ["TODO", "IN_PROGRESS", "DONE"].includes(status)) {
      where.status = status;
    }

    // Search query pencarian kata kunci
    if (search && search.trim()) {
      where.AND = [
        ...(where.AND || []),
        {
          OR: [
            { title: { contains: search.trim(), mode: "insensitive" } },
            { description: { contains: search.trim(), mode: "insensitive" } },
          ],
        },
      ];
    }

    const tasks = await prisma.taskItem.findMany({
      where,
      include: {
        project: {
          select: { id: true, name: true },
        },
        creator: {
          select: { id: true, name: true, username: true, role: true },
        },
        assignee: {
          select: { id: true, name: true, username: true, role: true },
        },
      },
      orderBy: [
        { status: "asc" },
        { order: "asc" },
        { createdAt: "desc" },
      ],
    });

    res.json({ success: true, data: tasks });
  } catch (error) {
    console.error("Get Tasks Error:", error);
    res.status(500).json({ error: "Gagal memuat daftar tugas." });
  }
});

/**
 * POST /api/tasks
 * Membuat tugas baru
 */
router.post("/tasks", verifyToken, async (req, res) => {
  try {
    const {
      title,
      description,
      status,
      priority,
      dueDate,
      projectId,
      assigneeId,
      targetRole,
    } = req.body;

    if (!title || !title.trim()) {
      return res.status(400).json({ error: "Judul tugas wajib diisi." });
    }

    const currentUserId = req.user.userId;
    const taskStatus = status && ["TODO", "IN_PROGRESS", "DONE"].includes(status) ? status : "TODO";
    const taskPriority = priority && ["LOW", "MEDIUM", "HIGH", "URGENT"].includes(priority) ? priority : "MEDIUM";

    let finalAssigneeId = null;
    let finalTargetRole = null;

    if (targetRole && VALID_ROLES.includes(targetRole)) {
      finalTargetRole = targetRole;
      finalAssigneeId = null;
    } else if (assigneeId && assigneeId !== "all") {
      finalAssigneeId = assigneeId;
      finalTargetRole = null;
    } else {
      // Ditujukan untuk seluruh tim
      finalAssigneeId = null;
      finalTargetRole = null;
    }

    // Hitung posisi order terakhir di kolom terkait
    const lastCount = await prisma.taskItem.count({
      where: { status: taskStatus },
    });

    const newTask = await prisma.taskItem.create({
      data: {
        title: title.trim(),
        description: description ? description.trim() : null,
        status: taskStatus,
        priority: taskPriority,
        dueDate: dueDate ? new Date(dueDate) : null,
        projectId: projectId && projectId !== "none" ? projectId : null,
        creatorId: currentUserId,
        assigneeId: finalAssigneeId,
        targetRole: finalTargetRole,
        order: lastCount,
      },
      include: {
        project: { select: { id: true, name: true } },
        creator: { select: { id: true, name: true, username: true, role: true } },
        assignee: { select: { id: true, name: true, username: true, role: true } },
      },
    });

    res.status(201).json({
      message: "Tugas berhasil dibuat!",
      data: newTask,
    });
  } catch (error) {
    console.error("Create Task Error:", error);
    res.status(500).json({ error: "Gagal membuat tugas baru." });
  }
});

/**
 * PUT /api/tasks/:id
 * Mengedit detail tugas.
 * Aturan: Hanya Creator tugas atau SUPER_ADMIN yang berhak mengedit detail task.
 */
router.put("/tasks/:id", verifyToken, async (req, res) => {
  try {
    const { id } = req.params;
    const {
      title,
      description,
      status,
      priority,
      dueDate,
      projectId,
      assigneeId,
      targetRole,
    } = req.body;

    const existingTask = await prisma.taskItem.findUnique({ where: { id } });
    if (!existingTask) {
      return res.status(404).json({ error: "Tugas tidak ditemukan." });
    }

    const isSuperAdmin = req.user.role === "SUPER_ADMIN";
    const isCreator = existingTask.creatorId === req.user.userId;

    if (!isSuperAdmin && !isCreator) {
      return res.status(403).json({
        error: "Akses Ditolak: Hanya pembuat tugas (Creator) atau Super Admin yang dapat mengubah detail tugas ini.",
      });
    }

    let finalAssigneeId = existingTask.assigneeId;
    let finalTargetRole = existingTask.targetRole;

    if (targetRole !== undefined || assigneeId !== undefined) {
      if (targetRole && VALID_ROLES.includes(targetRole)) {
        finalTargetRole = targetRole;
        finalAssigneeId = null;
      } else if (assigneeId && assigneeId !== "all") {
        finalAssigneeId = assigneeId;
        finalTargetRole = null;
      } else {
        finalAssigneeId = null;
        finalTargetRole = null;
      }
    }

    const updatedTask = await prisma.taskItem.update({
      where: { id },
      data: {
        ...(title !== undefined && { title: title.trim() }),
        ...(description !== undefined && { description: description ? description.trim() : null }),
        ...(status && { status }),
        ...(priority && { priority }),
        ...(dueDate !== undefined && { dueDate: dueDate ? new Date(dueDate) : null }),
        ...(projectId !== undefined && { projectId: projectId && projectId !== "none" ? projectId : null }),
        assigneeId: finalAssigneeId,
        targetRole: finalTargetRole,
      },
      include: {
        project: { select: { id: true, name: true } },
        creator: { select: { id: true, name: true, username: true, role: true } },
        assignee: { select: { id: true, name: true, username: true, role: true } },
      },
    });

    res.json({
      message: "Tugas berhasil diperbarui!",
      data: updatedTask,
    });
  } catch (error) {
    console.error("Update Task Error:", error);
    res.status(500).json({ error: "Gagal memperbarui tugas." });
  }
});

/**
 * PATCH /api/tasks/:id/move
 * Memindahkan status tugas (misal To Do -> In Progress -> Done) atau update checkbox.
 * Aturan: Hanya Creator, Super Admin, dan akun/role penerima tugas yang diizinkan!
 */
router.patch("/tasks/:id/move", verifyToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { status, order } = req.body;

    const existingTask = await prisma.taskItem.findUnique({ where: { id } });
    if (!existingTask) {
      return res.status(404).json({ error: "Tugas tidak ditemukan." });
    }

    // Pengecekan Hak Akses
    if (!canUserChangeStatus(req.user, existingTask)) {
      return res.status(403).json({
        error: "Akses Ditolak: Hanya pembuat tugas, penerima tugas, atau Super Admin yang dapat mengubah status tugas ini.",
      });
    }

    const dataToUpdate = {};
    if (status && ["TODO", "IN_PROGRESS", "DONE"].includes(status)) {
      dataToUpdate.status = status;
    }
    if (typeof order === "number") {
      dataToUpdate.order = order;
    }

    const updatedTask = await prisma.taskItem.update({
      where: { id },
      data: dataToUpdate,
      include: {
        project: { select: { id: true, name: true } },
        creator: { select: { id: true, name: true, username: true, role: true } },
        assignee: { select: { id: true, name: true, username: true, role: true } },
      },
    });

    res.json({
      message: "Status tugas berhasil diperbarui!",
      data: updatedTask,
    });
  } catch (error) {
    console.error("Move Task Error:", error);
    res.status(500).json({ error: "Gagal memindahkan status tugas." });
  }
});

/**
 * PATCH /api/tasks/reorder
 * Menyimpan urutan banyak tugas sekaligus (setelah drag & drop di board)
 */
router.patch("/tasks/reorder", verifyToken, async (req, res) => {
  try {
    const { tasks } = req.body; // array of { id, status, order }

    if (!Array.isArray(tasks) || tasks.length === 0) {
      return res.status(400).json({ error: "Data tasks wajib berupa array." });
    }

    // Ambil data task saat ini untuk validasi hak akses jika status berubah
    const taskIds = tasks.map((t) => t.id);
    const existingTasks = await prisma.taskItem.findMany({
      where: { id: { in: taskIds } },
    });
    const taskMap = new Map(existingTasks.map((t) => [t.id, t]));

    for (const item of tasks) {
      const existing = taskMap.get(item.id);
      if (existing && item.status && item.status !== existing.status) {
        // Status berubah! Pastikan user berhak
        if (!canUserChangeStatus(req.user, existing)) {
          return res.status(403).json({
            error: `Akses Ditolak: Anda tidak memiliki izin memindahkan tugas "${existing.title}".`,
          });
        }
      }
    }

    // Eksekusi update urutan secara batch transaction
    const updateOperations = tasks.map((item) =>
      prisma.taskItem.update({
        where: { id: item.id },
        data: {
          status: item.status,
          order: item.order,
        },
      })
    );

    await prisma.$transaction(updateOperations);

    res.json({ message: "Posisi tugas berhasil diperbarui!" });
  } catch (error) {
    console.error("Reorder Tasks Error:", error);
    res.status(500).json({ error: error.message || "Gagal menyimpan urutan tugas." });
  }
});

/**
 * DELETE /api/tasks/:id
 * Menghapus tugas.
 * Aturan: Hanya Creator atau SUPER_ADMIN yang berhak menghapus.
 */
router.delete("/tasks/:id", verifyToken, async (req, res) => {
  try {
    const { id } = req.params;

    const existingTask = await prisma.taskItem.findUnique({ where: { id } });
    if (!existingTask) {
      return res.status(404).json({ error: "Tugas tidak ditemukan." });
    }

    const isSuperAdmin = req.user.role === "SUPER_ADMIN";
    const isCreator = existingTask.creatorId === req.user.userId;

    if (!isSuperAdmin && !isCreator) {
      return res.status(403).json({
        error: "Akses Ditolak: Hanya pembuat tugas (Creator) atau Super Admin yang dapat menghapus tugas ini.",
      });
    }

    await prisma.taskItem.delete({ where: { id } });

    res.json({ message: "Tugas berhasil dihapus!" });
  } catch (error) {
    console.error("Delete Task Error:", error);
    res.status(500).json({ error: "Gagal menghapus tugas." });
  }
});

module.exports = router;
