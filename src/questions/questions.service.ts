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
import { encodeCursor, decodeCursor, buildCursorFromItem } from "../lib/feedCursor";
import { RedisService } from "../lib/redis.service";
import { SupabaseService } from "../lib/supabase.service";
import { NotificationTriggersService } from "../jobs/notification-triggers.service";
import { ContentFilterService } from "./content-filter.service";

/** Shape returned by the get_personalized_feed PostgreSQL function */
interface FeedRow {
  id: string;
  text: string;
  context: string | null;
  category: string;
  language: string;
  status: string;
  yes_count: number;
  no_count: number;
  total_votes: number;
  yes_percent: number;
  takes_count: number;
  expires_at: string;
  created_at: string;
  user_voted: "yes" | "no" | null;
  user_has_engaged: boolean;
  is_own: boolean;
  priority_tier: number;
  trending_score: number;
  is_trending: boolean;
}
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
    private readonly supabaseService: SupabaseService,
    private readonly notificationTriggersService: NotificationTriggersService,
  ) {}

  private get db() {
    return this.databaseService.db;
  }

  async getFeed(
    request: RequestWithDevice,
    category?: string,
    sort: "recent" | "hot" = "recent",
    cursorEncoded?: string,
    limit = 20,
    language?: string,
    fetchedAtParam?: string,
  ) {
    return withTransientDatabaseRetry(async () => {
      const currentUser = await this.currentUserService.getById(request.userId);
      const safeLimit = Number.isFinite(limit) ? Math.max(1, Math.min(limit, 50)) : 20;
      const userLanguage = language ?? "en";

      // Decode compound cursor (null = first page)
      const cursor = cursorEncoded ? decodeCursor(cursorEncoded) : null;

      // Feed session anchor: prevents page-shift when new questions arrive during browsing.
      // First page sets this; all subsequent pages send it back.
      const fetchedAt: string = cursor?.fetchedAt ?? fetchedAtParam ?? new Date().toISOString();

      // ── Call the personalized feed PostgreSQL function ─────────────────
      const supabase = this.supabaseService.getAdminClient();
      const { data, error } = await supabase.rpc("get_personalized_feed", {
        p_user_id:       currentUser.id,
        p_user_language: userLanguage,
        p_sort:          sort,
        p_limit:         safeLimit,
        p_cursor_tier:   cursor?.tier      ?? null,
        p_cursor_sort:   cursor?.sortValue ?? null,
        p_cursor_id:     cursor?.id        ?? null,
        p_fetched_at:    fetchedAt,
      });

      if (error) {
        console.error("[feed] get_personalized_feed error:", error);
        throw new InternalServerErrorException("feed_query_failed");
      }

      const rows = (data ?? []) as FeedRow[];

      // The SQL function returns limit+1 rows so we can detect hasMore cheaply.
      const hasMore = rows.length > safeLimit;
      const pageRows = hasMore ? rows.slice(0, safeLimit) : rows;

      // ── Build compound cursor from the last returned item ──────────────
      let nextCursor: string | null = null;
      if (hasMore && pageRows.length > 0) {
        const lastItem = pageRows[pageRows.length - 1];
        nextCursor = encodeCursor(buildCursorFromItem(lastItem, sort, fetchedAt));
      }

      // ── Merge Redis trending set (cosmetic badge override) ─────────────
      let redisTrendingIds: Set<string> = new Set();
      try {
        const redis = this.redisService.getClient();
        const ids = await redis.zrange("trending:questions", 0, 4, { rev: true });
        redisTrendingIds = new Set(ids.filter((id): id is string => typeof id === "string"));
      } catch {
        // Non-fatal — trending badge is cosmetic
      }

      return {
        questions: pageRows.map((row) => this.toFeedResponse(row, redisTrendingIds)),
        next_cursor: nextCursor,
        fetched_at: fetchedAt,
      };
    }, {
      label: "QuestionsService.getFeed",
    });
  }

  private toFeedResponse(row: FeedRow, redisTrendingIds: Set<string>) {
    return {
      id:               row.id,
      text:             row.text,
      context:          row.context ?? null,
      category:         row.category,
      language:         row.language,
      status:           row.status,
      yes_count:        row.yes_count,
      no_count:         row.no_count,
      yes_percent:      row.yes_percent,
      total_votes:      row.total_votes,
      takes_count:      row.takes_count,
      expires_at:       row.expires_at,
      created_at:       row.created_at,
      user_voted:       row.user_voted,
      user_has_engaged: row.user_has_engaged,
      is_own:           row.is_own,
      is_trending:      row.is_trending || redisTrendingIds.has(row.id),
    };
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
        context: createQuestionDto.context?.trim() ?? null,
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
      context: question.context ?? null,
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
      takes_count: question.takesCount,
    };
  }
}
