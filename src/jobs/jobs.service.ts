import { Injectable } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { and, eq, gte, inArray, isNotNull, lte, ne, sql } from "drizzle-orm";

import { DatabaseService } from "../common/database/database.service";
import { RedisService } from "../lib/redis.service";
import { notificationLog, qotd, questions, scheduledNotifications, users, votes as votesTable } from "../db/schema";
import { PushService } from "./push.service";

const CATEGORY_EMOJIS: Record<string, string> = {
  Life: "🌍",
  Love: "❤️",
  Career: "💼",
  Money: "💰",
  Health: "💪",
  Fun: "😂",
  Other: "🤔",
};

@Injectable()
export class JobsService {
  constructor(
    private readonly databaseService: DatabaseService,
    private readonly redisService: RedisService,
    private readonly pushService: PushService,
  ) {}

  private get db() {
    return this.databaseService.db;
  }

  @Cron(CronExpression.EVERY_5_MINUTES)
  async expireQuestions() {
    try {
      const now = new Date();

      // Fetch questions that have just become expired and are still active
      const expired = await this.db
        .select()
        .from(questions)
        .where(and(eq(questions.status, "active"), lte(questions.expiresAt, now)));

      if (expired.length === 0) return;

      // Mark as closed
      await this.db
        .update(questions)
        .set({ status: "closed" })
        .where(
          and(
            eq(questions.status, "active"),
            lte(questions.expiresAt, now),
          ),
        );

      // Trigger result notifications after a 2-minute delay (creates anticipation)
      for (const question of expired) {
        setTimeout(() => {
          void this.sendResultNotification(question.id);
        }, 2 * 60 * 1000);
      }
    } catch (err: unknown) {
      console.error("[jobs] expireQuestions failed", err instanceof Error ? err.message : err);
    }
  }

  private async sendResultNotification(questionId: string): Promise<void> {
    try {
      const rows = await this.db
        .select()
        .from(questions)
        .where(eq(questions.id, questionId))
        .limit(1);

      const closedQ = rows[0];
      if (!closedQ) return;

      const totalVotes = closedQ.yesCount + closedQ.noCount;
      if (totalVotes === 0) return; // No votes — skip

      const yesPercent = Math.round((closedQ.yesCount / totalVotes) * 100);
      const copy = this.pushService.getResultNotification(yesPercent, totalVotes);

      await this.pushService.sendPushToUser(
        closedQ.userId,
        { ...copy, data: { questionId: closedQ.id, screen: "question_detail" } },
        "result_ready",
        closedQ.id,
        { exempt: true },
      );
    } catch (err: unknown) {
      console.error("[jobs] sendResultNotification failed", err instanceof Error ? err.message : err);
    }
  }

  // ── Scheduled Notifications (expiry warnings, etc.) — every 5 minutes ───────

  @Cron(CronExpression.EVERY_5_MINUTES)
  async sendScheduledNotifications() {
    try {
      const now = new Date();

      const due = await this.db
        .select({
          id: scheduledNotifications.id,
          userId: scheduledNotifications.userId,
          questionId: scheduledNotifications.questionId,
          type: scheduledNotifications.type,
          question: {
            id: questions.id,
            status: questions.status,
            yesCount: questions.yesCount,
            noCount: questions.noCount,
            expiresAt: questions.expiresAt,
          },
        })
        .from(scheduledNotifications)
        .leftJoin(questions, eq(scheduledNotifications.questionId, questions.id))
        .where(and(lte(scheduledNotifications.sendAt, now), eq(scheduledNotifications.sent, false)))
        .limit(50);

      for (const notif of due) {
        try {
          const q = notif.question;

          // Skip if question is gone or closed
          if (!q || q.status !== "active") {
            await this.db
              .update(scheduledNotifications)
              .set({ sent: true })
              .where(eq(scheduledNotifications.id, notif.id));
            continue;
          }

          const totalVotes = q.yesCount + q.noCount;

          // Expiry warning requires ≥10 votes
          if (notif.type === "expiry_warning" && totalVotes < 10) {
            await this.db
              .update(scheduledNotifications)
              .set({ sent: true })
              .where(eq(scheduledNotifications.id, notif.id));
            continue;
          }

          if (notif.type === "expiry_warning" && notif.userId) {
            await this.pushService.sendPushToUser(
              notif.userId,
              {
                title: "1 hour left ⏳",
                body: `Your question closes soon. ${totalVotes.toLocaleString()} people voted — share the result before it's gone.`,
                data: { questionId: q.id, screen: "question_detail" },
              },
              "expiry_warning",
              q.id,
              { exempt: true },
            );
          }
        } catch (innerErr: unknown) {
          console.error("[jobs] sendScheduledNotification item failed", innerErr instanceof Error ? innerErr.message : innerErr);
        }

        await this.db
          .update(scheduledNotifications)
          .set({ sent: true })
          .where(eq(scheduledNotifications.id, notif.id));
      }
    } catch (err: unknown) {
      console.error("[jobs] sendScheduledNotifications failed", err instanceof Error ? err.message : err);
    }
  }

