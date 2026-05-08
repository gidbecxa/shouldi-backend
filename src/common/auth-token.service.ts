import { Injectable, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import jwt from "jsonwebtoken";

type AccessTokenPayload = {
  sub: string;
};

@Injectable()
export class AuthTokenService {
  constructor(private readonly configService: ConfigService) {}

  private get secret() {
    return this.configService.getOrThrow<string>("JWT_SECRET");
  }

  signAccessToken(userId: string) {
    return jwt.sign({ sub: userId }, this.secret, {
      expiresIn: "30d",
    });
  }

  verifyAccessToken(token: string): AccessTokenPayload {
    try {
      const decoded = jwt.verify(token, this.secret);

      if (typeof decoded === "string" || typeof decoded.sub !== "string") {
        throw new UnauthorizedException({ error: "invalid_token" });
      }

      return { sub: decoded.sub };
    } catch {
      throw new UnauthorizedException({ error: "invalid_token" });
    }
  }

  extractBearerToken(authorizationHeader?: string | null) {
    if (!authorizationHeader) {
      return null;
    }

    const [scheme, token] = authorizationHeader.trim().split(" ");
    if (!scheme || !token || scheme.toLowerCase() !== "bearer") {
      return null;
    }

    return token;
  }
}
