import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from "@nestjs/common";
import { and, count, desc, eq, gt, inArray, lt, ne, or, sql } from "drizzle-orm";
import { randomUUID } from "crypto";
import { createCanvas } from "@napi-rs/canvas";

import { DatabaseService } from "../common/database/database.service";
import { withTransientDatabaseRetry } from "../common/database/transient-database.util";
import { CurrentUserService } from "../common/current-user.service";
import { RequestWithDevice } from "../common/types/request-with-device.interface";
import { questions, reports, scheduledNotifications, shares, votes } from "../db/schema";
import { RedisService } from "../lib/redis.service";
import { NotificationTriggersService } from "../jobs/notification-triggers.service";
import { ContentFilterService } from "./content-filter.service";
import { CreateQuestionDto } from "./dto/create-question.dto";
import { ReportDto } from "./dto/report.dto";
import { ShareDto } from "./dto/share.dto";
import { VoteDto } from "./dto/vote.dto";

const AUTO_FLAG_THRESHOLD = 3;

@Injectable()
export class QuestionsService {
  constructor(
    private readonly contentFilterService: ContentFilterService,
    private readonly currentUserService: CurrentUserService,
    private readonly databaseService: DatabaseService,
    private readonly redisService: RedisService,
    private readonly notificationTriggersService: NotificationTriggersService,
  ) {}

  private get db() {
    return this.databaseService.db;
  }

  async getFeed(
    request: RequestWithDevice,
    category?: string,
    sort: "recent" | "hot" = "recent",
    cursor?: string,
    limit = 20,
    language?: string,
  ) {
    return withTransientDatabaseRetry(async () => {
      const currentUser = await this.currentUserService.getById(request.userId);
      const safeLimit = Number.isFinite(limit) ? Math.max(1, Math.min(limit, 50)) : 20;

      const baseWhere = [eq(questions.status, "active")];
      if (category) {
        baseWhere.push(eq(questions.category, category));
      }

      let questionRows: (typeof questions.$inferSelect)[];
      let nextCursor: string | null = null;

      if (sort === "hot") {
        const since = new Date(Date.now() - 48 * 60 * 60 * 1000);
        const hotWhere = [...baseWhere, gt(questions.createdAt, since)];

        // Two-pass language priority: 15 in user's language + 5 in other language
        let rows: (typeof questions.$inferSelect)[];
        if (language) {
          const otherLang = language === "fr" ? "en" : "fr";
          const [langRows, otherRows] = await Promise.all([
            this.db.select().from(questions).where(and(...hotWhere, eq(questions.language, language))).orderBy(desc(questions.createdAt)).limit(100),
            this.db.select().from(questions).where(and(...hotWhere, eq(questions.language, otherLang))).orderBy(desc(questions.createdAt)).limit(50),
          ]);
          const now = Date.now();
          const scored = (arr: (typeof questions.$inferSelect)[]) =>
            arr.map((row) => {
              const totalVotes = row.yesCount + row.noCount;
              const ageHours = Math.max((now - row.createdAt.getTime()) / (1000 * 60 * 60), 0.1);
              const baseScore = totalVotes / Math.pow(ageHours, 1.5);
              // Freshness boost: linearly decays from 3x at 0 min to 1x at 90 min
              const freshMinutes = ageHours * 60;
              const freshnessMultiplier = freshMinutes < 90 ? 3 - (2 * freshMinutes / 90) : 1;
              return { row, score: baseScore * freshnessMultiplier };
            }).sort((a, b) => b.score - a.score);
          const topLang = scored(langRows).slice(0, 15).map((e) => e.row);
          const topOther = scored(otherRows).slice(0, 5).map((e) => e.row);
          rows = [...topLang, ...topOther];
        } else {
          rows = await this.db.select().from(questions).where(and(...hotWhere)).orderBy(desc(questions.createdAt)).limit(100);
          const now = Date.now();
          rows = rows
            .map((row) => {
              const totalVotes = row.yesCount + row.noCount;
              const ageHours = Math.max((now - row.createdAt.getTime()) / (1000 * 60 * 60), 0.1);
              const baseScore = totalVotes / Math.pow(ageHours, 1.5);
              const freshMinutes = ageHours * 60;
              const freshnessMultiplier = freshMinutes < 90 ? 3 - (2 * freshMinutes / 90) : 1;
              return { row, score: baseScore * freshnessMultiplier };
            })
            .sort((a, b) => b.score - a.score)
            .slice(0, safeLimit)
            .map((entry) => entry.row);
        }
        questionRows = rows;
      } else {
        const whereClause = cursor
          ? and(...baseWhere, lt(questions.createdAt, new Date(cursor)))
          : and(...baseWhere);

        const rows = await this.db
          .select()
          .from(questions)
          .where(whereClause)
          .orderBy(desc(questions.createdAt))
          .limit(safeLimit + 1);

        const hasMore = rows.length > safeLimit;
        questionRows = hasMore ? rows.slice(0, safeLimit) : rows;
        nextCursor = hasMore
          ? (questionRows[questionRows.length - 1]?.createdAt?.toISOString() ?? null)
          : null;
      }

      const userVoteMap = await this.loadUserVotes(
        currentUser.id,
        questionRows.map((r) => r.id),
      );

      // Fetch trending IDs from Redis (top 5)
      let trendingIds: Set<string> = new Set();
      try {
        const redis = this.redisService.getClient();
        const ids = await redis.zrange("trending:questions", 0, 4, { rev: true });
        trendingIds = new Set(ids.filter((id): id is string => typeof id === "string"));
      } catch {
        // Non-fatal — trending badge is cosmetic
      }

      return {
        questions: questionRows.map((row) =>
          this.toQuestionResponse(row, currentUser.id, userVoteMap.get(row.id) ?? null, trendingIds.has(row.id)),
        ),
        next_cursor: nextCursor,
      };
    }, {
      label: "QuestionsService.getFeed",
    });
  }

