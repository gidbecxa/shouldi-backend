import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { and, desc, eq, lt } from "drizzle-orm";

import { DatabaseService } from "../common/database/database.service";
import { RequestWithDevice } from "../common/types/request-with-device.interface";
import { CurrentUserService } from "../common/current-user.service";
import { takes, votes } from "../db/schema";

@Injectable()
export class TakesService {
  constructor(
    private readonly databaseService: DatabaseService,
    private readonly currentUserService: CurrentUserService,
  ) {}

  private get db() {
    return this.databaseService.db;
  }

  async getTakes(questionId: string, cursor?: string, limit = 20) {
    const safeLimit = Math.max(1, Math.min(limit, 50));

    const query = this.db
      .select({
        id: takes.id,
        vote: takes.vote,
        content: takes.content,
        created_at: takes.createdAt,
      })
      .from(takes)
      .where(
        cursor
          ? and(eq(takes.questionId, questionId), eq(takes.status, "active"), lt(takes.createdAt, new Date(cursor)))
          : and(eq(takes.questionId, questionId), eq(takes.status, "active")),
      )
      .orderBy(desc(takes.createdAt))
      .limit(safeLimit + 1);

    const rows = await query;
    const hasMore = rows.length > safeLimit;
    const items = hasMore ? rows.slice(0, safeLimit) : rows;

    return {
      takes: items.map((r) => ({
        id: r.id,
        vote: r.vote,
        content: r.content,
        created_at: r.created_at.toISOString(),
      })),
      next_cursor: hasMore ? (items[items.length - 1]?.created_at.toISOString() ?? null) : null,
    };
  }

  async createTake(questionId: string, content: string, request: RequestWithDevice) {
    const currentUser = await this.currentUserService.getById(request.userId);

    // Verify the user has voted on this question
    const voteRows = await this.db
      .select({ vote: votes.vote })
      .from(votes)
      .where(and(eq(votes.questionId, questionId), eq(votes.userId, currentUser.id)))
      .limit(1);

    if (voteRows.length === 0) {
      throw new ForbiddenException({ error: "must_vote_first", message: "You must vote before leaving a take." });
    }

    const userVote = voteRows[0].vote;

    // Check for existing take
    const existing = await this.db
      .select({ id: takes.id })
      .from(takes)
      .where(and(eq(takes.questionId, questionId), eq(takes.userId, currentUser.id)))
      .limit(1);

    if (existing.length > 0) {
      throw new ConflictException({ error: "already_took" });
    }

    const [take] = await this.db
      .insert(takes)
      .values({
        questionId,
        userId: currentUser.id,
        vote: userVote,
        content: content.trim(),
      })
      .returning({
        id: takes.id,
        vote: takes.vote,
        content: takes.content,
        createdAt: takes.createdAt,
      });

    if (!take) {
      throw new NotFoundException({ error: "insert_failed" });
    }

    return {
      take: {
        id: take.id,
        vote: take.vote,
        content: take.content,
        created_at: take.createdAt.toISOString(),
      },
    };
  }

  async deleteTake(takeId: string, request: RequestWithDevice) {
    const currentUser = await this.currentUserService.getById(request.userId);

    await this.db
      .update(takes)
      .set({ status: "deleted" })
      .where(and(eq(takes.id, takeId), eq(takes.userId, currentUser.id)));

    return { deleted: true };
  }

  async reportTake(takeId: string) {
    await this.db
      .update(takes)
      .set({ status: "flagged" })
      .where(eq(takes.id, takeId));

    return { reported: true };
  }
}
