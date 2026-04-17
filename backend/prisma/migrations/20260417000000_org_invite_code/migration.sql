-- Add invite_code column to organizations for self-service employee join links
ALTER TABLE "organizations" ADD COLUMN "invite_code" TEXT;
CREATE UNIQUE INDEX "organizations_invite_code_key" ON "organizations"("invite_code");