  async getQuestionById(questionId: string, request: RequestWithDevice) {
    return withTransientDatabaseRetry(async () => {
      const currentUser = await this.currentUserService.getById(request.userId);

      const rows = await this.db
        .select()
        .from(questions)
        .where(and(eq(questions.id, questionId), ne(questions.status, "deleted")))
        .limit(1);

      if (rows.length === 0) {
        throw new NotFoundException({ error: "not_found" });
      }

      const voteMap = await this.loadUserVotes(currentUser.id, [questionId]);
      return this.toQuestionResponse(rows[0], currentUser.id, voteMap.get(questionId) ?? null, false);
    }, {
      label: "QuestionsService.getQuestionById",
    });
  }

  async createQuestion(createQuestionDto: CreateQuestionDto, request: RequestWithDevice) {
    const currentUser = await this.currentUserService.getById(request.userId);
    const filterResult = await this.contentFilterService.evaluate(createQuestionDto.text);

    if (filterResult.status === "blocked") {
      throw new BadRequestException({
        error: "content_violation",
        message: "This question can't be posted.",
      });
    }

    if (filterResult.status === "wellbeing_redirect") {
      throw new BadRequestException({
        error: "wellbeing_redirect",
        message: "It sounds like you might be going through something hard. You're not alone.",
        crisis_resources: filterResult.resources,
      });
    }

    const expiresAt = new Date(Date.now() + createQuestionDto.duration_hours * 60 * 60 * 1000);

    // Silently shadow-drop banned users
    if (currentUser.is_banned) {
      return {
        question: {
          id: randomUUID(),
          text: createQuestionDto.text,
          category: createQuestionDto.category,
          yes_count: 0,
          no_count: 0,
          yes_percent: 0,
          total_votes: 0,
          expires_at: expiresAt.toISOString(),
          created_at: new Date().toISOString(),
          user_voted: null,
          is_own: true,
        },
      };
    }

    const [inserted] = await this.db
      .insert(questions)
      .values({
        userId: currentUser.id,
        text: createQuestionDto.text,
        category: createQuestionDto.category,
        language: createQuestionDto.language ?? "en",
        expiresAt,
      })
      .returning();

    if (!inserted) {
      throw new InternalServerErrorException("Failed to create question");
    }

    // Schedule expiry warning (1 hour before expiry)
    const expiryWarningAt = new Date(expiresAt.getTime() - 60 * 60 * 1000);
    if (expiryWarningAt > new Date()) {
      void this.db.insert(scheduledNotifications).values({
        userId: currentUser.id,
        questionId: inserted.id,
        type: "expiry_warning",
        sendAt: expiryWarningAt,
      }).catch((err: unknown) => {
        console.error("[questions] Failed to schedule expiry warning", err instanceof Error ? err.message : err);
      });
    }

    return { question: this.toQuestionResponse(inserted, currentUser.id, null, false) };
  }

