const { google } = require("googleapis");

// Konfigurasi ini mengambil variabel dari file .env
// GOOGLE_APPLICATION_CREDENTIALS adalah path absolut ke file json dari Google Cloud Console
// GOOGLE_CALENDAR_ID adalah email target (misal: email owner)

const SCOPES = ["https://www.googleapis.com/auth/calendar"];

let calendar = null;

try {
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    const auth = new google.auth.GoogleAuth({
      keyFile: process.env.GOOGLE_APPLICATION_CREDENTIALS,
      scopes: SCOPES,
    });
    calendar = google.calendar({ version: "v3", auth });
    console.log("✅ Google Calendar API terinisialisasi.");
  } else {
    console.warn("⚠️ GOOGLE_APPLICATION_CREDENTIALS belum di-set. Fitur sinkronisasi kalender tidak akan berjalan.");
  }
} catch (error) {
  console.error("❌ Gagal inisialisasi Google Calendar API:", error);
}

/**
 * Membuat event baru di Google Calendar
 * @param {string} title - Judul task
 * @param {string} description - Deskripsi task
 * @param {Date} dueDate - Tenggat waktu task
 * @param {string} projectName - Nama Project
 * @returns {Promise<string|null>} Mengembalikan eventId dari Google Calendar
 */
const createCalendarEvent = async (title, description, dueDate, projectName = "Project Task") => {
  if (!calendar || !process.env.GOOGLE_CALENDAR_ID || !dueDate) return null;

  try {
    const end = new Date(dueDate);
    end.setHours(end.getHours() + 1); // Default durasi 1 jam

    const event = {
      summary: `[${projectName}] ${title}`,
      description: description || "",
      start: {
        dateTime: new Date(dueDate).toISOString(),
        timeZone: "Asia/Jakarta",
      },
      end: {
        dateTime: end.toISOString(),
        timeZone: "Asia/Jakarta",
      },
      reminders: {
        useDefault: false,
        overrides: [
          { method: "email", minutes: 24 * 60 },
          { method: "popup", minutes: 30 },
        ],
      },
    };

    const response = await calendar.events.insert({
      calendarId: process.env.GOOGLE_CALENDAR_ID,
      resource: event,
    });

    console.log(`✅ Event kalender dibuat: ${response.data.htmlLink}`);
    return response.data.id;
  } catch (error) {
    console.error("❌ Gagal membuat event kalender:", error);
    return null;
  }
};

/**
 * Memperbarui event di Google Calendar
 * @param {string} eventId - ID event dari database (KanbanTask.googleEventId)
 * @param {string} title - Judul task
 * @param {string} description - Deskripsi task
 * @param {Date} dueDate - Tenggat waktu task
 * @param {string} projectName - Nama Project
 */
const updateCalendarEvent = async (eventId, title, description, dueDate, projectName = "Project Task") => {
  if (!calendar || !process.env.GOOGLE_CALENDAR_ID || !eventId) return null;

  try {
    // Ambil dulu event sebelumnya (opsional, untuk cek apakah ada)
    try {
      await calendar.events.get({
        calendarId: process.env.GOOGLE_CALENDAR_ID,
        eventId: eventId,
      });
    } catch (e) {
      // Jika tidak ketemu (mungkin dihapus manual di kalender), buat baru
      console.warn("⚠️ Event kalender lama tidak ditemukan, membuat ulang...");
      return await createCalendarEvent(title, description, dueDate, projectName);
    }

    let startObj = null;
    let endObj = null;

    if (dueDate) {
      const end = new Date(dueDate);
      end.setHours(end.getHours() + 1);
      
      startObj = {
        dateTime: new Date(dueDate).toISOString(),
        timeZone: "Asia/Jakarta",
      };
      endObj = {
        dateTime: end.toISOString(),
        timeZone: "Asia/Jakarta",
      };
    }

    const event = {
      summary: `[${projectName}] ${title}`,
      description: description || "",
      ...(startObj && { start: startObj }),
      ...(endObj && { end: endObj }),
    };

    const response = await calendar.events.patch({
      calendarId: process.env.GOOGLE_CALENDAR_ID,
      eventId: eventId,
      resource: event,
    });

    console.log(`✅ Event kalender diperbarui: ${response.data.htmlLink}`);
    return response.data.id;
  } catch (error) {
    console.error("❌ Gagal memperbarui event kalender:", error);
    return null;
  }
};

/**
 * Menghapus event dari Google Calendar
 * @param {string} eventId - ID event dari database
 */
const deleteCalendarEvent = async (eventId) => {
  if (!calendar || !process.env.GOOGLE_CALENDAR_ID || !eventId) return;

  try {
    await calendar.events.delete({
      calendarId: process.env.GOOGLE_CALENDAR_ID,
      eventId: eventId,
    });
    console.log("✅ Event kalender berhasil dihapus.");
  } catch (error) {
    console.error("❌ Gagal menghapus event kalender:", error);
  }
};

module.exports = {
  createCalendarEvent,
  updateCalendarEvent,
  deleteCalendarEvent,
};
