ALTER TABLE "users" ADD COLUMN "nickname" text;--> statement-breakpoint
CREATE UNIQUE INDEX "users_nickname_unique" ON "users" USING btree ("nickname");