import { Injectable } from "@nestjs/common";
import { and, eq, gte, inArray, isNotNull, not } from "drizzle-orm";

import { DatabaseService } from "../common/database/database.service";
import { notificationLog, questions, users } from "../db/schema";
import { RedisService } from "./redis.service";

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";

// Notification types that don't count toward the daily 2-notification cap
const DEFAULT_EXEMPT_TYPES = ["first_vote", "expiry_warning", "result_ready"];

export type PushPayload = {
  title: string;
  body: string;
  data?: Record<string, string>;
};

type TrendingQuestion = {
  id: string;
  text: string;
  category: string;
  yesCount: number;
  noCount: number;
};

@Injectable()
export class PushService {
  constructor(
    private readonly databaseService: DatabaseService,
    private readonly redisService: RedisService,
  ) {}

  private get db() {
    return this.databaseService.db;
  }

  // ─── Quiet-hours guard ────────────────────────────────────────────────────

  isQuietHours(timezoneOffsetMinutes: number): boolean {
    const utcNow = new Date();
    const localHour = ((utcNow.getUTCHours() + timezoneOffsetMinutes / 60) % 24 + 24) % 24;
    // Quiet: 22:00–07:00 local time
    return localHour >= 22 || localHour < 7;
  }

  // ─── Churn guard ──────────────────────────────────────────────────────────

  async isChurned(userId: string): Promise<boolean> {
    const rows = await this.db
      .select({ lastActiveAt: users.lastActiveAt })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    const lastActiveAt = rows[0]?.lastActiveAt;
    if (!lastActiveAt) return true;

    const daysSinceActive = (Date.now() - lastActiveAt.getTime()) / (1000 * 60 * 60 * 24);
    return daysSinceActive >= 30;
  }

  // ─── Daily cap guard ──────────────────────────────────────────────────────

  async canSendNotification(
    userId: string,
    exemptTypes: string[] = DEFAULT_EXEMPT_TYPES,
  ): Promise<boolean> {
    const todayStart = new Date();
    todayStart.setUTCHours(0, 0, 0, 0);

    const sent = await this.db
      .select({ id: notificationLog.id })
      .from(notificationLog)
      .where(
        and(
          eq(notificationLog.userId, userId),
          gte(notificationLog.sentAt, todayStart),
          not(inArray(notificationLog.type, exemptTypes)),
        ),
      );

    return sent.length < 2;
  }

  // ─── Core send ────────────────────────────────────────────────────────────

