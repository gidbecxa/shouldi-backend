import { Injectable, OnApplicationShutdown } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import * as schema from "../../db/schema";

@Injectable()
export class DatabaseService implements OnApplicationShutdown {
  readonly pool: Pool;
  readonly db: NodePgDatabase<typeof schema>;

  constructor(private readonly configService: ConfigService) {
    const connectionString = this.configService.getOrThrow<string>("DATABASE_URL");
    const nodeEnv = this.configService.get<string>("NODE_ENV", "development");

    const needsSsl = nodeEnv === "production" || connectionString.includes("supabase.co");
    const maxConnections = this.getNumberFromConfig("DATABASE_POOL_MAX", 10);
    const minConnections = Math.min(
      this.getNumberFromConfig("DATABASE_POOL_MIN", 1),
      maxConnections,
    );
    const idleTimeoutMillis = this.getNumberFromConfig("DATABASE_POOL_IDLE_MS", 60_000);
    const connectionTimeoutMillis = this.getNumberFromConfig(
      "DATABASE_POOL_CONNECT_TIMEOUT_MS",
      10_000,
    );

    this.pool = new Pool({
      connectionString,
      ssl: needsSsl ? { rejectUnauthorized: false } : false,
      max: maxConnections,
      min: minConnections,
      idleTimeoutMillis,
      connectionTimeoutMillis,
      keepAlive: true,
      keepAliveInitialDelayMillis: 10_000,
    });

    this.pool.on("error", (error) => {
      console.error("[db] Idle pool client error", error);
    });

    this.db = drizzle(this.pool, { schema });
  }

  private getNumberFromConfig(key: string, fallback: number) {
    const raw = this.configService.get<string>(key);
    if (!raw) {
      return fallback;
    }

    const parsed = Number.parseInt(raw, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return fallback;
    }

    return parsed;
  }

  async check(): Promise<void> {
    await this.pool.query("select 1");
  }

  async onApplicationShutdown(): Promise<void> {
    await this.pool.end();
  }
}
