CREATE TABLE "document" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"parent_id" text,
	"position" integer DEFAULT 0 NOT NULL,
	"number" integer NOT NULL,
	"title" text NOT NULL,
	"content" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by" text,
	"updated_by" text,
	"archived_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "document_project_number_unique" UNIQUE("project_id","number")
);
--> statement-breakpoint
CREATE TABLE "document_task_link" (
	"id" text PRIMARY KEY NOT NULL,
	"document_id" text NOT NULL,
	"task_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "document_task_link_document_task_unique" UNIQUE("document_id","task_id")
);
--> statement-breakpoint
ALTER TABLE "document" ADD CONSTRAINT "document_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "document" ADD CONSTRAINT "document_parent_id_document_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."document"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "document" ADD CONSTRAINT "document_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "document" ADD CONSTRAINT "document_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "document_task_link" ADD CONSTRAINT "document_task_link_document_id_document_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."document"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "document_task_link" ADD CONSTRAINT "document_task_link_task_id_task_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."task"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "document_projectId_idx" ON "document" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "document_parentId_idx" ON "document" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "document_projectId_parentId_position_idx" ON "document" USING btree ("project_id","parent_id","position");--> statement-breakpoint
CREATE INDEX "document_task_link_documentId_idx" ON "document_task_link" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "document_task_link_taskId_idx" ON "document_task_link" USING btree ("task_id");