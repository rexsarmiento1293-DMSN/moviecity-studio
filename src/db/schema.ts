import { relations } from 'drizzle-orm';
import { integer, pgTable, serial, text, timestamp } from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  uid: text('uid').notNull().unique(),
  email: text('email').notNull(),
  createdAt: timestamp('created_at').defaultNow(),
});

export const dramaProjects = pgTable('drama_projects', {
  id: serial('id').primaryKey(),
  userId: integer('user_id')
    .references(() => users.id)
    .notNull(),
  projectKey: text('project_key').notNull(),
  title: text('title').notNull(),
  prompt: text('prompt').notNull(),
  genre: text('genre').notNull(),
  status: text('status').notNull(),
  characterName: text('character_name').notNull(),
  characterAppearance: text('character_appearance').notNull(),
  characterStyle: text('character_style').notNull(),
  selectedEffect: text('selected_effect').notNull(),
  resolution: text('resolution').notNull(),
  sceneCount: integer('scene_count').notNull(),
  totalDurationSec: integer('total_duration_sec').notNull(),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

export const usersRelations = relations(users, ({ many }) => ({
  dramaProjects: many(dramaProjects),
}));

export const dramaProjectsRelations = relations(dramaProjects, ({ one }) => ({
  author: one(users, {
    fields: [dramaProjects.userId],
    references: [users.id],
  }),
}));
