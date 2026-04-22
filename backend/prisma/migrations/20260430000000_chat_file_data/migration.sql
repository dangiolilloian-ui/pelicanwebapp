-- AlterTable: add file_data bytea column for storing file attachments in the DB
ALTER TABLE "chat_messages" ADD COLUMN "file_data" BYTEA;
