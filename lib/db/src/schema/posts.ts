import {
  pgTable,
  text,
  uuid,
  timestamp,
  boolean,
  integer,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const postsTable = pgTable("posts", {
  id: uuid("id").primaryKey().defaultRandom(),
  title: text("title").notNull(),
  body: text("body").notNull(),
  category: text("category").notNull(),
  imageUrl: text("image_url"),
  hasImage: boolean("has_image").notNull().default(false),
  significanceScore: integer("significance_score").notNull().default(5),
  sourceNote: text("source_note").notNull(),
  publishedAt: timestamp("published_at", { withTimezone: true }).notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  isBreaking: boolean("is_breaking").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  // Multi-language fields (nullable for backwards-compat with older posts)
  titleEn: text("title_en"),
  bodyEn: text("body_en"),
  titleUr: text("title_ur"),
  bodyUr: text("body_ur"),
  titleAr: text("title_ar"),
  bodyAr: text("body_ar"),
  // Engagement counters
  likesCount: integer("likes_count").notNull().default(0),
  viewsCount: integer("views_count").notNull().default(0),
});

export const insertPostSchema = createInsertSchema(postsTable).omit({
  id: true,
  createdAt: true,
});
export type InsertPost = z.infer<typeof insertPostSchema>;
export type Post = typeof postsTable.$inferSelect;
