import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";

import { RequestWithDevice } from "../common/types/request-with-device.interface";
import { CreateQuestionDto } from "./dto/create-question.dto";
import { ReportDto } from "./dto/report.dto";
import { ShareDto } from "./dto/share.dto";
import { VoteDto } from "./dto/vote.dto";
import { QuestionRateLimitGuard } from "./question-rate-limit.guard";
import { QuestionsService } from "./questions.service";

@Controller("questions")
export class QuestionsController {
  constructor(private readonly questionsService: QuestionsService) {}

  @Get()
  async getQuestions(
    @Req() req: RequestWithDevice,
    @Query("cursor") cursor?: string,
    @Query("category") category?: string,
    @Query("sort") sort: "recent" | "hot" = "recent",
    @Query("limit") limit?: string,
  ) {
    const parsedLimit = Number.parseInt(limit ?? "20", 10);
    return this.questionsService.getFeed(req, category, sort, cursor, parsedLimit);
  }

  @Get(":id")
  async getQuestion(@Param("id") id: string, @Req() req: RequestWithDevice) {
    return this.questionsService.getQuestionById(id, req);
  }

  @Post()
  @UseGuards(QuestionRateLimitGuard)
  async createQuestion(@Body() createQuestionDto: CreateQuestionDto, @Req() req: RequestWithDevice) {
    return this.questionsService.createQuestion(createQuestionDto, req);
  }

  @Post(":id/vote")
  async vote(@Param("id") id: string, @Body() voteDto: VoteDto, @Req() req: RequestWithDevice) {
    return this.questionsService.vote(id, voteDto, req);
  }

  @Post(":id/share")
  async logShare(@Param("id") id: string, @Body() shareDto: ShareDto, @Req() req: RequestWithDevice) {
    return this.questionsService.logShare(id, shareDto, req);
  }

  @Post(":id/report")
  async report(@Param("id") id: string, @Body() reportDto: ReportDto, @Req() req: RequestWithDevice) {
    return this.questionsService.report(id, reportDto, req);
  }

  @Get(":id/share-card")
  @Header("Content-Type", "image/png")
  async getShareCard(@Param("id") id: string) {
    return this.questionsService.shareCardPng(id);
  }
}
