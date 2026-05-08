import { Injectable, NestMiddleware, UnauthorizedException } from "@nestjs/common";
import { NextFunction, Response } from "express";

import { RequestWithDevice } from "../types/request-with-device.interface";

@Injectable()
export class DeviceAuthMiddleware implements NestMiddleware {
  use(req: RequestWithDevice, _res: Response, next: NextFunction) {
    const deviceIdHeader = req.header("X-Device-ID") ?? req.header("x-device-id");

    if (!deviceIdHeader || !deviceIdHeader.trim()) {
      throw new UnauthorizedException({ error: "missing_device_id" });
    }

    req.deviceId = deviceIdHeader;
    next();
  }
}
