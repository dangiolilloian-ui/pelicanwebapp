-- Add file attachment columns to chat_messages
ALTER TABLE "chat_messages" ADD COLUMN "file_url" TEXT;
ALTER TABLE "chat_messages" ADD COLUMN "file_name" TEXT;
ALTER TABLE "chat_messages" ADD COLUMN "file_type" TEXT;
ALTER TABLE "chat_messages" ADD COLUMN "file_size" INTEGER;
