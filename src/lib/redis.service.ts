import { Injectable } from "@nestjs/common";
import { Redis } from "@upstash/redis";

@Injectable()
export class RedisService {
  private client: Redis | null = null;

  getClient() {
    if (this.client) {
      return this.client;
    }

    const url = process.env.UPSTASH_REDIS_URL;
    const token = process.env.UPSTASH_REDIS_TOKEN;

    if (!url || !token) {
      throw new Error("UPSTASH_REDIS_URL and UPSTASH_REDIS_TOKEN are required.");
    }

    this.client = new Redis({ url, token });
    return this.client;
  }
}