  async vote(questionId: string, voteDto: VoteDto, request: RequestWithDevice) {
    const currentUser = await this.currentUserService.getById(request.userId);
    const hardwareDeviceId = (request.headers["x-hardware-id"] as string | undefined) ?? null;
    const browserId = (request.headers["x-browser-id"] as string | undefined) ?? null;

    const questionRows = await this.db
      .select({ id: questions.id, status: questions.status })
      .from(questions)
      .where(eq(questions.id, questionId))
      .limit(1);

    if (questionRows.length === 0) {
      throw new NotFoundException({ error: "not_found" });
    }

    if (questionRows[0].status !== "active") {
      throw new BadRequestException({ error: "question_closed" });
    }

    const existingVote = await this.db
      .select({ id: votes.id })
      .from(votes)
      .where(and(eq(votes.questionId, questionId), eq(votes.userId, currentUser.id)))
      .limit(1);

    if (existingVote.length > 0) {
      throw new ConflictException({ error: "already_voted" });
    }

    // Hardware device dedup — prevents voting from a different account on the same device
    if (hardwareDeviceId) {
      const existingHardwareVote = await this.db
        .select({ id: votes.id })
        .from(votes)
        .where(and(eq(votes.questionId, questionId), eq(votes.hardwareDeviceId, hardwareDeviceId)))
        .limit(1);
      if (existingHardwareVote.length > 0) {
        throw new ConflictException({ error: "already_voted" });
      }
    }

    // Browser fingerprint dedup — web clients
    if (browserId) {
      const existingBrowserVote = await this.db
        .select({ id: votes.id })
        .from(votes)
        .where(and(eq(votes.questionId, questionId), eq(votes.browserId, browserId)))
        .limit(1);
      if (existingBrowserVote.length > 0) {
        throw new ConflictException({ error: "already_voted" });
      }
    }

    const updated = await this.db.transaction(async (tx) => {
      await tx.insert(votes).values({
        questionId,
        userId: currentUser.id,
        vote: voteDto.vote,
        hardwareDeviceId,
        browserId,
      });

      const increment =
        voteDto.vote === "yes"
          ? { yesCount: sql<number>`yes_count + 1` }
          : { noCount: sql<number>`no_count + 1` };

      const [row] = await tx
        .update(questions)
        .set(increment)
        .where(eq(questions.id, questionId))
        .returning({ yesCount: questions.yesCount, noCount: questions.noCount });

      return row;
    });

    if (!updated) {
      throw new InternalServerErrorException("Vote counter update failed");
    }

    const yesCount = updated.yesCount;
    const noCount = updated.noCount;
    const totalVotes = yesCount + noCount;

    // Fire notification triggers non-blockingly (never delay the vote response)
    const fullQuestionRows = await this.db
      .select()
      .from(questions)
      .where(eq(questions.id, questionId))
      .limit(1);

    if (fullQuestionRows[0]) {
      setImmediate(() => {
        this.notificationTriggersService
          .triggerVoteNotifications(fullQuestionRows[0])
          .catch((err: unknown) => {
            console.error("[questions] triggerVoteNotifications failed", err instanceof Error ? err.message : err);
          });
      });
    }

    return {
      yes_count: yesCount,
      no_count: noCount,
      yes_percent: totalVotes > 0 ? Math.round((yesCount / totalVotes) * 100) : 0,
      user_vote: voteDto.vote,
    };
  }

