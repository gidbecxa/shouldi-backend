import { Module } from "@nestjs/common";

import { ContentFilterService } from "./content-filter.service";
import { QuestionRateLimitGuard } from "./question-rate-limit.guard";
import { QuestionsController } from "./questions.controller";
import { QuestionsService } from "./questions.service";

@Module({
  controllers: [QuestionsController],
  providers: [QuestionsService, ContentFilterService, QuestionRateLimitGuard],
})
export class QuestionsModule {}
