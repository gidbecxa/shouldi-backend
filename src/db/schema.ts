import {
  boolean,
  date,
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
  lastActiveAt: timestamp("last_active_at", { withTimezone: true }).defaultNow(),
  timezoneOffset: integer("timezone_offset").default(0),
  ratingPrompted: boolean("rating_prompted").default(false),
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
    shareCount: integer("share_count").default(0).notNull(),
    language: text("language").notNull().default("en"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    userIdIdx: index("questions_user_id_idx").on(table.userId),
    statusCreatedIdx: index("questions_status_created_idx").on(table.status, table.createdAt),
    expiresAtIdx: index("questions_expires_at_idx").on(table.expiresAt),
    languageIdx: index("idx_questions_language").on(table.language, table.status, table.createdAt),
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
    hardwareDeviceId: text("hardware_device_id"),
    browserId: text("browser_id"),
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

export const shares = pgTable(
  "shares",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    questionId: uuid("question_id")
      .references(() => questions.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .references(() => users.id, { onDelete: "cascade" }),
    shareType: text("share_type").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    questionIdIdx: index("shares_question_id_idx").on(table.questionId),
    userIdIdx: index("shares_user_id_idx").on(table.userId),
  }),
);

export const qotd = pgTable(
  "qotd",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    questionId: uuid("question_id")
      .references(() => questions.id, { onDelete: "cascade" }),
    date: date("date").notNull().unique(),
    isManual: boolean("is_manual").default(false),
  },
  (table) => ({
    dateIdx: index("qotd_date_idx").on(table.date),
  }),
);

export const scheduledNotifications = pgTable(
  "scheduled_notifications",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .references(() => users.id, { onDelete: "cascade" }),
    questionId: uuid("question_id")
      .references(() => questions.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    sendAt: timestamp("send_at", { withTimezone: true }).notNull(),
    sent: boolean("sent").default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    sendAtIdx: index("scheduled_notif_send_at_idx").on(table.sendAt),
  }),
);

export const waitlist = pgTable("waitlist", {
  id: uuid("id").defaultRandom().primaryKey(),
  email: text("email").notNull().unique(),
  source: text("source").default("website").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});
