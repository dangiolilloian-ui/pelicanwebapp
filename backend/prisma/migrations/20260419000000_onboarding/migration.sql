-- CreateTable
CREATE TABLE "onboarding_tasks" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "onboarding_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "onboarding_progress" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "task_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "completed_at" TIMESTAMP(3),
    "completed_by_id" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "onboarding_progress_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "onboarding_tasks_organization_id_sort_order_idx" ON "onboarding_tasks"("organization_id", "sort_order");

-- CreateIndex
CREATE UNIQUE INDEX "onboarding_progress_user_id_task_id_key" ON "onboarding_progress"("user_id", "task_id");

-- CreateIndex
CREATE INDEX "onboarding_progress_user_id_idx" ON "onboarding_progress"("user_id");
