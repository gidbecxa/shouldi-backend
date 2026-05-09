import { Injectable, NestMiddleware, UnauthorizedException } from "@nestjs/common";
import { eq } from "drizzle-orm";
import { NextFunction, Response } from "express";

import { AuthTokenService } from "../auth-token.service";
import { CurrentUserService } from "../current-user.service";
import { DatabaseService } from "../database/database.service";
import { users } from "../../db/schema";
import { RequestWithDevice } from "../types/request-with-device.interface";

@Injectable()
export class AuthMiddleware implements NestMiddleware {
  constructor(
    private readonly authTokenService: AuthTokenService,
    private readonly currentUserService: CurrentUserService,
    private readonly databaseService: DatabaseService,
  ) {}

  async use(req: RequestWithDevice, _res: Response, next: NextFunction) {
    const authorizationHeader = req.header("Authorization") ?? req.header("authorization");
    const accessToken = this.authTokenService.extractBearerToken(authorizationHeader);

    if (accessToken) {
      const tokenPayload = this.authTokenService.verifyAccessToken(accessToken);
      req.userId = tokenPayload.sub;
      this.touchLastActive(tokenPayload.sub);
      next();
      return;
    }

    // Backward-compatible fallback for older device-id clients while rollout completes.
    const deviceIdHeader = req.header("X-Device-ID") ?? req.header("x-device-id");
    if (deviceIdHeader?.trim()) {
      const currentUser = await this.currentUserService.getOrCreate(deviceIdHeader.trim());
      req.userId = currentUser.id;
      req.deviceId = deviceIdHeader.trim();
      this.touchLastActive(currentUser.id);
      next();
      return;
    }

    throw new UnauthorizedException({
      error: "missing_auth",
      message: "Provide Authorization: Bearer <token>.",
    });
  }

  private touchLastActive(userId: string): void {
    setImmediate(() => {
      this.databaseService.db
        .update(users)
        .set({ lastActiveAt: new Date() })
        .where(eq(users.id, userId))
        .catch((err: unknown) => {
          console.error("[auth] Failed to update last_active_at", err instanceof Error ? err.message : err);
        });
    });
  }
}
