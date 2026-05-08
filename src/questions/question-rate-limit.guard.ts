import { CanActivate, ExecutionContext, HttpException, HttpStatus, Injectable } from "@nestjs/common";

import { RequestWithDevice } from "../common/types/request-with-device.interface";

const ONE_HOUR_MS = 60 * 60 * 1000;
const MAX_PER_HOUR = 5;

@Injectable()
export class QuestionRateLimitGuard implements CanActivate {
  private readonly submissions = new Map<string, number[]>();

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<RequestWithDevice>();
    const userId = request.userId;

    if (!userId) {
      return true;
    }

    const now = Date.now();
    const recentSubmissions = (this.submissions.get(userId) ?? []).filter(
      (timestamp) => now - timestamp < ONE_HOUR_MS,
    );

    if (recentSubmissions.length >= MAX_PER_HOUR) {
      throw new HttpException(
        {
          error: "rate_limit_exceeded",
          message: "Max 5 questions per hour.",
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    recentSubmissions.push(now);
    this.submissions.set(userId, recentSubmissions);

    return true;
  }
}
