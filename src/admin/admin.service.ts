import { Injectable, InternalServerErrorException } from "@nestjs/common";
import { and, desc, eq, ne } from "drizzle-orm";

import { DatabaseService } from "../common/database/database.service";
import { withTransientDatabaseRetry } from "../common/database/transient-database.util";
import { qotd, questions, users } from "../db/schema";
import { UpdateQuestionStatusDto } from "./dto/update-question-status.dto";

@Injectable()
export class AdminService {
  constructor(private readonly databaseService: DatabaseService) {}

  private get db() {
    return this.databaseService.db;
  }

  async listFlaggedQuestions() {
    return withTransientDatabaseRetry(async () => {
      const rows = await this.db
        .select({
          id: questions.id,
          userId: questions.userId,
          text: questions.text,
          category: questions.category,
          yesCount: questions.yesCount,
          noCount: questions.noCount,
          createdAt: questions.createdAt,
        })
        .from(questions)
        .where(eq(questions.status, "flagged"))
        .orderBy(desc(questions.createdAt))
        .limit(200);

      return {
        questions: rows.map((r) => ({
          id: r.id,
          user_id: r.userId,
          text: r.text,
          category: r.category,
          yes_count: r.yesCount,
          no_count: r.noCount,
          created_at: r.createdAt.toISOString(),
        })),
      };
    }, {
      label: "AdminService.listFlaggedQuestions",
    });
  }

  async updateQuestionStatus(id: string, body: UpdateQuestionStatusDto) {
    const nextStatus = body.status === "approved" ? "active" : "deleted";

    try {
      await this.db.update(questions).set({ status: nextStatus }).where(eq(questions.id, id));
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "unknown error";
      throw new InternalServerErrorException(message);
    }

    return { id, updated: true };
  }

  async banUser(id: string) {
    try {
      await this.db
        .update(users)
        .set({ isBanned: true, banReason: "admin_action" })
        .where(and(eq(users.id, id), ne(users.isBanned, true)));
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "unknown error";
      throw new InternalServerErrorException(message);
    }

    return { id, banned: true };
  }

  async setQotd(questionId: string) {
    const today = new Date().toISOString().split("T")[0]!;

    try {
      await this.db
        .insert(qotd)
        .values({ questionId, date: today, isManual: true })
        .onConflictDoUpdate({
          target: qotd.date,
          set: { questionId, isManual: true },
        });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "unknown error";
      throw new InternalServerErrorException(message);
    }

    return { ok: true, date: today, question_id: questionId };
  }
}

