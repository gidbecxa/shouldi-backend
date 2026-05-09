import { Module } from "@nestjs/common";

import { JobsModule } from "../jobs/jobs.module";
import { ContentFilterService } from "./content-filter.service";
import { QuestionRateLimitGuard } from "./question-rate-limit.guard";
import { QuestionsController } from "./questions.controller";
import { QuestionsService } from "./questions.service";

@Module({
  imports: [JobsModule],
  controllers: [QuestionsController],
  providers: [QuestionsService, ContentFilterService, QuestionRateLimitGuard],
})
export class QuestionsModule {}
