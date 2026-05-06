import { NextFunction, Request, Response } from "express";

export function deviceAuth(req: Request, res: Response, next: NextFunction) {
  const deviceId = req.header("X-Device-ID");

  if (!deviceId) {
    res.status(401).json({ error: "missing_device_id" });
    return;
  }

  req.deviceId = deviceId;
  next();
}