  // ── Re-engagement — every 6 hours ───────────────────────────────────────────

  @Cron("0 */6 * * *")
  async sendReEngagement() {
    try {
      const trendingQuestion = await this.getTopTrendingQuestion();
      if (!trendingQuestion) return;

      const cutoff48h = new Date(Date.now() - 48 * 60 * 60 * 1000);
      const cutoff30d = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

      // Eligible: push token, not banned, idle 48h–30d
      const eligibleUsers = await this.db
        .select({ id: users.id, pushToken: users.pushToken, timezoneOffset: users.timezoneOffset })
        .from(users)
        .where(
          and(
            isNotNull(users.pushToken),
            eq(users.isBanned, false),
            lte(users.lastActiveAt, cutoff48h),
            gte(users.lastActiveAt, cutoff30d),
          ),
        )
        .limit(500);

      if (eligibleUsers.length === 0) return;

      // Exclude users who got a re_engage notification in the last 48h
      const userIds = eligibleUsers.map((u) => u.id);
      const recentNotifs = await this.db
        .select({ userId: notificationLog.userId })
        .from(notificationLog)
        .where(
          and(
            inArray(notificationLog.userId, userIds),
            eq(notificationLog.type, "re_engage"),
            gte(notificationLog.sentAt, cutoff48h),
          ),
        );

      const recentlyNotified = new Set(recentNotifs.map((n) => n.userId));
      const toNotify = eligibleUsers.filter(
        (u) => u.pushToken && !recentlyNotified.has(u.id),
      );

      const emoji = CATEGORY_EMOJIS[trendingQuestion.category] ?? "🤔";
      const truncated =
        trendingQuestion.text.length > 70
          ? trendingQuestion.text.slice(0, 70) + "…"
          : trendingQuestion.text;
      const totalVotes = trendingQuestion.yesCount + trendingQuestion.noCount;
      const yesPercent =
        totalVotes > 0 ? Math.round((trendingQuestion.yesCount / totalVotes) * 100) : 0;

      for (const user of toNotify) {
        if (this.pushService.isQuietHours(user.timezoneOffset ?? 0)) continue;

        await this.pushService.sendPushToUser(
          user.id,
          {
            title: `${emoji} People can't agree on this.`,
            body: `"${truncated}" — ${totalVotes.toLocaleString()} votes, ${yesPercent}% say YES.`,
            data: { screen: "feed" },
          },
          "re_engage",
          null,
          { exempt: false },
        );

        // Small delay to avoid batching too fast against Expo push service
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    } catch (err: unknown) {
      console.error("[jobs] sendReEngagement failed", err instanceof Error ? err.message : err);
    }
  }

  // ── QOTD — every hour (timezone-bucketed sends at 9:00 AM local) ─────────────

  @Cron("0 * * * *")
  async sendQotd() {
    try {
      const today = new Date().toISOString().split("T")[0];

      // Get or auto-create today's QOTD
      const qotdRows = await this.db
        .select({ questionId: qotd.questionId })
        .from(qotd)
        .where(eq(qotd.date, today!))
        .limit(1);

      let qotdQuestionId: string | null = qotdRows[0]?.questionId ?? null;

      if (!qotdQuestionId) {
        const top = await this.getTopTrendingQuestion();
        if (!top) return;

        await this.db
          .insert(qotd)
          .values({ questionId: top.id, date: today!, isManual: false })
          .onConflictDoNothing();

        qotdQuestionId = top.id;
      }

      const questionRows = await this.db
        .select()
        .from(questions)
        .where(eq(questions.id, qotdQuestionId))
        .limit(1);

      const question = questionRows[0];
      if (!question) return;

      const truncated =
        question.text.length > 80 ? question.text.slice(0, 80) + "…" : question.text;

      // Send to users for whom it's currently 9:00–9:59 AM local time
      const currentUTCHour = new Date().getUTCHours();
      // offset in minutes such that local hour = 9
      const targetOffsetMinutes = ((9 - currentUTCHour + 24) % 24) * 60;

      const eligibleUsers = await this.db
        .select({ id: users.id, pushToken: users.pushToken })
        .from(users)
        .where(
          and(
            isNotNull(users.pushToken),
            eq(users.isBanned, false),
            eq(users.timezoneOffset, targetOffsetMinutes),
          ),
        )
        .limit(1000);

      if (eligibleUsers.length === 0) return;

      const userIds = eligibleUsers.map((u) => u.id);
      const todayStart = `${today}T00:00:00Z`;

      // Exclude already-sent-today QOTD
      const alreadySentRows = await this.db
        .select({ userId: notificationLog.userId })
        .from(notificationLog)
        .where(
          and(
            inArray(notificationLog.userId, userIds),
            eq(notificationLog.type, "qotd"),
            gte(notificationLog.sentAt, new Date(todayStart)),
          ),
        );
      const alreadySentSet = new Set(alreadySentRows.map((r) => r.userId));

      // Exclude users who already voted on this QOTD question
      const alreadyVotedRows = await this.db
        .select({ userId: votesTable.userId })
        .from(votesTable)
        .where(
          and(
            inArray(votesTable.userId, userIds),
            eq(votesTable.questionId, question.id),
          ),
        );
      const alreadyVotedSet = new Set(alreadyVotedRows.map((r) => r.userId));

      const eligible = eligibleUsers.filter(
        (u) => u.pushToken && !alreadySentSet.has(u.id) && !alreadyVotedSet.has(u.id),
      );

      for (const user of eligible) {
        await this.pushService.sendPushToUser(
          user.id,
          {
            title: "Today's dilemma 🤔",
            body: `"${truncated}" — Vote now.`,
            data: { questionId: question.id, screen: "question_detail" },
          },
          "qotd",
          question.id,
          { exempt: false },
        );
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    } catch (err: unknown) {
      console.error("[jobs] sendQotd failed", err instanceof Error ? err.message : err);
    }
  }

  // ── Refresh live_stats materialized view — every 5 minutes ──────────────────

  @Cron(CronExpression.EVERY_5_MINUTES)
  async refreshStats() {
    try {
      await this.db.execute(sql`SELECT refresh_live_stats()`);
    } catch (err: unknown) {
      console.error("[jobs] refreshStats failed", err instanceof Error ? err.message : err);
    }
  }

  // ── Trending score update — every 5 minutes ─────────────────────────────────

  @Cron(CronExpression.EVERY_5_MINUTES)
  async updateTrending() {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

    try {
      const rows = await this.db
        .select({
          id: questions.id,
          yesCount: questions.yesCount,
          noCount: questions.noCount,
          createdAt: questions.createdAt,
        })
        .from(questions)
        .where(and(eq(questions.status, "active"), gte(questions.createdAt, since)))
        .limit(200);

      const now = Date.now();
      const ranked = rows
        .map((row) => {
          const totalVotes = row.yesCount + row.noCount;
          const ageHours = Math.max((now - row.createdAt.getTime()) / (1000 * 60 * 60), 1);
          const score = totalVotes / Math.pow(ageHours, 1.5);
          return { id: row.id, score };
        })
        .sort((a, b) => b.score - a.score)
        .slice(0, 20);

      if (ranked.length === 0) return;

      const scoreMembers = ranked.map((entry) => ({ score: entry.score, member: entry.id }));
      const [firstScoreMember, ...restScoreMembers] = scoreMembers;
      if (!firstScoreMember) return;

      const redis = this.redisService.getClient();
      await redis.del("trending:questions");
      await redis.zadd("trending:questions", firstScoreMember, ...restScoreMembers);
      await redis.expire("trending:questions", 300);
    } catch (err: unknown) {
      console.error("[jobs] updateTrending failed", err instanceof Error ? err.message : err);
    }
  }

  // ── Helper: get the current top trending question row ────────────────────────

  async getTopTrendingQuestion() {
    try {
      const redis = this.redisService.getClient();
      // zrange with REV gets highest-scored member first
      const ids = await redis.zrange("trending:questions", 0, 0, { rev: true });
      const topId = ids[0];

      if (!topId || typeof topId !== "string") return null;

      const rows = await this.db
        .select()
        .from(questions)
        .where(eq(questions.id, topId))
        .limit(1);

      return rows[0] ?? null;
    } catch {
      return null;
    }
  }
}
