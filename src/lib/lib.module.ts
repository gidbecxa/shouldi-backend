import { Global, Module } from "@nestjs/common";

import { EmailService } from "./email.service";
import { RedisService } from "./redis.service";
import { SupabaseService } from "./supabase.service";

@Global()
@Module({
  providers: [SupabaseService, RedisService, EmailService],
  exports: [SupabaseService, RedisService, EmailService],
})
export class LibModule {}
