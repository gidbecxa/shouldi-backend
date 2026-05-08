import { Global, Module } from "@nestjs/common";

import { AuthTokenService } from "./auth-token.service";
import { CurrentUserService } from "./current-user.service";

@Global()
@Module({
  providers: [CurrentUserService, AuthTokenService],
  exports: [CurrentUserService, AuthTokenService],
})
export class CommonModule {}
