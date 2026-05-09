import { MiddlewareConsumer, Module, NestModule, RequestMethod } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { APP_FILTER, APP_GUARD } from "@nestjs/core";
import { ScheduleModule } from "@nestjs/schedule";
import { ThrottlerGuard, ThrottlerModule } from "@nestjs/throttler";

import { AdminModule } from "./admin/admin.module";
import { AuthModule } from "./auth/auth.module";
import { CommonModule } from "./common/common.module";
import { DatabaseModule } from "./common/database/database.module";
import { TransientDatabaseExceptionFilter } from "./common/filters/transient-database-exception.filter";
import { AuthMiddleware } from "./common/middleware/auth.middleware";
import { HealthModule } from "./health/health.module";
import { JobsModule } from "./jobs/jobs.module";
import { LibModule } from "./lib/lib.module";
import { QuestionsModule } from "./questions/questions.module";
import { StatsModule } from "./stats/stats.module";
import { UsersModule } from "./users/users.module";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    ThrottlerModule.forRoot([
      {
        ttl: 60_000,
        limit: 120,
      },
    ]),
    LibModule,
    DatabaseModule,
    CommonModule,
    HealthModule,
    AuthModule,
    QuestionsModule,
    UsersModule,
    AdminModule,
    JobsModule,
    StatsModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
    {
      provide: APP_FILTER,
      useClass: TransientDatabaseExceptionFilter,
    },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(AuthMiddleware).forRoutes(
      { path: "questions", method: RequestMethod.GET },
      { path: "questions", method: RequestMethod.POST },
      { path: "questions/:id", method: RequestMethod.GET },
      { path: "questions/:id/vote", method: RequestMethod.POST },
      { path: "questions/:id/share", method: RequestMethod.POST },
      { path: "questions/:id/report", method: RequestMethod.POST },
      { path: "auth/me", method: RequestMethod.GET },
      { path: "users/me/questions", method: RequestMethod.GET },
      { path: "users/me/push-token", method: RequestMethod.PATCH },
      { path: "users/me/timezone", method: RequestMethod.PATCH },
    );
  }
}
