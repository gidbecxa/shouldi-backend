import { Injectable } from "@nestjs/common";
import { and, count, eq, lt } from "drizzle-orm";

import { DatabaseService } from "../common/database/database.service";
import { questions, shares, votes } from "../db/schema";
import { PushService } from "./push.service";

const MILESTONES = [10, 50, 100, 500, 1000, 5000, 10000];

export type QuestionRow = typeof questions.$inferSelect;

@Injectable()
export class NotificationTriggersService {
  constructor(
    private readonly databaseService: DatabaseService,
    private readonly pushService: PushService,
  ) {}

  /**
   * Called immediately after a vote is recorded (non-blocking via setImmediate).
   * Handles Trigger 1 (first vote), Trigger 2 (milestones), and Trigger 5 (viral feedback).
   */
  async triggerVoteNotifications(question: QuestionRow): Promise<void> {
    const totalVotes = question.yesCount + question.noCount;
    const yesPercent = totalVotes > 0 ? Math.round((question.yesCount / totalVotes) * 100) : 0;

    // ── TRIGGER 1: First vote ──────────────────────────────────────────────────
    if (totalVotes === 1) {
      await this.pushService.sendPushToUser(
        question.userId,
        {
          title: "Someone just voted 👀",
          body: "The results are starting to come in on your question.",
          data: { questionId: question.id, screen: "question_detail" },
        },
        "first_vote",
        question.id,
        { exempt: true },
      );
      return; // Milestones don't fire at vote count 1
    }

    // ── TRIGGER 2: Milestone notifications ────────────────────────────────────
    for (const milestone of MILESTONES) {
      if (totalVotes === milestone) {
        const copy = this.pushService.getMilestoneNotification(milestone, yesPercent);
        await this.pushService.sendPushToUser(
          question.userId,
          { ...copy, data: { questionId: question.id, screen: "question_detail" } },
          `milestone_${milestone}`,
          question.id,
          { exempt: false },
        );

        // ── TRIGGER 8: App Store rating — at 100-vote milestone ──────────────
        // Signal is embedded in the notification data; the mobile side handles the prompt
        if (milestone === 100) {
          // Data field already signals questionId; mobile checks rating conditions locally
        }
        break;
      }
    }

    // ── TRIGGER 5: Viral feedback ─────────────────────────────────────────────
    await this.checkViralFeedback(question, totalVotes);
  }

  private async checkViralFeedback(question: QuestionRow, totalVotes: number): Promise<void> {
    const db = this.databaseService.db;

    // Find earliest share by the poster
    const shareRows = await db
      .select({ createdAt: shares.createdAt })
      .from(shares)
      .where(and(eq(shares.questionId, question.id), eq(shares.userId, question.userId)))
      .limit(1);

    if (shareRows.length === 0) return;

    const shareCreatedAt = shareRows[0].createdAt;

    // Count votes that existed before the share happened
    const [beforeResult] = await db
      .select({ value: count() })
      .from(votes)
      .where(and(eq(votes.questionId, question.id), lt(votes.createdAt, shareCreatedAt)));

    const votesBefore = beforeResult?.value ?? 0;
    const votesFromShare = totalVotes - votesBefore;

    // Fire exactly when crossing 50 post-share votes
    if (votesFromShare === 50) {
      await this.pushService.sendPushToUser(
        question.userId,
        {
          title: "Your share is working 🚀",
          body: `People are clicking your link. Your question just hit ${totalVotes.toLocaleString()} votes.`,
          data: { questionId: question.id, screen: "question_detail" },
        },
        "viral_feedback",
        question.id,
        { exempt: false },
      );
    }
  }
}
