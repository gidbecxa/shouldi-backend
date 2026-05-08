import { Injectable, UnauthorizedException } from "@nestjs/common";
import { eq } from "drizzle-orm";

import { DatabaseService } from "./database/database.service";
import { users } from "../db/schema";

export type CurrentUser = {
  id: string;
  is_banned: boolean;
};

@Injectable()
export class CurrentUserService {
  constructor(private readonly databaseService: DatabaseService) {}

  private get db() {
    return this.databaseService.db;
  }

  async getOrCreate(deviceId: string): Promise<CurrentUser> {
    const existing = await this.db
      .select({ id: users.id, is_banned: users.isBanned })
      .from(users)
      .where(eq(users.deviceId, deviceId))
      .limit(1);

    if (existing.length > 0) {
      return existing[0] as CurrentUser;
    }

    const [inserted] = await this.db
      .insert(users)
      .values({ deviceId })
      .returning({ id: users.id, is_banned: users.isBanned });

    if (!inserted) {
      throw new Error("Failed to create anonymous user");
    }

    return inserted as CurrentUser;
  }

  async getById(userId: string): Promise<CurrentUser> {
    const existing = await this.db
      .select({ id: users.id, is_banned: users.isBanned })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (existing.length === 0) {
      throw new UnauthorizedException({ error: "invalid_user" });
    }

    return existing[0] as CurrentUser;
  }
}

