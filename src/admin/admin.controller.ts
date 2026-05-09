import { Body, Controller, Get, Param, Patch, Post, UseGuards } from "@nestjs/common";

import { AdminSecretGuard } from "../common/guards/admin-secret.guard";
import { AdminService } from "./admin.service";
import { SetQotdDto } from "./dto/set-qotd.dto";
import { UpdateQuestionStatusDto } from "./dto/update-question-status.dto";

@Controller("admin")
@UseGuards(AdminSecretGuard)
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Get("flagged")
  async listFlaggedQuestions() {
    return this.adminService.listFlaggedQuestions();
  }

  @Patch("questions/:id/status")
  async updateQuestionStatus(@Param("id") id: string, @Body() body: UpdateQuestionStatusDto) {
    return this.adminService.updateQuestionStatus(id, body);
  }

  @Post("users/:id/ban")
  async banUser(@Param("id") id: string) {
    return this.adminService.banUser(id);
  }

  @Patch("qotd")
  async setQotd(@Body() body: SetQotdDto) {
    return this.adminService.setQotd(body.question_id);
  }
}
