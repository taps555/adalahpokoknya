"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  collectSurveyPhotoUrls,
  deleteProjectWithSurveys,
} = require("./projectDeletionService");

test("collectSurveyPhotoUrls hanya mengambil URL foto survey yang tersimpan", () => {
  const urls = collectSurveyPhotoUrls([
    {
      areas: [
        { photoUrl: "/uploads/surveys/legacy.jpg", photos: [{ url: "/uploads/surveys/a.jpg" }] },
        { photoUrl: null, photos: [{ url: "/uploads/surveys/b.jpg" }] },
      ],
    },
  ]);

  assert.deepEqual(urls, [
    "/uploads/surveys/legacy.jpg",
    "/uploads/surveys/a.jpg",
    "/uploads/surveys/b.jpg",
  ]);
});

test("deleteProjectWithSurveys menghapus SurveyReport sebelum Project dalam transaksi", async () => {
  const calls = [];
  const existing = { id: "project-a", pairedProjectId: "project-b" };
  const surveys = [{ areas: [{ photoUrl: null, photos: [{ url: "/uploads/surveys/a.jpg" }] }] }];
  const tx = {
    project: {
      update: async (args) => calls.push(["project.update", args]),
      delete: async (args) => calls.push(["project.delete", args]),
    },
    surveyReport: {
      findMany: async (args) => {
        calls.push(["surveyReport.findMany", args]);
        return surveys;
      },
      deleteMany: async (args) => calls.push(["surveyReport.deleteMany", args]),
    },
  };
  const prisma = {
    $transaction: async (callback) => callback(tx),
  };

  const result = await deleteProjectWithSurveys(prisma, existing);

  assert.deepEqual(calls.map(([name]) => name), [
    "surveyReport.findMany",
    "project.update",
    "surveyReport.deleteMany",
    "project.delete",
  ]);
  assert.deepEqual(result.surveyPhotoUrls, ["/uploads/surveys/a.jpg"]);
});
