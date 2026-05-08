import { Injectable, NestMiddleware, UnauthorizedException } from "@nestjs/common";
import { NextFunction, Response } from "express";

import { AuthTokenService } from "../auth-token.service";
import { CurrentUserService } from "../current-user.service";
import { RequestWithDevice } from "../types/request-with-device.interface";

@Injectable()
export class AuthMiddleware implements NestMiddleware {
  constructor(
    private readonly authTokenService: AuthTokenService,
    private readonly currentUserService: CurrentUserService,
  ) {}

  async use(req: RequestWithDevice, _res: Response, next: NextFunction) {
    const authorizationHeader = req.header("Authorization") ?? req.header("authorization");
    const accessToken = this.authTokenService.extractBearerToken(authorizationHeader);

    if (accessToken) {
      const tokenPayload = this.authTokenService.verifyAccessToken(accessToken);
      req.userId = tokenPayload.sub;
      next();
      return;
    }

    // Backward-compatible fallback for older device-id clients while rollout completes.
    const deviceIdHeader = req.header("X-Device-ID") ?? req.header("x-device-id");
    if (deviceIdHeader?.trim()) {
      const currentUser = await this.currentUserService.getOrCreate(deviceIdHeader.trim());
      req.userId = currentUser.id;
      req.deviceId = deviceIdHeader.trim();
      next();
      return;
    }

    throw new UnauthorizedException({
      error: "missing_auth",
      message: "Provide Authorization: Bearer <token>.",
    });
  }
}
