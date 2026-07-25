import {
  pgTable,
  text,
  uuid,
  timestamp,
  integer,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const flaggedPostsTable = pgTable("flagged_posts", {
  id: uuid("id").primaryKey().defaultRandom(),
  title: text("title").notNull(),
  body: text("body").notNull(),
  category: text("category").notNull(),
  significanceScore: integer("significance_score").notNull().default(5),
  sourceNote: text("source_note").notNull(),
  flagReason: text("flag_reason").notNull(),
  flaggedAt: timestamp("flagged_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertFlaggedPostSchema = createInsertSchema(flaggedPostsTable).omit({
  id: true,
  createdAt: true,
  flaggedAt: true,
});
export type InsertFlaggedPost = z.infer<typeof insertFlaggedPostSchema>;
export type FlaggedPost = typeof flaggedPostsTable.$inferSelect;
