import { Controller, Get } from "@nestjs/common";
import { sql } from "drizzle-orm";

import { DatabaseService } from "../common/database/database.service";
import { RedisService } from "../lib/redis.service";

@Controller("stats")
export class StatsController {
  constructor(
    private readonly databaseService: DatabaseService,
    private readonly redisService: RedisService,
  ) {}

  @Get("live")
  async getLiveStats() {
    const cacheKey = "stats:live";

    try {
      const redis = this.redisService.getClient();
      const cached = await redis.get<string>(cacheKey);
      if (cached) {
        const parsed = typeof cached === "string" ? (JSON.parse(cached) as unknown) : cached;
        return parsed;
      }
    } catch {
      // Fall through to DB if Redis unavailable
    }

    let result = { active_voters_last_hour: 0, votes_today: 0, questions_today: 0 };

    try {
      const rows = await this.databaseService.db.execute<{
        active_voters_last_hour: number;
        votes_today: number;
        questions_today: number;
      }>(sql`SELECT active_voters_last_hour, votes_today, questions_today FROM live_stats LIMIT 1`);

      const row = rows.rows[0];
      if (row) {
        result = {
          active_voters_last_hour: Number(row.active_voters_last_hour ?? 0),
          votes_today: Number(row.votes_today ?? 0),
          questions_today: Number(row.questions_today ?? 0),
        };
      }
    } catch {
      // Return zeros if view not yet populated
    }

    try {
      const redis = this.redisService.getClient();
      await redis.setex(cacheKey, 60, JSON.stringify(result));
    } catch {
      // Non-fatal cache write failure
    }

    return result;
  }

  @Get("today")
  async getTodayStats() {
    const cacheKey = "stats:today";

    try {
      const redis = this.redisService.getClient();
      const cached = await redis.get<string>(cacheKey);
      if (cached) {
        return typeof cached === "string" ? (JSON.parse(cached) as unknown) : cached;
      }
    } catch {
      // Fall through
    }

    let result = { votes_today: 0, questions_today: 0 };

    try {
      const rows = await this.databaseService.db.execute<{
        votes_today: number;
        questions_today: number;
      }>(sql`SELECT votes_today, questions_today FROM live_stats LIMIT 1`);

      const row = rows.rows[0];
      if (row) {
        result = {
          votes_today: Number(row.votes_today ?? 0),
          questions_today: Number(row.questions_today ?? 0),
        };
      }
    } catch {
      // Return zeros
    }

    try {
      const redis = this.redisService.getClient();
      await redis.setex(cacheKey, 60, JSON.stringify(result));
    } catch {
      // Non-fatal
    }

    return result;
  }
}
