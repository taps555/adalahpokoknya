const express = require("express");
const router = express.Router();
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const { createCalendarEvent, updateCalendarEvent, deleteCalendarEvent } = require("../../services/googleCalendarService");

// ==========================================
// 1. Dapatkan semua Kanban Board untuk Project
// ==========================================
router.get("/projects/:projectId/kanban", async (req, res) => {
  try {
    const { projectId } = req.params;

    let board = await prisma.kanbanBoard.findUnique({
      where: { projectId },
      include: {
        lists: {
          orderBy: { order: "asc" },
          include: {
            tasks: {
              orderBy: { order: "asc" },
            },
          },
        },
      },
    });

    // Buat board otomatis jika belum ada untuk project ini
    if (!board) {
      board = await prisma.kanbanBoard.create({
        data: {
          projectId,
          lists: {
            create: [
              { title: "To Do", order: 0 },
              { title: "In Progress", order: 1 },
              { title: "Done", order: 2 },
            ],
          },
        },
        include: {
          lists: {
            orderBy: { order: "asc" },
            include: { tasks: true },
          },
        },
      });
    }

    res.json({ data: board });
  } catch (error) {
    console.error("Error fetching Kanban Board:", error);
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// 2. Tambah List Baru
// ==========================================
router.post("/kanban/boards/:boardId/lists", async (req, res) => {
  try {
    const { boardId } = req.params;
    const { title } = req.body;

    const count = await prisma.kanbanList.count({ where: { boardId } });
    const list = await prisma.kanbanList.create({
      data: {
        boardId,
        title,
        order: count,
      },
      include: { tasks: true }
    });

    res.json({ message: "List berhasil ditambahkan", data: list });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// 3. Update Judul List
// ==========================================
router.put("/kanban/lists/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { title } = req.body;

    const list = await prisma.kanbanList.update({
      where: { id },
      data: { title },
    });

    res.json({ message: "List diperbarui", data: list });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// 4. Hapus List
// ==========================================
router.delete("/kanban/lists/:id", async (req, res) => {
  try {
    const { id } = req.params;

    // Cari semua task di dalam list ini yang punya googleEventId
    const tasks = await prisma.kanbanTask.findMany({ where: { listId: id } });
    for (const task of tasks) {
      if (task.googleEventId) {
        await deleteCalendarEvent(task.googleEventId);
      }
    }

    // Menghapus list (beserta tasks-nya karena onDelete: Cascade)
    await prisma.kanbanList.delete({ where: { id } });

    res.json({ message: "List berhasil dihapus" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// 5. Tambah Task Baru
// ==========================================
router.post("/kanban/lists/:listId/tasks", async (req, res) => {
  try {
    const { listId } = req.params;
    const { title, description, dueDate } = req.body;

    const count = await prisma.kanbanTask.count({ where: { listId } });

    let googleEventId = null;
    if (dueDate) {
      // Ambil nama proyek
      const list = await prisma.kanbanList.findUnique({
        where: { id: listId },
        include: { board: { include: { project: true } } }
      });
      const projectName = list?.board?.project?.name || "Project Task";
      
      googleEventId = await createCalendarEvent(title, description, dueDate, projectName);
    }

    const task = await prisma.kanbanTask.create({
      data: {
        listId,
        title,
        description,
        dueDate: dueDate ? new Date(dueDate) : null,
        order: count,
        googleEventId,
      },
    });

    res.json({ message: "Task berhasil ditambahkan", data: task });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// 6. Update Task (Judul, Deskripsi, Due Date)
// ==========================================
router.put("/kanban/tasks/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { title, description, dueDate } = req.body;

    const existingTask = await prisma.kanbanTask.findUnique({ 
      where: { id },
      include: { list: { include: { board: { include: { project: true } } } } }
    });
    
    if (!existingTask) return res.status(404).json({ error: "Task not found" });
    
    const projectName = existingTask.list?.board?.project?.name || "Project Task";

    let newGoogleEventId = existingTask.googleEventId;

    if (dueDate) {
      if (existingTask.googleEventId) {
        // Update event di Google Calendar
        newGoogleEventId = await updateCalendarEvent(existingTask.googleEventId, title, description, dueDate, projectName);
      } else {
        // Buat baru jika sebelumnya tidak ada due date
        newGoogleEventId = await createCalendarEvent(title, description, dueDate, projectName);
      }
    } else {
      // Jika due date dihilangkan, hapus event di Google Calendar
      if (existingTask.googleEventId) {
        await deleteCalendarEvent(existingTask.googleEventId);
        newGoogleEventId = null;
      }
    }

    const task = await prisma.kanbanTask.update({
      where: { id },
      data: {
        title,
        description,
        dueDate: dueDate ? new Date(dueDate) : null,
        googleEventId: newGoogleEventId,
      },
    });

    res.json({ message: "Task diperbarui", data: task });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// 7. Hapus Task
// ==========================================
router.delete("/kanban/tasks/:id", async (req, res) => {
  try {
    const { id } = req.params;
    
    const task = await prisma.kanbanTask.findUnique({ where: { id } });
    if (task && task.googleEventId) {
      await deleteCalendarEvent(task.googleEventId);
    }

    await prisma.kanbanTask.delete({ where: { id } });

    res.json({ message: "Task dihapus" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// 8. Reorder List / Drag and Drop Tasks
// ==========================================
router.put("/kanban/boards/:boardId/reorder", async (req, res) => {
  try {
    const { lists } = req.body; // Menerima payload struktur lists baru

    // Update dalam transaction
    await prisma.$transaction(
      lists.flatMap((list, listIndex) => [
        // Update order untuk List
        prisma.kanbanList.update({
          where: { id: list.id },
          data: { order: listIndex },
        }),
        // Update order dan parent listId untuk setiap Task
        ...list.tasks.map((task, taskIndex) =>
          prisma.kanbanTask.update({
            where: { id: task.id },
            data: { listId: list.id, order: taskIndex },
          })
        ),
      ])
    );

    res.json({ message: "Reorder berhasil disimpan" });
  } catch (error) {
    console.error("Error reordering:", error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
