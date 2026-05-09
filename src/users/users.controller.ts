import { Body, Controller, Get, Param, Patch, Req } from "@nestjs/common";

import { RequestWithDevice } from "../common/types/request-with-device.interface";
import { UpdatePushTokenDto } from "./dto/update-push-token.dto";
import { UpdateTimezoneDto } from "./dto/update-timezone.dto";
import { UsersService } from "./users.service";

@Controller("users")
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get("me/questions")
  async getMyQuestions(@Req() req: RequestWithDevice) {
    return this.usersService.getMyQuestions(req);
  }

  @Patch("me/questions/:id/delete")
  async deleteMyQuestion(@Req() req: RequestWithDevice, @Param("id") id: string) {
    return this.usersService.deleteMyQuestion(req, id);
  }

  @Patch("me/push-token")
  async updatePushToken(@Req() req: RequestWithDevice, @Body() body: UpdatePushTokenDto) {
    return this.usersService.updatePushToken(req, body);
  }

  @Patch("me/timezone")
  async updateTimezone(@Req() req: RequestWithDevice, @Body() body: UpdateTimezoneDto) {
    return this.usersService.updateTimezone(req, body);
  }
}
