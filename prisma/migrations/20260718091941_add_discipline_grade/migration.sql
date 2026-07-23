-- CreateTable
CREATE TABLE "DisciplineGrade" (
    "id" TEXT NOT NULL,
    "discipline" "Discipline" NOT NULL,
    "grade" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "DisciplineGrade_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DisciplineGrade_discipline_grade_key" ON "DisciplineGrade"("discipline", "grade");
