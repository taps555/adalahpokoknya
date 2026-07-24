const swaggerAutogen = require("swagger-autogen")();

const doc = {
  info: {
    title: "Node.js API Documentation",
    description: "Auto-generated API routes",
  },
  host: "localhost:4000", // Sesuaikan port backend kamu
  schemes: ["http"],
};

const outputFile = "./swagger-output.json";

// Path disesuaikan dengan folder src/
const routesFiles = [
  "./src/index.js", // File entry point utama
  "./src/routes/*.js", // File JS langsung di src/routes/
  "./src/routes/**/*.js", // Semua sub-folder di src/routes/ (crudGrub, exportToFile, dll)
];

swaggerAutogen(outputFile, routesFiles, doc);
