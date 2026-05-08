import { Body, Controller, Get, Post, Req } from "@nestjs/common";

import { RequestWithDevice } from "../common/types/request-with-device.interface";

import { CreateSessionDto } from "./dto/create-session.dto";
import { GoogleSignInDto } from "./dto/google-signin.dto";
import { AuthService } from "./auth.service";

@Controller("auth")
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post("session")
  async createSession(@Body() body: CreateSessionDto) {
    return this.authService.createOrGetSession(body.device_id);
  }

  @Post("google")
  async signInWithGoogle(@Body() body: GoogleSignInDto) {
    return this.authService.signInWithGoogle(body.id_token, body.device_id);
  }

  @Get("me")
  async getMe(@Req() request: RequestWithDevice) {
    return this.authService.getMe(request.userId);
  }
}
