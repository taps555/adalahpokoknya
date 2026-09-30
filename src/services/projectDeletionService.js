"use strict";

function collectSurveyPhotoUrls(surveys = []) {
  return surveys.flatMap((survey) =>
    (survey.areas || []).flatMap((area) => [
      area.photoUrl,
      ...(area.photos || []).map((photo) => photo.url),
    ]),
  ).filter(Boolean);
}

async function deleteProjectWithSurveys(prisma, existingProject) {
  return prisma.$transaction(async (tx) => {
    const surveys = await tx.surveyReport.findMany({
      where: { projectId: existingProject.id },
      include: {
        areas: {
          include: { photos: true },
        },
      },
    });

    if (existingProject.pairedProjectId) {
      await tx.project.update({
        where: { id: existingProject.pairedProjectId },
        data: { pairedProjectId: null },
      });
    }

    await tx.surveyReport.deleteMany({
      where: { projectId: existingProject.id },
    });
    await tx.project.delete({ where: { id: existingProject.id } });

    return { surveyPhotoUrls: collectSurveyPhotoUrls(surveys) };
  });
}

module.exports = {
  collectSurveyPhotoUrls,
  deleteProjectWithSurveys,
};
