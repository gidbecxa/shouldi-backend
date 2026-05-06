import { Router } from "express";
import { z } from "zod";

import { deviceAuth } from "../middleware/deviceAuth";

export const usersRouter = Router();

const pushTokenSchema = z.object({
  push_token: z.string().trim().min(10),
});

usersRouter.patch("/me/push-token", deviceAuth, (req, res) => {
  const parsed = pushTokenSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_request" });
    return;
  }

  res.status(200).json({ ok: true });
});
