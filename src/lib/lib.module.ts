import { Global, Module } from "@nestjs/common";

import { RedisService } from "./redis.service";
import { SupabaseService } from "./supabase.service";

@Global()
@Module({
  providers: [SupabaseService, RedisService],
  exports: [SupabaseService, RedisService],
})
export class LibModule {}
