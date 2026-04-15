CREATE TABLE "checklist_templates" (
  "id" TEXT NOT NULL,
  "organization_id" TEXT NOT NULL,
  "location_id" TEXT,
  "name" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "checklist_templates_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "checklist_templates_org_loc_idx" ON "checklist_templates"("organization_id", "location_id");

CREATE TABLE "checklist_items" (
  "id" TEXT NOT NULL,
  "template_id" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "position" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "checklist_items_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "checklist_items_tpl_pos_idx" ON "checklist_items"("template_id", "position");
ALTER TABLE "checklist_items" ADD CONSTRAINT "checklist_items_template_id_fkey"
  FOREIGN KEY ("template_id") REFERENCES "checklist_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "checklist_completions" (
  "id" TEXT NOT NULL,
  "item_id" TEXT NOT NULL,
  "shift_id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "completed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "checklist_completions_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "checklist_completions_item_shift_key" ON "checklist_completions"("item_id", "shift_id");
CREATE INDEX "checklist_completions_shift_idx" ON "checklist_completions"("shift_id");
ALTER TABLE "checklist_completions" ADD CONSTRAINT "checklist_completions_item_id_fkey"
  FOREIGN KEY ("item_id") REFERENCES "checklist_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "employee_notes" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "author_id" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "employee_notes_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "employee_notes_user_created_idx" ON "employee_notes"("user_id", "created_at");