  async logShare(questionId: string, shareDto: ShareDto, request: RequestWithDevice) {
    const currentUser = await this.currentUserService.getById(request.userId);

    try {
      await this.db.insert(shares).values({
        questionId,
        userId: currentUser.id,
        shareType: shareDto.share_type,
      });

      // Increment share_count on the question (non-fatal if it fails)
      await this.db
        .update(questions)
        .set({ shareCount: sql`share_count + 1` })
        .where(eq(questions.id, questionId));
    } catch (err: unknown) {
      const pgError = err as { code?: string };
      if (pgError.code !== "23505") {
        // Ignore duplicate share logs — sharing the same way is fine
        console.error("[questions] logShare failed", err instanceof Error ? err.message : err);
      }
    }

    return { logged: true };
  }

  async report(questionId: string, reportDto: ReportDto, request: RequestWithDevice) {
    const currentUser = await this.currentUserService.getById(request.userId);

    if (currentUser.is_banned) {
      throw new HttpException({ error: "forbidden" }, HttpStatus.FORBIDDEN);
    }

    try {
      await this.db.insert(reports).values({
        questionId,
        reporterId: currentUser.id,
        reason: reportDto.reason,
      });
    } catch (err: unknown) {
      const pgError = err as { code?: string };
      if (pgError.code !== "23505") {
        throw new InternalServerErrorException("Failed to submit report");
      }
    }

    const [{ value: reportCount }] = await this.db
      .select({ value: count() })
      .from(reports)
      .where(eq(reports.questionId, questionId));

    if (reportCount >= AUTO_FLAG_THRESHOLD) {
      await this.db
        .update(questions)
        .set({ status: "flagged" })
        .where(and(eq(questions.id, questionId), eq(questions.status, "active")));
    }

    return { reported: true };
  }

