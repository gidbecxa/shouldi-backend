import { Redis } from "@upstash/redis";

let redisClient: Redis | null = null;

export function getRedisClient() {
  if (redisClient) {
    return redisClient;
  }

  const url = process.env.UPSTASH_REDIS_URL;
  const token = process.env.UPSTASH_REDIS_TOKEN;

  if (!url || !token) {
    throw new Error("UPSTASH_REDIS_URL and UPSTASH_REDIS_TOKEN must be configured.");
  }

  redisClient = new Redis({ url, token });
  return redisClient;
}
