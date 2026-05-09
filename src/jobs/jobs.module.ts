import { Module } from "@nestjs/common";

import { JobsService } from "./jobs.service";
import { NotificationTriggersService } from "./notification-triggers.service";
import { PushService } from "./push.service";

@Module({
  providers: [PushService, NotificationTriggersService, JobsService],
  exports: [PushService, NotificationTriggersService],
})
export class JobsModule {}
