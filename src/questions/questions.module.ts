import { Module } from "@nestjs/common";

import { JobsModule } from "../jobs/jobs.module";
import { ContentFilterService } from "./content-filter.service";
import { QuestionRateLimitGuard } from "./question-rate-limit.guard";
import { QuestionsController } from "./questions.controller";
import { QuestionsService } from "./questions.service";
import { TakesController } from "./takes.controller";
import { TakesService } from "./takes.service";

@Module({
  imports: [JobsModule],
  controllers: [QuestionsController, TakesController],
  providers: [QuestionsService, ContentFilterService, QuestionRateLimitGuard, TakesService],
})
export class QuestionsModule {}
