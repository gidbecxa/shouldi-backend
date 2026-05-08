import {
  Injectable,
  InternalServerErrorException,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { eq } from "drizzle-orm";
import { OAuth2Client } from "google-auth-library";

import { AuthTokenService } from "../common/auth-token.service";
import { CurrentUserService } from "../common/current-user.service";
import { DatabaseService } from "../common/database/database.service";
import { users } from "../db/schema";

const userSessionProjection = {
  id: users.id,
  deviceId: users.deviceId,
  googleSub: users.googleSub,
  email: users.email,
  displayName: users.displayName,
  avatarUrl: users.avatarUrl,
  isBanned: users.isBanned,
};

type UserSessionRow = {
  id: string;
  deviceId: string;
  googleSub: string | null;
  email: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  isBanned: boolean;
};

type GoogleIdentity = {
  sub: string;
  email: string | null;
  displayName: string | null;
  avatarUrl: string | null;
};

@Injectable()
export class AuthService {
  private readonly googleClient = new OAuth2Client();

  constructor(
    private readonly currentUserService: CurrentUserService,
    private readonly authTokenService: AuthTokenService,
    private readonly databaseService: DatabaseService,
    private readonly configService: ConfigService,
  ) {}

  private get db() {
    return this.databaseService.db;
  }

  private get googleAudience() {
    const configuredAudience = this.configService
      .get<string>("GOOGLE_AUTH_CLIENT_IDS", "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);

    if (configuredAudience.length === 0) {
      throw new InternalServerErrorException("GOOGLE_AUTH_CLIENT_IDS is not configured.");
    }

    return configuredAudience;
  }

  async createOrGetSession(deviceId: string) {
    const currentUser = await this.currentUserService.getOrCreate(deviceId);
    const row = await this.findSessionRowByUserId(currentUser.id);

    if (!row) {
      throw new InternalServerErrorException("Failed to load session user.");
    }

    return this.toSessionResponse(row);
  }

  async signInWithGoogle(idToken: string, deviceId?: string) {
    const googleIdentity = await this.verifyGoogleIdToken(idToken);
    const normalizedDeviceId = deviceId?.trim() ? deviceId.trim() : null;

    const existing = await this.findSessionRowByGoogleIdentity(
      googleIdentity.sub,
      googleIdentity.email,
      normalizedDeviceId,
    );

    if (existing) {
      const updated = await this.updateIdentity(existing.id, googleIdentity);
      return this.toSessionResponse(updated);
    }

    const fallbackDeviceId = normalizedDeviceId ?? `google:${googleIdentity.sub}`;

    const inserted = await this.db
      .insert(users)
      .values({
        deviceId: fallbackDeviceId,
        googleSub: googleIdentity.sub,
        email: googleIdentity.email,
        displayName: googleIdentity.displayName,
        avatarUrl: googleIdentity.avatarUrl,
      })
      .onConflictDoNothing()
      .returning(userSessionProjection);

    if (inserted.length > 0) {
      return this.toSessionResponse(inserted[0] as UserSessionRow);
    }

    const recovered = await this.findSessionRowByGoogleIdentity(
      googleIdentity.sub,
      googleIdentity.email,
      normalizedDeviceId,
    );

    if (!recovered) {
      throw new InternalServerErrorException("Failed to create Google-authenticated user.");
    }

    const updatedRecovered = await this.updateIdentity(recovered.id, googleIdentity);
    return this.toSessionResponse(updatedRecovered);
  }

  async getMe(userId: string) {
    const row = await this.findSessionRowByUserId(userId);

    if (!row) {
      throw new UnauthorizedException({ error: "invalid_user" });
    }

    return this.toProfileResponse(row);
  }

  private async findSessionRowByUserId(userId: string) {
    const rows = await this.db
      .select(userSessionProjection)
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    return (rows[0] as UserSessionRow | undefined) ?? null;
  }

  private async findSessionRowByGoogleIdentity(
    googleSub: string,
    email: string | null,
    deviceId: string | null,
  ) {
    const byGoogleSub = await this.db
      .select(userSessionProjection)
      .from(users)
      .where(eq(users.googleSub, googleSub))
      .limit(1);

    if (byGoogleSub.length > 0) {
      return byGoogleSub[0] as UserSessionRow;
    }

    if (email) {
      const byEmail = await this.db
        .select(userSessionProjection)
        .from(users)
        .where(eq(users.email, email))
        .limit(1);

      if (byEmail.length > 0) {
        return byEmail[0] as UserSessionRow;
      }
    }

    if (deviceId) {
      const byDevice = await this.db
        .select(userSessionProjection)
        .from(users)
        .where(eq(users.deviceId, deviceId))
        .limit(1);

      if (byDevice.length > 0) {
        return byDevice[0] as UserSessionRow;
      }
    }

    return null;
  }

  private async updateIdentity(userId: string, identity: GoogleIdentity) {
    const updated = await this.db
      .update(users)
      .set({
        googleSub: identity.sub,
        email: identity.email,
        displayName: identity.displayName,
        avatarUrl: identity.avatarUrl,
      })
      .where(eq(users.id, userId))
      .returning(userSessionProjection);

    if (updated.length === 0) {
      throw new InternalServerErrorException("Failed to update authenticated profile.");
    }

    return updated[0] as UserSessionRow;
  }

  private async verifyGoogleIdToken(idToken: string): Promise<GoogleIdentity> {
    try {
      const ticket = await this.googleClient.verifyIdToken({
        idToken,
        audience: this.googleAudience,
      });

      const payload = ticket.getPayload();
      const googleSub = payload?.sub?.trim();
      if (!googleSub) {
        throw new UnauthorizedException({ error: "invalid_google_token" });
      }

      return {
        sub: googleSub,
        email: payload?.email ? payload.email.toLowerCase() : null,
        displayName: payload?.name ?? null,
        avatarUrl: payload?.picture ?? null,
      };
    } catch {
      throw new UnauthorizedException({ error: "invalid_google_token" });
    }
  }

  private toSessionResponse(row: UserSessionRow) {
    return {
      access_token: this.authTokenService.signAccessToken(row.id),
      user_id: row.id,
      is_banned: row.isBanned,
      auth_provider: row.googleSub ? "google" : "anonymous",
      profile: {
        email: row.email,
        display_name: row.displayName,
        avatar_url: row.avatarUrl,
      },
    };
  }

  private toProfileResponse(row: UserSessionRow) {
    return {
      user_id: row.id,
      is_banned: row.isBanned,
      auth_provider: row.googleSub ? "google" : "anonymous",
      profile: {
        email: row.email,
        display_name: row.displayName,
        avatar_url: row.avatarUrl,
      },
    };
  }
}
