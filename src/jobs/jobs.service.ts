import { Injectable } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { and, eq, gte, inArray, lte } from "drizzle-orm";

import { DatabaseService } from "../common/database/database.service";
import { RedisService } from "../lib/redis.service";
import { notificationLog, questions } from "../db/schema";

@Injectable()
export class JobsService {
  constructor(
    private readonly databaseService: DatabaseService,
    private readonly redisService: RedisService,
  ) {}

  private get db() {
    return this.databaseService.db;
  }

  @Cron(CronExpression.EVERY_5_MINUTES)
  async expireQuestions() {
    try {
      await this.db
        .update(questions)
        .set({ status: "closed" })
        .where(and(eq(questions.status, "active"), lte(questions.expiresAt, new Date())));
    } catch (err: unknown) {
      console.error("[jobs] expireQuestions failed", err instanceof Error ? err.message : err);
    }
  }

  @Cron(CronExpression.EVERY_5_MINUTES)
  async sendMilestones() {
    const since = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);

    try {
      const rows = await this.db
        .select()
        .from(questions)
        .where(and(gte(questions.createdAt, since), inArray(questions.status, ["active", "closed"])));

      for (const question of rows) {
        const totalVotes = question.yesCount + question.noCount;
        const types: string[] = [];

        if (totalVotes >= 10) types.push("milestone_10");
        if (totalVotes >= 50) types.push("milestone_50");
        if (totalVotes >= 100) types.push("milestone_100");
        if (question.status === "closed") types.push("result_ready");

        for (const type of types) {
          try {
            await this.db
              .insert(notificationLog)
              .values({ userId: question.userId, questionId: question.id, type })
              .onConflictDoNothing();
          } catch (err: unknown) {
            console.error("[jobs] sendMilestones log failed", err instanceof Error ? err.message : err);
          }
        }
      }
    } catch (err: unknown) {
      console.error("[jobs] sendMilestones failed", err instanceof Error ? err.message : err);
    }
  }

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
}
