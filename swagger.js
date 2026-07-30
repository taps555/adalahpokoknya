const swaggerAutogen = require("swagger-autogen")();

const doc = {
  info: {
    title: "Node.js API Documentation",
    description: "Auto-generated API routes",
  },
  host: "localhost:4000", // Sesuaikan port backend kamu
  schemes: ["http"],
};

const outputFile = "./swagger-output_crudGrrop.json";

const routesFiles = [
  // "./src/routes/clients.js",
  // "./src/routes/hspk.js",
  // "./src/routes/jobs.routes.js",
  // "./src/routes/projects.js",
  // "./src/routes/upload.routes.js",
  "./src/routes/crudGrub/bv.routes.js",
  "./src/routes/crudGrub/rab.routes.js",
  "./src/routes/crudGrub/rabGrub.routes.js",
  "./src/routes/crudGrub/timeSchedule.routes.js",
  // "./src/routes/exportToFile/bvExport.routes.js",
  // "./src/routes/exportToFile/rabExport.routes.js",
  // "./src/routes/exportToFile/rabView.routes.js",
  // "./src/routes/exportToFile/fullExport.routes.js",
  // "./src/routes/exportToFile/timeScheduleExport.routes.js",
  // "",
];
// const routesFiles = ["./src/index.js"];

swaggerAutogen(outputFile, routesFiles, doc);
