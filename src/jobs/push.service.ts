import { Injectable } from "@nestjs/common";
import { and, count, eq, gte, inArray, isNull, not } from "drizzle-orm";

import { DatabaseService } from "../common/database/database.service";
import { notificationLog, users } from "../db/schema";

export type PushPayload = {
  title: string;
  body: string;
  data?: Record<string, string>;
};

const EXEMPT_TYPES = ["first_vote", "expiry_warning", "result_ready"];

@Injectable()
export class PushService {
  constructor(private readonly databaseService: DatabaseService) {}

  private get db() {
    return this.databaseService.db;
  }

  // ─── Rate limit: max 2 non-exempt notifications per user per calendar day ───

  async canSendNotification(userId: string, notificationType: string): Promise<boolean> {
    if (EXEMPT_TYPES.includes(notificationType)) return true;

    const todayStart = new Date();
    todayStart.setUTCHours(0, 0, 0, 0);

    const [result] = await this.db
      .select({ value: count() })
      .from(notificationLog)
      .where(
        and(
          eq(notificationLog.userId, userId),
          gte(notificationLog.sentAt, todayStart),
          not(inArray(notificationLog.type, EXEMPT_TYPES)),
        ),
      );

    return (result?.value ?? 0) < 2;
  }

  // ─── Quiet hours: 10pm–7am local time ───────────────────────────────────────

  isQuietHours(timezoneOffsetMinutes: number): boolean {
    const utcNow = new Date();
    const localHour = ((utcNow.getUTCHours() * 60 + utcNow.getUTCMinutes() + timezoneOffsetMinutes) / 60 + 48) % 24;
    return localHour >= 22 || localHour < 7;
  }

  // ─── Churn check: no activity in 30 days ────────────────────────────────────

  async isChurned(userId: string): Promise<boolean> {
    const rows = await this.db
      .select({ lastActiveAt: users.lastActiveAt })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    const lastActive = rows[0]?.lastActiveAt;
    if (!lastActive) return true;

    const daysSinceActive = (Date.now() - lastActive.getTime()) / (1000 * 60 * 60 * 24);
    return daysSinceActive >= 30;
  }

  // ─── De-duplication check ───────────────────────────────────────────────────

  async alreadySent(userId: string, questionId: string | null, type: string): Promise<boolean> {
    if (!questionId) return false;

    const [result] = await this.db
      .select({ value: count() })
      .from(notificationLog)
      .where(
        and(
          eq(notificationLog.userId, userId),
          eq(notificationLog.questionId, questionId),
          eq(notificationLog.type, type),
        ),
      );

    return (result?.value ?? 0) > 0;
  }

  // ─── Log a sent notification ─────────────────────────────────────────────────

  async logNotification(userId: string, questionId: string | null, type: string): Promise<void> {
    try {
      await this.db
        .insert(notificationLog)
        .values({
          userId,
          questionId: questionId ?? null,
          type,
          sentAt: new Date(),
        })
        .onConflictDoNothing();
    } catch {
      // Non-fatal — log failures should not disrupt the flow
    }
  }

  // ─── Core send: full guard chain + Expo push ─────────────────────────────────

  async sendPushToUser(
    userId: string,
    payload: PushPayload,
    notificationType: string,
    questionId?: string | null,
    options: { exempt?: boolean } = {},
  ): Promise<boolean> {
    const isExempt = options.exempt ?? EXEMPT_TYPES.includes(notificationType);

    // Get user record
    const userRows = await this.db
      .select({
        pushToken: users.pushToken,
        timezoneOffset: users.timezoneOffset,
        isBanned: users.isBanned,
      })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    const user = userRows[0];
    if (!user?.pushToken || user.isBanned) return false;

    // Churn check
    if (await this.isChurned(userId)) return false;

    // Quiet hours check
    if (this.isQuietHours(user.timezoneOffset ?? 0)) return false;

    // Daily cap check (skip for exempt types)
    if (!isExempt && !(await this.canSendNotification(userId, notificationType))) return false;

    // De-duplication check
    const qId = questionId ?? null;
    if (qId && (await this.alreadySent(userId, qId, notificationType))) return false;

    // Send via Expo Push API
    try {
      const response = await fetch("https://exp.host/--/api/v2/push/send", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Accept-Encoding": "gzip, deflate" },
        body: JSON.stringify({
          to: user.pushToken,
          title: payload.title,
          body: payload.body,
          data: payload.data ?? {},
          sound: "default",
          priority: "high",
        }),
      });

      if (!response.ok) return false;
    } catch {
      return false;
    }

    // Log the notification
    await this.logNotification(userId, qId, notificationType);
    return true;
  }

  // ─── Notification copy helpers ───────────────────────────────────────────────

  getMilestoneNotification(
    milestone: number,
    yesPercent: number,
  ): { title: string; body: string } {
    const noPercent = 100 - yesPercent;
    const isClose = yesPercent >= 44 && yesPercent <= 56;
    const isDominantYes = yesPercent > 74;
    const isDominantNo = yesPercent < 26;

    if (isClose) {
      return {
        title: "It's neck and neck 🔥",
        body: `${milestone.toLocaleString()} people voted and it's almost exactly 50/50. This one could go either way.`,
      };
    }
    if (isDominantYes) {
      return {
        title: "The crowd is decided.",
        body: `${yesPercent}% of ${milestone.toLocaleString()} people said YES. The verdict is coming in strong.`,
      };
    }
    if (isDominantNo) {
      return {
        title: "The crowd is decided.",
        body: `${noPercent}% of ${milestone.toLocaleString()} people said NO. The verdict is coming in strong.`,
      };
    }
    return {
      title: `${milestone.toLocaleString()} votes and counting 📊`,
      body: `${yesPercent}% say YES so far. Tap to see the breakdown.`,
    };
  }

  getResultNotification(yesPercent: number, totalVotes: number): { title: string; body: string } {
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
}