  async shareCardPng(questionId: string) {
    return withTransientDatabaseRetry(async () => {
      const rows = await this.db
        .select({
          text: questions.text,
          category: questions.category,
          yesCount: questions.yesCount,
          noCount: questions.noCount,
        })
        .from(questions)
        .where(eq(questions.id, questionId))
        .limit(1);

      if (rows.length === 0) {
        throw new NotFoundException({ error: "not_found" });
      }

      const row = rows[0];
      const totalVotes = row.yesCount + row.noCount;
      const yesPercent = totalVotes > 0 ? Math.round((row.yesCount / totalVotes) * 100) : 0;
      const noPercent = 100 - yesPercent;

      const width = 1200;
      const height = 630;
      const canvas = createCanvas(width, height);
      const ctx = canvas.getContext("2d");

      const backgroundGradient = ctx.createLinearGradient(0, 0, width, height);
      backgroundGradient.addColorStop(0, "#FFFBEF");
      backgroundGradient.addColorStop(0.55, "#FFF2C5");
      backgroundGradient.addColorStop(1, "#FFE7A5");
      ctx.fillStyle = backgroundGradient;
      ctx.fillRect(0, 0, width, height);

      ctx.fillStyle = "rgba(255, 247, 220, 0.72)";
      ctx.fillRect(50, 48, width - 100, height - 96);

      ctx.fillStyle = "rgba(244, 196, 48, 0.34)";
      ctx.fillRect(50, 48, width - 100, 8);

      ctx.fillStyle = "#7A5A03";
      ctx.font = "700 35px 'Trebuchet MS', 'Helvetica Neue', Arial, sans-serif";
      ctx.fillText("SHOULD I?", 90, 120);

      ctx.fillStyle = "#2B2102";
      ctx.font = "700 56px 'Trebuchet MS', 'Helvetica Neue', Arial, sans-serif";
      const wrappedQuestion = this.wrapText(ctx, row.text, width - 180);
      let y = 196;
      for (const line of wrappedQuestion.slice(0, 3)) {
        ctx.fillText(line, 90, y);
        y += 68;
      }

      ctx.fillStyle = "#7A6320";
      ctx.font = "600 24px 'Trebuchet MS', 'Helvetica Neue', Arial, sans-serif";
      ctx.fillText(`Category: ${row.category}`, 90, y + 8);

      const barX = 90;
      const barY = 438;
      const barWidth = width - 180;
      const barHeight = 32;

      ctx.fillStyle = "#F2DE9E";
      ctx.fillRect(barX, barY, barWidth, barHeight);

      const yesWidth = Math.round((yesPercent / 100) * barWidth);
      ctx.fillStyle = "#22C55E";
      ctx.fillRect(barX, barY, yesWidth, barHeight);

      ctx.fillStyle = "#EF4444";
      ctx.fillRect(barX + yesWidth, barY, Math.max(0, barWidth - yesWidth), barHeight);

      ctx.fillStyle = "#2B2102";
      ctx.font = "700 30px 'Trebuchet MS', 'Helvetica Neue', Arial, sans-serif";
      ctx.fillText(`YES ${yesPercent}%`, barX, 510);
      ctx.fillText(`NO ${noPercent}%`, barX + 260, 510);

      ctx.fillStyle = "#7A6320";
      ctx.font = "600 22px 'Trebuchet MS', 'Helvetica Neue', Arial, sans-serif";
      ctx.fillText(`${totalVotes} total votes`, barX, 554);
      ctx.fillText("shouldi.app", width - 210, 554);

      return canvas.toBuffer("image/png");
    }, {
      label: "QuestionsService.shareCardPng",
    });
  }

  private wrapText(ctx: { measureText: (value: string) => { width: number } }, text: string, maxWidth: number) {
    const words = text.split(/\s+/).filter(Boolean);
    const lines: string[] = [];
    let current = "";

    for (const word of words) {
      const next = current ? `${current} ${word}` : word;
      if (ctx.measureText(next).width <= maxWidth) {
        current = next;
      } else {
        if (current) {
          lines.push(current);
        }
        current = word;
      }
    }

    if (current) {
      lines.push(current);
    }

    return lines.length > 0 ? lines : [text.slice(0, 100)];
  }

  private async loadUserVotes(userId: string, questionIds: string[]) {
    const voteMap = new Map<string, "yes" | "no">();
    if (questionIds.length === 0) return voteMap;

    const rows = await this.db
      .select({ questionId: votes.questionId, vote: votes.vote })
      .from(votes)
      .where(and(eq(votes.userId, userId), inArray(votes.questionId, questionIds)));

    for (const row of rows) {
      voteMap.set(row.questionId, row.vote);
    }

    return voteMap;
  }

  private toQuestionResponse(
    question: typeof questions.$inferSelect,
    currentUserId: string,
    userVote: "yes" | "no" | null,
    isTrending = false,
  ) {
    const totalVotes = question.yesCount + question.noCount;
    const yesPercent = totalVotes > 0 ? Math.round((question.yesCount / totalVotes) * 100) : 0;

    return {
      id: question.id,
      text: question.text,
      category: question.category,
      yes_count: question.yesCount,
      no_count: question.noCount,
      yes_percent: yesPercent,
      total_votes: totalVotes,
      expires_at: question.expiresAt.toISOString(),
      created_at: question.createdAt.toISOString(),
      user_voted: userVote,
      is_own: question.userId === currentUserId,
      is_trending: isTrending,
      language: question.language,
    };
  }
}