  async sendPushToUser(
    userId: string,
    payload: PushPayload,
    notificationType: string,
    questionId?: string,
    options: { exempt?: boolean } = {},
  ): Promise<boolean> {
    // Fetch user push token, timezone, ban status
    const userRows = await this.db
      .select({
        pushToken: users.pushToken,
        timezoneOffset: users.timezoneOffset,
        isBanned: users.isBanned,
        lastActiveAt: users.lastActiveAt,
      })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    const user = userRows[0];
    if (!user?.pushToken || user.isBanned) return false;

    // Churn check
    if (user.lastActiveAt) {
      const daysSince = (Date.now() - user.lastActiveAt.getTime()) / (1000 * 60 * 60 * 24);
      if (daysSince >= 30) return false;
    } else {
      return false;
    }

    // Quiet hours check
    if (this.isQuietHours(user.timezoneOffset ?? 0)) return false;

    // Daily cap check (unless exempt)
    if (!options.exempt && !(await this.canSendNotification(userId))) return false;

    // De-duplication check (per question+type)
    if (questionId) {
      const existing = await this.db
        .select({ id: notificationLog.id })
        .from(notificationLog)
        .where(
          and(
            eq(notificationLog.userId, userId),
            eq(notificationLog.questionId, questionId),
            eq(notificationLog.type, notificationType),
          ),
        )
        .limit(1);

      if (existing.length > 0) return false;
    }

    // Send via Expo Push API
    const expoPushResponse = await fetch(EXPO_PUSH_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        to: user.pushToken,
        title: payload.title,
        body: payload.body,
        data: payload.data ?? {},
        sound: "default",
        priority: "high",
      }),
    });

    if (!expoPushResponse.ok) {
      console.error("[push] Expo push failed", await expoPushResponse.text());
      return false;
    }

    // Log the notification
    try {
      await this.db.insert(notificationLog).values({
        userId,
        questionId: questionId ?? null,
        type: notificationType,
        sentAt: new Date(),
      });
    } catch {
      // Unique constraint violation means it was already sent — treat as success
    }

    return true;
  }

  // ─── Notification copy generators ─────────────────────────────────────────

  getMilestoneNotification(
    milestone: number,
    yesPercent: number,
  ): PushPayload {
    const noPercent = 100 - yesPercent;
    const isClose = yesPercent >= 44 && yesPercent <= 56;
    const isDominant = yesPercent > 74 || yesPercent < 26;
    const dominantSide = yesPercent > 50 ? "YES" : "NO";
    const dominantPercent = dominantSide === "YES" ? yesPercent : noPercent;

    if (isClose) {
      return {
        title: "It's neck and neck 🔥",
        body: `${milestone.toLocaleString()} people voted and it's almost exactly 50/50. This one could go either way.`,
      };
    }
    if (isDominant) {
      return {
        title: "The crowd is decided.",
        body: `${dominantPercent}% of ${milestone.toLocaleString()} people said ${dominantSide}. The verdict is coming in strong.`,
      };
    }
    return {
      title: `${milestone.toLocaleString()} votes and counting 📊`,
      body: `${yesPercent}% say YES so far. Tap to see the breakdown.`,
    };
  }

  getResultNotification(yesPercent: number, totalVotes: number): PushPayload {
    const noPercent = 100 - yesPercent;
    if (yesPercent > 70) {
      return {
        title: "The world said YES. 🟢",
        body: `${yesPercent}% of ${totalVotes.toLocaleString()} people think you should. Tap to see the full verdict and share it.`,
      };
    }
    if (yesPercent < 30) {
      return {
        title: "The world said NO. 🔴",
        body: `${noPercent}% said no — but ${yesPercent}% still believed in you. Tap to see the full result.`,
      };
    }
    return {
      title: "The world couldn't decide. 🤷",
      body: `It ended ${yesPercent}% YES / ${noPercent}% NO across ${totalVotes.toLocaleString()} votes. You're on your own with this one.`,
    };
  }

  // ─── Trending question helper ──────────────────────────────────────────────

  async getTopTrendingQuestion(): Promise<
    (TrendingQuestion & { totalVotes: number; yesPercent: number }) | null
  > {
    const redis = this.redisService.getClient();
    const topIds = await redis.zrange("trending:questions", 0, 0, { rev: true });

    if (!topIds || topIds.length === 0) return null;

    const topId = topIds[0] as string;
    const rows = await this.db
      .select({
        id: questions.id,
        text: questions.text,
        category: questions.category,
        yesCount: questions.yesCount,
        noCount: questions.noCount,
      })
      .from(questions)
      .where(and(eq(questions.id, topId), eq(questions.status, "active")))
      .limit(1);

    if (rows.length === 0) return null;

    const q = rows[0];
    const totalVotes = q.yesCount + q.noCount;
    const yesPercent = totalVotes > 0 ? Math.round((q.yesCount / totalVotes) * 100) : 0;

    return { ...q, totalVotes, yesPercent };
  }

  // ─── Top trending IDs (for feed is_trending marker) ────────────────────────

  async getTopTrendingIds(count = 5): Promise<string[]> {
    try {
      const redis = this.redisService.getClient();
      const ids = await redis.zrange("trending:questions", 0, count - 1, { rev: true });
      return (ids ?? []).filter((id): id is string => typeof id === "string");
    } catch {
      return [];
    }
  }
}
