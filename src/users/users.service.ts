import {
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from "@nestjs/common";
import { and, desc, eq, ne } from "drizzle-orm";

import { DatabaseService } from "../common/database/database.service";
import { withTransientDatabaseRetry } from "../common/database/transient-database.util";
import { CurrentUserService } from "../common/current-user.service";
import { RequestWithDevice } from "../common/types/request-with-device.interface";
import { questions, users } from "../db/schema";
import { UpdatePushTokenDto } from "./dto/update-push-token.dto";
import { UpdateTimezoneDto } from "./dto/update-timezone.dto";

@Injectable()
export class UsersService {
  constructor(
    private readonly currentUserService: CurrentUserService,
    private readonly databaseService: DatabaseService,
  ) {}

  async updatePushToken(request: RequestWithDevice, body: UpdatePushTokenDto) {
    const currentUser = await this.currentUserService.getById(request.userId);

    try {
      await this.databaseService.db
        .update(users)
        .set({ pushToken: body.push_token })
        .where(eq(users.id, currentUser.id));
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "unknown error";
      throw new InternalServerErrorException(`Failed to update push token: ${message}`);
    }

    return { ok: true };
  }

  async getMyQuestions(request: RequestWithDevice) {
    return withTransientDatabaseRetry(async () => {
      const currentUser = await this.currentUserService.getById(request.userId);

      const rows = await this.databaseService.db
        .select({
          id: questions.id,
          text: questions.text,
          category: questions.category,
          yesCount: questions.yesCount,
          noCount: questions.noCount,
          expiresAt: questions.expiresAt,
          createdAt: questions.createdAt,
        })
        .from(questions)
        .where(and(eq(questions.userId, currentUser.id), ne(questions.status, "deleted")))
        .orderBy(desc(questions.createdAt))
        .limit(100);

      return {
        questions: rows.map((row) => {
          const totalVotes = row.yesCount + row.noCount;
          const yesPercent = totalVotes > 0 ? Math.round((row.yesCount / totalVotes) * 100) : 0;

          return {
            id: row.id,
            text: row.text,
            category: row.category,
            yes_count: row.yesCount,
            no_count: row.noCount,
            yes_percent: yesPercent,
            total_votes: totalVotes,
            expires_at: row.expiresAt.toISOString(),
            created_at: row.createdAt.toISOString(),
            user_voted: null,
            is_own: true,
          };
        }),
      };
    }, {
      label: "UsersService.getMyQuestions",
    });
  }

  async updateTimezone(request: RequestWithDevice, body: UpdateTimezoneDto) {
    const currentUser = await this.currentUserService.getById(request.userId);

    await this.databaseService.db
      .update(users)
      .set({ timezoneOffset: body.timezone_offset })
      .where(eq(users.id, currentUser.id));

    return { ok: true };
  }

  async deleteMyQuestion(request: RequestWithDevice, questionId: string) {
    const currentUser = await this.currentUserService.getById(request.userId);

    try {
      const [updated] = await this.databaseService.db
        .update(questions)
        .set({ status: "deleted" })
        .where(and(eq(questions.id, questionId), eq(questions.userId, currentUser.id)))
        .returning({ id: questions.id });

      if (!updated) {
        throw new NotFoundException("Question not found.");
      }

      return { id: updated.id, deleted: true };
    } catch (err: unknown) {
      if (err instanceof NotFoundException) {
        throw err;
      }

      const message = err instanceof Error ? err.message : "unknown error";
      throw new InternalServerErrorException(`Failed to delete question: ${message}`);
    }
  }
}

