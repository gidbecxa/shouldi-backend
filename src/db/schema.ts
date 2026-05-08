import {
  boolean,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

// ─── Enums ──────────────────────────────────────────────────────────────────

export const questionStatusEnum = pgEnum("question_status", ["active", "closed", "flagged", "deleted"]);
export const voteChoiceEnum = pgEnum("vote_choice", ["yes", "no"]);

// ─── Tables ──────────────────────────────────────────────────────────────────

export const users = pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  deviceId: text("device_id").notNull().unique(),
  googleSub: text("google_sub").unique(),
  email: text("email").unique(),
  displayName: text("display_name"),
  avatarUrl: text("avatar_url"),
  isBanned: boolean("is_banned").default(false).notNull(),
  banReason: text("ban_reason"),
  pushToken: text("push_token"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const questions = pgTable(
  "questions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    text: text("text").notNull(),
    category: text("category").notNull().default("general"),
    status: questionStatusEnum("status").default("active").notNull(),
    yesCount: integer("yes_count").default(0).notNull(),
    noCount: integer("no_count").default(0).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    userIdIdx: index("questions_user_id_idx").on(table.userId),
    statusCreatedIdx: index("questions_status_created_idx").on(table.status, table.createdAt),
    expiresAtIdx: index("questions_expires_at_idx").on(table.expiresAt),
  }),
);

export const votes = pgTable(
  "votes",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    questionId: uuid("question_id")
      .notNull()
      .references(() => questions.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    vote: voteChoiceEnum("vote").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    questionUserUniq: unique("votes_question_user_uniq").on(table.questionId, table.userId),
    questionIdIdx: index("votes_question_id_idx").on(table.questionId),
    userIdIdx: index("votes_user_id_idx").on(table.userId),
  }),
);

export const reports = pgTable(
  "reports",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    questionId: uuid("question_id")
      .notNull()
      .references(() => questions.id, { onDelete: "cascade" }),
    reporterId: uuid("reporter_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    reason: text("reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    questionReporterUniq: unique("reports_question_reporter_uniq").on(table.questionId, table.reporterId),
    questionIdIdx: index("reports_question_id_idx").on(table.questionId),
  }),
);

export const bannedKeywords = pgTable("banned_keywords", {
  id: uuid("id").defaultRandom().primaryKey(),
  keyword: text("keyword").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const notificationLog = pgTable(
  "notification_log",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    questionId: uuid("question_id")
      .notNull()
      .references(() => questions.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    sentAt: timestamp("sent_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    userQuestionTypeUniq: unique("notification_log_user_question_type_uniq").on(
      table.userId,
      table.questionId,
      table.type,
    ),
  }),
);

export const waitlist = pgTable("waitlist", {
  id: uuid("id").defaultRandom().primaryKey(),
  email: text("email").notNull().unique(),
  source: text("source").default("website").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});
