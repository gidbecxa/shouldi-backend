import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { Request } from "express";

@Injectable()
export class AdminSecretGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const authHeader = request.headers.authorization;
    const token = typeof authHeader === "string" ? authHeader.replace("Bearer ", "") : null;
    const adminSecret = process.env.ADMIN_SECRET;

    if (!token || !adminSecret || token !== adminSecret) {
      throw new UnauthorizedException({ error: "unauthorized" });
    }

    return true;
  }
}
