const express = require("express");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const prisma = require("../../lib/prisma"); // Sesuaikan path-nya dengan struktur Anda

const router = express.Router();
const SECRET_KEY = process.env.JWT_SECRET || "rahasia_super_aman_123";

/**
 * POST /api/auth/register
 * (Opsional: Digunakan untuk membuat akun pertama kali, misal akun Super Admin)
 */
router.post("/register", async (req, res) => {
  try {
    const { username, password, name, role } = req.body;

    // 1. Cek apakah username sudah dipakai
    const existingUser = await prisma.user.findUnique({ where: { username } });
    if (existingUser)
      return res.status(400).json({ error: "Username sudah digunakan." });

    // 2. Acak password menggunakan bcrypt (Salt rounds = 10 adalah standar aman)
    const hashedPassword = await bcrypt.hash(password, 10);

    // 3. Simpan ke database
    const newUser = await prisma.user.create({
      data: {
        username,
        password: hashedPassword,
        name,
        role: role || "PERENCANA",
      },
    });

    res.json({
      message: "Akun berhasil dibuat!",
      data: { username: newUser.username, role: newUser.role },
    });
  } catch (error) {
    console.error("Register Error:", error);
    res.status(500).json({ error: "Terjadi kesalahan saat mendaftar." });
  }
});

/**
 * POST /api/auth/login
 * Fitur utama untuk masuk aplikasi
 */
router.post("/login", async (req, res) => {
  try {
    const { username, password } = req.body;

    // 1. Cari user di database
    const user = await prisma.user.findUnique({ where: { username } });
    if (!user)
      return res.status(401).json({ error: "Username atau password salah." });

    // 2. Cocokkan password yang diketik dengan yang diacak di database
    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid)
      return res.status(401).json({ error: "Username atau password salah." });

    // 3. Jika cocok, buat Tiket JWT
    // Tiket ini menyimpan ID dan Role, berlaku selama 12 jam
    const token = jwt.sign(
      { userId: user.id, role: user.role, name: user.name },
      SECRET_KEY,
      { expiresIn: "12h" },
    );

    // 4. Kirim tiket ke Frontend
    res.json({
      message: "Login berhasil!",
      token: token,
      user: { name: user.name, role: user.role },
    });
  } catch (error) {
    console.error("Login Error:", error);
    res.status(500).json({ error: "Terjadi kesalahan server saat login." });
  }
});

module.exports = router;
