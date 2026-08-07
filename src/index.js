"use strict";

require("dotenv").config();
const express = require("express");
const cors = require("cors");
const path = require("path"); // ← tambah ini

const uploadRoutes = require("./routes/upload.routes");
const jobsRoutes = require("./routes/jobs.routes");
const clientsRouter = require("./routes/clients");
const hspkRouter = require("./routes/hspk");
const projectsRouter = require("./routes/projects");

const rabRoutes = require("./routes/crudGrub/rab.routes");
const rabGrub = require("./routes/crudGrub/rabGrub.routes");

const exportExcel = require("./routes/exportToFile/rabExport.routes");

const bv = require("./routes/crudGrub/bv.routes");

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "..", "frontend")));

app.get("/health", (req, res) => res.json({ ok: true }));
app.use("/api", uploadRoutes);
app.use("/api", jobsRoutes);
app.use("/api/clients", clientsRouter);
app.use("/api/hspk", hspkRouter);
app.use("/api/projects", projectsRouter);

//pembuatan rab:
app.use("/api", rabRoutes);
app.use("/api", rabGrub);

//export to file excel
app.use("/api", exportExcel);

//bv
app.use("/api", bv);

app.use("/api", require("./routes/exportToFile/bvExport.routes"));
app.use("/api", require("./routes/exportToFile/fullExport.routes"));

app.use("/api", require("./routes/exportToFile/rabView.routes"));

//shedule
app.use("/api", require("./routes/crudGrub/timeSchedule.routes"));

//
app.use("/api", require("./routes/exportToFile/timeScheduleExport.routes"));

app.use("/api", require("./routes/crudGrub/joinOpname.routes"));

app.use((err, req, res, next) => {
  if (err) {
    console.error(err);
    return res.status(400).json({ error: err.message || "Terjadi kesalahan." });
  }
  next();
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`HSPK/AHSP importer jalan di http://localhost:${PORT}`);
});
