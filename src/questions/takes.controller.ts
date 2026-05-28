import { Body, Controller, Delete, Get, Param, Post, Query, Req } from "@nestjs/common";

import { RequestWithDevice } from "../common/types/request-with-device.interface";
import { CreateTakeDto } from "./dto/create-take.dto";
import { TakesService } from "./takes.service";

@Controller("questions/:questionId/takes")
export class TakesController {
  constructor(private readonly takesService: TakesService) {}

  @Get()
  getTakes(
    @Param("questionId") questionId: string,
    @Query("cursor") cursor?: string,
    @Query("limit") limit?: string,
  ) {
    return this.takesService.getTakes(questionId, cursor, limit ? parseInt(limit, 10) : 20);
  }

  @Post()
  createTake(
    @Param("questionId") questionId: string,
    @Body() dto: CreateTakeDto,
    @Req() request: RequestWithDevice,
  ) {
    return this.takesService.createTake(questionId, dto.content, request);
  }

  @Delete(":takeId")
  deleteTake(@Param("takeId") takeId: string, @Req() request: RequestWithDevice) {
    return this.takesService.deleteTake(takeId, request);
  }

  @Post(":takeId/report")
  reportTake(@Param("takeId") takeId: string) {
    return this.takesService.reportTake(takeId);
  }
}
