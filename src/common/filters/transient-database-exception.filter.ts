import {
  ArgumentsHost,
  Catch,
  HttpStatus,
  Injectable,
  Logger,
} from "@nestjs/common";
import { BaseExceptionFilter, HttpAdapterHost } from "@nestjs/core";
import { isTransientDatabaseException } from "../database/transient-database.util";

@Injectable()
@Catch()
export class TransientDatabaseExceptionFilter extends BaseExceptionFilter {
  private readonly logger = new Logger(TransientDatabaseExceptionFilter.name);

  constructor(adapterHost: HttpAdapterHost) {
    super(adapterHost.httpAdapter);
  }

  override catch(exception: unknown, host: ArgumentsHost) {
    if (host.getType() !== "http") {
      super.catch(exception, host);
      return;
    }

    if (!isTransientDatabaseException(exception)) {
      super.catch(exception, host);
      return;
    }

    const ctx = host.switchToHttp();
    const request = ctx.getRequest<{ method?: string; url?: string }>();
    const response = ctx.getResponse<{ status: (value: number) => { json: (value: unknown) => void } }>();

    this.logger.warn(
      `Transient database connectivity issue on ${request.method ?? "UNKNOWN"} ${request.url ?? "UNKNOWN"}`,
    );

    response.status(HttpStatus.SERVICE_UNAVAILABLE).json({
      error: "service_unavailable",
      message: "Database is temporarily unavailable. Please retry.",
    });
  }
}
