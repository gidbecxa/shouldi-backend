import { Request } from "express";

export interface RequestWithDevice extends Request {
  userId: string;
  deviceId?: string;
}
