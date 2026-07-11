import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const records = sqliteTable("records", {
  id: text("id").primaryKey(),
  type: text("type").notNull(),
  projectId: text("project_id"),
  status: text("status").notNull().default("active"),
  payload: text("payload", { mode: "json" }).notNull(),
  createdBy: text("created_by").notNull().default("system"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});

export const activityEvents = sqliteTable("activity_events", {
  id: text("id").primaryKey(),
  recordId: text("record_id").notNull(),
  action: text("action").notNull(),
  actor: text("actor").notNull(),
  detail: text("detail"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
});

export const webhookReceipts = sqliteTable("webhook_receipts", {
  id: text("id").primaryKey(),
  provider: text("provider").notNull(),
  receivedAt: integer("received_at", { mode: "timestamp_ms" }).notNull(),
});
