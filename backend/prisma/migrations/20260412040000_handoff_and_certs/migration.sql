ALTER TABLE "shifts" ADD COLUMN "handoff_note" TEXT;

CREATE TABLE "certifications" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "issued_at" TIMESTAMP(3),
  "expires_at" TIMESTAMP(3),
  "reference" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "certifications_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "certifications_user_id_expires_at_idx" ON "certifications"("user_id", "expires_at");

ALTER TABLE "certifications" ADD CONSTRAINT "certifications_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
