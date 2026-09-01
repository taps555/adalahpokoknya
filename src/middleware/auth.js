const jwt = require("jsonwebtoken");

// Rahasia untuk membuka token (Pastikan disembunyikan di file .env nantinya)
const SECRET_KEY = process.env.JWT_SECRET || "rahasia_super_aman_123";

/**
 * 1. VERIFIKASI LOGIN
 * Mengecek apakah user membawa tiket (token) yang valid
 */
const verifyToken = (req, res, next) => {
  // Ambil token dari header request
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res
      .status(401)
      .json({ error: "Anda belum login atau token tidak valid." });
  }

  const token = authHeader.split(" ")[1];

  try {
    // Buka isi tiketnya (biasanya berisi id dan role user)
    const decoded = jwt.verify(token, SECRET_KEY);
    req.user = decoded; // Tempelkan data user ke request agar bisa dibaca oleh rute selanjutnya
    next(); // Silakan masuk!
  } catch (error) {
    return res
      .status(401)
      .json({ error: "Sesi login Anda telah habis atau tidak valid." });
  }
};

/**
 * 2. VERIFIKASI HAK AKSES (ROLE)
 * Mengecek apakah role user ada di dalam daftar yang diizinkan
 */
const authorizeRoles = (...allowedRoles) => {
  return (req, res, next) => {
    // Cegat jika user tidak ada atau rolenya tidak termasuk yang diizinkan
    if (!req.user || !allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        error: `Akses Ditolak! Fitur ini hanya untuk divisi: ${allowedRoles.join(", ")}.`,
      });
    }
    next(); // Lolos cek Role, silakan eksekusi fitur!
  };
};

module.exports = {
  verifyToken,
  authorizeRoles,
};
